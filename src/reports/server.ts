import http, { type IncomingMessage, type ServerResponse } from "http";
import type {
  OpenFoxConfig,
  OpenFoxDatabase,
  OwnerOpportunityAlertRecord,
  OwnerOpportunityActionExecutionRecord,
  OperatorApprovalRequestRecord,
  OwnerReportPeriodKind,
} from "../types.js";
import { createLogger } from "../observability/logger.js";
import { decideOperatorApprovalRequest } from "../operator/autopilot.js";
import { queueOwnerOpportunityAlertAction } from "./alerts.js";
import { materializeApprovedOwnerOpportunityAction } from "./actions.js";
import { executeOwnerOpportunityAction } from "./action-execution.js";
import { renderOwnerReportHtml } from "./render.js";
import { getWallet } from "../identity/wallet.js";
import { createInferenceClient } from "../runtime/inference.js";
import { ModelRegistry } from "../inference/registry.js";

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

function redirect(res: ServerResponse, location: string): void {
  res.statusCode = 303;
  res.setHeader("Location", location);
  res.end();
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

async function readBody(
  req: IncomingMessage,
): Promise<Record<string, string | undefined>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  if (!chunks.length) return {};
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return {};
  const contentType = String(req.headers["content-type"] || "");
  if (contentType.includes("application/json")) {
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      return Object.fromEntries(
        Object.entries(parsed).map(([key, value]) => [
          key,
          value == null ? undefined : String(value),
        ]),
      );
    } catch {
      return {};
    }
  }
  const params = new URLSearchParams(raw);
  return Object.fromEntries(params.entries());
}

function renderOwnerApprovalsHtml(params: {
  approvals: OperatorApprovalRequestRecord[];
  pathPrefix: string;
  token?: string;
  status?: string | null;
}): string {
  const tokenQuery = params.token ? `?token=${encodeURIComponent(params.token)}` : "";
  const statusLabel = params.status?.trim() || "all";
  const rows = params.approvals
    .map((approval) => {
      const approveAction = `${params.pathPrefix}/approvals/${encodeURIComponent(approval.requestId)}/approve${tokenQuery}`;
      const rejectAction = `${params.pathPrefix}/approvals/${encodeURIComponent(approval.requestId)}/reject${tokenQuery}`;
      const note = approval.reason ? `<p><strong>Reason:</strong> ${approval.reason}</p>` : "";
      const payload = approval.payload
        ? `<details><summary>Payload</summary><pre>${JSON.stringify(approval.payload, null, 2)}</pre></details>`
        : "";
      const actions =
        approval.status === "pending"
          ? `
        <form method="post" action="${approveAction}" style="display:inline-block;margin-right:8px;">
          <button type="submit">Approve</button>
        </form>
        <form method="post" action="${rejectAction}" style="display:inline-block;">
          <button type="submit">Reject</button>
        </form>`
          : `<p><strong>Decision:</strong> ${approval.status}${approval.decisionNote ? ` — ${approval.decisionNote}` : ""}</p>`;
      return `
      <article style="border:1px solid #d0d7de;border-radius:12px;padding:16px;margin:16px 0;">
        <h2 style="margin:0 0 8px 0;">${approval.kind}</h2>
        <p><strong>Request ID:</strong> ${approval.requestId}</p>
        <p><strong>Status:</strong> ${approval.status}</p>
        <p><strong>Scope:</strong> ${approval.scope}</p>
        <p><strong>Requested by:</strong> ${approval.requestedBy}</p>
        <p><strong>Expires:</strong> ${approval.expiresAt || "(none)"}</p>
        ${note}
        ${payload}
        <div style="margin-top:12px;">${actions}</div>
      </article>`;
    })
    .join("\n");
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>OpenFox Approval Inbox</title>
  </head>
  <body style="font-family:ui-sans-serif,system-ui,sans-serif;max-width:840px;margin:0 auto;padding:24px;">
    <h1>OpenFox Approval Inbox</h1>
    <p>Showing <strong>${params.approvals.length}</strong> ${statusLabel} approval request(s).</p>
    <p><a href="${params.pathPrefix}${tokenQuery}">Back to latest report</a></p>
    ${rows || "<p>No approval requests found.</p>"}
  </body>
</html>`;
}

function renderOwnerAlertsHtml(params: {
  alerts: OwnerOpportunityAlertRecord[];
  pathPrefix: string;
  token?: string;
  status?: string | null;
}): string {
  const tokenQuery = params.token ? `?token=${encodeURIComponent(params.token)}` : "";
  const statusLabel = params.status?.trim() || "all";
  const rows = params.alerts
    .map((alert) => {
      const readAction = `${params.pathPrefix}/alerts/${encodeURIComponent(alert.alertId)}/read${tokenQuery}`;
      const dismissAction = `${params.pathPrefix}/alerts/${encodeURIComponent(alert.alertId)}/dismiss${tokenQuery}`;
      const requestAction = `${params.pathPrefix}/alerts/${encodeURIComponent(alert.alertId)}/request-action${tokenQuery}`;
      const metadata = [
        `<p><strong>Status:</strong> ${alert.status}</p>`,
        `<p><strong>Kind:</strong> ${alert.kind}</p>`,
        `<p><strong>Provider class:</strong> ${alert.providerClass}</p>`,
        `<p><strong>Trust tier:</strong> ${alert.trustTier}</p>`,
        `<p><strong>Margin:</strong> ${alert.marginWei} (${alert.marginBps} bps)</p>`,
        alert.strategyScore == null
          ? ""
          : `<p><strong>Strategy score:</strong> ${alert.strategyScore}</p>`,
        alert.capability ? `<p><strong>Capability:</strong> ${alert.capability}</p>` : "",
        alert.baseUrl ? `<p><strong>Base URL:</strong> ${alert.baseUrl}</p>` : "",
        alert.actionRequestId
          ? `<p><strong>Queued action:</strong> ${alert.actionKind || "review"} via approval ${alert.actionRequestId}</p>`
          : "",
      ].join("");
      const actions =
        !alert.actionRequestId
          ? `
        <form method="post" action="${readAction}" style="display:inline-block;margin-right:8px;">
          <button type="submit">Mark read</button>
        </form>
        <form method="post" action="${dismissAction}" style="display:inline-block;">
          <button type="submit">Dismiss</button>
        </form>
        <form method="post" action="${requestAction}" style="display:inline-block;margin-left:8px;">
          <input type="hidden" name="action" value="review" />
          <button type="submit">Queue review</button>
        </form>`
          : `<p><strong>Decision:</strong> ${alert.status}</p>`;
      return `
      <article style="border:1px solid #d0d7de;border-radius:12px;padding:16px;margin:16px 0;">
        <h2 style="margin:0 0 8px 0;">${alert.title}</h2>
        <p>${alert.summary}</p>
        ${metadata}
        <p><strong>Suggested action:</strong> ${alert.suggestedAction}</p>
        <div style="margin-top:12px;">${actions}</div>
      </article>`;
    })
    .join("\n");
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>OpenFox Opportunity Alerts</title>
  </head>
  <body style="font-family:ui-sans-serif,system-ui,sans-serif;max-width:840px;margin:0 auto;padding:24px;">
    <h1>OpenFox Opportunity Alerts</h1>
    <p>Showing <strong>${params.alerts.length}</strong> ${statusLabel} alert(s).</p>
    <p><a href="${params.pathPrefix}${tokenQuery}">Back to latest report</a></p>
    ${rows || "<p>No opportunity alerts found.</p>"}
  </body>
</html>`;
}

function renderOwnerActionsHtml(params: {
  actions: import("../types.js").OwnerOpportunityActionRecord[];
  executions?: OwnerOpportunityActionExecutionRecord[];
  pathPrefix: string;
  token?: string;
  status?: string | null;
}): string {
  const tokenQuery = params.token ? `?token=${encodeURIComponent(params.token)}` : "";
  const statusLabel = params.status?.trim() || "all";
  const rows = params.actions
    .map((action) => {
      const completeAction = `${params.pathPrefix}/actions/${encodeURIComponent(action.actionId)}/complete${tokenQuery}`;
      const cancelAction = `${params.pathPrefix}/actions/${encodeURIComponent(action.actionId)}/cancel${tokenQuery}`;
      const executeAction = `${params.pathPrefix}/actions/${encodeURIComponent(action.actionId)}/execute${tokenQuery}`;
      const latestExecution = params.executions?.find(
        (execution) => execution.actionId === action.actionId,
      );
      const metadata = [
        `<p><strong>Status:</strong> ${action.status}</p>`,
        `<p><strong>Kind:</strong> ${action.kind}</p>`,
        `<p><strong>Alert:</strong> ${action.alertId}</p>`,
        `<p><strong>Approval request:</strong> ${action.requestId}</p>`,
        action.capability ? `<p><strong>Capability:</strong> ${action.capability}</p>` : "",
        action.baseUrl ? `<p><strong>Base URL:</strong> ${action.baseUrl}</p>` : "",
        action.decisionNote ? `<p><strong>Decision note:</strong> ${action.decisionNote}</p>` : "",
        latestExecution
          ? `<p><strong>Latest execution:</strong> ${latestExecution.status}${latestExecution.executionRef ? ` (${latestExecution.executionRef})` : ""}</p>`
          : "",
      ].join("");
      const controls =
        action.status === "queued"
          ? `
        <form method="post" action="${executeAction}" style="display:inline-block;margin-right:8px;">
          <button type="submit">Execute</button>
        </form>
        <form method="post" action="${completeAction}" style="display:inline-block;margin-right:8px;">
          <button type="submit">Mark complete</button>
        </form>
        <form method="post" action="${cancelAction}" style="display:inline-block;">
          <button type="submit">Cancel</button>
        </form>`
          : `<p><strong>Queued:</strong> ${action.queuedAt}</p>`;
      return `
      <article style="border:1px solid #d0d7de;border-radius:12px;padding:16px;margin:16px 0;">
        <h2 style="margin:0 0 8px 0;">${action.title}</h2>
        <p>${action.summary}</p>
        ${metadata}
        <div style="margin-top:12px;">${controls}</div>
      </article>`;
    })
    .join("\n");
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>OpenFox Opportunity Actions</title>
  </head>
  <body style="font-family:ui-sans-serif,system-ui,sans-serif;max-width:840px;margin:0 auto;padding:24px;">
    <h1>OpenFox Opportunity Actions</h1>
    <p>Showing <strong>${params.actions.length}</strong> ${statusLabel} action(s).</p>
    <p><a href="${params.pathPrefix}${tokenQuery}">Back to latest report</a></p>
    ${rows || "<p>No owner opportunity actions found.</p>"}
  </body>
</html>`;
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
            html(
              res,
              200,
              `<!doctype html><html><body><h1>No owner reports yet.</h1><p><a href="${pathPrefix}/approvals${webConfig.authToken ? `?token=${encodeURIComponent(webConfig.authToken)}` : ""}">Open approval inbox</a></p><p><a href="${pathPrefix}/alerts${webConfig.authToken ? `?token=${encodeURIComponent(webConfig.authToken)}` : ""}">Open opportunity alerts</a></p><p><a href="${pathPrefix}/actions${webConfig.authToken ? `?token=${encodeURIComponent(webConfig.authToken)}` : ""}">Open opportunity actions</a></p></body></html>`,
            );
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

        if (req.method === "GET" && url.pathname === `${pathPrefix}/alerts`) {
          const limit = Number.parseInt(url.searchParams.get("limit") || "20", 10);
          const statusRaw = url.searchParams.get("status");
          const status =
            statusRaw === "unread" ||
            statusRaw === "read" ||
            statusRaw === "dismissed"
              ? statusRaw
              : undefined;
          const items = params.db.listOwnerOpportunityAlerts(limit, { status });
          const format = url.searchParams.get("format");
          if (format === "json") {
            json(res, 200, { items });
            return;
          }
          html(
            res,
            200,
            renderOwnerAlertsHtml({
              alerts: items,
              pathPrefix,
              token: webConfig.authToken,
              status: statusRaw,
            }),
          );
          return;
        }

        if (req.method === "GET" && url.pathname === `${pathPrefix}/actions`) {
          const limit = Number.parseInt(url.searchParams.get("limit") || "20", 10);
          const statusRaw = url.searchParams.get("status");
          const status =
            statusRaw === "queued" ||
            statusRaw === "completed" ||
            statusRaw === "cancelled"
              ? statusRaw
              : undefined;
          const items = params.db.listOwnerOpportunityActions(limit, { status });
          const format = url.searchParams.get("format");
          if (format === "json") {
            json(res, 200, { items });
            return;
          }
          const executions = params.db.listOwnerOpportunityActionExecutions(
            limit * 3,
          );
          html(
            res,
            200,
            renderOwnerActionsHtml({
              actions: items,
              executions,
              pathPrefix,
              token: webConfig.authToken,
              status: statusRaw,
            }),
          );
          return;
        }

        if (req.method === "GET" && url.pathname === `${pathPrefix}/action-executions`) {
          const limit = Number.parseInt(url.searchParams.get("limit") || "20", 10);
          const statusRaw = url.searchParams.get("status");
          const items = params.db.listOwnerOpportunityActionExecutions(limit, {
            actionId: url.searchParams.get("actionId") || undefined,
            status:
              statusRaw === "running" ||
              statusRaw === "completed" ||
              statusRaw === "failed" ||
              statusRaw === "skipped"
                ? statusRaw
                : undefined,
          });
          json(res, 200, { items });
          return;
        }

        if (
          req.method === "POST" &&
          /^\/?.*\/alerts\/[^/]+\/(read|dismiss|request-action)$/.test(url.pathname)
        ) {
          const match = url.pathname.match(/\/alerts\/([^/]+)\/(read|dismiss|request-action)$/);
          const alertId = match?.[1] ? decodeURIComponent(match[1]) : undefined;
          const action = match?.[2];
          if (!alertId || !action) {
            json(res, 404, { error: "alert action not found" });
            return;
          }
          let record: OwnerOpportunityAlertRecord | undefined;
          let payload: OwnerOpportunityAlertRecord | {
            alert: OwnerOpportunityAlertRecord;
            request: OperatorApprovalRequestRecord;
          } | null = null;
          if (action === "request-action") {
            const body = await readBody(req);
            const alert = params.db.getOwnerOpportunityAlert(alertId);
            if (!alert) {
              json(res, 404, { error: "alert not found" });
              return;
            }
            const queued = queueOwnerOpportunityAlertAction({
              config: params.config,
              db: params.db,
              alertId: alert.alertId,
              actionKind:
                body.action === "review" ||
                body.action === "pursue" ||
                body.action === "delegate"
                  ? body.action
                  : "review",
              requestedBy: "owner-web",
              reason: body.reason,
            });
            payload = queued;
            record = queued.alert;
          } else {
            record = params.db.updateOwnerOpportunityAlertStatus(
              alertId,
              action === "read" ? "read" : "dismissed",
            );
          }
          if (!record) {
            json(res, 404, { error: "alert not found" });
            return;
          }
          if (action !== "request-action") {
            payload = record;
          }
          if (url.searchParams.get("format") === "json") {
            json(res, 200, payload);
            return;
          }
          redirect(res, `${pathPrefix}/alerts${webConfig.authToken ? `?token=${encodeURIComponent(webConfig.authToken)}` : ""}`);
          return;
        }

        if (
          req.method === "POST" &&
          /^\/?.*\/actions\/[^/]+\/execute$/.test(url.pathname)
        ) {
          const match = url.pathname.match(/\/actions\/([^/]+)\/execute$/);
          const actionId = match?.[1] ? decodeURIComponent(match[1]) : undefined;
          if (!actionId) {
            json(res, 404, { error: "action route not found" });
            return;
          }
          if (
            !(
              params.config.openaiApiKey ||
              params.config.anthropicApiKey ||
              params.config.ollamaBaseUrl ||
              params.config.runtimeApiKey
            )
          ) {
            json(res, 400, { error: "owner action execution requires an inference provider" });
            return;
          }
          const modelRegistry = new ModelRegistry(params.db.raw);
          modelRegistry.initialize();
          const { account } = await getWallet();
          const result = await executeOwnerOpportunityAction({
            identity: {
              name: params.config.name,
              address: params.config.walletAddress,
              account,
              creatorAddress: params.config.creatorAddress,
              sandboxId: params.config.sandboxId,
              apiKey: params.config.runtimeApiKey || "",
              createdAt: new Date().toISOString(),
            },
            config: params.config,
            db: params.db,
            inference: createInferenceClient({
              apiUrl: params.config.runtimeApiUrl || "",
              apiKey: params.config.runtimeApiKey,
              defaultModel:
                params.config.inferenceModelRef || params.config.inferenceModel,
              maxTokens: params.config.maxTokensPerTurn,
              lowComputeModel:
                params.config.modelStrategy?.lowComputeModel || "gpt-5-mini",
              openaiApiKey: params.config.openaiApiKey,
              anthropicApiKey: params.config.anthropicApiKey,
              ollamaBaseUrl:
                process.env.OLLAMA_BASE_URL || params.config.ollamaBaseUrl,
              getModelProvider: (modelId) => modelRegistry.get(modelId)?.provider,
            }),
            actionId,
          });
          if (url.searchParams.get("format") === "json") {
            json(res, 200, result);
            return;
          }
          redirect(res, `${pathPrefix}/actions${webConfig.authToken ? `?token=${encodeURIComponent(webConfig.authToken)}` : ""}`);
          return;
        }

        if (
          req.method === "POST" &&
          /^\/?.*\/actions\/[^/]+\/(complete|cancel)$/.test(url.pathname)
        ) {
          const match = url.pathname.match(/\/actions\/([^/]+)\/(complete|cancel)$/);
          const actionId = match?.[1] ? decodeURIComponent(match[1]) : undefined;
          const action = match?.[2];
          if (!actionId || !action) {
            json(res, 404, { error: "action route not found" });
            return;
          }
          const body = await readBody(req);
          const record = params.db.updateOwnerOpportunityActionStatus(
            actionId,
            action === "complete" ? "completed" : "cancelled",
            undefined,
            {
              kind:
                body.resultKind === "note" ||
                body.resultKind === "bounty" ||
                body.resultKind === "campaign" ||
                body.resultKind === "provider_call" ||
                body.resultKind === "artifact" ||
                body.resultKind === "report" ||
                body.resultKind === "other"
                  ? body.resultKind
                  : undefined,
              ref: typeof body.resultRef === "string" ? body.resultRef : undefined,
              note: typeof body.note === "string" ? body.note : undefined,
            },
          );
          if (!record) {
            json(res, 404, { error: "action not found" });
            return;
          }
          if (url.searchParams.get("format") === "json") {
            json(res, 200, record);
            return;
          }
          redirect(res, `${pathPrefix}/actions${webConfig.authToken ? `?token=${encodeURIComponent(webConfig.authToken)}` : ""}`);
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

        if (req.method === "GET" && url.pathname === `${pathPrefix}/approvals`) {
          const limit = Number.parseInt(url.searchParams.get("limit") || "20", 10);
          const statusRaw = url.searchParams.get("status");
          const status =
            statusRaw === "pending" ||
            statusRaw === "approved" ||
            statusRaw === "rejected" ||
            statusRaw === "expired"
              ? statusRaw
              : undefined;
          const items = params.db.listOperatorApprovalRequests(limit, { status });
          const format = url.searchParams.get("format");
          if (format === "json") {
            json(res, 200, { items });
            return;
          }
          html(
            res,
            200,
            renderOwnerApprovalsHtml({
              approvals: items,
              pathPrefix,
              token: webConfig.authToken,
              status: statusRaw,
            }),
          );
          return;
        }

        if (
          req.method === "POST" &&
          /^\/?.*\/approvals\/[^/]+\/(approve|reject)$/.test(url.pathname)
        ) {
          const match = url.pathname.match(/\/approvals\/([^/]+)\/(approve|reject)$/);
          if (!match) {
            json(res, 404, { error: "approval route not found" });
            return;
          }
          const [, requestId, decision] = match;
          const body = await readBody(req);
          const record = decideOperatorApprovalRequest({
            db: params.db,
            requestId: decodeURIComponent(requestId),
            status: decision === "approve" ? "approved" : "rejected",
            decidedBy: "owner-web",
            decisionNote: body.note,
          });
          const actionRecord =
            decision === "approve" && record.kind === "opportunity_action"
              ? materializeApprovedOwnerOpportunityAction({
                  db: params.db,
                  requestId: record.requestId,
                })
              : undefined;
          const format = url.searchParams.get("format");
          if (format === "json" || req.headers.accept === "application/json") {
            json(res, 200, actionRecord ? { request: record, action: actionRecord } : record);
            return;
          }
          redirect(
            res,
            `${pathPrefix}/approvals${webConfig.authToken ? `?token=${encodeURIComponent(webConfig.authToken)}` : ""}`,
          );
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
