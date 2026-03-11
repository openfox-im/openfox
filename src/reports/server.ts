import http, { type IncomingMessage, type ServerResponse } from "http";
import type {
  OpenFoxConfig,
  OpenFoxDatabase,
  OwnerReportPeriodKind,
} from "../types.js";
import { createLogger } from "../observability/logger.js";
import { renderOwnerReportHtml } from "./render.js";

const logger = createLogger("reports.server");

export interface OwnerReportServer {
  url: string;
  close(): Promise<void>;
}

function normalizePathPrefix(pathPrefix: string): string {
  return pathPrefix.startsWith("/") ? pathPrefix : `/${pathPrefix}`;
}

function json(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Content-Length", Buffer.byteLength(payload));
  res.end(payload);
}

function html(res: ServerResponse, status: number, body: string): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Content-Length", Buffer.byteLength(body));
  res.end(body);
}

function getBearerToken(req: IncomingMessage): string | undefined {
  const authHeader = req.headers.authorization;
  if (typeof authHeader === "string" && authHeader.startsWith("Bearer ")) {
    return authHeader.slice("Bearer ".length).trim();
  }
  const alt = req.headers["x-openfox-owner-token"];
  return typeof alt === "string" && alt.trim() ? alt.trim() : undefined;
}

function ensureAuthorized(
  req: IncomingMessage,
  token: string | undefined,
  url: URL,
): boolean {
  if (!token) return true;
  const provided = getBearerToken(req) || url.searchParams.get("token") || undefined;
  return provided === token;
}

function isPeriodKind(value: string | null): value is OwnerReportPeriodKind {
  return value === "daily" || value === "weekly";
}

export async function startOwnerReportServer(params: {
  config: OpenFoxConfig;
  db: OpenFoxDatabase;
}): Promise<OwnerReportServer | null> {
  if (!params.config.ownerReports?.enabled || !params.config.ownerReports.web.enabled) {
    return null;
  }

  const webConfig = params.config.ownerReports.web;
  const pathPrefix = normalizePathPrefix(webConfig.pathPrefix);

  const server = http.createServer((req, res) => {
    void (async () => {
      try {
        const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
        if (!ensureAuthorized(req, webConfig.authToken, url)) {
          json(res, 401, { error: "unauthorized" });
          return;
        }

        if (req.method === "GET" && url.pathname === `${pathPrefix}/healthz`) {
          json(res, 200, { ok: true });
          return;
        }

        if (req.method === "GET" && url.pathname === pathPrefix) {
          const latest = params.db.getLatestOwnerReport("daily") || params.db.getLatestOwnerReport("weekly");
          if (!latest) {
            html(res, 200, "<html><body><h1>No owner reports yet.</h1></body></html>");
            return;
          }
          html(res, 200, renderOwnerReportHtml(latest));
          return;
        }

        if (req.method === "GET" && url.pathname === `${pathPrefix}/reports`) {
          const limit = Number.parseInt(url.searchParams.get("limit") || "20", 10);
          const periodRaw = url.searchParams.get("period");
          const periodKind = isPeriodKind(periodRaw) ? periodRaw : undefined;
          const items = params.db.listOwnerReports(limit, { periodKind });
          json(res, 200, { items });
          return;
        }

        if (req.method === "GET" && url.pathname.startsWith(`${pathPrefix}/reports/latest/`)) {
          const periodRaw = url.pathname.slice(`${pathPrefix}/reports/latest/`.length);
          if (!isPeriodKind(periodRaw)) {
            json(res, 404, { error: "report not found" });
            return;
          }
          const report = params.db.getLatestOwnerReport(periodRaw);
          if (!report) {
            json(res, 404, { error: "report not found" });
            return;
          }
          const format = url.searchParams.get("format");
          if (format === "html") {
            html(res, 200, renderOwnerReportHtml(report));
            return;
          }
          json(res, 200, report);
          return;
        }

        if (req.method === "GET" && url.pathname.startsWith(`${pathPrefix}/reports/`)) {
          const reportId = decodeURIComponent(url.pathname.slice(`${pathPrefix}/reports/`.length));
          const report = params.db.getOwnerReport(reportId);
          if (!report) {
            json(res, 404, { error: "report not found" });
            return;
          }
          const format = url.searchParams.get("format");
          if (format === "html") {
            html(res, 200, renderOwnerReportHtml(report));
            return;
          }
          json(res, 200, report);
          return;
        }

        if (req.method === "GET" && url.pathname === `${pathPrefix}/deliveries`) {
          const limit = Number.parseInt(url.searchParams.get("limit") || "20", 10);
          const channelRaw = url.searchParams.get("channel");
          const statusRaw = url.searchParams.get("status");
          const items = params.db.listOwnerReportDeliveries(limit, {
            channel:
              channelRaw === "web" || channelRaw === "email" ? channelRaw : undefined,
            status:
              statusRaw === "pending" ||
              statusRaw === "delivered" ||
              statusRaw === "failed"
                ? statusRaw
                : undefined,
          });
          json(res, 200, { items });
          return;
        }

        json(res, 404, { error: "not found" });
      } catch (error) {
        logger.warn(
          `Owner report server request failed: ${error instanceof Error ? error.message : String(error)}`,
        );
        json(res, 500, {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    })();
  });

  await new Promise<void>((resolve) => {
    server.listen(webConfig.port, webConfig.bindHost, () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("failed to resolve owner report server address");
  }
  return {
    url: `http://${webConfig.bindHost}:${address.port}${pathPrefix}`,
    close: async () =>
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}
