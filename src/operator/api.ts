import http, { type IncomingMessage, type ServerResponse } from "http";
import type { OpenFoxConfig, OpenFoxDatabase } from "../types.js";
import { createLogger } from "../observability/logger.js";
import {
  buildGatewayStatusSnapshot,
  buildCombinedServiceStatusSnapshot,
} from "../service/operator.js";
import { getManagedServiceStatus } from "../service/daemon.js";
import { buildHealthSnapshot } from "../doctor/report.js";
import {
  buildRuntimeStatusSnapshot,
} from "./status.js";
import {
  buildArtifactsOperatorStatusSnapshot,
  buildPaymasterOperatorStatusSnapshot,
  buildSignerOperatorStatusSnapshot,
  buildStorageOperatorStatusSnapshot,
} from "./components.js";
import {
  runArtifactMaintenance,
  runStorageMaintenance,
} from "./maintenance.js";
import { buildProviderReputationSnapshot } from "./provider-reputation.js";
import { buildStorageLeaseHealthSnapshot } from "./storage-health.js";

const logger = createLogger("operator.api");

export interface OperatorApiServer {
  url: string;
  close(): Promise<void>;
}

export interface StartOperatorApiServerParams {
  config: OpenFoxConfig;
  db: OpenFoxDatabase;
}

function json(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Content-Length", Buffer.byteLength(payload));
  res.end(payload);
}

function normalizePathPrefix(pathPrefix: string): string {
  return pathPrefix.startsWith("/") ? pathPrefix : `/${pathPrefix}`;
}

async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  if (chunks.length === 0) return {};
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return {};
  const parsed = JSON.parse(raw);
  return typeof parsed === "object" && parsed !== null
    ? (parsed as Record<string, unknown>)
    : {};
}

function getBearerToken(req: IncomingMessage): string | undefined {
  const authHeader = req.headers.authorization;
  if (typeof authHeader === "string" && authHeader.startsWith("Bearer ")) {
    return authHeader.slice("Bearer ".length).trim();
  }
  const alt = req.headers["x-openfox-operator-token"];
  return typeof alt === "string" && alt.trim() ? alt.trim() : undefined;
}

function ensureAuthorized(
  req: IncomingMessage,
  res: ServerResponse,
  token: string | undefined,
): boolean {
  if (!token) {
    json(res, 500, {
      error: "operator API is enabled but no auth token is configured",
    });
    return false;
  }
  const provided = getBearerToken(req);
  if (provided !== token) {
    json(res, 401, { error: "unauthorized" });
    return false;
  }
  return true;
}

export async function startOperatorApiServer(
  params: StartOperatorApiServerParams,
): Promise<OperatorApiServer | null> {
  const operatorApi = params.config.operatorApi;
  if (!operatorApi?.enabled) return null;

  const pathPrefix = normalizePathPrefix(operatorApi.pathPrefix);
  const statusPath = `${pathPrefix}/status`;
  const healthPath = `${pathPrefix}/health`;
  const doctorPath = `${pathPrefix}/doctor`;
  const servicePath = `${pathPrefix}/service/status`;
  const gatewayPath = `${pathPrefix}/gateway/status`;
  const storagePath = `${pathPrefix}/storage/status`;
  const storageLeaseHealthPath = `${pathPrefix}/storage/lease-health`;
  const storageMaintainPath = `${pathPrefix}/storage/maintain`;
  const artifactsPath = `${pathPrefix}/artifacts/status`;
  const artifactsMaintainPath = `${pathPrefix}/artifacts/maintain`;
  const signerPath = `${pathPrefix}/signer/status`;
  const paymasterPath = `${pathPrefix}/paymaster/status`;
  const providersPath = `${pathPrefix}/providers/reputation`;
  const healthzPath = `${pathPrefix}/healthz`;

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
      if (req.method === "GET" && url.pathname === healthzPath) {
        json(res, 200, { ok: true });
        return;
      }

      if (!ensureAuthorized(req, res, operatorApi.authToken)) {
        return;
      }

      if (req.method === "GET" && url.pathname === statusPath) {
        json(res, 200, buildRuntimeStatusSnapshot(params.config, params.db));
        return;
      }

      if (req.method === "GET" && url.pathname === healthPath) {
        json(res, 200, await buildHealthSnapshot(params.config, params.db));
        return;
      }

      if (req.method === "GET" && url.pathname === doctorPath) {
        if (!operatorApi.exposeDoctor) {
          json(res, 404, { error: "doctor endpoint disabled" });
          return;
        }
        json(res, 200, await buildHealthSnapshot(params.config, params.db));
        return;
      }

      if (req.method === "GET" && url.pathname === servicePath) {
        if (!operatorApi.exposeServiceStatus) {
          json(res, 404, { error: "service status endpoint disabled" });
          return;
        }
        json(
          res,
          200,
          buildCombinedServiceStatusSnapshot(
            getManagedServiceStatus(),
            params.config,
            params.db.raw,
          ),
        );
        return;
      }

      if (req.method === "GET" && url.pathname === gatewayPath) {
        if (!operatorApi.exposeServiceStatus) {
          json(res, 404, { error: "gateway status endpoint disabled" });
          return;
        }
        json(res, 200, await buildGatewayStatusSnapshot(params.config, params.db.raw));
        return;
      }

      if (req.method === "GET" && url.pathname === storagePath) {
        json(res, 200, await buildStorageOperatorStatusSnapshot(params.config, params.db));
        return;
      }

      if (req.method === "GET" && url.pathname === storageLeaseHealthPath) {
        const limitParam = url.searchParams.get("limit");
        const limit =
          limitParam && Number.isFinite(Number(limitParam))
            ? Number(limitParam)
            : undefined;
        json(
          res,
          200,
          buildStorageLeaseHealthSnapshot({
            config: params.config,
            db: params.db,
            limit,
          }),
        );
        return;
      }

      if (req.method === "POST" && url.pathname === storageMaintainPath) {
        const body = await readJsonBody(req);
        const limit =
          typeof body.limit === "number" && Number.isFinite(body.limit)
            ? body.limit
            : undefined;
        json(
          res,
          200,
          await runStorageMaintenance({
            config: params.config,
            db: params.db,
            limit,
          }),
        );
        return;
      }

      if (req.method === "GET" && url.pathname === artifactsPath) {
        json(res, 200, await buildArtifactsOperatorStatusSnapshot(params.config, params.db));
        return;
      }

      if (req.method === "POST" && url.pathname === artifactsMaintainPath) {
        const body = await readJsonBody(req);
        const limit =
          typeof body.limit === "number" && Number.isFinite(body.limit)
            ? body.limit
            : undefined;
        json(
          res,
          200,
          await runArtifactMaintenance({
            config: params.config,
            db: params.db,
            limit,
          }),
        );
        return;
      }

      if (req.method === "GET" && url.pathname === signerPath) {
        json(res, 200, await buildSignerOperatorStatusSnapshot(params.config, params.db));
        return;
      }

      if (req.method === "GET" && url.pathname === paymasterPath) {
        json(res, 200, await buildPaymasterOperatorStatusSnapshot(params.config, params.db));
        return;
      }

      if (req.method === "GET" && url.pathname === providersPath) {
        const kindParam = url.searchParams.get("kind");
        const kind =
          kindParam === "storage" ||
          kindParam === "artifacts" ||
          kindParam === "signer" ||
          kindParam === "paymaster"
            ? kindParam
            : undefined;
        const limitParam = url.searchParams.get("limit");
        const limit =
          limitParam && Number.isFinite(Number(limitParam))
            ? Number(limitParam)
            : undefined;
        json(
          res,
          200,
          buildProviderReputationSnapshot({
            db: params.db,
            kind,
            limit,
          }),
        );
        return;
      }

      json(res, 404, { error: "not found" });
    } catch (error) {
      logger.error("Operator API request failed", error instanceof Error ? error : undefined);
      json(res, 500, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(operatorApi.port, operatorApi.bindHost, () => {
      server.off("error", reject);
      resolve();
    });
  });

  const boundAddress = server.address();
  const actualPort =
    boundAddress && typeof boundAddress !== "string"
      ? boundAddress.port
      : operatorApi.port;
  const normalizedHost =
    operatorApi.bindHost === "0.0.0.0" ? "127.0.0.1" : operatorApi.bindHost;
  const baseUrl = `http://${normalizedHost}:${actualPort}${pathPrefix}`;
  logger.info(`Operator API enabled at ${baseUrl}`);

  return {
    url: baseUrl,
    async close() {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    },
  };
}
