import fs from "fs/promises";
import http, { type IncomingMessage, type ServerResponse } from "http";
import path from "path";
import { createHash, randomUUID } from "crypto";
import { hashStorageReceipt, type Address } from "tosdk";
import {
  DEFAULT_X402_SERVER_CONFIG,
  type OpenFoxConfig,
  type OpenFoxDatabase,
  type OpenFoxIdentity,
  type StorageAnchorRecord,
  type StorageAuditRecord,
  type StorageLeaseRecord,
  type StorageMarketConfig,
  type StorageQuoteRecord,
  type StorageRenewalRecord,
} from "../types.js";
import { resolvePath } from "../config.js";
import { normalizeAddress } from "../chain/address.js";
import {
  createX402PaymentManager,
  hashX402RequestPayload,
  writeX402RequirementResponse,
  X402ServerPaymentRejectedError,
} from "../chain/x402-server.js";
import {
  ensureRequestNotReplayed,
  normalizeNonce,
  recordRequestNonce,
  validateRequestExpiry,
} from "../agent-discovery/security.js";
import { propagateExecutionTrailsForSubject } from "../audit/execution-trails.js";
import { createLogger } from "../observability/logger.js";
import { createNativeStorageAnchorPublisher } from "./publisher.js";
import { finalizeBundle, readBundleFromPath, type StorageBundle } from "./bundle.js";

const logger = createLogger("storage.http");
const BODY_LIMIT_BYTES = 16 * 1024 * 1024;
const MEBIBYTE = 1024 * 1024;

export interface StorageQuoteRequest {
  cid: string;
  bundle_kind: string;
  size_bytes: number;
  ttl_seconds: number;
  requester_address: Address;
}

export interface StoragePutRequest {
  requester: {
    identity: {
      kind: "tos";
      value: Address;
    };
  };
  request_nonce: string;
  request_expires_at: number;
  quote_id?: string;
  bundle: StorageBundle;
  bundle_kind: string;
  ttl_seconds?: number;
  cid?: string;
}

export interface StorageRenewRequest {
  requester: {
    identity: {
      kind: "tos";
      value: Address;
    };
  };
  request_nonce: string;
  request_expires_at: number;
  lease_id: string;
  ttl_seconds?: number;
}

export interface StorageQuoteResponse {
  quote_id: string;
  provider_address: Address;
  requester_address: Address;
  cid: string;
  bundle_kind: string;
  size_bytes: number;
  ttl_seconds: number;
  amount_tomi: string;
  expires_at: string;
}

export interface StorageLeaseResponse {
  lease_id: string;
  cid: string;
  bundle_hash: string;
  bundle_kind: string;
  provider_address: Address;
  size_bytes: number;
  ttl_seconds: number;
  amount_tomi: string;
  issued_at: string;
  expires_at: string;
  receipt_id: string;
  receipt_hash: string;
  payment_tx_hash?: string;
  payment_status?: string;
  get_url: string;
  head_url: string;
  anchor_tx_hash?: string;
}

export interface StorageRenewalResponse extends StorageLeaseResponse {
  renewal_id: string;
  previous_expires_at: string;
  renewed_expires_at: string;
  added_ttl_seconds: number;
}

export interface StorageAuditResponse {
  audit_id: string;
  lease_id: string;
  cid: string;
  status: "verified" | "failed";
  response_hash: string;
  checked_at: string;
}

export interface StorageProviderServer {
  url: string;
  close(): Promise<void>;
}

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
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

function normalizePathPrefix(pathPrefix: string): string {
  return pathPrefix.startsWith("/") ? pathPrefix : `/${pathPrefix}`;
}

function parsePath(pathPrefix: string, pathname: string): string[] {
  const normalizedPrefix = normalizePathPrefix(pathPrefix);
  if (!pathname.startsWith(normalizedPrefix)) return [];
  const remainder = pathname.slice(normalizedPrefix.length).replace(/^\/+/, "");
  return remainder ? remainder.split("/") : [];
}

function getBundleStoragePath(config: StorageMarketConfig, cid: string): string {
  return path.join(resolvePath(config.storageDir), `${cid}.json`);
}

function computeStoragePrice(params: {
  config: StorageMarketConfig;
  sizeBytes: number;
  ttlSeconds: number;
}): string {
  const sizeUnits = BigInt(Math.max(1, Math.ceil(params.sizeBytes / MEBIBYTE)));
  const ttlUnits = BigInt(
    Math.max(1, Math.ceil(params.ttlSeconds / params.config.defaultTtlSeconds)),
  );
  const perMiB = BigInt(params.config.pricePerMiBTomi);
  const minimum = BigInt(params.config.minimumPriceTomi);
  const computed = sizeUnits * ttlUnits * perMiB;
  return (computed > minimum ? computed : minimum).toString();
}

function buildQuoteId(params: {
  requesterAddress: string;
  providerAddress: string;
  cid: string;
  bundleKind: string;
  sizeBytes: number;
  ttlSeconds: number;
}): string {
  return createHash("sha256")
    .update(
      [
        params.requesterAddress.toLowerCase(),
        params.providerAddress.toLowerCase(),
        params.cid,
        params.bundleKind,
        String(params.sizeBytes),
        String(params.ttlSeconds),
      ].join("|"),
    )
    .digest("hex");
}

function buildLeaseId(params: {
  requesterAddress: string;
  providerAddress: string;
  cid: string;
  nonce: string;
}): string {
  return createHash("sha256")
    .update(
      [
        params.requesterAddress.toLowerCase(),
        params.providerAddress.toLowerCase(),
        params.cid,
        params.nonce,
      ].join("|"),
    )
    .digest("hex");
}

function buildStorageRequestKey(params: {
  requesterAddress: string;
  capability: string;
  nonce: string;
}): string {
  return [
    "storage:put",
    params.requesterAddress.toLowerCase(),
    params.capability.toLowerCase(),
    params.nonce,
  ].join(":");
}

function buildStorageRenewalRequestKey(params: {
  requesterAddress: string;
  capability: string;
  leaseId: string;
  nonce: string;
}): string {
  return [
    "storage:renew",
    params.requesterAddress.toLowerCase(),
    params.capability.toLowerCase(),
    params.leaseId,
    params.nonce,
  ].join(":");
}

function buildHeadUrl(baseUrl: string, cid: string): string {
  return `${baseUrl}/head/${encodeURIComponent(cid)}`;
}

function buildGetUrl(baseUrl: string, cid: string): string {
  return `${baseUrl}/get/${encodeURIComponent(cid)}`;
}

function validateQuoteRequest(
  body: Record<string, unknown>,
  config: StorageMarketConfig,
): StorageQuoteRequest {
  const cid = String(body.cid || "").trim();
  const bundleKind = String(body.bundle_kind || "").trim();
  const sizeBytes = Number(body.size_bytes);
  const ttlSeconds = Number(body.ttl_seconds);
  const requesterAddress = normalizeAddress(String(body.requester_address || "")) as Address;
  if (!cid) throw new Error("cid is required");
  if (!bundleKind) throw new Error("bundle_kind is required");
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
    throw new Error("size_bytes must be a positive number");
  }
  if (sizeBytes > config.maxBundleBytes) {
    throw new Error(`bundle exceeds maxBundleBytes (${config.maxBundleBytes})`);
  }
  if (!Number.isFinite(ttlSeconds) || ttlSeconds <= 0) {
    throw new Error("ttl_seconds must be a positive number");
  }
  if (ttlSeconds > config.maxTtlSeconds) {
    throw new Error(`ttl_seconds exceeds maxTtlSeconds (${config.maxTtlSeconds})`);
  }
  return { cid, bundle_kind: bundleKind, size_bytes: sizeBytes, ttl_seconds: ttlSeconds, requester_address: requesterAddress };
}

function validatePutRequest(
  body: StoragePutRequest,
  config: StorageMarketConfig,
): { requesterAddress: Address; nonce: string } {
  if (!body.requester?.identity?.value) {
    throw new Error("missing requester identity");
  }
  const requesterAddress = normalizeAddress(body.requester.identity.value) as Address;
  const nonce = normalizeNonce(body.request_nonce);
  validateRequestExpiry(body.request_expires_at);
  if (!body.bundle || typeof body.bundle !== "object") {
    throw new Error("bundle is required");
  }
  if (!body.bundle_kind?.trim()) {
    throw new Error("bundle_kind is required");
  }
  if (body.ttl_seconds && body.ttl_seconds > config.maxTtlSeconds) {
    throw new Error(`ttl_seconds exceeds maxTtlSeconds (${config.maxTtlSeconds})`);
  }
  return { requesterAddress, nonce };
}

function validateRenewRequest(
  body: StorageRenewRequest,
  config: StorageMarketConfig,
): { requesterAddress: Address; nonce: string; leaseId: string; ttlSeconds?: number } {
  if (!body.requester?.identity?.value) {
    throw new Error("missing requester identity");
  }
  const requesterAddress = normalizeAddress(body.requester.identity.value) as Address;
  const nonce = normalizeNonce(body.request_nonce);
  validateRequestExpiry(body.request_expires_at);
  const leaseId = String(body.lease_id || "").trim();
  if (!leaseId) {
    throw new Error("lease_id is required");
  }
  const ttlSeconds =
    body.ttl_seconds !== undefined ? Number(body.ttl_seconds) : undefined;
  if (
    ttlSeconds !== undefined &&
    (!Number.isFinite(ttlSeconds) || ttlSeconds <= 0)
  ) {
    throw new Error("ttl_seconds must be a positive number");
  }
  if (ttlSeconds !== undefined && ttlSeconds > config.maxTtlSeconds) {
    throw new Error(`ttl_seconds exceeds maxTtlSeconds (${config.maxTtlSeconds})`);
  }
  return { requesterAddress, nonce, leaseId, ttlSeconds };
}

function quoteToResponse(record: StorageQuoteRecord): StorageQuoteResponse {
  return {
    quote_id: record.quoteId,
    provider_address: record.providerAddress,
    requester_address: record.requesterAddress,
    cid: record.cid,
    bundle_kind: record.bundleKind,
    size_bytes: record.sizeBytes,
    ttl_seconds: record.ttlSeconds,
    amount_tomi: record.amountTomi,
    expires_at: record.expiresAt,
  };
}

function leaseToResponse(baseUrl: string, lease: StorageLeaseRecord): StorageLeaseResponse {
  return {
    lease_id: lease.leaseId,
    cid: lease.cid,
    bundle_hash: lease.bundleHash,
    bundle_kind: lease.bundleKind,
    provider_address: lease.providerAddress,
    size_bytes: lease.sizeBytes,
    ttl_seconds: lease.ttlSeconds,
    amount_tomi: lease.amountTomi,
    issued_at: lease.receipt.issuedAt,
    expires_at: lease.receipt.expiresAt,
    receipt_id: lease.receipt.receiptId,
    receipt_hash: lease.receiptHash,
    payment_tx_hash: lease.receipt.paymentTxHash ?? undefined,
    get_url: buildGetUrl(baseUrl, lease.cid),
    head_url: buildHeadUrl(baseUrl, lease.cid),
    anchor_tx_hash: lease.anchorTxHash ?? undefined,
  };
}

function auditToResponse(record: StorageAuditRecord): StorageAuditResponse {
  return {
    audit_id: record.auditId,
    lease_id: record.leaseId,
    cid: record.cid,
    status: record.status,
    response_hash: record.responseHash,
    checked_at: record.checkedAt,
  };
}

function renewalToResponse(
  baseUrl: string,
  lease: StorageLeaseRecord,
  renewal: StorageRenewalRecord,
): StorageRenewalResponse {
  return {
    renewal_id: renewal.renewalId,
    previous_expires_at: renewal.previousExpiresAt,
    renewed_expires_at: renewal.renewedExpiresAt,
    added_ttl_seconds: renewal.addedTtlSeconds,
    ...leaseToResponse(baseUrl, lease),
  };
}

function readMaybeQuote(db: OpenFoxDatabase, quoteId?: string): StorageQuoteRecord | undefined {
  if (!quoteId) return undefined;
  return db.getStorageQuote(quoteId);
}

export async function startStorageProviderServer(params: {
  identity: OpenFoxIdentity;
  config: OpenFoxConfig;
  address: Address;
  privateKey: `0x${string}`;
  db: OpenFoxDatabase;
  storageConfig: StorageMarketConfig;
}): Promise<StorageProviderServer> {
  const pathPrefix = normalizePathPrefix(params.storageConfig.pathPrefix);
  const healthzPath = `${pathPrefix}/healthz`;
  const baseLocalUrl = (boundPort: number) =>
    `http://${params.storageConfig.bindHost}:${boundPort}${pathPrefix}`;
  const rpcUrl = params.config.rpcUrl || process.env.TOS_RPC_URL;
  const x402Config = params.config.x402Server ?? DEFAULT_X402_SERVER_CONFIG;
  const paymentManager =
    x402Config.enabled && rpcUrl
      ? createX402PaymentManager({
          db: params.db,
          rpcUrl,
          config: x402Config,
        })
      : null;
  const anchorPublisher =
    params.storageConfig.anchor.enabled && rpcUrl
      ? createNativeStorageAnchorPublisher({
          db: params.db,
          rpcUrl,
          privateKey: params.privateKey,
          config: params.storageConfig.anchor,
          publisherAddress: params.address,
        })
      : null;
  let currentBaseUrl = baseLocalUrl(params.storageConfig.port);

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
      if (req.method === "GET" && url.pathname === healthzPath) {
        json(res, 200, {
          ok: true,
          capability_prefix: params.storageConfig.capabilityPrefix,
          bind: `${params.storageConfig.bindHost}:${params.storageConfig.port}`,
          storage_dir: params.storageConfig.storageDir,
          auto_audit: params.storageConfig.leaseHealth.autoAudit,
          audit_interval_seconds: params.storageConfig.leaseHealth.auditIntervalSeconds,
          auto_renew: params.storageConfig.leaseHealth.autoRenew,
          renewal_lead_seconds: params.storageConfig.leaseHealth.renewalLeadSeconds,
          replication_enabled: params.storageConfig.replication.enabled,
          replication_target: params.storageConfig.replication.targetCopies,
          replication_providers: params.storageConfig.replication.providerBaseUrls,
        });
        return;
      }

      const parts = parsePath(pathPrefix, url.pathname);
      if (parts.length === 1 && parts[0] === "quote" && req.method === "POST") {
        const body = (await readJsonBody(req)) as Record<string, unknown>;
        const request = validateQuoteRequest(body, params.storageConfig);
        const now = new Date();
        const record: StorageQuoteRecord = {
          quoteId: buildQuoteId({
            requesterAddress: request.requester_address,
            providerAddress: params.address,
            cid: request.cid,
            bundleKind: request.bundle_kind,
            sizeBytes: request.size_bytes,
            ttlSeconds: request.ttl_seconds,
          }),
          requesterAddress: request.requester_address,
          providerAddress: params.address,
          cid: request.cid,
          bundleKind: request.bundle_kind,
          sizeBytes: request.size_bytes,
          ttlSeconds: request.ttl_seconds,
          amountTomi: computeStoragePrice({
            config: params.storageConfig,
            sizeBytes: request.size_bytes,
            ttlSeconds: request.ttl_seconds,
          }),
          status: "quoted",
          expiresAt: new Date(now.getTime() + params.storageConfig.quoteValiditySeconds * 1000).toISOString(),
          createdAt: now.toISOString(),
          updatedAt: now.toISOString(),
        };
        params.db.upsertStorageQuote(record);
        json(res, 200, quoteToResponse(record));
        return;
      }

      if (parts.length === 2 && parts[0] === "head" && req.method === "GET") {
        const lease = params.db.getStorageLeaseByCid(decodeURIComponent(parts[1]!));
        if (!lease) {
          json(res, 404, { error: "lease not found" });
          return;
        }
        json(res, 200, leaseToResponse(currentBaseUrl, lease));
        return;
      }

      if (parts.length === 2 && parts[0] === "get" && req.method === "GET") {
        const lease = params.db.getStorageLeaseByCid(decodeURIComponent(parts[1]!));
        if (!lease) {
          json(res, 404, { error: "lease not found" });
          return;
        }
        if (!params.storageConfig.allowAnonymousGet) {
          json(res, 403, { error: "anonymous retrieval disabled" });
          return;
        }
        const bundle = await readBundleFromPath(lease.storagePath);
        json(res, 200, {
          lease: leaseToResponse(currentBaseUrl, lease),
          bundle,
        });
        return;
      }

      if (parts.length === 1 && parts[0] === "audit" && req.method === "POST") {
        const body = (await readJsonBody(req)) as Record<string, unknown>;
        const leaseId = String(body.lease_id || "").trim();
        const challengeNonce = normalizeNonce(String(body.challenge_nonce || randomUUID().replace(/-/g, "")));
        const lease = params.db.getStorageLease(leaseId);
        if (!lease) {
          json(res, 404, { error: "lease not found" });
          return;
        }
        const raw = await fs.readFile(lease.storagePath);
        const responseHash = hashStorageReceipt({
          ...lease.receipt,
          metadata: {
            challenge_nonce: challengeNonce,
            content_sha256: createHash("sha256").update(raw).digest("hex"),
          },
        });
        const audit: StorageAuditRecord = {
          auditId: `${leaseId}:${challengeNonce}`,
          leaseId,
          cid: lease.cid,
          status: "verified",
          challengeNonce,
          responseHash,
          details: {
            size_bytes: raw.byteLength,
          },
          checkedAt: new Date().toISOString(),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        params.db.upsertStorageAudit(audit);
        propagateExecutionTrailsForSubject({
          db: params.db,
          fromSubjectKind: "storage_lease",
          fromSubjectId: leaseId,
          toSubjectKind: "storage_audit",
          toSubjectId: audit.auditId,
          metadata: { via: "storage_lease", lease_id: leaseId },
          createdAt: audit.updatedAt,
        });
        json(res, 200, auditToResponse(audit));
        return;
      }

      if (parts.length === 1 && parts[0] === "put" && req.method === "POST") {
        const body = (await readJsonBody(req)) as StoragePutRequest;
        const { requesterAddress, nonce } = validatePutRequest(body, params.storageConfig);
        const { bundle, cid, bytes } = await finalizeBundle(body.bundle);
        if (bytes.byteLength > params.storageConfig.maxBundleBytes) {
          throw new Error(`bundle exceeds maxBundleBytes (${params.storageConfig.maxBundleBytes})`);
        }
        if (body.cid && body.cid !== cid) {
          throw new Error("provided cid does not match bundle content");
        }
        const quote = readMaybeQuote(params.db, body.quote_id);
        const ttlSeconds = quote?.ttlSeconds ?? body.ttl_seconds ?? params.storageConfig.defaultTtlSeconds;
        if (quote) {
          if (quote.status !== "quoted") {
            throw new Error("quote is not active");
          }
          if (new Date(quote.expiresAt).getTime() <= Date.now()) {
            throw new Error("quote has expired");
          }
          if (quote.requesterAddress !== requesterAddress) {
            throw new Error("quote requester does not match request");
          }
          if (quote.cid !== cid) {
            throw new Error("quote cid does not match bundle content");
          }
          if (quote.bundleKind !== body.bundle_kind) {
            throw new Error("quote bundle_kind does not match request");
          }
        }
        if (ttlSeconds > params.storageConfig.maxTtlSeconds) {
          throw new Error(`ttl_seconds exceeds maxTtlSeconds (${params.storageConfig.maxTtlSeconds})`);
        }
        const requestKey = buildStorageRequestKey({
          requesterAddress,
          capability: `${params.storageConfig.capabilityPrefix}.put`,
          nonce,
        });
        const requestHash = hashX402RequestPayload({
          requester_address: requesterAddress,
          cid,
          bundle_kind: body.bundle_kind,
          ttl_seconds: ttlSeconds,
          request_nonce: nonce,
        });

        const existingLeaseId = params.db.getKV(requestKey);
        if (existingLeaseId) {
          const existingLease = params.db.getStorageLease(existingLeaseId);
          if (existingLease) {
            json(res, 200, { ...leaseToResponse(currentBaseUrl, existingLease), idempotent: true });
            return;
          }
        }
        ensureRequestNotReplayed({
          db: params.db,
          scope: "storage.put",
          requesterIdentity: requesterAddress,
          capability: `${params.storageConfig.capabilityPrefix}.put`,
          nonce,
        });

        const amountTomi =
          quote?.amountTomi ??
          computeStoragePrice({
            config: params.storageConfig,
            sizeBytes: bytes.byteLength,
            ttlSeconds,
          });

        if (!paymentManager) {
          throw new Error("x402 payment manager is unavailable; configure rpcUrl");
        }
        const payment = await paymentManager.requirePayment({
          req,
          serviceKind: "storage",
          providerAddress: params.address,
          requestKey,
          requestHash,
          amountTomi,
          description: "OpenFox storage.put payment",
        });
        if (payment.state === "required") {
          writeX402RequirementResponse({ res, requirement: payment.requirement });
          return;
        }
        if (payment.state === "pending") {
          json(res, 202, {
            status: "pending",
            reason: payment.reason,
            payment_tx_hash: payment.payment.txHash,
            payment_status: payment.payment.status,
          });
          return;
        }

        const issuedAt = new Date().toISOString();
        const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();
        const leaseId = buildLeaseId({
          requesterAddress,
          providerAddress: params.address,
          cid,
          nonce,
        });
        const storagePath = getBundleStoragePath(params.storageConfig, cid);
        await fs.mkdir(path.dirname(storagePath), { recursive: true });
        await fs.writeFile(storagePath, Buffer.from(bytes));
        recordRequestNonce({
          db: params.db,
          scope: "storage.put",
          requesterIdentity: requesterAddress,
          capability: `${params.storageConfig.capabilityPrefix}.put`,
          nonce,
          expiresAt: body.request_expires_at,
        });

        // Build StorageReceipt for tosdk
        const receipt = {
          version: 1 as const,
          receiptId: `storage:${leaseId}`,
          leaseId,
          cid,
          bundleHash: bundle.manifest.bundle_hash,
          bundleKind: body.bundle_kind,
          providerAddress: params.address,
          requesterAddress,
          sizeBytes: bytes.byteLength,
          ttlSeconds,
          amountTomi: amountTomi,
          status: "active" as const,
          issuedAt,
          expiresAt,
          artifactUrl: buildGetUrl(currentBaseUrl, cid),
          paymentTxHash: payment.payment.txHash,
        };
        const lease: StorageLeaseRecord = {
          leaseId,
          quoteId: quote?.quoteId ?? null,
          cid,
          bundleHash: bundle.manifest.bundle_hash,
          bundleKind: body.bundle_kind,
          requesterAddress,
          providerAddress: params.address,
          providerBaseUrl: currentBaseUrl,
          sizeBytes: bytes.byteLength,
          ttlSeconds,
          amountTomi,
          status: "active",
          storagePath,
          requestKey,
          paymentId: payment.payment.paymentId,
          receipt,
          receiptHash: hashStorageReceipt(receipt),
          anchorTxHash: null,
          anchorReceipt: null,
          createdAt: issuedAt,
          updatedAt: issuedAt,
        };
        if (quote) {
          params.db.upsertStorageQuote({
            ...quote,
            status: "used",
            updatedAt: issuedAt,
          });
        }
        params.db.upsertStorageLease(lease);
        params.db.setKV(requestKey, leaseId);
        paymentManager.bindPayment({
          paymentId: payment.payment.paymentId,
          boundKind: "storage_lease",
          boundSubjectId: leaseId,
          artifactUrl: receipt.artifactUrl || undefined,
        });

        let anchorRecord: StorageAnchorRecord | undefined;
        if (anchorPublisher) {
          anchorRecord = await anchorPublisher.publish({
            lease,
            publisherAddress: params.address,
          });
          params.db.upsertStorageLease({
            ...lease,
            anchorTxHash: anchorRecord.anchorTxHash ?? null,
            anchorReceipt: anchorRecord.anchorReceipt ?? null,
            updatedAt: new Date().toISOString(),
          });
        }

        json(res, 200, {
          ...leaseToResponse(currentBaseUrl, {
            ...lease,
            anchorTxHash: anchorRecord?.anchorTxHash ?? null,
            anchorReceipt: anchorRecord?.anchorReceipt ?? null,
          }),
          payment_tx_hash: payment.payment.txHash,
          payment_status: payment.payment.status,
        });
        return;
      }

      if (parts.length === 1 && parts[0] === "renew" && req.method === "POST") {
        const body = (await readJsonBody(req)) as StorageRenewRequest;
        const { requesterAddress, nonce, leaseId, ttlSeconds } = validateRenewRequest(
          body,
          params.storageConfig,
        );
        const lease = params.db.getStorageLease(leaseId);
        if (!lease) {
          json(res, 404, { error: "lease not found" });
          return;
        }
        if (lease.status !== "active") {
          throw new Error("lease is not active");
        }
        if (lease.requesterAddress !== requesterAddress) {
          throw new Error("lease requester does not match request");
        }
        const addedTtlSeconds = ttlSeconds ?? params.storageConfig.defaultTtlSeconds;
        const requestKey = buildStorageRenewalRequestKey({
          requesterAddress,
          capability: `${params.storageConfig.capabilityPrefix}.renew`,
          leaseId,
          nonce,
        });
        const requestHash = hashX402RequestPayload({
          requester_address: requesterAddress,
          lease_id: leaseId,
          ttl_seconds: addedTtlSeconds,
          request_nonce: nonce,
        });
        const existingRenewalId = params.db.getKV(requestKey);
        if (existingRenewalId) {
          const existingRenewal = params.db.getStorageRenewal(existingRenewalId);
          const existingLease = params.db.getStorageLease(leaseId);
          if (existingRenewal && existingLease) {
            json(res, 200, {
              ...renewalToResponse(currentBaseUrl, existingLease, existingRenewal),
              idempotent: true,
            });
            return;
          }
        }
        ensureRequestNotReplayed({
          db: params.db,
          scope: "storage.renew",
          requesterIdentity: requesterAddress,
          capability: `${params.storageConfig.capabilityPrefix}.renew`,
          nonce,
        });
        if (!paymentManager) {
          throw new Error("x402 payment manager is unavailable; configure rpcUrl");
        }
        const amountTomi = computeStoragePrice({
          config: params.storageConfig,
          sizeBytes: lease.sizeBytes,
          ttlSeconds: addedTtlSeconds,
        });
        const payment = await paymentManager.requirePayment({
          req,
          serviceKind: "storage",
          providerAddress: params.address,
          requestKey,
          requestHash,
          amountTomi,
          description: "OpenFox storage.renew payment",
        });
        if (payment.state === "required") {
          writeX402RequirementResponse({ res, requirement: payment.requirement });
          return;
        }
        if (payment.state === "pending") {
          json(res, 202, {
            status: "pending",
            reason: payment.reason,
            payment_tx_hash: payment.payment.txHash,
            payment_status: payment.payment.status,
          });
          return;
        }

        const nowIso = new Date().toISOString();
        const previousExpiresAt = lease.receipt.expiresAt;
        const previousExpiryMs = new Date(previousExpiresAt).getTime();
        const effectiveStartMs = Math.max(Date.now(), previousExpiryMs);
        const renewedExpiresAt = new Date(
          effectiveStartMs + addedTtlSeconds * 1000,
        ).toISOString();
        const renewalId = `${leaseId}:renew:${nonce}`;
        const nextAmountTomi = (
          BigInt(lease.amountTomi || "0") + BigInt(amountTomi)
        ).toString();
        const nextTtlSeconds = lease.ttlSeconds + addedTtlSeconds;
        recordRequestNonce({
          db: params.db,
          scope: "storage.renew",
          requesterIdentity: requesterAddress,
          capability: `${params.storageConfig.capabilityPrefix}.renew`,
          nonce,
          expiresAt: body.request_expires_at,
        });

        // Build StorageReceipt for tosdk
        const receipt = {
          ...lease.receipt,
          ttlSeconds: nextTtlSeconds,
          amountTomi: nextAmountTomi,
          issuedAt: nowIso,
          expiresAt: renewedExpiresAt,
          paymentTxHash: payment.payment.txHash,
          metadata: {
            ...(lease.receipt.metadata || {}),
            previous_expires_at: previousExpiresAt,
            renewal_id: renewalId,
            renewal_count:
              Number((lease.receipt.metadata as Record<string, unknown> | undefined)?.renewal_count || 0) +
              1,
            added_ttl_seconds: addedTtlSeconds,
          },
        };
        const updatedLease: StorageLeaseRecord = {
          ...lease,
          providerBaseUrl: lease.providerBaseUrl ?? currentBaseUrl,
          ttlSeconds: nextTtlSeconds,
          amountTomi: nextAmountTomi,
          paymentId: payment.payment.paymentId,
          receipt,
          receiptHash: hashStorageReceipt(receipt),
          updatedAt: nowIso,
        };
        const renewal: StorageRenewalRecord = {
          renewalId,
          leaseId,
          cid: lease.cid,
          requesterAddress,
          providerAddress: params.address,
          providerBaseUrl: currentBaseUrl,
          previousExpiresAt,
          renewedExpiresAt,
          addedTtlSeconds,
          amountTomi,
          paymentId: payment.payment.paymentId,
          receipt,
          receiptHash: hashStorageReceipt(receipt),
          createdAt: nowIso,
          updatedAt: nowIso,
        };
        params.db.upsertStorageLease(updatedLease);
        params.db.upsertStorageRenewal(renewal);
        params.db.setKV(requestKey, renewalId);
        paymentManager.bindPayment({
          paymentId: payment.payment.paymentId,
          boundKind: "storage_renewal",
          boundSubjectId: renewalId,
          artifactUrl: updatedLease.receipt.artifactUrl || undefined,
        });
        json(res, 200, {
          ...renewalToResponse(currentBaseUrl, updatedLease, renewal),
          payment_tx_hash: payment.payment.txHash,
          payment_status: payment.payment.status,
        });
        return;
      }

      json(res, 404, { error: "not found" });
    } catch (error) {
      const statusCode =
        error instanceof X402ServerPaymentRejectedError ? error.statusCode : 400;
      logger.warn(
        `Storage request failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      json(res, statusCode, {
        status: "rejected",
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(params.storageConfig.port, params.storageConfig.bindHost, () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address();
  const boundPort =
    address && typeof address === "object" && "port" in address
      ? address.port
      : params.storageConfig.port;
  const baseUrl = baseLocalUrl(boundPort);
  currentBaseUrl = baseUrl;
  return {
    url: baseUrl,
    close: async () =>
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}
