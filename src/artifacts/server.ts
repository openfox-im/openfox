import http, { type IncomingMessage, type ServerResponse } from "http";
import { URL } from "url";
import type { Address } from "tosdk";
import type {
  ArtifactAnchorRecord,
  ArtifactCaptureServerConfig,
  ArtifactRecord,
  ArtifactVerificationRecord,
  OpenFoxDatabase,
  OpenFoxIdentity,
} from "../types.js";
import type { ArtifactManager } from "./manager.js";
import { createLogger } from "../observability/logger.js";
import {
  normalizeNonce,
  validateRequestExpiry,
} from "../agent-discovery/security.js";

const logger = createLogger("artifacts.server");

export interface ArtifactCaptureServer {
  url: string;
  close(): Promise<void>;
}

interface ArtifactRequesterIdentity {
  kind: "tos";
  value: Address;
}

interface ArtifactRequesterEnvelope {
  identity: ArtifactRequesterIdentity;
}

interface CaptureBaseRequest {
  capability: string;
  requester: ArtifactRequesterEnvelope;
  request_nonce: string;
  request_expires_at: number;
  ttl_seconds?: number;
  auto_anchor?: boolean;
}

export interface CaptureNewsRequest extends CaptureBaseRequest {
  title: string;
  source_url: string;
  headline?: string;
  body_text: string;
}

export interface CaptureOracleEvidenceRequest extends CaptureBaseRequest {
  title: string;
  question: string;
  evidence_text: string;
  source_url?: string;
  related_artifact_ids?: string[];
}

interface StoredArtifactCaptureRequest {
  requestKey: string;
  artifactId: string;
  capability: string;
  requesterIdentity: string;
  createdAt: string;
}

const DEFAULT_BODY_LIMIT_BYTES = 256 * 1024;

function json(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Content-Length", Buffer.byteLength(payload));
  res.end(payload);
}

async function readJsonBody(
  req: IncomingMessage,
  limitBytes: number,
): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > limitBytes) {
      throw new Error("request body too large");
    }
    chunks.push(buffer);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
}

function normalizePathPrefix(pathPrefix: string): string {
  return pathPrefix.startsWith("/") ? pathPrefix : `/${pathPrefix}`;
}

function buildBaseUrl(params: {
  bindHost: string;
  port: number;
  pathPrefix: string;
}): string {
  const host = params.bindHost === "0.0.0.0" ? "127.0.0.1" : params.bindHost;
  return `http://${host}:${params.port}${normalizePathPrefix(params.pathPrefix)}`;
}

function captureRequestKey(params: {
  capability: string;
  requesterIdentity: string;
  nonce: string;
}): string {
  return [
    "artifacts:capture",
    params.capability.toLowerCase(),
    params.requesterIdentity.toLowerCase(),
    params.nonce,
  ].join(":");
}

function requesterIdentityFromBody(
  body: Record<string, unknown>,
  config: ArtifactCaptureServerConfig,
): ArtifactRequesterIdentity {
  const requester = body.requester as Record<string, unknown> | undefined;
  const identity = requester?.identity as Record<string, unknown> | undefined;
  const kind = String(identity?.kind || "").trim();
  const value = String(identity?.value || "").trim() as Address;
  if (!kind || !value) {
    throw new Error("missing requester identity");
  }
  if (config.requireNativeIdentity && kind !== "tos") {
    throw new Error("requester identity must be native");
  }
  return {
    kind: "tos",
    value,
  };
}

function loadStoredCapture(
  db: OpenFoxDatabase,
  requestKey: string,
): StoredArtifactCaptureRequest | null {
  const raw = db.getKV(requestKey);
  if (!raw) return null;
  return JSON.parse(raw) as StoredArtifactCaptureRequest;
}

function storeCapturedRequest(
  db: OpenFoxDatabase,
  record: StoredArtifactCaptureRequest,
): void {
  db.setKV(record.requestKey, JSON.stringify(record));
}

function buildArtifactResponse(params: {
  baseUrl: string;
  artifactId: string;
  artifact: ArtifactRecord;
  verification: ArtifactVerificationRecord | null;
  anchor: ArtifactAnchorRecord | null;
}) {
  return {
    artifact: params.artifact,
    verification: params.verification,
    anchor: params.anchor,
    artifact_url: `${params.baseUrl}/item/${params.artifactId}`,
  };
}

export async function startArtifactCaptureServer(params: {
  identity: OpenFoxIdentity;
  db: OpenFoxDatabase;
  manager: ArtifactManager;
  config: ArtifactCaptureServerConfig;
  captureCapability: string;
  evidenceCapability: string;
}): Promise<ArtifactCaptureServer> {
  const pathPrefix = normalizePathPrefix(params.config.pathPrefix);
  const bodyLimitBytes = params.config.maxBodyBytes || DEFAULT_BODY_LIMIT_BYTES;
  const newsPath = `${pathPrefix}/capture-news`;
  const evidencePath = `${pathPrefix}/oracle-evidence`;
  const healthzPath = `${pathPrefix}/healthz`;
  const itemPrefix = `${pathPrefix}/item/`;

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
      if (req.method === "GET" && url.pathname === healthzPath) {
        json(res, 200, {
          ok: true,
          captureCapability: params.captureCapability,
          evidenceCapability: params.evidenceCapability,
          address: params.identity.address,
        });
        return;
      }

      if (req.method === "GET" && url.pathname.startsWith(itemPrefix)) {
        const artifactId = url.pathname.slice(itemPrefix.length).trim();
        if (!artifactId) {
          json(res, 400, { error: "missing artifact id" });
          return;
        }
        const artifact = params.manager.getArtifact(artifactId);
        if (!artifact) {
          json(res, 404, { error: "artifact not found" });
          return;
        }
        const verification = params.db.getArtifactVerificationByArtifactId(artifactId) ?? null;
        const anchor = params.db.getArtifactAnchorByArtifactId(artifactId) ?? null;
        json(
          res,
          200,
          buildArtifactResponse({
            baseUrl,
            artifactId,
            artifact,
            verification,
            anchor,
          }),
        );
        return;
      }

      if (req.method !== "POST" || (url.pathname !== newsPath && url.pathname !== evidencePath)) {
        json(res, 404, { error: "not found" });
        return;
      }

      const body = await readJsonBody(req, bodyLimitBytes);
      const requesterIdentity = requesterIdentityFromBody(body, params.config);
      const capability = String(body.capability || "").trim();
      const requestNonce = normalizeNonce(String(body.request_nonce || ""));
      validateRequestExpiry(Number(body.request_expires_at));
      const requestKey = captureRequestKey({
        capability,
        requesterIdentity: requesterIdentity.value,
        nonce: requestNonce,
      });
      const existing = loadStoredCapture(params.db, requestKey);
      if (existing) {
        const artifact = params.manager.getArtifact(existing.artifactId);
        if (artifact) {
          const verification =
            params.db.getArtifactVerificationByArtifactId(existing.artifactId) ?? null;
          const anchor = params.db.getArtifactAnchorByArtifactId(existing.artifactId) ?? null;
          json(
            res,
            200,
            buildArtifactResponse({
              baseUrl,
              artifactId: existing.artifactId,
              artifact,
              verification,
              anchor,
            }),
          );
          return;
        }
      }

      if (url.pathname === newsPath) {
        if (capability !== params.captureCapability) {
          throw new Error(`unsupported capability ${capability}`);
        }
        const title = String(body.title || "").trim();
        const sourceUrl = String(body.source_url || "").trim();
        const headline = String(body.headline || title).trim();
        const bodyText = String(body.body_text || "").trim();
        if (!title || !sourceUrl || !bodyText) {
          throw new Error("title, source_url, and body_text are required");
        }
        if (headline.length > params.config.maxTextChars || bodyText.length > params.config.maxTextChars) {
          throw new Error("request text exceeds maxTextChars");
        }
        const result = await params.manager.capturePublicNews({
          title,
          sourceUrl,
          headline,
          bodyText,
          ttlSeconds:
            typeof body.ttl_seconds === "number" ? (body.ttl_seconds as number) : undefined,
          autoAnchor: body.auto_anchor === true,
        });
        storeCapturedRequest(params.db, {
          requestKey,
          artifactId: result.artifact.artifactId,
          capability,
          requesterIdentity: requesterIdentity.value,
          createdAt: new Date().toISOString(),
        });
        json(
          res,
          200,
          buildArtifactResponse({
            baseUrl,
            artifactId: result.artifact.artifactId,
            artifact: result.artifact,
            verification: null,
            anchor: result.anchor ?? null,
          }),
        );
        return;
      }

      if (capability !== params.evidenceCapability) {
        throw new Error(`unsupported capability ${capability}`);
      }
      const title = String(body.title || "").trim();
      const question = String(body.question || "").trim();
      const evidenceText = String(body.evidence_text || "").trim();
      const sourceUrl = body.source_url ? String(body.source_url).trim() : undefined;
      const relatedArtifactIds = Array.isArray(body.related_artifact_ids)
        ? body.related_artifact_ids.map((value) => String(value))
        : undefined;
      if (!title || !question || !evidenceText) {
        throw new Error("title, question, and evidence_text are required");
      }
      if (question.length > params.config.maxTextChars || evidenceText.length > params.config.maxTextChars) {
        throw new Error("request text exceeds maxTextChars");
      }
      const result = await params.manager.createOracleEvidence({
        title,
        question,
        evidenceText,
        sourceUrl,
        relatedArtifactIds,
        ttlSeconds:
          typeof body.ttl_seconds === "number" ? (body.ttl_seconds as number) : undefined,
        autoAnchor: body.auto_anchor === true,
      });
      storeCapturedRequest(params.db, {
        requestKey,
        artifactId: result.artifact.artifactId,
        capability,
        requesterIdentity: requesterIdentity.value,
        createdAt: new Date().toISOString(),
      });
      json(
        res,
        200,
        buildArtifactResponse({
          baseUrl,
          artifactId: result.artifact.artifactId,
          artifact: result.artifact,
          verification: null,
          anchor: result.anchor ?? null,
        }),
      );
    } catch (error) {
      logger.warn(
        `artifact capture request failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      json(res, 400, {
        error: error instanceof Error ? error.message : "request failed",
      });
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(params.config.port, params.config.bindHost, () => {
      server.off("error", reject);
      resolve();
    });
  });

  const bound = server.address();
  if (!bound || typeof bound === "string") {
    throw new Error("failed to determine artifact capture server address");
  }
  const baseUrl = buildBaseUrl({
    bindHost: params.config.bindHost,
    port: bound.port,
    pathPrefix: params.config.pathPrefix,
  });

  return {
    url: baseUrl,
    close: async () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      }),
  };
}
