import http, { type IncomingMessage, type ServerResponse } from "http";
import { createHash } from "crypto";
import fs from "fs";
import path from "path";
import type {
  OpenFoxConfig,
  OpenFoxDatabase,
  OpenFoxIdentity,
} from "../types.js";
import { createLogger } from "../observability/logger.js";
import { resolvePath } from "../config.js";
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
  buildStorageServerUrl,
  type AgentDiscoveryStorageServerConfig,
  type StorageGetInvocationRequest,
  type StorageGetInvocationResponse,
  type StoragePutInvocationRequest,
  type StoragePutInvocationResponse,
} from "./types.js";
import {
  ensureRequestNotReplayed,
  normalizeNonce,
  recordRequestNonce,
  validateRequestExpiry,
} from "./security.js";
import { executeProviderBackend } from "./provider-backends.js";
import { formatSkillBackendStage } from "./provider-skill-spec.js";
import { runSkillBackend } from "../skills/backend-runner.js";
import {
  parseStorageGetSkillResult,
  parseStoragePutSkillResult,
} from "./skill-backend-contracts.js";

const logger = createLogger("agent-discovery.storage");

export interface AgentDiscoveryStorageServer {
  close(): Promise<void>;
  url: string;
}

export interface StartAgentDiscoveryStorageServerParams {
  identity: OpenFoxIdentity;
  config: OpenFoxConfig;
  address: string;
  db: OpenFoxDatabase;
  storageConfig: AgentDiscoveryStorageServerConfig;
}

interface StoredStorageObject {
  objectId: string;
  objectKey?: string;
  contentType: string;
  contentSha256: string;
  sizeBytes: number;
  metadata?: Record<string, unknown>;
  storedAt: string;
  ttlSeconds: number;
  expiresAt: string;
  filePath: string;
}

interface StoragePutBackendResult {
  objectId: string;
  objectKey?: string;
  contentType: string;
  contentSha256: string;
  sizeBytes: number;
  ttlSeconds: number;
  expiresAt: string;
  buffer: Buffer;
  backendSummary: {
    kind: "skills" | "builtin";
    stages: string[];
  };
}

type StorageGetBackendResult =
  | {
      status: "ok";
      response: Omit<StorageGetInvocationResponse, "payment_tx_hash" | "fetched_at">;
      backendSummary: {
        kind: "skills" | "builtin";
        stages: string[];
      };
    }
  | {
      status: "rejected";
      httpStatus: number;
      reason: string;
      pruneExpired?: boolean;
      backendSummary: {
        kind: "skills" | "builtin";
        stages: string[];
      };
    };

const BODY_LIMIT_BYTES = 512 * 1024;

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

function buildStorageRequestKey(
  scope: "put" | "get",
  requesterIdentity: string,
  capability: string,
  nonce: string,
): string {
  return [
    "agent_discovery:storage",
    scope,
    requesterIdentity.toLowerCase(),
    capability,
    normalizeNonce(nonce),
  ].join(":");
}

function storageMetaKey(objectId: string): string {
  return `agent_discovery:storage:object:${objectId}`;
}

function buildStorageObjectPath(objectId: string): string {
  return `/storage/object/${objectId}`;
}

function toHexSha256(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

function parseObjectId(value: string): string {
  const trimmed = value.trim().toLowerCase();
  return trimmed.startsWith("0x") ? trimmed.slice(2) : trimmed;
}

function loadStoredObject(
  db: OpenFoxDatabase,
  objectId: string,
): StoredStorageObject | null {
  const raw = db.getKV(storageMetaKey(objectId));
  if (!raw) return null;
  return JSON.parse(raw) as StoredStorageObject;
}

function storeObject(db: OpenFoxDatabase, object: StoredStorageObject): void {
  db.setKV(storageMetaKey(object.objectId), JSON.stringify(object));
}

function deleteStoredObject(db: OpenFoxDatabase, object: StoredStorageObject): void {
  db.deleteKV(storageMetaKey(object.objectId));
  fs.rmSync(object.filePath, { force: true });
}

function detectContentType(request: StoragePutInvocationRequest): string {
  if (request.content_type?.trim()) return request.content_type.trim();
  if (request.content_text !== undefined) return "text/plain; charset=utf-8";
  return "application/octet-stream";
}

function decodePutPayload(
  request: StoragePutInvocationRequest,
  maxObjectBytes: number,
): { buffer: Buffer; contentType: string } {
  if (request.content_text === undefined && request.content_base64 === undefined) {
    throw new Error("storage.put requires content_text or content_base64");
  }
  const buffer =
    request.content_base64 !== undefined
      ? Buffer.from(request.content_base64, "base64")
      : Buffer.from(request.content_text || "", "utf8");
  if (buffer.byteLength > maxObjectBytes) {
    throw new Error(`object exceeds maxObjectBytes (${maxObjectBytes})`);
  }
  return {
    buffer,
    contentType: detectContentType(request),
  };
}

function validatePutRequest(
  request: StoragePutInvocationRequest,
  config: AgentDiscoveryStorageServerConfig,
): string {
  if (request.capability !== config.putCapability) {
    throw new Error(`unsupported capability ${request.capability}`);
  }
  if (!request.requester?.identity?.value) {
    throw new Error("missing requester identity");
  }
  validateRequestExpiry(request.request_expires_at);
  normalizeNonce(request.request_nonce);
  if (
    request.ttl_seconds !== undefined &&
    (!Number.isInteger(request.ttl_seconds) ||
      request.ttl_seconds <= 0 ||
      request.ttl_seconds > config.maxTtlSeconds)
  ) {
    throw new Error(`ttl_seconds must be a positive integer <= ${config.maxTtlSeconds}`);
  }
  return request.requester.identity.value.toLowerCase();
}

function validateGetRequest(
  request: StorageGetInvocationRequest,
  config: AgentDiscoveryStorageServerConfig,
): string {
  if (request.capability !== config.getCapability) {
    throw new Error(`unsupported capability ${request.capability}`);
  }
  if (!request.requester?.identity?.value) {
    throw new Error("missing requester identity");
  }
  validateRequestExpiry(request.request_expires_at);
  normalizeNonce(request.request_nonce);
  if (!request.object_id && !request.content_sha256) {
    throw new Error("storage.get requires object_id or content_sha256");
  }
  return request.requester.identity.value.toLowerCase();
}

async function requirePayment(params: {
  req: IncomingMessage;
  res: ServerResponse;
  config: OpenFoxConfig;
  providerAddress: string;
  amountWei: string;
  description: string;
}): Promise<VerifiedPayment | null> {
  const rpcUrl = params.config.rpcUrl || process.env.TOS_RPC_URL;
  if (!rpcUrl) {
    throw new Error("Chain RPC is required to run the storage server");
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
    description: params.description,
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

function prepareBuiltinStoragePut(params: {
  request: StoragePutInvocationRequest;
  storageConfig: AgentDiscoveryStorageServerConfig;
  nowMs: number;
}): StoragePutBackendResult {
  const { buffer, contentType } = decodePutPayload(
    params.request,
    params.storageConfig.maxObjectBytes,
  );
  const hashHex = toHexSha256(buffer);
  const ttlSeconds =
    params.request.ttl_seconds ?? params.storageConfig.defaultTtlSeconds;
  return {
    objectId: hashHex,
    objectKey: params.request.object_key?.trim() || undefined,
    contentType,
    contentSha256: `0x${hashHex}`,
    sizeBytes: buffer.byteLength,
    ttlSeconds,
    expiresAt: new Date(params.nowMs + ttlSeconds * 1000).toISOString(),
    buffer,
    backendSummary: {
      kind: "builtin",
      stages: ["builtin:storage.put"],
    },
  };
}

async function prepareSkillStoragePut(params: {
  request: StoragePutInvocationRequest;
  storageConfig: AgentDiscoveryStorageServerConfig;
  config: OpenFoxConfig;
  db: OpenFoxDatabase;
  nowMs: number;
}): Promise<StoragePutBackendResult> {
  const skillsDir = params.config.skillsDir || "~/.openfox/skills";
  const [putStage] = params.storageConfig.putSkillStages;
  if (!putStage) {
    throw new Error("storage.put putSkillStages must define a put stage");
  }
  const result = parseStoragePutSkillResult(await runSkillBackend({
    skillsDir,
    skillName: putStage.skill,
    backendName: putStage.backend,
    input: {
      request: params.request,
      options: {
        maxObjectBytes: params.storageConfig.maxObjectBytes,
        defaultTtlSeconds: params.storageConfig.defaultTtlSeconds,
        maxTtlSeconds: params.storageConfig.maxTtlSeconds,
      },
      nowMs: params.nowMs,
    },
    context: {
      config: params.config,
      db: params.db,
      now: () => new Date(params.nowMs),
    },
  }));
  return {
    objectId: result.objectId,
    objectKey: result.objectKey,
    contentType: result.contentType,
    contentSha256: result.contentSha256,
    sizeBytes: result.sizeBytes,
    ttlSeconds: result.ttlSeconds,
    expiresAt: new Date(result.expiresAt * 1000).toISOString(),
    buffer: Buffer.from(result.bufferBase64, "base64"),
    backendSummary: {
      kind: "skills",
      stages: params.storageConfig.putSkillStages.map(formatSkillBackendStage),
    },
  };
}

function renderBuiltinStorageGet(params: {
  request: StorageGetInvocationRequest;
  object: StoredStorageObject;
  buffer: Buffer;
  nowMs: number;
}): StorageGetBackendResult {
  if (Date.parse(params.object.expiresAt) <= params.nowMs) {
    return {
      status: "rejected",
      httpStatus: 410,
      reason: "object expired",
      pruneExpired: true,
      backendSummary: {
        kind: "builtin",
        stages: ["builtin:storage.get"],
      },
    };
  }
  if (
    params.request.max_bytes !== undefined &&
    params.object.sizeBytes > params.request.max_bytes
  ) {
    return {
      status: "rejected",
      httpStatus: 400,
      reason: `object exceeds requested max_bytes (${params.request.max_bytes})`,
      backendSummary: {
        kind: "builtin",
        stages: ["builtin:storage.get"],
      },
    };
  }
  return {
    status: "ok",
    response: {
      status: "ok",
      object_id: params.object.objectId,
      expires_at: Math.floor(Date.parse(params.object.expiresAt) / 1000),
      content_type: params.object.contentType,
      content_sha256: params.object.contentSha256,
      size_bytes: params.object.sizeBytes,
      metadata: params.object.metadata,
      ...(params.request.inline_base64 === false
        ? {}
        : { content_base64: params.buffer.toString("base64") }),
      ...(params.object.contentType.startsWith("text/") ||
      params.object.contentType.includes("json")
        ? { content_text: params.buffer.toString("utf8") }
        : {}),
    },
    backendSummary: {
      kind: "builtin",
      stages: ["builtin:storage.get"],
    },
  };
}

async function renderSkillStorageGet(params: {
  request: StorageGetInvocationRequest;
  object: StoredStorageObject;
  buffer: Buffer;
  storageConfig: AgentDiscoveryStorageServerConfig;
  config: OpenFoxConfig;
  db: OpenFoxDatabase;
  nowMs: number;
}): Promise<StorageGetBackendResult> {
  const skillsDir = params.config.skillsDir || "~/.openfox/skills";
  const [getStage] = params.storageConfig.getSkillStages;
  if (!getStage) {
    throw new Error("storage.get getSkillStages must define a get stage");
  }
  const result = parseStorageGetSkillResult(await runSkillBackend({
    skillsDir,
    skillName: getStage.skill,
    backendName: getStage.backend,
    input: {
      request: params.request,
      object: {
        objectId: params.object.objectId,
        objectKey: params.object.objectKey,
        contentType: params.object.contentType,
        contentSha256: params.object.contentSha256,
        sizeBytes: params.object.sizeBytes,
        metadata: params.object.metadata,
        storedAt: params.object.storedAt,
        ttlSeconds: params.object.ttlSeconds,
        expiresAt: params.object.expiresAt,
      },
      bufferBase64: params.buffer.toString("base64"),
      nowMs: params.nowMs,
    },
    context: {
      config: params.config,
      db: params.db,
      now: () => new Date(params.nowMs),
    },
  }));
  return {
    ...result,
    backendSummary: {
      kind: "skills",
      stages: params.storageConfig.getSkillStages.map(formatSkillBackendStage),
    },
  };
}

export async function startAgentDiscoveryStorageServer(
  params: StartAgentDiscoveryStorageServerParams,
): Promise<AgentDiscoveryStorageServer> {
  const { storageConfig, config, db, address } = params;
  const pathPrefix = storageConfig.path.startsWith("/")
    ? storageConfig.path
    : `/${storageConfig.path}`;
  const healthzPath = `${pathPrefix}/healthz`;
  const rootPaths = new Set([pathPrefix, "/storage"]);
  const putPaths = new Set([`${pathPrefix}/put`, "/storage/put", ...rootPaths]);
  const getPaths = new Set([`${pathPrefix}/get`, "/storage/get", ...rootPaths]);
  const objectPrefix = "/storage/object/";
  const rootDir = resolvePath(storageConfig.storageDir);
  const objectsDir = path.join(rootDir, "objects");
  fs.mkdirSync(objectsDir, { recursive: true });

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
      if (req.method === "GET" && url.pathname === healthzPath) {
        json(res, 200, {
          ok: true,
          putCapability: storageConfig.putCapability,
          getCapability: storageConfig.getCapability,
          putPriceWei: storageConfig.putPriceWei,
          getPriceWei: storageConfig.getPriceWei,
          defaultTtlSeconds: storageConfig.defaultTtlSeconds,
          maxTtlSeconds: storageConfig.maxTtlSeconds,
          putBackendMode: storageConfig.putBackendMode,
          getBackendMode: storageConfig.getBackendMode,
          putSkillStages: storageConfig.putSkillStages,
          getSkillStages: storageConfig.getSkillStages,
          address,
          storageDir: rootDir,
        });
        return;
      }
      if (req.method === "GET" && url.pathname.startsWith(objectPrefix)) {
        const objectId = parseObjectId(url.pathname.slice(objectPrefix.length));
        if (!objectId) {
          json(res, 400, { error: "missing object id" });
          return;
        }
        const object = loadStoredObject(db, objectId);
        if (!object) {
          json(res, 404, { error: "object not found" });
          return;
        }
        if (Date.parse(object.expiresAt) <= Date.now()) {
          if (storageConfig.pruneExpiredOnRead) {
            deleteStoredObject(db, object);
          }
          json(res, 410, { error: "object expired" });
          return;
        }
        json(res, 200, {
          object_id: object.objectId,
          result_url: buildStorageObjectPath(object.objectId),
          object_key: object.objectKey || null,
          content_type: object.contentType,
          content_sha256: object.contentSha256,
          size_bytes: object.sizeBytes,
          metadata: object.metadata || {},
          stored_at: object.storedAt,
          ttl_seconds: object.ttlSeconds,
          expires_at: Math.floor(Date.parse(object.expiresAt) / 1000),
        });
        return;
      }
      if ((putPaths.has(url.pathname) || getPaths.has(url.pathname)) && req.method === "HEAD") {
        const amountWei = putPaths.has(url.pathname)
          ? storageConfig.putPriceWei
          : storageConfig.getPriceWei;
        const description = putPaths.has(url.pathname)
          ? "OpenFox storage.put payment"
          : "OpenFox storage.get payment";
        const paid = await requirePayment({
          req,
          res,
          config,
          providerAddress: address,
          amountWei,
          description,
        });
        if (paid) {
          res.statusCode = 200;
          res.end();
        }
        return;
      }
      if (req.method === "POST" && (putPaths.has(url.pathname) || getPaths.has(url.pathname))) {
        const rawBody = (await readJsonBody(req)) as Record<string, unknown>;
        const capability = String(rawBody.capability || "").trim();
        const wantsPut =
          url.pathname.endsWith("/put") ||
          (rootPaths.has(url.pathname) && capability === storageConfig.putCapability);
        const wantsGet =
          url.pathname.endsWith("/get") ||
          (rootPaths.has(url.pathname) && capability === storageConfig.getCapability);

        if (wantsPut) {
          const body = rawBody as unknown as StoragePutInvocationRequest;
          const requesterIdentity = validatePutRequest(body, storageConfig);
          const prepared = await executeProviderBackend({
            mode: storageConfig.putBackendMode,
            runSkills: () =>
              prepareSkillStoragePut({
                request: body,
                storageConfig,
                config,
                db,
                nowMs: Date.now(),
              }),
            runBuiltin: () =>
              Promise.resolve(
                prepareBuiltinStoragePut({
                  request: body,
                  storageConfig,
                  nowMs: Date.now(),
                }),
              ),
            onSkillsFailure: (error) => {
              logger.warn(
                `storage.put skill backend failed, falling back to builtin: ${
                  error instanceof Error ? error.message : String(error)
                }`,
              );
            },
          });
          const requestKey = buildStorageRequestKey(
            "put",
            requesterIdentity,
            body.capability,
            body.request_nonce,
          );
          const existingObjectId = db.getKV(requestKey);
          if (existingObjectId) {
            const existingObject = loadStoredObject(db, existingObjectId);
            if (!existingObject) {
              json(res, 409, { status: "rejected", reason: "storage.put state is inconsistent" });
              return;
            }
            const response: StoragePutInvocationResponse = {
              status: "ok",
              object_id: existingObject.objectId,
              result_url: buildStorageObjectPath(existingObject.objectId),
              price_wei: storageConfig.putPriceWei,
              idempotent: true,
              stored_at: Math.floor(new Date(existingObject.storedAt).getTime() / 1000),
              ttl_seconds: existingObject.ttlSeconds,
              expires_at: Math.floor(Date.parse(existingObject.expiresAt) / 1000),
              object_key: existingObject.objectKey,
              content_type: existingObject.contentType,
              content_sha256: existingObject.contentSha256,
              size_bytes: existingObject.sizeBytes,
              metadata: existingObject.metadata,
            };
            json(res, 200, response);
            return;
          }

          ensureRequestNotReplayed({
            db,
            scope: "storage_put",
            requesterIdentity,
            capability: body.capability,
            nonce: body.request_nonce,
          });

          const paid = await requirePayment({
            req,
            res,
            config,
            providerAddress: address,
            amountWei: storageConfig.putPriceWei,
            description: "OpenFox storage.put payment",
          });
          if (!paid) {
            return;
          }

          recordRequestNonce({
            db,
            scope: "storage_put",
            requesterIdentity,
            capability: body.capability,
            nonce: body.request_nonce,
            expiresAt: body.request_expires_at,
          });

          const objectId = prepared.result.objectId;
          const filePath = path.join(objectsDir, `${objectId}.bin`);
          if (!fs.existsSync(filePath)) {
            fs.writeFileSync(filePath, prepared.result.buffer);
          }
          const storedAt = new Date().toISOString();
          const object: StoredStorageObject = {
            objectId,
            objectKey: prepared.result.objectKey,
            contentType: prepared.result.contentType,
            contentSha256: prepared.result.contentSha256,
            sizeBytes: prepared.result.sizeBytes,
            metadata: body.metadata,
            storedAt,
            ttlSeconds: prepared.result.ttlSeconds,
            expiresAt: prepared.result.expiresAt,
            filePath,
          };
          storeObject(db, object);
          db.setKV(requestKey, objectId);
          const response: StoragePutInvocationResponse = {
            status: "ok",
            object_id: objectId,
            result_url: buildStorageObjectPath(objectId),
            price_wei: storageConfig.putPriceWei,
            payment_tx_hash: paid.txHash,
            stored_at: Math.floor(Date.now() / 1000),
            ttl_seconds: object.ttlSeconds,
            expires_at: Math.floor(Date.parse(object.expiresAt) / 1000),
            object_key: object.objectKey,
            content_type: object.contentType,
            content_sha256: object.contentSha256,
            size_bytes: object.sizeBytes,
            metadata: object.metadata,
          };
          json(res, 200, response);
          return;
        }

        if (wantsGet) {
          const body = rawBody as unknown as StorageGetInvocationRequest;
          const requesterIdentity = validateGetRequest(body, storageConfig);
          const requestKey = buildStorageRequestKey(
            "get",
            requesterIdentity,
            body.capability,
            body.request_nonce,
          );
          const existingGet = db.getKV(requestKey);
          if (existingGet) {
            json(res, 200, JSON.parse(existingGet) as StorageGetInvocationResponse);
            return;
          }

          const objectId = parseObjectId(body.object_id || body.content_sha256 || "");
          const object = loadStoredObject(db, objectId);
          if (!object) {
            json(res, 404, { status: "rejected", reason: "object not found" });
            return;
          }
          const buffer = fs.readFileSync(object.filePath);
          const rendered = await executeProviderBackend({
            mode: storageConfig.getBackendMode,
            runSkills: () =>
              renderSkillStorageGet({
                request: body,
                object,
                buffer,
                storageConfig,
                config,
                db,
                nowMs: Date.now(),
              }),
            runBuiltin: () =>
              Promise.resolve(
                renderBuiltinStorageGet({
                  request: body,
                  object,
                  buffer,
                  nowMs: Date.now(),
                }),
              ),
            onSkillsFailure: (error) => {
              logger.warn(
                `storage.get skill backend failed, falling back to builtin: ${
                  error instanceof Error ? error.message : String(error)
                }`,
              );
            },
          });
          if (rendered.result.status !== "ok") {
            if (
              rendered.result.pruneExpired &&
              storageConfig.pruneExpiredOnRead
            ) {
              deleteStoredObject(db, object);
            }
            json(res, rendered.result.httpStatus, {
              status: "rejected",
              reason: rendered.result.reason,
            });
            return;
          }

          ensureRequestNotReplayed({
            db,
            scope: "storage_get",
            requesterIdentity,
            capability: body.capability,
            nonce: body.request_nonce,
          });

          const paid = await requirePayment({
            req,
            res,
            config,
            providerAddress: address,
            amountWei: storageConfig.getPriceWei,
            description: "OpenFox storage.get payment",
          });
          if (!paid) {
            return;
          }

          recordRequestNonce({
            db,
            scope: "storage_get",
            requesterIdentity,
            capability: body.capability,
            nonce: body.request_nonce,
            expiresAt: body.request_expires_at,
          });
          const response: StorageGetInvocationResponse = {
            ...rendered.result.response,
            payment_tx_hash: paid.txHash,
            fetched_at: Math.floor(Date.now() / 1000),
          };
          db.setKV(requestKey, JSON.stringify(response));
          json(res, 200, response);
          return;
        }

        throw new Error(`unsupported capability ${capability}`);
      }

      json(res, 404, { error: "not found" });
    } catch (error) {
      logger.warn(
        `Storage request failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      json(res, 400, {
        status: "rejected",
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(storageConfig.port, storageConfig.bindHost, () => {
      server.off("error", reject);
      resolve();
    });
  });

  const addr = server.address();
  const boundPort =
    addr && typeof addr === "object" && "port" in addr ? addr.port : storageConfig.port;
  const actualURL = buildStorageServerUrl({
    ...storageConfig,
    port: boundPort,
  });
  logger.info(`Agent Discovery storage server listening on ${actualURL}`);

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
