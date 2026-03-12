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
  TOSRpcClient as RpcClient,
  formatTOSNetwork as formatNetwork,
} from "../tos/client.js";
import {
  readTOSPaymentEnvelope,
  submitTOSPayment,
  verifyTOSPayment,
  writeTOSPaymentRequired,
  type TOSPaymentRequirement,
  type VerifiedTOSPayment,
} from "../tos/x402.js";
import { normalizeTOSAddress as normalizeAddress } from "../tos/address.js";
import {
  buildProofVerifyServerUrl,
  type AgentDiscoveryProofVerifyServerConfig,
  type ProofVerifyInvocationRequest,
  type ProofVerifyInvocationResponse,
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
import { parseProofVerifySkillResult } from "./skill-backend-contracts.js";
import {
  storeProofVerificationRecord,
  type ProofMaterialReference,
} from "../proof-market/records.js";

const logger = createLogger("agent-discovery.proof-verify");

export interface AgentDiscoveryProofVerifyServer {
  close(): Promise<void>;
  url: string;
}

export interface StartAgentDiscoveryProofVerifyServerParams {
  identity: OpenFoxIdentity;
  config: OpenFoxConfig;
  address: string;
  db: OpenFoxDatabase;
  proofVerifyConfig: AgentDiscoveryProofVerifyServerConfig;
}

interface StoredProofVerifyResult {
  resultId: string;
  requestKey: string;
  request: ProofVerifyInvocationRequest;
  response: ProofVerifyInvocationResponse;
  requesterIdentity: string;
  capability: string;
  createdAt: string;
}

interface ProofVerifyBackendResult {
  verdict: ProofVerifyInvocationResponse["verdict"];
  summary: string;
  metadata: Record<string, unknown>;
  verifierReceiptSha256: `0x${string}`;
  backendSummary: {
    kind: "skills" | "builtin";
    stages: string[];
  };
  verdictReason: string;
  verifierMaterialReference?: ProofMaterialReference | null;
  boundSubjectHashes: {
    subjectSha256?: `0x${string}` | null;
    bundleSha256?: `0x${string}` | null;
    responseHash?: `0x${string}` | null;
  };
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

function buildProofVerifyResultId(request: ProofVerifyInvocationRequest): string {
  return createHash("sha256")
    .update(
      `${request.requester.identity.value.toLowerCase()}|${request.capability}|${normalizeNonce(request.request_nonce)}`,
    )
    .digest("hex");
}

function buildProofVerifyRequestKey(request: ProofVerifyInvocationRequest): string {
  return [
    "agent_discovery:proof_verify:request",
    request.requester.identity.value.toLowerCase(),
    request.capability,
    normalizeNonce(request.request_nonce),
  ].join(":");
}

function getProofVerifyResultKey(resultId: string): string {
  return `agent_discovery:proof_verify:result:${resultId}`;
}

function buildProofVerifyResultPath(resultId: string): string {
  return `/proof/verify/result/${resultId}`;
}

function loadStoredProofVerifyResult(
  db: OpenFoxDatabase,
  resultId: string,
): StoredProofVerifyResult | null {
  const raw = db.getKV(getProofVerifyResultKey(resultId));
  if (!raw) return null;
  return JSON.parse(raw) as StoredProofVerifyResult;
}

function storeProofVerifyResult(db: OpenFoxDatabase, result: StoredProofVerifyResult): void {
  db.setKV(getProofVerifyResultKey(result.resultId), JSON.stringify(result));
  db.setKV(result.requestKey, result.resultId);
}

function validateRequest(
  request: ProofVerifyInvocationRequest,
  config: AgentDiscoveryProofVerifyServerConfig,
): string {
  if (request.capability !== config.capability) {
    throw new Error(`unsupported capability ${request.capability}`);
  }
  if (!request.requester?.identity?.value) {
    throw new Error("missing requester identity");
  }
  validateRequestExpiry(request.request_expires_at);
  normalizeNonce(request.request_nonce);
  if (
    !request.subject_url &&
    !request.subject_sha256 &&
    !request.proof_bundle_url &&
    !request.proof_bundle_sha256
  ) {
    throw new Error(
      "proof.verify requires at least one of subject_url, subject_sha256, proof_bundle_url, or proof_bundle_sha256",
    );
  }
  const serializedSize = JSON.stringify(request).length;
  if (serializedSize > config.maxPayloadChars) {
    throw new Error(`request exceeds maxPayloadChars (${config.maxPayloadChars})`);
  }
  if (request.subject_url) {
    validateHttpTargetUrl(request.subject_url, {
      allowPrivateTargets: config.allowPrivateTargets,
    });
  }
  if (request.proof_bundle_url) {
    validateHttpTargetUrl(request.proof_bundle_url, {
      allowPrivateTargets: config.allowPrivateTargets,
    });
  }
  return request.requester.identity.value.toLowerCase();
}

function extractReferencedSubjectHash(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  for (const key of ["article_sha256", "subject_sha256", "content_sha256", "body_sha256"]) {
    const candidate = record[key];
    if (typeof candidate === "string" && /^0x[0-9a-f]{64}$/i.test(candidate)) {
      return candidate.toLowerCase();
    }
  }
  const metadata = record.metadata;
  if (metadata && typeof metadata === "object") {
    return extractReferencedSubjectHash(metadata);
  }
  return undefined;
}

function extractReferencedBundleHash(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  for (const key of ["zktls_bundle_sha256", "proof_bundle_sha256", "bundle_sha256"]) {
    const candidate = record[key];
    if (typeof candidate === "string" && /^0x[0-9a-f]{64}$/i.test(candidate)) {
      return candidate.toLowerCase();
    }
  }
  const metadata = record.metadata;
  if (metadata && typeof metadata === "object") {
    return extractReferencedBundleHash(metadata);
  }
  return undefined;
}

async function verifyRequestBackend(
  request: ProofVerifyInvocationRequest,
  config: AgentDiscoveryProofVerifyServerConfig,
): Promise<ProofVerifyBackendResult> {
  const checks: Array<{ label: string; ok: boolean; actual?: string; expected?: string }> = [];
  const metadata: Record<string, unknown> = {
    verifier_backend: "bounded_receipt_verifier_v0",
    verification_mode: "fallback",
  };

  if (request.subject_url) {
    const subjectUrl = validateHttpTargetUrl(request.subject_url, {
      allowPrivateTargets: config.allowPrivateTargets,
    });
    const subject = await fetchBoundedUrl(subjectUrl, {
      timeoutMs: config.requestTimeoutMs,
      maxResponseBytes: config.maxFetchBytes,
    });
    metadata.subject = {
      canonical_url: subject.canonicalUrl,
      status: subject.status,
      content_type: subject.contentType,
      sha256: subject.bodySha256,
    };
    if (request.subject_sha256) {
      checks.push({
        label: "subject_sha256",
        ok: subject.bodySha256.toLowerCase() === request.subject_sha256.toLowerCase(),
        actual: subject.bodySha256,
        expected: request.subject_sha256,
      });
    }
  } else if (request.subject_sha256) {
    metadata.subject = {
      declared_sha256: request.subject_sha256,
    };
  }

  if (request.proof_bundle_url) {
    const bundleUrl = validateHttpTargetUrl(request.proof_bundle_url, {
      allowPrivateTargets: config.allowPrivateTargets,
    });
    const bundle = await fetchBoundedUrl(bundleUrl, {
      timeoutMs: config.requestTimeoutMs,
      maxResponseBytes: config.maxFetchBytes,
    });
    let parsed: unknown;
    try {
      parsed = JSON.parse(bundle.body.toString("utf8"));
    } catch {
      parsed = undefined;
    }
    const referencedSubjectHash = extractReferencedSubjectHash(parsed);
    const referencedBundleHash = extractReferencedBundleHash(parsed);
    metadata.bundle = {
      canonical_url: bundle.canonicalUrl,
      status: bundle.status,
      content_type: bundle.contentType,
      sha256: bundle.bodySha256,
      declared_bundle_sha256: referencedBundleHash || null,
      referenced_subject_sha256: referencedSubjectHash || null,
    };
    if (request.proof_bundle_sha256) {
      checks.push({
        label: "proof_bundle_sha256",
        ok: (referencedBundleHash || bundle.bodySha256).toLowerCase() === request.proof_bundle_sha256.toLowerCase(),
        actual: referencedBundleHash || bundle.bodySha256,
        expected: request.proof_bundle_sha256,
      });
    }
    if (request.subject_sha256 && referencedSubjectHash) {
      checks.push({
        label: "bundle_subject_sha256",
        ok: referencedSubjectHash.toLowerCase() === request.subject_sha256.toLowerCase(),
        actual: referencedSubjectHash,
        expected: request.subject_sha256,
      });
    }
  } else if (request.proof_bundle_sha256) {
    metadata.bundle = {
      declared_sha256: request.proof_bundle_sha256,
    };
  }

  let verdict: ProofVerifyInvocationResponse["verdict"] = "inconclusive";
  if (checks.length > 0) {
    verdict = checks.every((entry) => entry.ok) ? "valid" : "invalid";
  }
  const verifierClass: string =
    request.proof_bundle_url || request.proof_bundle_sha256
      ? "bundle_integrity_verification"
      : "structural_verification";
  metadata.verifier_class = verifierClass;
  const summary =
    verdict === "valid"
      ? `Verified ${checks.length} proof check${checks.length === 1 ? "" : "s"} successfully.`
      : verdict === "invalid"
        ? `Verification failed for ${checks.filter((entry) => !entry.ok).length} check${checks.filter((entry) => !entry.ok).length === 1 ? "" : "s"}.`
        : "No comparable hashes were available, so the result is inconclusive.";
  metadata.checks = checks;
  const verifierReceiptSha256 = `0x${createHash("sha256").update(JSON.stringify({
    request,
    verdict,
    checks,
    metadata,
  })).digest("hex")}` as const;
  return {
    verdict,
    summary,
    metadata,
    verifierReceiptSha256,
    backendSummary: {
      kind: "builtin",
      stages: ["builtin:proof.verify"],
    },
    verdictReason:
      verdict === "valid"
        ? "all_checks_passed"
        : verdict === "invalid"
          ? "checks_failed"
          : "insufficient_comparable_hashes",
    verifierMaterialReference: request.proof_bundle_url
      ? {
            kind: verifierClass,
            ref: request.proof_bundle_url,
            hash:
              request.proof_bundle_sha256 && /^0x[0-9a-f]{64}$/i.test(request.proof_bundle_sha256)
              ? (request.proof_bundle_sha256 as `0x${string}`)
              : null,
          metadata: {
            verifier_backend: "bounded_receipt_verifier_v0",
          },
        }
      : null,
    boundSubjectHashes: {
      subjectSha256:
        request.subject_sha256 && /^0x[0-9a-f]{64}$/i.test(request.subject_sha256)
          ? (request.subject_sha256 as `0x${string}`)
          : null,
      bundleSha256:
        request.proof_bundle_sha256 && /^0x[0-9a-f]{64}$/i.test(request.proof_bundle_sha256)
          ? (request.proof_bundle_sha256 as `0x${string}`)
          : null,
      responseHash: verifierReceiptSha256,
    },
  };
}

async function runSkillProofVerifyBackend(params: {
  request: ProofVerifyInvocationRequest;
  proofVerifyConfig: AgentDiscoveryProofVerifyServerConfig;
  config: OpenFoxConfig;
  db: OpenFoxDatabase;
}): Promise<ProofVerifyBackendResult> {
  const skillsDir = params.config.skillsDir || "~/.openfox/skills";
  const [verifyStage] = params.proofVerifyConfig.skillStages;
  if (!verifyStage) {
    throw new Error("proof.verify skillStages must define a verify stage");
  }
  const result = parseProofVerifySkillResult(await runSkillBackend({
    skillsDir,
    skillName: verifyStage.skill,
    backendName: verifyStage.backend,
    input: {
      request: params.request,
      options: {
        allowPrivateTargets: params.proofVerifyConfig.allowPrivateTargets,
        requestTimeoutMs: params.proofVerifyConfig.requestTimeoutMs,
        maxFetchBytes: params.proofVerifyConfig.maxFetchBytes,
      },
    },
    context: {
      config: params.config,
      db: params.db,
      now: () => new Date(),
    },
  }));
  return {
    ...result,
    metadata: {
      ...result.metadata,
      verification_mode: "worker_backed",
    },
    backendSummary: {
      kind: "skills",
      stages: params.proofVerifyConfig.skillStages.map(formatSkillBackendStage),
    },
    verdictReason: result.verdictReason || "worker_verdict",
    verifierMaterialReference:
      result.verifierMaterialReference &&
      typeof result.verifierMaterialReference === "object"
        ? {
            kind:
              typeof result.verifierMaterialReference.kind === "string" &&
              result.verifierMaterialReference.kind.trim()
                ? result.verifierMaterialReference.kind.trim()
                : "worker_material",
            ref:
              typeof result.verifierMaterialReference.ref === "string" &&
              result.verifierMaterialReference.ref.trim()
                ? result.verifierMaterialReference.ref.trim()
                : "inline://unknown",
            hash:
              typeof result.verifierMaterialReference.hash === "string" &&
              /^0x[0-9a-f]{64}$/i.test(result.verifierMaterialReference.hash)
                ? (result.verifierMaterialReference.hash as `0x${string}`)
                : null,
            metadata:
              result.verifierMaterialReference.metadata &&
              typeof result.verifierMaterialReference.metadata === "object" &&
              !Array.isArray(result.verifierMaterialReference.metadata)
                ? (result.verifierMaterialReference.metadata as Record<string, unknown>)
                : null,
          }
        : null,
    boundSubjectHashes: {
      subjectSha256:
        result.boundSubjectHashes &&
        typeof result.boundSubjectHashes.subjectSha256 === "string" &&
        /^0x[0-9a-f]{64}$/i.test(result.boundSubjectHashes.subjectSha256)
          ? (result.boundSubjectHashes.subjectSha256 as `0x${string}`)
          : params.request.subject_sha256 &&
              /^0x[0-9a-f]{64}$/i.test(params.request.subject_sha256)
            ? (params.request.subject_sha256 as `0x${string}`)
            : null,
      bundleSha256:
        result.boundSubjectHashes &&
        typeof result.boundSubjectHashes.bundleSha256 === "string" &&
        /^0x[0-9a-f]{64}$/i.test(result.boundSubjectHashes.bundleSha256)
          ? (result.boundSubjectHashes.bundleSha256 as `0x${string}`)
          : params.request.proof_bundle_sha256 &&
              /^0x[0-9a-f]{64}$/i.test(params.request.proof_bundle_sha256)
            ? (params.request.proof_bundle_sha256 as `0x${string}`)
            : null,
      responseHash:
        result.boundSubjectHashes &&
        typeof result.boundSubjectHashes.responseHash === "string" &&
        /^0x[0-9a-f]{64}$/i.test(result.boundSubjectHashes.responseHash)
          ? (result.boundSubjectHashes.responseHash as `0x${string}`)
          : result.verifierReceiptSha256,
    },
  };
}

async function requirePayment(params: {
  req: IncomingMessage;
  res: ServerResponse;
  config: OpenFoxConfig;
  providerAddress: string;
  amountWei: string;
}): Promise<VerifiedTOSPayment | null> {
  const rpcUrl = params.config.rpcUrl || process.env.TOS_RPC_URL;
  if (!rpcUrl) {
    throw new Error("Chain RPC is required to run the proof.verify server");
  }
  const client = new RpcClient({ rpcUrl });
  const chainId = params.config.chainId ? BigInt(params.config.chainId) : await client.getChainId();
  const requirement: TOSPaymentRequirement = {
    scheme: "exact",
    network: formatNetwork(chainId),
    maxAmountRequired: params.amountWei,
    payToAddress: normalizeAddress(params.providerAddress),
    asset: "native",
    requiredDeadlineSeconds: 300,
    description: "OpenFox proof.verify payment",
  };
  const envelope = readTOSPaymentEnvelope(params.req);
  if (!envelope) {
    writeTOSPaymentRequired(params.res, requirement);
    return null;
  }
  const verified = verifyTOSPayment(requirement, envelope);
  await submitTOSPayment(rpcUrl, verified);
  return verified;
}

export async function startAgentDiscoveryProofVerifyServer(
  params: StartAgentDiscoveryProofVerifyServerParams,
): Promise<AgentDiscoveryProofVerifyServer> {
  const { proofVerifyConfig, config, db, address } = params;
  const path = proofVerifyConfig.path.startsWith("/")
    ? proofVerifyConfig.path
    : `/${proofVerifyConfig.path}`;
  const healthzPath = `${path}/healthz`;
  const resultPathPrefix = "/proof/verify/result/";
  const requestPaths = new Set([path, "/proof/verify"]);

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
      if (req.method === "GET" && url.pathname === healthzPath) {
        json(res, 200, {
          ok: true,
          capability: proofVerifyConfig.capability,
          priceWei: proofVerifyConfig.priceWei,
          address,
          integration: "skill_composed",
          backendMode: proofVerifyConfig.backendMode,
          skillStages: proofVerifyConfig.skillStages,
        });
        return;
      }
      if (req.method === "GET" && url.pathname.startsWith(resultPathPrefix)) {
        const resultId = url.pathname.slice(resultPathPrefix.length).trim();
        if (!resultId) {
          json(res, 400, { error: "missing result id" });
          return;
        }
        const result = loadStoredProofVerifyResult(db, resultId);
        if (!result) {
          json(res, 404, { error: "result not found" });
          return;
        }
        json(res, 200, result.response);
        return;
      }
      if (requestPaths.has(url.pathname) && req.method === "HEAD") {
        const paid = await requirePayment({
          req,
          res,
          config,
          providerAddress: address,
          amountWei: proofVerifyConfig.priceWei,
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

      const body = (await readJsonBody(req)) as ProofVerifyInvocationRequest;
      const requesterIdentity = validateRequest(body, proofVerifyConfig);
      const requestKey = buildProofVerifyRequestKey(body);
      const existingResultId = db.getKV(requestKey);
      if (existingResultId) {
        const existingResult = loadStoredProofVerifyResult(db, existingResultId);
        if (!existingResult) {
          json(res, 409, { status: "rejected", reason: "proof.verify result state is inconsistent" });
          return;
        }
        json(res, 200, { ...existingResult.response, idempotent: true });
        return;
      }

      ensureRequestNotReplayed({
        db,
        scope: "proof_verify",
        requesterIdentity,
        capability: body.capability,
        nonce: body.request_nonce,
      });

      const paid = await requirePayment({
        req,
        res,
        config,
        providerAddress: address,
        amountWei: proofVerifyConfig.priceWei,
      });
      if (!paid) {
        return;
      }

      recordRequestNonce({
        db,
        scope: "proof_verify",
        requesterIdentity,
        capability: body.capability,
        nonce: body.request_nonce,
        expiresAt: body.request_expires_at,
      });

      const resultId = buildProofVerifyResultId(body);
      const verifiedAt = Math.floor(Date.now() / 1000);
      const backend = await executeProviderBackend({
        mode: proofVerifyConfig.backendMode,
        runSkills: () =>
          runSkillProofVerifyBackend({
            request: body,
            proofVerifyConfig,
            config,
            db,
          }),
        runBuiltin: () => verifyRequestBackend(body, proofVerifyConfig),
        onSkillsFailure: (error) => {
          logger.warn(
            `proof.verify skill backend failed, falling back to builtin: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        },
      });
      const verification = backend.result;
      const response: ProofVerifyInvocationResponse = {
        status: "ok",
        result_id: resultId,
        result_url: buildProofVerifyResultPath(resultId),
        price_wei: proofVerifyConfig.priceWei,
        payment_tx_hash: paid.txHash,
        verified_at: verifiedAt,
        verdict: verification.verdict,
        ...(body.subject_url ? { subject_url: body.subject_url } : {}),
        ...(body.subject_sha256 ? { subject_sha256: body.subject_sha256 } : {}),
        ...(body.proof_bundle_sha256
          ? { proof_bundle_sha256: body.proof_bundle_sha256 }
          : {}),
        ...(body.verifier_profile ? { verifier_profile: body.verifier_profile } : {}),
        verifier_receipt_sha256: verification.verifierReceiptSha256,
        summary: verification.summary,
        metadata: {
          ...verification.metadata,
          provider_backend: verification.backendSummary,
        },
      };
      storeProofVerifyResult(db, {
        resultId,
        requestKey,
        request: body,
        response,
        requesterIdentity,
        capability: body.capability,
        createdAt: new Date().toISOString(),
      });
      const verifierClass =
        typeof verification.metadata.verifier_class === "string" &&
        verification.metadata.verifier_class.length > 0
          ? verification.metadata.verifier_class
          : proofVerifyConfig.supportedVerifierClasses?.includes("cryptographic_proof_verification")
            ? "cryptographic_proof_verification"
            : "structural_verification";
      const verificationMode =
        typeof verification.metadata.verification_mode === "string" &&
        (verification.metadata.verification_mode === "fallback" ||
          verification.metadata.verification_mode === "worker_backed" ||
          verification.metadata.verification_mode === "cryptographic")
          ? verification.metadata.verification_mode
          : "fallback";
      storeProofVerificationRecord(db, {
        recordId: `proof:${resultId}`,
        resultId,
        requestKey,
        capability: body.capability,
        requesterIdentity,
        providerBackend: verification.backendSummary,
        verifierClass,
        verificationMode,
        verdict: verification.verdict,
        verdictReason: verification.verdictReason,
        summary: verification.summary,
        verifierProfile: body.verifier_profile ?? null,
        verifierReceiptSha256: verification.verifierReceiptSha256,
        verifierMaterialReference:
          verification.verifierMaterialReference ??
          (body.proof_bundle_url
            ? {
                kind: verifierClass,
                ref: body.proof_bundle_url,
                hash:
                  body.proof_bundle_sha256 &&
                  /^0x[0-9a-f]{64}$/i.test(body.proof_bundle_sha256)
                    ? (body.proof_bundle_sha256 as `0x${string}`)
                    : null,
                metadata: null,
              }
            : null),
        boundSubjectHashes: verification.boundSubjectHashes,
        request: {
          subjectUrl: body.subject_url ?? null,
          proofBundleUrl: body.proof_bundle_url ?? null,
        },
        metadata: response.metadata ?? null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      json(res, 200, response);
    } catch (error) {
      logger.warn(
        `Proof verify request failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      json(res, 400, {
        status: "rejected",
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(proofVerifyConfig.port, proofVerifyConfig.bindHost, () => {
      server.off("error", reject);
      resolve();
    });
  });

  const addr = server.address();
  const boundPort =
    addr && typeof addr === "object" && "port" in addr ? addr.port : proofVerifyConfig.port;
  const actualURL = buildProofVerifyServerUrl({
    ...proofVerifyConfig,
    port: boundPort,
  });
  logger.info(`Agent Discovery proof.verify server listening on ${actualURL}`);

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
