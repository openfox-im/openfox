import fs from "fs";
import http from "http";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildFleetDashboardHtml,
  buildFleetDashboardReport,
  buildFleetDashboardSnapshot,
  exportFleetDashboardBundle,
  exportFleetDashboard,
} from "../operator/dashboard.js";

const servers: http.Server[] = [];
const tempDirs: string[] = [];

async function startDashboardServer(routes: Record<string, unknown>): Promise<string> {
  const server = http.createServer((req, res) => {
    const payload = routes[req.url || ""];
    if (!payload) {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "not found", path: req.url }));
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(payload));
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("failed to bind server");
  }
  return `http://127.0.0.1:${address.port}/operator`;
}

function createManifest(contents: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openfox-dashboard-"));
  tempDirs.push(dir);
  const filePath = path.join(dir, "fleet.json");
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

describe("operator dashboard", () => {
  it("builds a fleet dashboard snapshot and report", async () => {
    const baseUrl = await startDashboardServer({
      "/operator/status": { ok: true, summary: "runtime ok" },
      "/operator/health": { ok: true, summary: "health ok" },
      "/operator/service/status": { summary: "service ready" },
      "/operator/gateway/status": { summary: "gateway ready" },
      "/operator/control/status": { summary: "control ready" },
      "/operator/autopilot/status": { summary: "autopilot ready" },
      "/operator/wallet/status": {
        summary: "balance=5.000000 TOS reserved=1.000000 TOS",
        pendingReceivablesTomi: "1000000000000000000",
        pendingPayablesTomi: "500000000000000000",
      },
      "/operator/finance/status": {
        summary: "30d revenue=8.000000 TOS, cost=3.000000 TOS",
        periods: {
          trailing30d: {
            revenueTomi: "8000000000000000000",
            costTomi: "3000000000000000000",
            netTomi: "5000000000000000000",
          },
        },
        pendingReceivablesTomi: "1000000000000000000",
        pendingPayablesTomi: "500000000000000000",
      },
      "/operator/payments/status": {
        summary: "confirmed revenue=8.000000 TOS, confirmed cost=3.000000 TOS, pending receivables=1.000000 TOS, pending liabilities=0.500000 TOS, failed=0",
        capabilities: [
          {
            capability: "oracle",
            confirmedRevenueTomi: "8000000000000000000",
            confirmedCostTomi: "0",
            pendingRevenueTomi: "1000000000000000000",
            pendingCostTomi: "0",
          },
        ],
        counterparties: [
          {
            address: "0x12252ae6b5d22fa4f58b295fe42cdb782f41881025d22645816d196b4f2e5143",
            kind: "customer",
            confirmedRevenueTomi: "8000000000000000000",
            confirmedCostTomi: "0",
            pendingRevenueTomi: "1000000000000000000",
            pendingCostTomi: "0",
            confirmedCount: 1,
            pendingCount: 1,
          },
        ],
      },
      "/operator/settlement/status": {
        summary: "2 receipts, callbacks pending=1, failed=0",
        callbackPending: 1,
        callbackFailed: 0,
      },
      "/operator/market/status": {
        summary: "1 bindings, callbacks pending=0, failed=1",
        callbackPending: 0,
        callbackFailed: 1,
      },
      "/operator/storage/status": { summary: "2 active leases" },
      "/operator/storage/lease-health": { summary: "2 leases, 0 critical" },
      "/operator/artifacts/status": { summary: "3 artifacts" },
      "/operator/signer/status": { summary: "1 pending signer execution" },
      "/operator/paymaster/status": { summary: "sponsor funded" },
      "/operator/providers/reputation": { summary: "2 providers tracked, 0 weak" },
      "/operator/fleet/reconciliation": { summary: "reconciliation ok" },
      "/operator/fleet/provider-liveness": { summary: "all providers alive" },
    });
    const manifestPath = createManifest(
      JSON.stringify({
        version: 1,
        nodes: [{ name: "alpha", role: "storage", baseUrl }],
      }),
    );

    const snapshot = await buildFleetDashboardSnapshot({ manifestPath });
    expect(snapshot.nodeCount).toBe(1);
    expect(snapshot.roles.storage).toBe(1);
    expect(snapshot.endpointSummaries).toHaveLength(19);
    expect(snapshot.failingEndpoints).toHaveLength(0);
    expect(snapshot.financeSummary.roles[0]?.role).toBe("storage");
    expect(snapshot.financeSummary.capabilities[0]?.capability).toBe("oracle");
    expect(snapshot.financeSummary.warnings).toContain(
      "Market callbacks are delaying contract binding visibility (pending=0, failed=1).",
    );

    const report = buildFleetDashboardReport(snapshot);
    expect(report).toContain("=== OPENFOX DASHBOARD ===");
    expect(report).toContain("status: 1/1 healthy");
    expect(report).toContain("autopilot: 1/1 healthy");
    expect(report).toContain("Fleet finance: 30d revenue=8 TOS, cost=3 TOS, net=5 TOS");

    const html = buildFleetDashboardHtml(snapshot);
    expect(html).toContain("<title>OpenFox Fleet Dashboard</title>");
    expect(html).toContain("balance=5.000000 TOS reserved=1.000000 TOS");
    expect(html).toContain("30d revenue=8.000000 TOS, cost=3.000000 TOS");
    expect(html).toContain("Role Margin Breakdown");
    expect(html).toContain("Capability Breakdown");
    expect(html).toContain("Top Counterparties");
    expect(html).toContain("2 active leases");
    expect(html).toContain("2 providers tracked, 0 weak");
  });

  it("exports json and html dashboards", async () => {
    const baseUrl = await startDashboardServer({
      "/operator/status": { summary: "runtime ok" },
      "/operator/health": { summary: "health ok" },
      "/operator/service/status": { summary: "service ready" },
      "/operator/gateway/status": { summary: "gateway ready" },
      "/operator/control/status": { summary: "control ready" },
      "/operator/autopilot/status": { summary: "autopilot ready" },
      "/operator/wallet/status": { summary: "wallet ready" },
      "/operator/finance/status": {
        summary: "finance ready",
        periods: { trailing30d: { revenueTomi: "0", costTomi: "0", netTomi: "0" } },
        pendingReceivablesTomi: "0",
        pendingPayablesTomi: "0",
      },
      "/operator/payments/status": { summary: "payments ready", capabilities: [], counterparties: [] },
      "/operator/settlement/status": { summary: "settlement ready", callbackPending: 0, callbackFailed: 0 },
      "/operator/market/status": { summary: "market ready", callbackPending: 0, callbackFailed: 0 },
      "/operator/storage/status": { summary: "storage ready" },
      "/operator/storage/lease-health": { summary: "lease health ok" },
      "/operator/artifacts/status": { summary: "artifacts ready" },
      "/operator/signer/status": { summary: "signer ready" },
      "/operator/paymaster/status": { summary: "paymaster ready" },
      "/operator/providers/reputation": { summary: "providers ready" },
    });
    const manifestPath = createManifest(
      JSON.stringify({
        version: 1,
        nodes: [{ name: "beta", role: "gateway", baseUrl }],
      }),
    );
    const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "openfox-dashboard-export-"));
    tempDirs.push(outputDir);
    const jsonPath = path.join(outputDir, "dashboard.json");
    const htmlPath = path.join(outputDir, "dashboard.html");

    await exportFleetDashboard({
      manifestPath,
      outputPath: jsonPath,
      format: "json",
    });
    await exportFleetDashboard({
      manifestPath,
      outputPath: htmlPath,
      format: "html",
    });

    expect(JSON.parse(fs.readFileSync(jsonPath, "utf8")).manifestPath).toBe(
      path.resolve(manifestPath),
    );
    expect(fs.readFileSync(htmlPath, "utf8")).toContain("OpenFox Fleet Dashboard");
  });

  it("exports a dashboard bundle with manifest copy and lint report", async () => {
    const baseUrl = await startDashboardServer({
      "/operator/status": { summary: "runtime ok" },
      "/operator/health": { summary: "health ok" },
      "/operator/service/status": { summary: "service ready" },
      "/operator/gateway/status": { summary: "gateway ready" },
      "/operator/control/status": { summary: "control ready" },
      "/operator/autopilot/status": { summary: "autopilot ready" },
      "/operator/control/events?limit=100": { items: [{ action: "pause", status: "applied" }] },
      "/operator/autopilot/approvals?limit=100": { items: [{ requestId: "req-1", status: "pending" }] },
      "/operator/wallet/status": { summary: "wallet ready" },
      "/operator/finance/status": {
        summary: "finance ready",
        periods: { trailing30d: { revenueTomi: "0", costTomi: "0", netTomi: "0" } },
        pendingReceivablesTomi: "0",
        pendingPayablesTomi: "0",
      },
      "/operator/payments/status": { summary: "payments ready", capabilities: [], counterparties: [] },
      "/operator/settlement/status": { summary: "settlement ready", callbackPending: 0, callbackFailed: 0 },
      "/operator/market/status": { summary: "market ready", callbackPending: 0, callbackFailed: 0 },
      "/operator/storage/status": { summary: "storage ready" },
      "/operator/storage/lease-health": { summary: "lease health ok" },
      "/operator/artifacts/status": { summary: "artifacts ready" },
      "/operator/signer/status": { summary: "signer ready" },
      "/operator/paymaster/status": { summary: "paymaster ready" },
      "/operator/providers/reputation": { summary: "providers ready" },
    });
    const manifestPath = createManifest(
      JSON.stringify({
        version: 1,
        nodes: [{ name: "beta", role: "gateway", baseUrl, authToken: "secret-token" }],
      }),
    );
    const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "openfox-dashboard-bundle-"));
    tempDirs.push(outputDir);

    const result = await exportFleetDashboardBundle({
      manifestPath,
      outputPath: outputDir,
      force: true,
    });

    expect(result.outputPath).toBe(path.resolve(outputDir));
    expect(fs.existsSync(result.manifestCopyPath)).toBe(true);
    expect(fs.existsSync(result.jsonPath)).toBe(true);
    expect(fs.existsSync(result.htmlPath)).toBe(true);
    expect(fs.existsSync(result.lintPath)).toBe(true);
    expect(fs.existsSync(result.controlEventsPath)).toBe(true);
    expect(fs.existsSync(result.autopilotPath)).toBe(true);
    expect(fs.existsSync(result.approvalsPath)).toBe(true);
    expect(JSON.parse(fs.readFileSync(result.lintPath, "utf8")).errors).toBe(0);
    expect(
      JSON.parse(fs.readFileSync(result.controlEventsPath, "utf8")).nodes[0]?.payload?.items?.[0]?.action,
    ).toBe("pause");
    expect(
      JSON.parse(fs.readFileSync(result.autopilotPath, "utf8")).nodes[0]?.payload?.summary,
    ).toBe("autopilot ready");
    expect(
      JSON.parse(fs.readFileSync(result.approvalsPath, "utf8")).nodes[0]?.payload?.items?.[0]?.requestId,
    ).toBe("req-1");
  });
});
