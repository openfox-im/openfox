import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import http from "http";
import { createDatabase } from "../state/database.js";
import { startMetaWorldServer, type MetaWorldServer } from "../metaworld/server.js";
import type { OpenFoxConfig, OpenFoxDatabase } from "../types.js";

const TEST_ADDRESS = "0xabcdef0123456789abcdef0123456789abcdef01";

function makeTmpDbPath(): string {
  const tmpDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "openfox-mw-server-test-"),
  );
  return path.join(tmpDir, "test.db");
}

function makeConfig(): OpenFoxConfig {
  return {
    name: "test-fox",
    walletAddress: TEST_ADDRESS,
    dbPath: ":memory:",
    agentId: "test-agent",
  } as unknown as OpenFoxConfig;
}

function httpGet(
  url: string,
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    http
      .get(url, (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks).toString("utf8"),
          });
        });
      })
      .on("error", reject);
  });
}

function httpPost(
  url: string,
  body: Record<string, unknown> = {},
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const parsed = new URL(url);
    const req = http.request(
      {
        hostname: parsed.hostname,
        port: parsed.port,
        path: parsed.pathname + parsed.search,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks).toString("utf8"),
          });
        });
      },
    );
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

describe("metaWorld server", () => {
  let dbPath: string;
  let db: OpenFoxDatabase;
  let server: MetaWorldServer;

  beforeEach(async () => {
    dbPath = makeTmpDbPath();
    db = createDatabase(dbPath);
    server = await startMetaWorldServer({
      db,
      config: makeConfig(),
      port: 0, // random port
      host: "127.0.0.1",
    });
  });

  afterEach(async () => {
    await server.close();
    try {
      db.close();
    } catch {
      // ignore
    }
  });

  // --- HTML route tests ---

  it("serves the home page with HTML content", async () => {
    const res = await httpGet(server.url + "/");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/html");
    expect(res.body).toContain("<!doctype html>");
    expect(res.body).toContain("metaWorld");
  });

  it("serves the feed page", async () => {
    const res = await httpGet(server.url + "/feed");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/html");
    expect(res.body).toContain("World Feed");
  });

  it("serves the personalized feed page", async () => {
    const res = await httpGet(server.url + "/personalized-feed");
    expect(res.status).toBe(200);
    expect(res.body).toContain("Personalized Feed");
  });

  it("serves the search page", async () => {
    const res = await httpGet(server.url + "/search?query=test");
    expect(res.status).toBe(200);
    expect(res.body).toContain("Search");
  });

  it("serves the recommended foxes page", async () => {
    const res = await httpGet(server.url + "/recommended/foxes");
    expect(res.status).toBe(200);
    expect(res.body).toContain("Recommended Foxes");
  });

  it("serves the subscriptions page", async () => {
    const res = await httpGet(server.url + "/subscriptions");
    expect(res.status).toBe(200);
    expect(res.body).toContain("Subscriptions");
  });

  it("serves the fox directory page", async () => {
    const res = await httpGet(server.url + "/directory/foxes");
    expect(res.status).toBe(200);
    expect(res.body).toContain("Fox Directory");
  });

  it("serves the group directory page", async () => {
    const res = await httpGet(server.url + "/directory/groups");
    expect(res.status).toBe(200);
    expect(res.body).toContain("Group Directory");
  });

  it("serves a board page", async () => {
    const res = await httpGet(server.url + "/boards/work");
    expect(res.status).toBe(200);
    expect(res.body).toContain("Work Board");
  });

  it("serves the presence page", async () => {
    const res = await httpGet(server.url + "/presence");
    expect(res.status).toBe(200);
    expect(res.body).toContain("Presence");
  });

  it("serves the notifications page", async () => {
    const res = await httpGet(server.url + "/notifications");
    expect(res.status).toBe(200);
    expect(res.body).toContain("Notifications");
  });

  it("returns 400 for invalid board kind", async () => {
    const res = await httpGet(server.url + "/boards/invalid");
    expect(res.status).toBe(400);
  });

  // --- JSON API tests ---

  it("returns JSON shell snapshot", async () => {
    const res = await httpGet(server.url + "/api/v1/shell");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("application/json");
    const data = JSON.parse(res.body);
    expect(data).toHaveProperty("generatedAt");
    expect(data).toHaveProperty("fox");
    expect(data).toHaveProperty("feed");
    expect(data).toHaveProperty("notifications");
    expect(data).toHaveProperty("presence");
    expect(data).toHaveProperty("boards");
    expect(data).toHaveProperty("directories");
  });

  it("returns JSON feed", async () => {
    const res = await httpGet(server.url + "/api/v1/feed");
    expect(res.status).toBe(200);
    const data = JSON.parse(res.body);
    expect(data).toHaveProperty("items");
    expect(data).toHaveProperty("generatedAt");
  });

  it("returns JSON personalized feed", async () => {
    const res = await httpGet(server.url + "/api/v1/personalized-feed");
    expect(res.status).toBe(200);
    const data = JSON.parse(res.body);
    expect(data).toHaveProperty("items");
    expect(data).toHaveProperty("summary");
  });

  it("returns JSON search results", async () => {
    const res = await httpGet(server.url + "/api/v1/search?query=test");
    expect(res.status).toBe(200);
    const data = JSON.parse(res.body);
    expect(data).toHaveProperty("results");
    expect(data).toHaveProperty("query", "test");
  });

  it("returns JSON recommendations", async () => {
    const foxes = await httpGet(server.url + "/api/v1/recommended/foxes");
    expect(foxes.status).toBe(200);
    expect(JSON.parse(foxes.body)).toHaveProperty("items");

    const groups = await httpGet(server.url + "/api/v1/recommended/groups");
    expect(groups.status).toBe(200);
    expect(JSON.parse(groups.body)).toHaveProperty("items");
  });

  it("returns JSON subscriptions", async () => {
    const res = await httpGet(server.url + "/api/v1/subscriptions");
    expect(res.status).toBe(200);
    const data = JSON.parse(res.body);
    expect(data).toHaveProperty("subscriptions");
  });

  it("returns JSON fox directory", async () => {
    const res = await httpGet(server.url + "/api/v1/directory/foxes");
    expect(res.status).toBe(200);
    const data = JSON.parse(res.body);
    expect(data).toHaveProperty("items");
  });

  it("returns JSON group directory", async () => {
    const res = await httpGet(server.url + "/api/v1/directory/groups");
    expect(res.status).toBe(200);
    const data = JSON.parse(res.body);
    expect(data).toHaveProperty("items");
  });

  it("returns JSON board data", async () => {
    const res = await httpGet(server.url + "/api/v1/boards/opportunity");
    expect(res.status).toBe(200);
    const data = JSON.parse(res.body);
    expect(data).toHaveProperty("items");
    expect(data).toHaveProperty("boardKind", "opportunity");
  });

  it("returns 400 for invalid JSON board kind", async () => {
    const res = await httpGet(server.url + "/api/v1/boards/badkind");
    expect(res.status).toBe(400);
  });

  it("returns JSON presence", async () => {
    const res = await httpGet(server.url + "/api/v1/presence");
    expect(res.status).toBe(200);
    const data = JSON.parse(res.body);
    expect(data).toHaveProperty("items");
    expect(data).toHaveProperty("activeCount");
  });

  it("returns JSON notifications", async () => {
    const res = await httpGet(server.url + "/api/v1/notifications");
    expect(res.status).toBe(200);
    const data = JSON.parse(res.body);
    expect(data).toHaveProperty("items");
    expect(data).toHaveProperty("unreadCount");
  });

  it("returns 404 for unknown routes", async () => {
    const res = await httpGet(server.url + "/api/v1/nonexistent");
    expect(res.status).toBe(404);
  });

  // --- POST action tests ---

  it("publishes presence via POST", async () => {
    const res = await httpPost(server.url + "/api/v1/presence/publish", {
      status: "online",
      summary: "testing presence",
    });
    expect(res.status).toBe(200);
    const data = JSON.parse(res.body);
    expect(data).toHaveProperty("actorAddress");
    expect(data).toHaveProperty("effectiveStatus", "online");
    expect(data).toHaveProperty("summary", "testing presence");
  });

  it("handles notification read for non-existent notification", async () => {
    const res = await httpPost(
      server.url + "/api/v1/notifications/nonexistent-id/read",
    );
    expect(res.status).toBe(200);
    const data = JSON.parse(res.body);
    // The markWorldNotificationRead function creates a new state record
    // even if the notification didn't exist before
    expect(data).toHaveProperty("notificationId", "nonexistent-id");
  });

  it("handles notification dismiss for non-existent notification", async () => {
    const res = await httpPost(
      server.url + "/api/v1/notifications/nonexistent-dismiss/dismiss",
    );
    expect(res.status).toBe(200);
    const data = JSON.parse(res.body);
    expect(data).toHaveProperty("notificationId", "nonexistent-dismiss");
  });

  // --- HTML pages contain expected elements ---

  it("home page contains nav bar with all sections", async () => {
    const res = await httpGet(server.url + "/");
    expect(res.body).toContain("Home");
    expect(res.body).toContain("Feed");
    expect(res.body).toContain("For You");
    expect(res.body).toContain("Search");
    expect(res.body).toContain("Directory");
    expect(res.body).toContain("Recommended");
    expect(res.body).toContain("Boards");
    expect(res.body).toContain("Presence");
    expect(res.body).toContain("Notifications");
  });

  it("home page includes client-side router script", async () => {
    const res = await httpGet(server.url + "/");
    expect(res.body).toContain("history.pushState");
    expect(res.body).toContain("mw-content");
  });

  it("feed page supports query params", async () => {
    const res = await httpGet(server.url + "/feed?limit=5");
    expect(res.status).toBe(200);
    expect(res.body).toContain("World Feed");
  });

  it("directory foxes supports query params", async () => {
    const res = await httpGet(server.url + "/directory/foxes?query=test&limit=5");
    expect(res.status).toBe(200);
    expect(res.body).toContain("Fox Directory");
  });

  it("all board kinds are accessible", async () => {
    for (const kind of ["work", "opportunity", "artifact", "settlement"]) {
      const res = await httpGet(server.url + `/boards/${kind}`);
      expect(res.status).toBe(200);
      expect(res.body).toContain("Board");
    }
  });

  it("JSON feed supports limit param", async () => {
    const res = await httpGet(server.url + "/api/v1/feed?limit=3");
    expect(res.status).toBe(200);
    const data = JSON.parse(res.body);
    expect(data).toHaveProperty("items");
  });
});
