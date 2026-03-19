import http, { type IncomingMessage, type ServerResponse } from "http";
import { createHash } from "crypto";
import { URL } from "url";
import type {
  OpenFoxConfig,
  OpenFoxDatabase,
  OpenFoxIdentity,
} from "../types.js";
import { createLogger } from "../observability/logger.js";
import {
  ChainRpcClient as RpcClient,
  formatNetwork as formatNetwork,
} from "../chain/client.js";
import {
  readPaymentEnvelope,
  submitPayment,
  verifyPayment,
  writePaymentRequired,
  type PaymentRequirement,
  type VerifiedPayment,
} from "../chain/x402.js";
import { normalizeAddress } from "../chain/address.js";
import {
  buildNewsFetchServerUrl,
  type AgentDiscoveryNewsFetchServerConfig,
  type NewsFetchSourcePolicyConfig,
  type NewsFetchInvocationRequest,
  type NewsFetchInvocationResponse,
} from "./types.js";
import {
  ensureRequestNotReplayed,
  normalizeNonce,
  recordRequestNonce,
  validateRequestExpiry,
} from "./security.js";
import { fetchBoundedUrl, validateHttpTargetUrl } from "./http-fetch.js";
import { executeProviderBackend } from "./provider-backends.js";
import { formatSkillBackendStage } from "./provider-skill-spec.js";
import { runSkillBackend } from "../skills/backend-runner.js";
import {
  parseNewsFetchCaptureSkillResult,
  parseZkTlsProveSkillResult,
  parseZkTlsBundleSkillResult,
} from "./skill-backend-contracts.js";
import {
  storeZkTlsBundleRecord,
  type ProofMaterialReference,
  type ZkTlsBundleIntegrityRecord,
  type ZkTlsBundleOriginClaims,
} from "../proof-market/records.js";

const logger = createLogger("agent-discovery.news-fetch");

export interface AgentDiscoveryNewsFetchServer {
  close(): Promise<void>;
  url: string;
}

export interface StartAgentDiscoveryNewsFetchServerParams {
  identity: OpenFoxIdentity;
  config: OpenFoxConfig;
  address: string;
  db: OpenFoxDatabase;
  newsFetchConfig: AgentDiscoveryNewsFetchServerConfig;
}

interface StoredNewsFetchJob {
  jobId: string;
  requestKey: string;
  request: NewsFetchInvocationRequest;
  response: NewsFetchInvocationResponse;
  requesterIdentity: string;
  capability: string;
  createdAt: string;
}

interface NewsFetchBackendResult {
  canonicalUrl: string;
  httpStatus: number;
  contentType: string;
  articleSha256: `0x${string}`;
  articleText?: string;
  headline?: string;
  publisher?: string;
  bundleFormat: string;
  bundleSha256: `0x${string}`;
  bundle: Record<string, unknown>;
  verificationMode: "fallback_integrity" | "native_attestation";
  nativeProofStatus: "native_attested" | "fallback_only";
  zktlsAttestationSha256?: `0x${string}`;
  zktlsAttestation?: string;
  workerProvenance?: {
    worker: string;
    backend: string;
    native: boolean;
  };
  backendSummary: {
    kind: "skills" | "builtin";
    stages: string[];
  };
  sourcePolicyId?: string;
  sourcePolicyHost?: string;
  originClaims: ZkTlsBundleOriginClaims;
  verifierMaterialReferences: ProofMaterialReference[];
  integrity: ZkTlsBundleIntegrityRecord;
}

const BODY_LIMIT_BYTES = 64 * 1024;

function json(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Content-Length", Buffer.byteLength(payload));
  res.end(payload);
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > BODY_LIMIT_BYTES) {
      throw new Error("request body too large");
    }
    chunks.push(buffer);
  }
  const raw = Buffer.concat(chunks).toString("utf-8");
  return raw ? JSON.parse(raw) : {};
}

function buildNewsFetchJobId(request: NewsFetchInvocationRequest): string {
  return createHash("sha256")
    .update(
      `${request.requester.identity.value.toLowerCase()}|${request.capability}|${normalizeNonce(request.request_nonce)}`,
    )
    .digest("hex");
}

function buildNewsFetchRequestKey(request: NewsFetchInvocationRequest): string {
  return [
    "agent_discovery:news_fetch:request",
    request.requester.identity.value.toLowerCase(),
    request.capability,
    normalizeNonce(request.request_nonce),
  ].join(":");
}

function getNewsFetchJobKey(jobId: string): string {
  return `agent_discovery:news_fetch:job:${jobId}`;
}

function buildNewsFetchResultPath(jobId: string): string {
  return `/news/fetch/result/${jobId}`;
}

function buildNewsFetchBundlePath(jobId: string): string {
  return `/news/fetch/bundle/${jobId}`;
}

function buildNewsFetchAttestationPath(jobId: string): string {
  return `/news/fetch/attestation/${jobId}`;
}

function loadStoredNewsFetchJob(
  db: OpenFoxDatabase,
  jobId: string,
): StoredNewsFetchJob | null {
  const raw = db.getKV(getNewsFetchJobKey(jobId));
  if (!raw) return null;
  return JSON.parse(raw) as StoredNewsFetchJob;
}

function storeNewsFetchJob(db: OpenFoxDatabase, job: StoredNewsFetchJob): void {
  db.setKV(getNewsFetchJobKey(job.jobId), JSON.stringify(job));
  db.setKV(job.requestKey, job.jobId);
}

function matchesSourcePolicy(
  sourceUrl: URL,
  policy: NewsFetchSourcePolicyConfig,
): boolean {
  const hostname = sourceUrl.hostname.toLowerCase();
  const hostMatched = policy.allowHosts.some((host) => {
    const normalized = host.toLowerCase();
    return hostname === normalized || hostname.endsWith(`.${normalized}`);
  });
  if (!hostMatched) return false;
  if (!policy.pathPrefixes || policy.pathPrefixes.length === 0) return true;
  return policy.pathPrefixes.some((prefix) => sourceUrl.pathname.startsWith(prefix));
}

function resolveSourcePolicy(
  request: NewsFetchInvocationRequest,
  config: AgentDiscoveryNewsFetchServerConfig,
  sourceUrl: URL,
): { sourcePolicyId?: string; sourcePolicyHost?: string } {
  const policies = config.sourcePolicies ?? [];
  const requestedPolicyId =
    request.source_policy_id || config.defaultSourcePolicyId || undefined;
  if (policies.length === 0) {
    if (config.requireSourcePolicyId && !requestedPolicyId) {
      throw new Error("source_policy_id is required for this news.fetch provider");
    }
    return {
      sourcePolicyId: requestedPolicyId,
    };
  }

  if (requestedPolicyId) {
    const policy = policies.find((entry) => entry.id === requestedPolicyId);
    if (!policy) {
      throw new Error(`unknown source_policy_id ${requestedPolicyId}`);
    }
    if (!matchesSourcePolicy(sourceUrl, policy)) {
      throw new Error(`source_url is not allowed by source policy ${requestedPolicyId}`);
    }
    return {
      sourcePolicyId: policy.id,
      sourcePolicyHost: sourceUrl.hostname.toLowerCase(),
    };
  }

  const matched = policies.filter((policy) => matchesSourcePolicy(sourceUrl, policy));
  if (matched.length === 0) {
    throw new Error("source_url is not covered by any configured source policy");
  }
  if (matched.length > 1) {
    throw new Error("source_url matches multiple source policies; set source_policy_id explicitly");
  }
  return {
    sourcePolicyId: matched[0].id,
    sourcePolicyHost: sourceUrl.hostname.toLowerCase(),
  };
}

function validateRequest(
  request: NewsFetchInvocationRequest,
  config: AgentDiscoveryNewsFetchServerConfig,
): { requesterIdentity: string; sourceUrl: URL; sourcePolicyId?: string; sourcePolicyHost?: string } {
  if (request.capability !== config.capability) {
    throw new Error(`unsupported capability ${request.capability}`);
  }
  if (!request.requester?.identity?.value) {
    throw new Error("missing requester identity");
  }
  validateRequestExpiry(request.request_expires_at);
  normalizeNonce(request.request_nonce);
  if (!request.source_url || request.source_url.length > config.maxSourceUrlChars) {
    throw new Error(`source_url exceeds maxSourceUrlChars (${config.maxSourceUrlChars})`);
  }
  const sourceUrl = validateHttpTargetUrl(request.source_url, {
    allowPrivateTargets: config.allowPrivateTargets,
  });
  const sourcePolicy = resolveSourcePolicy(request, config, sourceUrl);
  return {
    requesterIdentity: request.requester.identity.value.toLowerCase(),
    sourceUrl,
    ...sourcePolicy,
  };
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function stripHtml(value: string): string {
  return normalizeWhitespace(
    value
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">"),
  );
}

function extractHeadline(contentType: string, body: Buffer): string | undefined {
  const text = body.toString("utf8");
  if (contentType.includes("application/json")) {
    try {
      const parsed = JSON.parse(text) as Record<string, unknown>;
      for (const key of ["headline", "title", "name"]) {
        const value = parsed[key];
        if (typeof value === "string" && value.trim()) {
          return normalizeWhitespace(value);
        }
      }
    } catch {
      return undefined;
    }
    return undefined;
  }
  if (contentType.includes("html")) {
    const title = text.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
    if (title) return normalizeWhitespace(stripHtml(title));
  }
  const firstLine = normalizeWhitespace(text.split(/\r?\n/)[0] || "");
  return firstLine || undefined;
}

function extractArticleText(
  contentType: string,
  body: Buffer,
  maxArticleChars: number,
): string | undefined {
  const raw = body.toString("utf8");
  let value = raw;
  if (contentType.includes("application/json")) {
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      for (const key of ["article", "content", "body", "text", "summary"]) {
        const candidate = parsed[key];
        if (typeof candidate === "string" && candidate.trim()) {
          value = candidate;
          break;
        }
      }
    } catch {
      value = raw;
    }
  } else if (contentType.includes("html")) {
    value = stripHtml(raw);
  }
  const normalized = normalizeWhitespace(value);
  if (!normalized) return undefined;
  return normalized.slice(0, maxArticleChars);
}

function buildCaptureBundle(params: {
  request: NewsFetchInvocationRequest;
  fetchedAt: number;
  canonicalUrl: string;
  articleSha256: `0x${string}`;
  articleText?: string;
  headline?: string;
  publisher?: string;
  contentType: string;
  httpStatus: number;
  sourcePolicyId?: string;
}): { bundleSha256: `0x${string}`; bundle: Record<string, unknown> } {
  const bundle = {
    version: 1,
    backend: "bounded_http_capture_v0",
    fetched_at: params.fetchedAt,
    source_url: params.request.source_url,
    canonical_url: params.canonicalUrl,
    source_policy_id: params.sourcePolicyId || null,
    publisher_hint: params.request.publisher_hint || null,
    headline_hint: params.request.headline_hint || null,
    http_status: params.httpStatus,
    content_type: params.contentType,
    article_sha256: params.articleSha256,
    headline: params.headline || null,
    publisher: params.publisher || null,
    article_preview: params.articleText || null,
  };
  const bundleSha256 = `0x${createHash("sha256").update(JSON.stringify(bundle)).digest("hex")}` as const;
  return { bundleSha256, bundle };
}

async function runBuiltinNewsFetchBackend(params: {
  request: NewsFetchInvocationRequest;
  sourceUrl: URL;
  newsFetchConfig: AgentDiscoveryNewsFetchServerConfig;
  fetchedAt: number;
  sourcePolicyId?: string;
  sourcePolicyHost?: string;
}): Promise<NewsFetchBackendResult> {
  const fetched = await fetchBoundedUrl(params.sourceUrl, {
    timeoutMs: params.newsFetchConfig.requestTimeoutMs,
    maxResponseBytes: params.newsFetchConfig.maxResponseBytes,
  });
  const articleText = extractArticleText(
    fetched.contentType,
    fetched.body,
    params.newsFetchConfig.maxArticleChars,
  );
  const headline =
    params.request.headline_hint?.trim() ||
    extractHeadline(fetched.contentType, fetched.body);
  const publisher =
    params.request.publisher_hint?.trim() || params.sourceUrl.hostname;
  const { bundleSha256, bundle } = buildCaptureBundle({
    request: params.request,
    fetchedAt: params.fetchedAt,
    canonicalUrl: fetched.canonicalUrl,
    articleSha256: fetched.bodySha256,
    articleText,
    headline,
    publisher,
    contentType: fetched.contentType,
    httpStatus: fetched.status,
    sourcePolicyId: params.sourcePolicyId,
  });
  return {
    canonicalUrl: fetched.canonicalUrl,
    httpStatus: fetched.status,
    contentType: fetched.contentType,
    articleSha256: fetched.bodySha256,
    articleText,
    headline,
    publisher,
    bundleFormat: "bounded_http_capture_v0",
    bundleSha256,
    bundle,
    verificationMode: "fallback_integrity",
    nativeProofStatus: "fallback_only",
    backendSummary: {
      kind: "builtin",
      stages: ["builtin:news.fetch"],
    },
    sourcePolicyId: params.sourcePolicyId,
    sourcePolicyHost: params.sourcePolicyHost,
    originClaims: {
      sourceUrl: params.request.source_url,
      canonicalUrl: fetched.canonicalUrl,
      sourcePolicyId: params.sourcePolicyId ?? null,
      sourcePolicyHost: params.sourcePolicyHost ?? null,
      publisherHint: params.request.publisher_hint ?? null,
      headlineHint: params.request.headline_hint ?? null,
      publisher: publisher ?? null,
      headline: headline ?? null,
      fetchedAt: params.fetchedAt,
      httpStatus: fetched.status,
      contentType: fetched.contentType,
    },
    verifierMaterialReferences: [],
    integrity: {
      bundleSha256,
      articleSha256: fetched.bodySha256,
      sourceResponseSha256: fetched.bodySha256,
    },
  };
}

async function runSkillNewsFetchBackend(params: {
  request: NewsFetchInvocationRequest;
  sourceUrl: URL;
  newsFetchConfig: AgentDiscoveryNewsFetchServerConfig;
  config: OpenFoxConfig;
  db: OpenFoxDatabase;
  fetchedAt: number;
  sourcePolicyId?: string;
  sourcePolicyHost?: string;
}): Promise<NewsFetchBackendResult> {
  const skillsDir = params.config.skillsDir || "~/.openfox/skills";
  const [captureStage, proveStage, bundleStage] = params.newsFetchConfig.skillStages;
  if (!captureStage || !proveStage || !bundleStage) {
    throw new Error(
      "news.fetch skillStages must define capture, prove, and bundle stages",
    );
  }
  const capture = parseNewsFetchCaptureSkillResult(await runSkillBackend({
    skillsDir,
    skillName: captureStage.skill,
    backendName: captureStage.backend,
    input: {
      request: params.request,
      options: {
        allowPrivateTargets: params.newsFetchConfig.allowPrivateTargets,
        requestTimeoutMs: params.newsFetchConfig.requestTimeoutMs,
        maxResponseBytes: params.newsFetchConfig.maxResponseBytes,
        maxArticleChars: params.newsFetchConfig.maxArticleChars,
      },
    },
    context: {
      config: params.config,
      db: params.db,
      now: () => new Date(),
    },
  }));
  const proof = parseZkTlsProveSkillResult(await runSkillBackend({
    skillsDir,
    skillName: proveStage.skill,
    backendName: proveStage.backend,
    input: {
      request: params.request,
      fetchedAt: params.fetchedAt,
      capture,
    },
    context: {
      config: params.config,
      db: params.db,
      now: () => new Date(),
    },
  }));
  const bundled = parseZkTlsBundleSkillResult(await runSkillBackend({
    skillsDir,
    skillName: bundleStage.skill,
    backendName: bundleStage.backend,
    input: {
      request: params.request,
      fetchedAt: params.fetchedAt,
      capture,
      proof,
    },
    context: {
      config: params.config,
      db: params.db,
      now: () => new Date(),
    },
  }));
  return {
    canonicalUrl: capture.canonicalUrl,
    httpStatus: capture.httpStatus,
    contentType: capture.contentType,
    articleSha256: capture.articleSha256,
    articleText: capture.articleText,
    headline: capture.headline,
    publisher: capture.publisher,
    bundleFormat: bundled.format,
    bundleSha256: bundled.bundleSha256,
    bundle: bundled.bundle,
    verificationMode: "native_attestation",
    nativeProofStatus: "native_attested",
    zktlsAttestationSha256: proof.attestationSha256,
    zktlsAttestation: proof.attestation,
    workerProvenance: {
      worker: "zktls.prove",
      backend: formatSkillBackendStage(proveStage),
      native: true,
    },
    backendSummary: {
      kind: "skills",
      stages: params.newsFetchConfig.skillStages.map(formatSkillBackendStage),
    },
    sourcePolicyId: params.sourcePolicyId,
    sourcePolicyHost: params.sourcePolicyHost,
    originClaims: {
      sourceUrl: params.request.source_url,
      canonicalUrl: capture.canonicalUrl,
      sourcePolicyId: params.sourcePolicyId ?? null,
      sourcePolicyHost: params.sourcePolicyHost ?? null,
      publisherHint: params.request.publisher_hint ?? null,
      headlineHint: params.request.headline_hint ?? null,
      publisher: capture.publisher ?? null,
      headline: capture.headline ?? null,
      fetchedAt: params.fetchedAt,
      httpStatus: capture.httpStatus,
      contentType: capture.contentType,
      ...(bundled.originClaims &&
      typeof bundled.originClaims === "object" &&
      !Array.isArray(bundled.originClaims)
        ? (bundled.originClaims as Partial<ZkTlsBundleOriginClaims>)
        : {}),
    },
    verifierMaterialReferences: (bundled.verifierMaterialReferences ?? [])
      .map((entry) => ({
        kind:
          typeof entry.kind === "string" && entry.kind.trim()
            ? entry.kind.trim()
            : "worker_material",
        ref:
          typeof entry.ref === "string" && entry.ref.trim()
            ? entry.ref.trim()
            : "inline://unknown",
        hash:
          typeof entry.hash === "string" && /^0x[0-9a-f]{64}$/i.test(entry.hash)
            ? (entry.hash as `0x${string}`)
            : null,
        metadata:
          entry.metadata && typeof entry.metadata === "object" && !Array.isArray(entry.metadata)
            ? (entry.metadata as Record<string, unknown>)
            : null,
      }))
      .filter((entry) => entry.ref !== "inline://unknown"),
    integrity: {
      bundleSha256: bundled.bundleSha256,
      articleSha256: capture.articleSha256,
      sourceResponseSha256:
        bundled.integrity &&
        typeof bundled.integrity.sourceResponseSha256 === "string" &&
        /^0x[0-9a-f]{64}$/i.test(bundled.integrity.sourceResponseSha256)
          ? (bundled.integrity.sourceResponseSha256 as `0x${string}`)
          : capture.articleSha256,
    },
  };
}

async function requirePayment(params: {
  req: IncomingMessage;
  res: ServerResponse;
  config: OpenFoxConfig;
  providerAddress: string;
  amountTomi: string;
}): Promise<VerifiedPayment | null> {
  const rpcUrl = params.config.rpcUrl || process.env.TOS_RPC_URL;
  if (!rpcUrl) {
    throw new Error("Chain RPC is required to run the news.fetch server");
  }
  const client = new RpcClient({ rpcUrl });
  const chainId = params.config.chainId ? BigInt(params.config.chainId) : await client.getChainId();
  const requirement: PaymentRequirement = {
    scheme: "exact",
    network: formatNetwork(chainId),
    maxAmountRequired: params.amountTomi,
    payToAddress: normalizeAddress(params.providerAddress),
    asset: "native",
    requiredDeadlineSeconds: 300,
    description: "OpenFox news.fetch payment",
  };
  const envelope = readPaymentEnvelope(params.req);
  if (!envelope) {
    writePaymentRequired(params.res, requirement);
    return null;
  }
  const verified = verifyPayment(requirement, envelope);
  await submitPayment(rpcUrl, verified);
  return verified;
}

export async function startAgentDiscoveryNewsFetchServer(
  params: StartAgentDiscoveryNewsFetchServerParams,
): Promise<AgentDiscoveryNewsFetchServer> {
  const { newsFetchConfig, config, db, address } = params;
  const path = newsFetchConfig.path.startsWith("/")
    ? newsFetchConfig.path
    : `/${newsFetchConfig.path}`;
  const healthzPath = `${path}/healthz`;
  const resultPathPrefix = "/news/fetch/result/";
  const bundlePathPrefix = "/news/fetch/bundle/";
  const attestationPathPrefix = "/news/fetch/attestation/";
  const requestPaths = new Set([path, "/news/fetch"]);

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
      if (req.method === "GET" && url.pathname === healthzPath) {
        json(res, 200, {
          ok: true,
          capability: newsFetchConfig.capability,
          priceTomi: newsFetchConfig.priceTomi,
          address,
          integration: "skill_composed",
          backendMode: newsFetchConfig.backendMode,
          skillStages: newsFetchConfig.skillStages,
        });
        return;
      }
      if (req.method === "GET" && url.pathname.startsWith(resultPathPrefix)) {
        const jobId = url.pathname.slice(resultPathPrefix.length).trim();
        if (!jobId) {
          json(res, 400, { error: "missing job id" });
          return;
        }
        const job = loadStoredNewsFetchJob(db, jobId);
        if (!job) {
          json(res, 404, { error: "job not found" });
          return;
        }
        json(res, 200, job.response);
        return;
      }
      if (req.method === "GET" && url.pathname.startsWith(bundlePathPrefix)) {
        const jobId = url.pathname.slice(bundlePathPrefix.length).trim();
        if (!jobId) {
          json(res, 400, { error: "missing job id" });
          return;
        }
        const job = loadStoredNewsFetchJob(db, jobId);
        if (!job) {
          json(res, 404, { error: "job not found" });
          return;
        }
        const bundle = job.response.metadata?.bundle;
        if (!bundle || typeof bundle !== "object") {
          json(res, 404, { error: "bundle not found" });
          return;
        }
        json(res, 200, bundle);
        return;
      }
      if (req.method === "GET" && url.pathname.startsWith(attestationPathPrefix)) {
        const jobId = url.pathname.slice(attestationPathPrefix.length).trim();
        if (!jobId) {
          json(res, 400, { error: "missing job id" });
          return;
        }
        const job = loadStoredNewsFetchJob(db, jobId);
        if (!job) {
          json(res, 404, { error: "job not found" });
          return;
        }
        const attestation = job.response.metadata?.zktls_attestation;
        if (typeof attestation !== "string" || attestation.length === 0) {
          json(res, 404, { error: "attestation not found" });
          return;
        }
        json(res, 200, {
          attestation,
          attestation_sha256: job.response.zktls_attestation_sha256 ?? null,
          verification_mode: job.response.verification_mode ?? "fallback_integrity",
        });
        return;
      }
      if (requestPaths.has(url.pathname) && req.method === "HEAD") {
        const paid = await requirePayment({
          req,
          res,
          config,
          providerAddress: address,
          amountTomi: newsFetchConfig.priceTomi,
        });
        if (paid) {
          res.statusCode = 200;
          res.end();
        }
        return;
      }
      if (req.method !== "POST" || !requestPaths.has(url.pathname)) {
        json(res, 404, { error: "not found" });
        return;
      }

      const body = (await readJsonBody(req)) as NewsFetchInvocationRequest;
      const { requesterIdentity, sourceUrl, sourcePolicyId, sourcePolicyHost } = validateRequest(body, newsFetchConfig);
      const requestKey = buildNewsFetchRequestKey(body);
      const existingJobId = db.getKV(requestKey);
      if (existingJobId) {
        const existingJob = loadStoredNewsFetchJob(db, existingJobId);
        if (!existingJob) {
          json(res, 409, { status: "rejected", reason: "news.fetch job state is inconsistent" });
          return;
        }
        if (existingJob.request.source_url !== body.source_url) {
          json(res, 409, {
            status: "rejected",
            reason: "request nonce is already bound to a different news.fetch payload",
          });
          return;
        }
        json(res, 200, { ...existingJob.response, idempotent: true });
        return;
      }

      ensureRequestNotReplayed({
        db,
        scope: "news_fetch",
        requesterIdentity,
        capability: body.capability,
        nonce: body.request_nonce,
      });

      const paid = await requirePayment({
        req,
        res,
        config,
        providerAddress: address,
        amountTomi: newsFetchConfig.priceTomi,
      });
      if (!paid) {
        return;
      }

      recordRequestNonce({
        db,
        scope: "news_fetch",
        requesterIdentity,
        capability: body.capability,
        nonce: body.request_nonce,
        expiresAt: body.request_expires_at,
      });

      const jobId = buildNewsFetchJobId(body);
      const fetchedAt = Math.floor(Date.now() / 1000);
      const backend = await executeProviderBackend({
        mode: newsFetchConfig.backendMode,
        runSkills: () =>
          runSkillNewsFetchBackend({
            request: body,
            sourceUrl,
            newsFetchConfig,
            config,
            db,
            fetchedAt,
            sourcePolicyId,
            sourcePolicyHost,
          }),
        runBuiltin: () =>
          runBuiltinNewsFetchBackend({
            request: body,
            sourceUrl,
            newsFetchConfig,
            fetchedAt,
            sourcePolicyId,
            sourcePolicyHost,
          }),
        onSkillsFailure: (error) => {
          logger.warn(
            `news.fetch skill backend failed, falling back to builtin: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        },
      });
      const result = backend.result;
      const response: NewsFetchInvocationResponse = {
        status: "ok",
        job_id: jobId,
        result_url: buildNewsFetchResultPath(jobId),
        price_tomi: newsFetchConfig.priceTomi,
        payment_tx_hash: paid.txHash,
        fetched_at: fetchedAt,
        source_url: sourceUrl.toString(),
        ...(sourcePolicyId ? { source_policy_id: sourcePolicyId } : {}),
        canonical_url: result.canonicalUrl,
        publisher: result.publisher,
        headline: result.headline,
        article_sha256: result.articleSha256,
        article_text: result.articleText,
        verification_mode: result.verificationMode,
        native_proof_status: result.nativeProofStatus,
        zktls_bundle_format: result.bundleFormat,
        zktls_bundle_sha256: result.bundleSha256,
        zktls_bundle_url: buildNewsFetchBundlePath(jobId),
        ...(result.zktlsAttestationSha256
          ? { zktls_attestation_sha256: result.zktlsAttestationSha256 }
          : {}),
        ...(result.zktlsAttestation
          ? { zktls_attestation_url: buildNewsFetchAttestationPath(jobId) }
          : {}),
        ...(result.workerProvenance ? { worker_provenance: result.workerProvenance } : {}),
        metadata: {
          publisher_hint: body.publisher_hint || null,
          headline_hint: body.headline_hint || null,
          source_policy_id: result.sourcePolicyId || null,
          source_policy_host: result.sourcePolicyHost || null,
          http_status: result.httpStatus,
          content_type: result.contentType,
          verification_mode: result.verificationMode,
          native_proof_status: result.nativeProofStatus,
          provider_backend: result.backendSummary,
          ...(result.zktlsAttestation ? { zktls_attestation: result.zktlsAttestation } : {}),
          bundle: result.bundle,
        },
      };
      storeNewsFetchJob(db, {
        jobId,
        requestKey,
        request: body,
        response,
        requesterIdentity,
        capability: body.capability,
        createdAt: new Date().toISOString(),
      });
      const verifierMaterialReferences = [
        {
          kind: "news.fetch.result",
          ref: buildNewsFetchResultPath(jobId),
          hash: null,
          metadata: {
            capability: body.capability,
          },
        },
        {
          kind: result.bundleFormat,
          ref: buildNewsFetchBundlePath(jobId),
          hash: result.bundleSha256,
          metadata: {
            sourcePolicyId: result.sourcePolicyId ?? null,
            verificationMode: result.verificationMode,
          },
        },
        ...(result.zktlsAttestationSha256
          ? [
              {
                kind: "tlsnotary_attestation",
                ref: buildNewsFetchAttestationPath(jobId),
                hash: result.zktlsAttestationSha256,
                metadata: {
                  sourcePolicyId: result.sourcePolicyId ?? null,
                },
              },
            ]
          : []),
        ...result.verifierMaterialReferences,
      ];
      storeZkTlsBundleRecord(db, {
        recordId: `zktls:${jobId}`,
        jobId,
        requestKey,
        capability: body.capability,
        requesterIdentity,
        providerBackend: result.backendSummary,
        sourceUrl: sourceUrl.toString(),
        resultUrl: buildNewsFetchResultPath(jobId),
        bundleUrl: buildNewsFetchBundlePath(jobId),
        attestationUrl: result.zktlsAttestation
          ? buildNewsFetchAttestationPath(jobId)
          : null,
        bundleFormat: result.bundleFormat,
        verificationMode: result.verificationMode,
        nativeProofStatus: result.nativeProofStatus,
        zktlsAttestationSha256: result.zktlsAttestationSha256 ?? null,
        originClaims: result.originClaims,
        verifierMaterialReferences,
        integrity: result.integrity,
        workerProvenance: result.workerProvenance ?? null,
        bundle: result.bundle,
        metadata: response.metadata ?? null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      json(res, 200, response);
    } catch (error) {
      logger.warn(
        `News fetch request failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      json(res, 400, {
        status: "rejected",
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(newsFetchConfig.port, newsFetchConfig.bindHost, () => {
      server.off("error", reject);
      resolve();
    });
  });

  const addr = server.address();
  const boundPort =
    addr && typeof addr === "object" && "port" in addr ? addr.port : newsFetchConfig.port;
  const actualURL = buildNewsFetchServerUrl({
    ...newsFetchConfig,
    port: boundPort,
  });
  logger.info(`Agent Discovery news.fetch server listening on ${actualURL}`);

  return {
    url: actualURL,
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      });
    },
  };
}
