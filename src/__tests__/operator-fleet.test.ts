import fs from "fs";
import http from "http";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildFleetReport,
  buildFleetSnapshot,
  loadFleetManifest,
} from "../operator/fleet.js";

const servers: http.Server[] = [];
const tempDirs: string[] = [];

async function startJsonServer(body: unknown, status = 200): Promise<string> {
  const server = http.createServer((_req, res) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("failed to bind server");
  }
  return `http://127.0.0.1:${address.port}/operator`;
}

async function startEndpointServer(
  endpoint: string,
  body: unknown,
  status = 200,
): Promise<string> {
  const server = http.createServer((req, res) => {
    if (req.url !== endpoint) {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "not found", path: req.url }));
      return;
    }
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("failed to bind server");
  }
  return `http://127.0.0.1:${address.port}/operator`;
}

function createManifest(contents: string, ext = "json"): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openfox-fleet-"));
  tempDirs.push(dir);
  const filePath = path.join(dir, `fleet.${ext}`);
  fs.writeFileSync(filePath, contents, "utf8");
  return filePath;
}

afterEach(async () => {
  while (servers.length) {
    const server = servers.pop();
    if (!server) continue;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  while (tempDirs.length) {
    fs.rmSync(tempDirs.pop() || "", { recursive: true, force: true });
  }
});

describe("operator fleet", () => {
  it("loads JSON and YAML manifests", async () => {
    const manifestJson = createManifest(
      JSON.stringify({
        version: 1,
        nodes: [{ name: "alpha", baseUrl: "http://127.0.0.1:4903/operator" }],
      }),
    );
    const jsonManifest = loadFleetManifest(manifestJson);
    expect(jsonManifest.nodes).toHaveLength(1);

    const manifestYaml = createManifest(
      [
        "version: 1",
        "nodes:",
        "  - name: beta",
        "    role: provider",
        "    baseUrl: http://127.0.0.1:4904/operator",
      ].join("\n"),
      "yml",
    );
    const yamlManifest = loadFleetManifest(manifestYaml);
    expect(yamlManifest.nodes[0]?.role).toBe("provider");
  });

  it("builds a mixed fleet snapshot and report", async () => {
    const okBaseUrl = await startJsonServer({ ok: true, configured: true }, 200);
    const failingBaseUrl = await startJsonServer({ error: "boom" }, 503);

    const manifestPath = createManifest(
      JSON.stringify({
        version: 1,
        nodes: [
          { name: "alpha", role: "gateway", baseUrl: okBaseUrl },
          { name: "beta", role: "provider", baseUrl: failingBaseUrl },
        ],
      }),
    );

    const snapshot = await buildFleetSnapshot({
      manifestPath,
      endpoint: "status",
    });
    expect(snapshot.total).toBe(2);
    expect(snapshot.ok).toBe(1);
    expect(snapshot.failed).toBe(1);
    expect(snapshot.nodes[0]?.ok).toBe(true);
    expect(snapshot.nodes[1]?.ok).toBe(false);

    const report = buildFleetReport(snapshot);
    expect(report).toContain("=== OPENFOX FLEET ===");
    expect(report).toContain("alpha [gateway]: ok");
    expect(report).toContain("beta [provider]: failed");
  });

  it("supports component-specific fleet endpoints and includes summaries in the report", async () => {
    const baseUrl = await startEndpointServer("/operator/storage/status", {
      kind: "storage",
      enabled: true,
      summary: "3 active leases, 1 due renewal, 0 under-replicated bundles, ready=yes",
    });
    const manifestPath = createManifest(
      JSON.stringify({
        version: 1,
        nodes: [{ name: "storage-1", role: "storage", baseUrl }],
      }),
    );

    const snapshot = await buildFleetSnapshot({
      manifestPath,
      endpoint: "storage",
    });
    expect(snapshot.total).toBe(1);
    expect(snapshot.ok).toBe(1);
    expect(snapshot.nodes[0]?.ok).toBe(true);
    expect((snapshot.nodes[0]?.payload as { kind?: string })?.kind).toBe("storage");

    const report = buildFleetReport(snapshot);
    expect(report).toContain("storage-1 [storage]: ok");
    expect(report).toContain("3 active leases, 1 due renewal");
  });
});
