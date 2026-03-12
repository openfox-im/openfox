import http, { type IncomingMessage, type ServerResponse } from "http";
import { createHash } from "crypto";
import { URL } from "url";
import type {
  OpenFoxConfig,
  OpenFoxDatabase,
  OpenFoxIdentity,
  ProofVerifierClass,
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
import {
  parseProofVerifySkillResult,
  type ProofVerifySkillResult,
} from "./skill-backend-contracts.js";
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
  verificationMode: "fallback_integrity" | "native_attestation" | "committee_verified";
  verifierClass: ProofVerifierClass;
  attestationVerification?: Record<string, unknown> | null;
  consensusVerification?: Record<string, unknown> | null;
  workerProvenance?: {
    worker: string;
    backend: string;
    native: boolean;
  } | null;
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
    verification_mode: "fallback_integrity",
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
  const verifierClass: ProofVerifierClass =
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
    verificationMode: "fallback_integrity",
    verifierClass,
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

function buildConsensusAgentResults(
  attestationVerification: ProofVerifySkillResult,
  request: ProofVerifyInvocationRequest,
): Array<Record<string, unknown>> {
  const metadata =
    attestationVerification.metadata &&
    typeof attestationVerification.metadata === "object" &&
    !Array.isArray(attestationVerification.metadata)
      ? (attestationVerification.metadata as Record<string, unknown>)
      : {};
  const resultEntries = Array.isArray(metadata.results)
    ? metadata.results.filter(
        (entry): entry is Record<string, unknown> =>
          Boolean(entry) && typeof entry === "object" && !Array.isArray(entry),
      )
    : [];
  if (resultEntries.length > 0) {
    return resultEntries.map((entry) => ({
      verdict: entry.valid === true ? "valid" : "invalid",
      serverName:
        typeof entry.serverName === "string"
          ? entry.serverName
          : typeof entry.server_name === "string"
            ? entry.server_name
            : undefined,
      articleSha256: request.subject_sha256 || undefined,
      attestationSha256:
        typeof entry.attestationSha256 === "string"
          ? entry.attestationSha256
          : typeof entry.attestation_sha256 === "string"
            ? entry.attestation_sha256
            : undefined,
    }));
  }
  return [
    {
      verdict: attestationVerification.verdict,
      serverName:
        Array.isArray(metadata.server_names) && metadata.server_names.length > 0
          ? metadata.server_names[0]
          : undefined,
      articleSha256: request.subject_sha256 || undefined,
      attestationSha256:
        Array.isArray(metadata.attestation_hashes) && metadata.attestation_hashes.length > 0
          ? metadata.attestation_hashes[0]
          : undefined,
    },
  ];
}

async function runSkillProofVerifyBackend(params: {
  request: ProofVerifyInvocationRequest;
  proofVerifyConfig: AgentDiscoveryProofVerifyServerConfig;
  config: OpenFoxConfig;
  db: OpenFoxDatabase;
}): Promise<ProofVerifyBackendResult> {
  const skillsDir = params.config.skillsDir || "~/.openfox/skills";
  const [attestationStage, consensusStage] = params.proofVerifyConfig.skillStages;
  if (!attestationStage || !consensusStage) {
    throw new Error(
      "proof.verify skillStages must define attestation and consensus stages",
    );
  }
  const attestationVerification = parseProofVerifySkillResult(await runSkillBackend({
    skillsDir,
    skillName: attestationStage.skill,
    backendName: attestationStage.backend,
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
  const attestationAgentResults = buildConsensusAgentResults(
    attestationVerification,
    params.request,
  );
  const consensusInputRequest = {
    ...params.request,
    agentResults: attestationAgentResults,
    m: attestationAgentResults.length,
    n: attestationAgentResults.length,
    expectedServerName:
      typeof params.request.subject_url === "string"
        ? new URL(params.request.subject_url).hostname
        : undefined,
    expectedArticleSha256: params.request.subject_sha256,
  };
  const consensusVerification = parseProofVerifySkillResult(await runSkillBackend({
    skillsDir,
    skillName: consensusStage.skill,
    backendName: consensusStage.backend,
    input: {
      request: consensusInputRequest,
      attestationVerification,
    },
    context: {
      config: params.config,
      db: params.db,
      now: () => new Date(),
    },
  }));
  const attestationMetadata =
    attestationVerification.metadata &&
    typeof attestationVerification.metadata === "object"
      ? attestationVerification.metadata
      : {};
  const validAttestations =
    typeof attestationMetadata.valid_attestations === "number"
      ? attestationMetadata.valid_attestations
      : attestationAgentResults.filter((item) => item.verdict === "valid").length;
  const totalAttestations =
    typeof attestationMetadata.total_attestations === "number"
      ? attestationMetadata.total_attestations
      : attestationAgentResults.length;
  const verificationMode =
    attestationVerification.verdict === "valid" &&
    consensusVerification.verdict === "valid" &&
    totalAttestations > 1
      ? "committee_verified"
      : attestationVerification.verdict === "valid"
        ? "native_attestation"
        : "fallback_integrity";
  const verifierClass =
    verificationMode === "committee_verified"
      ? "m_of_n_consensus_verification"
      : "tlsnotary_attestation_verification";
  const finalVerdict =
    verificationMode === "committee_verified"
      ? consensusVerification.verdict
      : attestationVerification.verdict;
  const finalSummary =
    verificationMode === "committee_verified"
      ? `${attestationVerification.summary} ${consensusVerification.summary}`.trim()
      : attestationVerification.summary;
  const finalReceipt =
    verificationMode === "committee_verified"
      ? consensusVerification.verifierReceiptSha256
      : attestationVerification.verifierReceiptSha256;
  return {
    verdict: finalVerdict,
    summary: finalSummary,
    metadata: {
      ...attestationVerification.metadata,
      attestation_verification_receipt_sha256:
        attestationVerification.verifierReceiptSha256,
      consensus_verification_receipt_sha256:
        consensusVerification.verifierReceiptSha256,
      verification_mode: verificationMode,
      verifier_class: verifierClass,
      valid_attestations: validAttestations,
      total_attestations: totalAttestations,
      consensus_threshold_met: consensusVerification.verdict === "valid",
    },
    verifierReceiptSha256: finalReceipt,
    verificationMode,
    verifierClass,
    attestationVerification: {
      verdict: attestationVerification.verdict,
      summary: attestationVerification.summary,
      metadata: attestationVerification.metadata,
      verifierReceiptSha256: attestationVerification.verifierReceiptSha256,
    },
    consensusVerification: {
      verdict: consensusVerification.verdict,
      summary: consensusVerification.summary,
      metadata: consensusVerification.metadata,
      verifierReceiptSha256: consensusVerification.verifierReceiptSha256,
    },
    workerProvenance: {
      worker:
        verificationMode === "committee_verified"
          ? "proofverify.verify-consensus"
          : "proofverify.verify-attestations",
      backend:
        verificationMode === "committee_verified"
          ? formatSkillBackendStage(consensusStage)
          : formatSkillBackendStage(attestationStage),
      native: true,
    },
    backendSummary: {
      kind: "skills",
      stages: params.proofVerifyConfig.skillStages.map(formatSkillBackendStage),
    },
    verdictReason:
      verificationMode === "committee_verified"
        ? consensusVerification.verdictReason || "committee_consensus_verdict"
        : attestationVerification.verdictReason || "native_attestation_verdict",
    verifierMaterialReference:
      attestationVerification.verifierMaterialReference &&
      typeof attestationVerification.verifierMaterialReference === "object"
        ? {
            kind:
              typeof attestationVerification.verifierMaterialReference.kind === "string" &&
              attestationVerification.verifierMaterialReference.kind.trim()
                ? attestationVerification.verifierMaterialReference.kind.trim()
                : "worker_material",
            ref:
              typeof attestationVerification.verifierMaterialReference.ref === "string" &&
              attestationVerification.verifierMaterialReference.ref.trim()
                ? attestationVerification.verifierMaterialReference.ref.trim()
                : "inline://unknown",
            hash:
              typeof attestationVerification.verifierMaterialReference.hash === "string" &&
              /^0x[0-9a-f]{64}$/i.test(attestationVerification.verifierMaterialReference.hash)
                ? (attestationVerification.verifierMaterialReference.hash as `0x${string}`)
                : null,
            metadata:
              attestationVerification.verifierMaterialReference.metadata &&
              typeof attestationVerification.verifierMaterialReference.metadata === "object" &&
              !Array.isArray(attestationVerification.verifierMaterialReference.metadata)
                ? (attestationVerification.verifierMaterialReference.metadata as Record<string, unknown>)
                : null,
          }
        : null,
    boundSubjectHashes: {
      subjectSha256:
        attestationVerification.boundSubjectHashes &&
        typeof attestationVerification.boundSubjectHashes.subjectSha256 === "string" &&
        /^0x[0-9a-f]{64}$/i.test(attestationVerification.boundSubjectHashes.subjectSha256)
          ? (attestationVerification.boundSubjectHashes.subjectSha256 as `0x${string}`)
          : params.request.subject_sha256 &&
              /^0x[0-9a-f]{64}$/i.test(params.request.subject_sha256)
            ? (params.request.subject_sha256 as `0x${string}`)
            : null,
      bundleSha256:
        attestationVerification.boundSubjectHashes &&
        typeof attestationVerification.boundSubjectHashes.bundleSha256 === "string" &&
        /^0x[0-9a-f]{64}$/i.test(attestationVerification.boundSubjectHashes.bundleSha256)
          ? (attestationVerification.boundSubjectHashes.bundleSha256 as `0x${string}`)
          : params.request.proof_bundle_sha256 &&
              /^0x[0-9a-f]{64}$/i.test(params.request.proof_bundle_sha256)
            ? (params.request.proof_bundle_sha256 as `0x${string}`)
            : null,
      responseHash:
        consensusVerification.boundSubjectHashes &&
        typeof consensusVerification.boundSubjectHashes.responseHash === "string" &&
        /^0x[0-9a-f]{64}$/i.test(consensusVerification.boundSubjectHashes.responseHash)
          ? (consensusVerification.boundSubjectHashes.responseHash as `0x${string}`)
          : finalReceipt,
    },
  };
}

async function requirePayment(params: {
  req: IncomingMessage;
  res: ServerResponse;
  config: OpenFoxConfig;
  providerAddress: string;
  amountWei: string;
}): Promise<VerifiedPayment | null> {
  const rpcUrl = params.config.rpcUrl || process.env.TOS_RPC_URL;
  if (!rpcUrl) {
    throw new Error("Chain RPC is required to run the proof.verify server");
  }
  const client = new RpcClient({ rpcUrl });
  const chainId = params.config.chainId ? BigInt(params.config.chainId) : await client.getChainId();
  const requirement: PaymentRequirement = {
    scheme: "exact",
    network: formatNetwork(chainId),
    maxAmountRequired: params.amountWei,
    payToAddress: normalizeAddress(params.providerAddress),
    asset: "native",
    requiredDeadlineSeconds: 300,
    description: "OpenFox proof.verify payment",
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
        verification_mode: verification.verificationMode,
        verifier_class: verification.verifierClass,
        verifier_receipt_sha256: verification.verifierReceiptSha256,
        ...(verification.attestationVerification
          ? { attestation_verification: verification.attestationVerification }
          : {}),
        ...(verification.consensusVerification
          ? { consensus_verification: verification.consensusVerification }
          : {}),
        ...(verification.workerProvenance
          ? { worker_provenance: verification.workerProvenance }
          : {}),
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
      const verifierClass = verification.verifierClass;
      const verificationMode = verification.verificationMode;
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
        attestationVerification: verification.attestationVerification ?? null,
        consensusVerification: verification.consensusVerification ?? null,
        workerProvenance: verification.workerProvenance ?? null,
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
