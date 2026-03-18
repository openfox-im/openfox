import fs from "fs";
import http from "http";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildFleetBundleReport,
  buildFleetBundleSnapshot,
  buildFleetControlReport,
  buildFleetControlSnapshot,
  buildFleetReport,
  buildFleetLintReport,
  buildFleetLintSnapshot,
  buildFleetQueueRetryReport,
  buildFleetQueueRetrySnapshot,
  buildFleetRepairReport,
  buildFleetRepairSnapshot,
  buildFleetSnapshot,
  loadFleetManifest,
} from "../operator/fleet.js";
import { exportFleetDashboardBundle } from "../operator/dashboard.js";

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

  it("supports provider reputation and storage lease-health fleet endpoints", async () => {
    const providersBaseUrl = await startEndpointServer("/operator/providers/reputation", {
      totalProviders: 2,
      weakProviders: 1,
      summary: "2 providers tracked, 1 weak",
      entries: [],
    });
    const leaseHealthBaseUrl = await startEndpointServer("/operator/storage/lease-health", {
      totalLeases: 3,
      critical: 1,
      warning: 1,
      healthy: 1,
      summary: "3 leases, 1 critical, 1 warning",
      entries: [],
    });

    const manifestPath = createManifest(
      JSON.stringify({
        version: 1,
        nodes: [
          { name: "providers-1", role: "provider", baseUrl: providersBaseUrl },
          { name: "storage-1", role: "storage", baseUrl: leaseHealthBaseUrl },
        ],
      }),
    );

    const providersSnapshot = await buildFleetSnapshot({
      manifestPath,
      endpoint: "providers",
    });
    expect(providersSnapshot.ok).toBe(1);
    expect(buildFleetReport(providersSnapshot)).toContain("2 providers tracked, 1 weak");

    const leaseHealthSnapshot = await buildFleetSnapshot({
      manifestPath,
      endpoint: "lease-health",
    });
    expect(leaseHealthSnapshot.ok).toBe(1);
    expect(buildFleetReport(leaseHealthSnapshot)).toContain("3 leases, 1 critical, 1 warning");
  });

  it("supports wallet and finance fleet endpoints", async () => {
    const walletBaseUrl = await startEndpointServer("/operator/wallet/status", {
      kind: "wallet",
      address:
        "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
      summary:
        "balance=5.000000 TOS reserved=1.000000 TOS available=4.000000 TOS, receivable=0.500000 TOS, payable=0.200000 TOS, runway=40.0d",
    });
    const financeBaseUrl = await startEndpointServer("/operator/finance/status", {
      kind: "finance",
      address:
        "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
      summary:
        "30d revenue=8.000000 TOS, cost=3.000000 TOS, net=5.000000 TOS, operating=$12.50",
    });

    const manifestPath = createManifest(
      JSON.stringify({
        version: 1,
        nodes: [
          { name: "wallet-1", role: "host", baseUrl: walletBaseUrl },
          { name: "finance-1", role: "gateway", baseUrl: financeBaseUrl },
        ],
      }),
    );

    const walletSnapshot = await buildFleetSnapshot({
      manifestPath,
      endpoint: "wallet",
    });
    expect(walletSnapshot.ok).toBe(1);
    expect(buildFleetReport(walletSnapshot)).toContain("balance=5.000000 TOS");

    const financeSnapshot = await buildFleetSnapshot({
      manifestPath,
      endpoint: "finance",
    });
    expect(financeSnapshot.ok).toBe(1);
    expect(buildFleetReport(financeSnapshot)).toContain("30d revenue=8.000000 TOS");
  });

  it("supports payments, settlement, and market fleet endpoints", async () => {
    const paymentsBaseUrl = await startEndpointServer("/operator/payments/status", {
      kind: "payments",
      summary:
        "confirmed revenue=8.000000 TOS, confirmed cost=3.000000 TOS, pending receivables=1.000000 TOS, pending liabilities=0.500000 TOS, failed=1",
    });
    const settlementBaseUrl = await startEndpointServer("/operator/settlement/status", {
      kind: "settlement",
      callbackPending: 2,
      callbackFailed: 1,
      summary: "4 receipts, callbacks pending=2, failed=1",
    });
    const marketBaseUrl = await startEndpointServer("/operator/market/status", {
      kind: "market",
      callbackPending: 1,
      callbackFailed: 0,
      summary: "3 bindings, callbacks pending=1, failed=0",
    });

    const manifestPath = createManifest(
      JSON.stringify({
        version: 1,
        nodes: [
          { name: "payments-1", role: "gateway", baseUrl: paymentsBaseUrl },
          { name: "settlement-1", role: "host", baseUrl: settlementBaseUrl },
          { name: "market-1", role: "oracle", baseUrl: marketBaseUrl },
        ],
      }),
    );

    const paymentsSnapshot = await buildFleetSnapshot({
      manifestPath,
      endpoint: "payments",
    });
    expect(paymentsSnapshot.ok).toBe(1);
    expect(buildFleetReport(paymentsSnapshot)).toContain("confirmed revenue=8.000000 TOS");

    const settlementSnapshot = await buildFleetSnapshot({
      manifestPath,
      endpoint: "settlement",
    });
    expect(settlementSnapshot.ok).toBe(1);
    expect(buildFleetReport(settlementSnapshot)).toContain("callbacks pending=2");

    const marketSnapshot = await buildFleetSnapshot({
      manifestPath,
      endpoint: "market",
    });
    expect(marketSnapshot.ok).toBe(1);
    expect(buildFleetReport(marketSnapshot)).toContain("3 bindings, callbacks pending=1");
  });

  it("supports fleet repair actions for storage and artifacts", async () => {
    const storageBaseUrl = await startEndpointServer("/operator/storage/maintain", {
      kind: "storage",
      enabled: true,
      renewed: 1,
      audited: 2,
    });
    const artifactsBaseUrl = await startEndpointServer("/operator/artifacts/maintain", {
      kind: "artifacts",
      enabled: true,
      verified: 1,
      anchored: 1,
    });

    const manifestPath = createManifest(
      JSON.stringify({
        version: 1,
        nodes: [
          { name: "storage-1", role: "storage", baseUrl: storageBaseUrl },
          { name: "artifact-1", role: "artifacts", baseUrl: artifactsBaseUrl },
        ],
      }),
    );

    const storageSnapshot = await buildFleetRepairSnapshot({
      manifestPath,
      component: "storage",
      limit: 3,
    });
    expect(storageSnapshot.ok).toBe(1);
    expect(storageSnapshot.failed).toBe(1);
    expect((storageSnapshot.nodes[0]?.payload as { renewed?: number })?.renewed).toBe(1);
    const storageReport = buildFleetRepairReport(storageSnapshot);
    expect(storageReport).toContain("=== OPENFOX FLEET REPAIR ===");
    expect(storageReport).toContain("Component: storage");

    const artifactSnapshot = await buildFleetRepairSnapshot({
      manifestPath,
      component: "artifacts",
      limit: 2,
    });
    expect(artifactSnapshot.ok).toBe(1);
    expect(artifactSnapshot.failed).toBe(1);
    expect((artifactSnapshot.nodes[1]?.payload as { anchored?: number })?.anchored).toBe(1);
    const artifactReport = buildFleetRepairReport(artifactSnapshot);
    expect(artifactReport).toContain("Component: artifacts");
  });

  it("supports fleet control actions and queue retries", async () => {
    const controlBaseUrl = await startEndpointServer("/operator/control/pause", {
      action: "pause",
      status: "applied",
      summary: "heartbeat paused",
    });
    const resumeBaseUrl = await startEndpointServer("/operator/control/resume", {
      action: "resume",
      status: "applied",
      summary: "node resumed",
    });
    const retryBaseUrl = await startEndpointServer("/operator/control/retry/payments", {
      action: "retry_payments",
      status: "applied",
      summary: "retried x402 payments: processed=3, failed=0",
    });

    const manifestPath = createManifest(
      JSON.stringify({
        version: 1,
        nodes: [
          { name: "control-1", role: "gateway", baseUrl: controlBaseUrl },
          { name: "resume-1", role: "host", baseUrl: resumeBaseUrl },
          { name: "retry-1", role: "payments", baseUrl: retryBaseUrl },
        ],
      }),
    );

    const controlSnapshot = await buildFleetControlSnapshot({
      manifestPath,
      action: "pause",
      nodeName: "control-1",
      actor: "test-suite",
      reason: "maintenance",
    });
    expect(controlSnapshot.ok).toBe(1);
    expect(controlSnapshot.failed).toBe(0);
    expect(controlSnapshot.targetNode).toBe("control-1");
    expect(buildFleetControlReport(controlSnapshot)).toContain("Action:    pause");

    const resumeSnapshot = await buildFleetControlSnapshot({
      manifestPath,
      action: "resume",
      nodeName: "resume-1",
    });
    expect(resumeSnapshot.ok).toBe(1);
    expect(buildFleetControlReport(resumeSnapshot)).toContain("node resumed");

    const retrySnapshot = await buildFleetQueueRetrySnapshot({
      manifestPath,
      queue: "payments",
      nodeName: "retry-1",
      actor: "test-suite",
      reason: "recover",
      limit: 5,
    });
    expect(retrySnapshot.ok).toBe(1);
    expect(retrySnapshot.failed).toBe(0);
    expect(buildFleetQueueRetryReport(retrySnapshot)).toContain("Queue:     payments");
    expect(buildFleetQueueRetryReport(retrySnapshot)).toContain("processed=3");
  });

  it("lint-detects placeholder urls, tokens, and duplicates", () => {
    const manifestPath = createManifest(
      JSON.stringify({
        version: 1,
        nodes: [
          {
            name: "gateway-1",
            role: "gateway",
            baseUrl: "https://gateway.example.com/operator",
            authToken: "replace-me-token",
          },
          {
            name: "gateway-1",
            baseUrl: "http://provider.internal/operator",
          },
          {
            name: "storage-1",
            role: "storage",
            baseUrl: "https://gateway.example.com/operator",
            authToken: "token-real",
          },
        ],
      }),
    );

    const snapshot = buildFleetLintSnapshot({ manifestPath });
    expect(snapshot.total).toBe(3);
    expect(snapshot.errors).toBeGreaterThanOrEqual(3);
    expect(snapshot.warnings).toBeGreaterThanOrEqual(2);
    expect(snapshot.issues.some((issue) => issue.code === "placeholder_auth_token")).toBe(true);
    expect(snapshot.issues.some((issue) => issue.code === "duplicate_name")).toBe(true);
    expect(snapshot.issues.some((issue) => issue.code === "duplicate_base_url")).toBe(true);
    expect(snapshot.issues.some((issue) => issue.code === "missing_role")).toBe(true);
    expect(snapshot.issues.some((issue) => issue.code === "non_https_base_url")).toBe(true);

    const report = buildFleetLintReport(snapshot);
    expect(report).toContain("=== OPENFOX FLEET LINT ===");
    expect(report).toContain("placeholder_auth_token");
    expect(report).toContain("duplicate_base_url");
  });

  it("lint-detects invalid roles and missing public control-plane roles", () => {
    const manifestPath = createManifest(
      JSON.stringify({
        version: 1,
        nodes: [
          {
            name: "odd-1",
            role: "weird-role",
            baseUrl: "https://odd.example.net/operator",
            authToken: "token-real",
          },
        ],
      }),
    );

    const snapshot = buildFleetLintSnapshot({ manifestPath });
    expect(snapshot.issues.some((issue) => issue.code === "invalid_role")).toBe(true);
    expect(snapshot.issues.some((issue) => issue.code === "missing_gateway_role")).toBe(true);
    expect(snapshot.issues.some((issue) => issue.code === "missing_host_role")).toBe(true);
    expect(snapshot.issues.some((issue) => issue.code === "missing_provider_role")).toBe(true);
  });

  it("inspects exported fleet dashboard bundles", async () => {
    const baseUrl = await startEndpointServer("/operator/status", {
      summary: "runtime ok",
    });
    const manifestPath = createManifest(
      JSON.stringify({
        version: 1,
        nodes: [{ name: "gateway-1", role: "gateway", baseUrl, authToken: "token-real" }],
      }),
    );
    const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "openfox-fleet-bundle-"));
    tempDirs.push(outputDir);

    await exportFleetDashboardBundle({
      manifestPath,
      outputPath: outputDir,
      force: true,
    });

    const snapshot = buildFleetBundleSnapshot({ bundlePath: outputDir });
    expect(snapshot.exists).toBe(true);
    expect(snapshot.manifest?.nodeCount).toBe(1);
    expect(snapshot.manifest?.roles.gateway).toBe(1);
    expect(snapshot.dashboard?.nodeCount).toBe(1);
    expect(snapshot.lint?.errors).toBe(0);
    expect(buildFleetBundleReport(snapshot)).toContain("OPENFOX FLEET BUNDLE");
  });
});
