import http, { type IncomingMessage, type ServerResponse } from "http";
import type { OpenFoxConfig, OpenFoxDatabase } from "../types.js";
import { createLogger } from "../observability/logger.js";
import { escapeHtml } from "./render.js";
import { buildMetaWorldLayout } from "./layout.js";
import { buildMetaWorldRouterScript } from "./router.js";
import {
  buildMetaWorldShellSnapshot,
  buildMetaWorldShellHtml,
} from "./shell.js";
import {
  buildFoxPageSnapshot,
  buildFoxPageHtml,
} from "./fox-page.js";
import {
  buildGroupPageSnapshot,
  buildGroupPageHtml,
} from "./group-page.js";
import {
  buildWorldFoxDirectorySnapshot,
  buildWorldGroupDirectorySnapshot,
} from "./directory.js";
import { buildWorldFeedSnapshot } from "./feed.js";
import {
  buildWorldBoardSnapshot,
  type WorldBoardKind,
} from "./boards.js";
import {
  buildWorldPresenceSnapshot,
  publishWorldPresence,
  type WorldPresenceStatus,
} from "./presence.js";
import {
  buildWorldNotificationsSnapshot,
  markWorldNotificationRead,
  dismissWorldNotification,
} from "./notifications.js";
import { buildFoxProfile } from "./profile.js";

const logger = createLogger("metaworld-server");

export interface MetaWorldServer {
  url: string;
  close(): Promise<void>;
}

export interface StartMetaWorldServerOptions {
  db: OpenFoxDatabase;
  config: OpenFoxConfig;
  port?: number;
  host?: string;
}

function jsonResponse(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Content-Length", Buffer.byteLength(payload));
  res.end(payload);
}

function htmlResponse(res: ServerResponse, status: number, body: string): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Content-Length", Buffer.byteLength(body));
  res.end(body);
}

async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  if (chunks.length === 0) return {};
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function parseIntParam(value: string | null, fallback: number): number {
  if (!value) return fallback;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

const BOARD_KINDS = new Set<string>(["work", "opportunity", "artifact", "settlement"]);

function wrapInLayout(title: string, content: string, activeRoute?: string): string {
  return buildMetaWorldLayout({
    title: `${title} — OpenFox metaWorld`,
    content,
    activeRoute,
    scripts: buildMetaWorldRouterScript(),
  });
}

function renderFeedHtml(
  db: OpenFoxDatabase,
  groupId?: string,
  limit = 25,
): string {
  const snapshot = buildWorldFeedSnapshot(db, { groupId, limit });
  const items = snapshot.items
    .map(
      (item) =>
        `<div class="mw-card"><div class="mw-meta"><span>${escapeHtml(item.occurredAt)}</span><span>${escapeHtml(item.kind)}</span></div><h4>${escapeHtml(item.title)}</h4><p>${escapeHtml(item.summary)}</p></div>`,
    )
    .join("");
  const content = `<h2 class="mw-title">World Feed</h2>
<p style="color:var(--text-muted);margin-bottom:16px;">${escapeHtml(snapshot.summary)}</p>
<div class="mw-grid">${items || '<p class="mw-empty">No feed items yet.</p>'}</div>`;
  return wrapInLayout("Feed", content, "/feed");
}

function renderDirectoryFoxesHtml(
  db: OpenFoxDatabase,
  config: OpenFoxConfig,
  query?: string,
  role?: string,
  limit = 25,
): string {
  const snapshot = buildWorldFoxDirectorySnapshot(db, config, { query, role, limit });
  const items = snapshot.items
    .map(
      (item) =>
        `<li><span class="mw-li-label"><a href="/fox/${encodeURIComponent(item.address)}">${escapeHtml(item.displayName)}</a></span><span class="mw-li-value">${escapeHtml(item.presenceStatus || "offline")} · groups=${item.activeGroupCount}</span></li>`,
    )
    .join("");
  const content = `<h2 class="mw-title">Fox Directory</h2>
<p style="margin-bottom:12px;"><a href="/directory/foxes">Foxes</a> | <a href="/directory/groups">Groups</a></p>
<ul class="mw-list">${items || '<li class="mw-empty">No Fox profiles yet.</li>'}</ul>`;
  return wrapInLayout("Fox Directory", content, "/directory/foxes");
}

function renderDirectoryGroupsHtml(
  db: OpenFoxDatabase,
  query?: string,
  visibility?: "private" | "listed" | "public",
  tag?: string,
  limit = 25,
): string {
  const snapshot = buildWorldGroupDirectorySnapshot(db, { query, visibility, tag, limit });
  const items = snapshot.items
    .map(
      (item) =>
        `<li><span class="mw-li-label"><a href="/group/${encodeURIComponent(item.groupId)}">${escapeHtml(item.name)}</a></span><span class="mw-li-value">${item.activeMemberCount} members · ${escapeHtml(item.visibility)}</span></li>`,
    )
    .join("");
  const content = `<h2 class="mw-title">Group Directory</h2>
<p style="margin-bottom:12px;"><a href="/directory/foxes">Foxes</a> | <a href="/directory/groups">Groups</a></p>
<ul class="mw-list">${items || '<li class="mw-empty">No groups yet.</li>'}</ul>`;
  return wrapInLayout("Group Directory", content, "/directory/foxes");
}

function renderBoardHtml(db: OpenFoxDatabase, kind: WorldBoardKind, limit = 25): string {
  const snapshot = buildWorldBoardSnapshot(db, { boardKind: kind, limit });
  const items = snapshot.items
    .map(
      (item) =>
        `<div class="mw-card"><div class="mw-meta"><span>${escapeHtml(item.occurredAt)}</span><span>${escapeHtml(item.status)}</span></div><h4>${escapeHtml(item.title)}</h4><p>${escapeHtml(item.summary)}</p></div>`,
    )
    .join("");
  const kindLabel = kind.charAt(0).toUpperCase() + kind.slice(1);
  const boardNav = (["work", "opportunity", "artifact", "settlement"] as const)
    .map((k) => `<a href="/boards/${k}"${k === kind ? ' style="color:var(--accent)"' : ""}>${k.charAt(0).toUpperCase() + k.slice(1)}</a>`)
    .join(" | ");
  const content = `<h2 class="mw-title">${escapeHtml(kindLabel)} Board</h2>
<p style="margin-bottom:12px;">${boardNav}</p>
<div class="mw-grid">${items || '<p class="mw-empty">No items yet.</p>'}</div>`;
  return wrapInLayout(`${kindLabel} Board`, content, "/boards/work");
}

function renderPresenceHtml(db: OpenFoxDatabase, limit = 25): string {
  const snapshot = buildWorldPresenceSnapshot(db, { limit });
  const items = snapshot.items
    .map(
      (item) =>
        `<li><span class="mw-li-label">${escapeHtml(item.displayName || item.agentId || item.actorAddress)}</span><span class="mw-li-value">${escapeHtml(item.effectiveStatus)}${item.groupName ? ` · ${escapeHtml(item.groupName)}` : ""}</span></li>`,
    )
    .join("");
  const content = `<h2 class="mw-title">Presence</h2>
<p style="color:var(--text-muted);margin-bottom:16px;">${escapeHtml(snapshot.summary)}</p>
<ul class="mw-list">${items || '<li class="mw-empty">No live presence.</li>'}</ul>`;
  return wrapInLayout("Presence", content, "/presence");
}

function renderNotificationsHtml(
  db: OpenFoxDatabase,
  config: OpenFoxConfig,
  limit = 25,
): string {
  const snapshot = buildWorldNotificationsSnapshot(db, {
    actorAddress: config.walletAddress,
    limit,
  });
  const items = snapshot.items
    .map(
      (item) =>
        `<div class="mw-card"><div class="mw-meta"><span>${escapeHtml(item.occurredAt)}</span><span>${item.readAt ? "read" : '<span class="mw-badge">unread</span>'}</span></div><h4>${escapeHtml(item.title)}</h4><p>${escapeHtml(item.summary)}</p></div>`,
    )
    .join("");
  const content = `<h2 class="mw-title">Notifications</h2>
<p style="color:var(--text-muted);margin-bottom:16px;">${snapshot.unreadCount} unread</p>
<div class="mw-grid">${items || '<p class="mw-empty">Nothing needs attention.</p>'}</div>`;
  return wrapInLayout("Notifications", content, "/notifications");
}

function renderShellHtml(db: OpenFoxDatabase, config: OpenFoxConfig): string {
  const snapshot = buildMetaWorldShellSnapshot({ db, config });
  const feedItems = snapshot.feed.items
    .slice(0, 12)
    .map(
      (item) =>
        `<div class="mw-card"><div class="mw-meta"><span>${escapeHtml(item.occurredAt)}</span><span>${escapeHtml(item.kind)}</span></div><h4>${escapeHtml(item.title)}</h4><p>${escapeHtml(item.summary)}</p></div>`,
    )
    .join("");
  const notifItems = snapshot.notifications.items
    .slice(0, 8)
    .map(
      (item) =>
        `<div class="mw-card"><div class="mw-meta"><span>${escapeHtml(item.occurredAt)}</span><span>${item.readAt ? "read" : "unread"}</span></div><h4>${escapeHtml(item.title)}</h4><p>${escapeHtml(item.summary)}</p></div>`,
    )
    .join("");
  const presenceItems = snapshot.presence.items
    .slice(0, 8)
    .map(
      (item) =>
        `<li><span class="mw-li-label">${escapeHtml(item.displayName || item.agentId || item.actorAddress)}</span><span class="mw-li-value">${escapeHtml(item.effectiveStatus)}</span></li>`,
    )
    .join("");
  const content = `<h2 class="mw-title">${escapeHtml(snapshot.fox.displayName)}</h2>
<div class="mw-metrics">
  <div class="mw-metric"><strong>${snapshot.notifications.unreadCount}</strong><span>Unread</span></div>
  <div class="mw-metric"><strong>${snapshot.fox.stats.activeGroupCount}</strong><span>Groups</span></div>
  <div class="mw-metric"><strong>${snapshot.presence.activeCount}</strong><span>Present</span></div>
  <div class="mw-metric"><strong>${snapshot.feed.items.length}</strong><span>Feed items</span></div>
</div>
<div class="mw-panel"><h3>World Feed</h3><div class="mw-grid">${feedItems || '<p class="mw-empty">No feed items yet.</p>'}</div></div>
<div class="mw-grid">
  <div class="mw-panel"><h3>Notifications</h3><div class="mw-grid">${notifItems || '<p class="mw-empty">Nothing needs attention.</p>'}</div></div>
  <div class="mw-panel"><h3>Presence</h3><ul class="mw-list">${presenceItems || '<li class="mw-empty">No live presence.</li>'}</ul></div>
</div>`;
  return wrapInLayout("Home", content, "/");
}

export async function startMetaWorldServer(
  options: StartMetaWorldServerOptions,
): Promise<MetaWorldServer> {
  const { db, config } = options;
  const port = options.port ?? 3000;
  const host = options.host ?? "127.0.0.1";

  const server = http.createServer((req, res) => {
    void (async () => {
      try {
        const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
        const pathname = url.pathname;

        // --- JSON API routes ---

        if (req.method === "GET" && pathname === "/api/v1/shell") {
          jsonResponse(res, 200, buildMetaWorldShellSnapshot({ db, config }));
          return;
        }

        if (req.method === "GET" && pathname === "/api/v1/feed") {
          const groupId = url.searchParams.get("group") || undefined;
          const limit = parseIntParam(url.searchParams.get("limit"), 25);
          jsonResponse(res, 200, buildWorldFeedSnapshot(db, { groupId, limit }));
          return;
        }

        if (req.method === "GET" && /^\/api\/v1\/fox\/[^/]+$/.test(pathname)) {
          const address = decodeURIComponent(pathname.split("/")[4]);
          try {
            const profile = buildFoxProfile({ db, config, address });
            jsonResponse(res, 200, profile);
          } catch (err) {
            jsonResponse(res, 404, { error: err instanceof Error ? err.message : "not found" });
          }
          return;
        }

        if (req.method === "GET" && /^\/api\/v1\/group\/[^/]+$/.test(pathname)) {
          const groupId = decodeURIComponent(pathname.split("/")[4]);
          try {
            const snapshot = buildGroupPageSnapshot(db, { groupId });
            jsonResponse(res, 200, snapshot);
          } catch (err) {
            jsonResponse(res, 404, { error: err instanceof Error ? err.message : "not found" });
          }
          return;
        }

        if (req.method === "GET" && pathname === "/api/v1/directory/foxes") {
          const query = url.searchParams.get("query") || undefined;
          const role = url.searchParams.get("role") || undefined;
          const limit = parseIntParam(url.searchParams.get("limit"), 25);
          jsonResponse(res, 200, buildWorldFoxDirectorySnapshot(db, config, { query, role, limit }));
          return;
        }

        if (req.method === "GET" && pathname === "/api/v1/directory/groups") {
          const query = url.searchParams.get("query") || undefined;
          const visibilityRaw = url.searchParams.get("visibility");
          const visibility =
            visibilityRaw === "private" || visibilityRaw === "listed" || visibilityRaw === "public"
              ? visibilityRaw
              : undefined;
          const tag = url.searchParams.get("tag") || undefined;
          const limit = parseIntParam(url.searchParams.get("limit"), 25);
          jsonResponse(res, 200, buildWorldGroupDirectorySnapshot(db, { query, visibility, tag, limit }));
          return;
        }

        if (req.method === "GET" && /^\/api\/v1\/boards\/[^/]+$/.test(pathname)) {
          const kind = pathname.split("/")[4];
          if (!BOARD_KINDS.has(kind)) {
            jsonResponse(res, 400, { error: "invalid board kind" });
            return;
          }
          const limit = parseIntParam(url.searchParams.get("limit"), 25);
          jsonResponse(res, 200, buildWorldBoardSnapshot(db, { boardKind: kind as WorldBoardKind, limit }));
          return;
        }

        if (req.method === "GET" && pathname === "/api/v1/presence") {
          const limit = parseIntParam(url.searchParams.get("limit"), 25);
          jsonResponse(res, 200, buildWorldPresenceSnapshot(db, { limit }));
          return;
        }

        if (req.method === "GET" && pathname === "/api/v1/notifications") {
          const limit = parseIntParam(url.searchParams.get("limit"), 25);
          jsonResponse(res, 200, buildWorldNotificationsSnapshot(db, {
            actorAddress: config.walletAddress,
            limit,
          }));
          return;
        }

        // --- POST action endpoints ---

        if (req.method === "POST" && pathname === "/api/v1/presence/publish") {
          const body = await readJsonBody(req);
          const status = (
            typeof body.status === "string" &&
            (body.status === "online" || body.status === "busy" || body.status === "away" || body.status === "recently_active")
          ) ? body.status as WorldPresenceStatus : "online";
          const record = publishWorldPresence({
            db,
            actorAddress: config.walletAddress,
            agentId: config.agentId,
            displayName: config.agentDiscovery?.displayName?.trim() || config.name,
            status,
            summary: typeof body.summary === "string" ? body.summary : undefined,
            groupId: typeof body.groupId === "string" ? body.groupId : undefined,
            ttlSeconds: typeof body.ttlSeconds === "number" ? body.ttlSeconds : 120,
          });
          jsonResponse(res, 200, record);
          return;
        }

        if (req.method === "POST" && /^\/api\/v1\/notifications\/[^/]+\/read$/.test(pathname)) {
          const notificationId = decodeURIComponent(pathname.split("/")[4]);
          try {
            const state = markWorldNotificationRead(db, notificationId);
            jsonResponse(res, 200, state);
          } catch (err) {
            jsonResponse(res, 404, { error: err instanceof Error ? err.message : "not found" });
          }
          return;
        }

        if (req.method === "POST" && /^\/api\/v1\/notifications\/[^/]+\/dismiss$/.test(pathname)) {
          const notificationId = decodeURIComponent(pathname.split("/")[4]);
          try {
            const state = dismissWorldNotification(db, notificationId);
            jsonResponse(res, 200, state);
          } catch (err) {
            jsonResponse(res, 404, { error: err instanceof Error ? err.message : "not found" });
          }
          return;
        }

        // --- HTML page routes ---

        if (req.method === "GET" && pathname === "/") {
          htmlResponse(res, 200, renderShellHtml(db, config));
          return;
        }

        if (req.method === "GET" && pathname === "/feed") {
          const groupId = url.searchParams.get("group") || undefined;
          const limit = parseIntParam(url.searchParams.get("limit"), 25);
          htmlResponse(res, 200, renderFeedHtml(db, groupId, limit));
          return;
        }

        if (req.method === "GET" && /^\/fox\/[^/]+$/.test(pathname)) {
          const address = decodeURIComponent(pathname.split("/")[2]);
          try {
            const snapshot = buildFoxPageSnapshot({ db, config, address });
            const html = buildFoxPageHtml(snapshot, {
              homeHref: "/",
              foxDirectoryHref: "/directory/foxes",
              groupDirectoryHref: "/directory/groups",
              groupHrefsById: Object.fromEntries(
                snapshot.fox.groups.map((g) => [g.groupId, `/group/${encodeURIComponent(g.groupId)}`]),
              ),
            });
            htmlResponse(res, 200, html);
          } catch (err) {
            htmlResponse(res, 404, wrapInLayout("Not Found", `<p class="mw-empty">${escapeHtml(err instanceof Error ? err.message : "Fox not found")}</p>`));
          }
          return;
        }

        if (req.method === "GET" && /^\/fox\/[^/]+\/page$/.test(pathname)) {
          const address = decodeURIComponent(pathname.split("/")[2]);
          try {
            const snapshot = buildFoxPageSnapshot({ db, config, address });
            const html = buildFoxPageHtml(snapshot, {
              homeHref: "/",
              foxDirectoryHref: "/directory/foxes",
              groupDirectoryHref: "/directory/groups",
              groupHrefsById: Object.fromEntries(
                snapshot.fox.groups.map((g) => [g.groupId, `/group/${encodeURIComponent(g.groupId)}`]),
              ),
            });
            htmlResponse(res, 200, html);
          } catch (err) {
            htmlResponse(res, 404, wrapInLayout("Not Found", `<p class="mw-empty">${escapeHtml(err instanceof Error ? err.message : "Fox not found")}</p>`));
          }
          return;
        }

        if (req.method === "GET" && /^\/group\/[^/]+$/.test(pathname)) {
          const groupId = decodeURIComponent(pathname.split("/")[2]);
          try {
            const snapshot = buildGroupPageSnapshot(db, { groupId });
            const html = buildGroupPageHtml(snapshot, {
              homeHref: "/",
              foxDirectoryHref: "/directory/foxes",
              groupDirectoryHref: "/directory/groups",
              foxHrefsByAddress: Object.fromEntries(
                snapshot.members.map((m) => [m.memberAddress, `/fox/${encodeURIComponent(m.memberAddress)}`]),
              ),
            });
            htmlResponse(res, 200, html);
          } catch (err) {
            htmlResponse(res, 404, wrapInLayout("Not Found", `<p class="mw-empty">${escapeHtml(err instanceof Error ? err.message : "Group not found")}</p>`));
          }
          return;
        }

        if (req.method === "GET" && pathname === "/directory/foxes") {
          const query = url.searchParams.get("query") || undefined;
          const role = url.searchParams.get("role") || undefined;
          const limit = parseIntParam(url.searchParams.get("limit"), 25);
          htmlResponse(res, 200, renderDirectoryFoxesHtml(db, config, query, role, limit));
          return;
        }

        if (req.method === "GET" && pathname === "/directory/groups") {
          const query = url.searchParams.get("query") || undefined;
          const visibilityRaw = url.searchParams.get("visibility");
          const visibility =
            visibilityRaw === "private" || visibilityRaw === "listed" || visibilityRaw === "public"
              ? visibilityRaw
              : undefined;
          const tag = url.searchParams.get("tag") || undefined;
          const limit = parseIntParam(url.searchParams.get("limit"), 25);
          htmlResponse(res, 200, renderDirectoryGroupsHtml(db, query, visibility, tag, limit));
          return;
        }

        if (req.method === "GET" && /^\/boards\/[^/]+$/.test(pathname)) {
          const kind = pathname.split("/")[2];
          if (!BOARD_KINDS.has(kind)) {
            htmlResponse(res, 400, wrapInLayout("Bad Request", `<p class="mw-empty">Invalid board kind: ${escapeHtml(kind)}</p>`));
            return;
          }
          const limit = parseIntParam(url.searchParams.get("limit"), 25);
          htmlResponse(res, 200, renderBoardHtml(db, kind as WorldBoardKind, limit));
          return;
        }

        if (req.method === "GET" && pathname === "/presence") {
          const limit = parseIntParam(url.searchParams.get("limit"), 25);
          htmlResponse(res, 200, renderPresenceHtml(db, limit));
          return;
        }

        if (req.method === "GET" && pathname === "/notifications") {
          const limit = parseIntParam(url.searchParams.get("limit"), 25);
          htmlResponse(res, 200, renderNotificationsHtml(db, config, limit));
          return;
        }

        // --- 404 ---
        jsonResponse(res, 404, { error: "not found" });
      } catch (error) {
        logger.error(
          "metaWorld server request failed",
          error instanceof Error ? error : undefined,
        );
        jsonResponse(res, 500, {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    })();
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve();
    });
  });

  const boundAddress = server.address();
  const actualPort =
    boundAddress && typeof boundAddress !== "string"
      ? boundAddress.port
      : port;
  const normalizedHost = host === "0.0.0.0" ? "127.0.0.1" : host;
  const baseUrl = `http://${normalizedHost}:${actualPort}`;
  logger.info(`metaWorld server listening at ${baseUrl}`);

  return {
    url: baseUrl,
    async close() {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    },
  };
}
