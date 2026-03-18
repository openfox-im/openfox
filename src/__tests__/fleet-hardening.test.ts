import fs from "fs";
import http from "http";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildFleetReconciliationReport,
  buildFleetReconciliationSnapshot,
  buildFleetProviderLivenessReport,
  buildFleetProviderLivenessSnapshot,
  buildFleetRecoveryReport,
  buildFleetRecoverySnapshot,
} from "../operator/fleet.js";

const servers: http.Server[] = [];
const tempDirs: string[] = [];

function createManifest(contents: string, ext = "json"): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openfox-hardening-"));
  tempDirs.push(dir);
  const filePath = path.join(dir, `fleet.${ext}`);
  fs.writeFileSync(filePath, contents, "utf8");
  return filePath;
}

async function startMultiEndpointServer(
  routes: Record<string, { body: unknown; status?: number; method?: string }>,
): Promise<string> {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || "/", `http://${req.headers.host}`);
    const routeKey = url.pathname;
    const route = routes[routeKey];
    if (route && (route.method ?? "GET") === req.method) {
      res.writeHead(route.status ?? 200, { "content-type": "application/json" });
      res.end(JSON.stringify(route.body));
      return;
    }
    // Also match without method constraint for GET
    if (route && req.method === "GET") {
      res.writeHead(route.status ?? 200, { "content-type": "application/json" });
      res.end(JSON.stringify(route.body));
      return;
    }
    // For POST recovery endpoints, accept any matching path
    for (const [pattern, handler] of Object.entries(routes)) {
      if (routeKey === pattern && req.method === "POST") {
        res.writeHead(handler.status ?? 200, { "content-type": "application/json" });
        res.end(JSON.stringify(handler.body));
        return;
      }
    }
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "not found", path: req.url }));
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("failed to bind server");
  }
  return `http://127.0.0.1:${address.port}/operator`;
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

describe("fleet reconciliation views", () => {
  it("builds reconciliation snapshot from lease-health and storage payloads", async () => {
    const baseUrl = await startMultiEndpointServer({
      "/operator/storage/lease-health": {
        body: {
          totalLeases: 5,
          healthy: 3,
          warning: 1,
          critical: 1,
          dueRenewals: 2,
          dueAudits: 1,
          underReplicated: 1,
          entries: [],
        },
      },
      "/operator/storage/status": {
        body: {
          kind: "storage",
          enabled: true,
          replication: {
            targetCopies: 3,
            currentCopies: 2,
            gap: 1,
            missing: 0,
          },
        },
      },
    });

    const manifestPath = createManifest(
      JSON.stringify({
        version: 1,
        nodes: [
          { name: "storage-1", role: "storage", baseUrl },
        ],
      }),
    );

    const snapshot = await buildFleetReconciliationSnapshot({
      manifestPath,
    });

    expect(snapshot.total).toBe(2); // lease-health + storage nodes
    expect(snapshot.ok).toBe(2);
    expect(snapshot.entries.length).toBeGreaterThan(0);

    // Should have parsed the lease-health reconciliation entry
    const leaseEntry = snapshot.entries.find((e) => e.kind === "lease");
    expect(leaseEntry).toBeDefined();
    expect(leaseEntry!.total).toBe(5);
    expect(leaseEntry!.healthy).toBe(3);
    expect(leaseEntry!.critical).toBe(1);

    // Should have parsed the replication entry
    const replicationEntry = snapshot.entries.find((e) => e.kind === "replication");
    expect(replicationEntry).toBeDefined();
    expect(replicationEntry!.total).toBe(3);
    expect(replicationEntry!.healthy).toBe(2);

    const report = buildFleetReconciliationReport(snapshot);
    expect(report).toContain("=== OPENFOX FLEET RECONCILIATION ===");
    expect(report).toContain("storage-1 [storage]: lease");
    expect(report).toContain("reconciliation entries");
  });

  it("builds reconciliation snapshot with structured per-kind sections", async () => {
    const baseUrl = await startMultiEndpointServer({
      "/operator/storage/lease-health": {
        body: {
          lease: { total: 10, healthy: 8, warning: 1, critical: 1 },
          audit: { total: 10, healthy: 9, warning: 1, critical: 0, overdue: 2 },
          renewal: { total: 3, healthy: 2, warning: 1, critical: 0 },
        },
      },
      "/operator/storage/status": {
        body: { kind: "storage", enabled: true },
      },
    });

    const manifestPath = createManifest(
      JSON.stringify({
        version: 1,
        nodes: [{ name: "node-1", role: "storage", baseUrl }],
      }),
    );

    const snapshot = await buildFleetReconciliationSnapshot({ manifestPath });
    const leaseEntry = snapshot.entries.find((e) => e.kind === "lease");
    const auditEntry = snapshot.entries.find((e) => e.kind === "audit");
    const renewalEntry = snapshot.entries.find((e) => e.kind === "renewal");

    expect(leaseEntry).toBeDefined();
    expect(auditEntry).toBeDefined();
    expect(renewalEntry).toBeDefined();
    expect(auditEntry!.details.overdue).toBe(2);
  });

  it("handles unreachable nodes gracefully in reconciliation", async () => {
    const manifestPath = createManifest(
      JSON.stringify({
        version: 1,
        nodes: [
          { name: "offline-1", role: "storage", baseUrl: "http://127.0.0.1:1" },
        ],
      }),
    );

    const snapshot = await buildFleetReconciliationSnapshot({ manifestPath });
    expect(snapshot.failed).toBe(2); // lease-health + storage both fail
    expect(snapshot.entries.length).toBe(0);
    expect(snapshot.summary).toContain("0 reconciliation entries");
  });
});

describe("fleet provider liveness reporting", () => {
  it("classifies providers as alive, degraded, or unreachable", async () => {
    const aliveBaseUrl = await startMultiEndpointServer({
      "/operator/providers/reputation": {
        body: {
          entries: [
            {
              kind: "storage",
              state: "alive",
              failureDomain: "us-east-1",
              degradedRoutes: [],
              lastSeenAt: "2026-03-11T00:00:00Z",
              latencyMs: 50,
            },
            {
              kind: "signer",
              score: 45,
              failureDomain: "us-west-2",
              degradedRoutes: ["/signer/submit"],
              lastSeenAt: "2026-03-10T00:00:00Z",
              latencyMs: 1200,
            },
          ],
        },
      },
    });

    const deadBaseUrl = "http://127.0.0.1:1/operator";

    const manifestPath = createManifest(
      JSON.stringify({
        version: 1,
        nodes: [
          { name: "node-1", role: "provider", baseUrl: aliveBaseUrl },
          { name: "node-2", role: "signer", baseUrl: deadBaseUrl },
        ],
      }),
    );

    const snapshot = await buildFleetProviderLivenessSnapshot({ manifestPath });

    expect(snapshot.alive).toBe(1);
    expect(snapshot.degraded).toBe(1);
    expect(snapshot.unreachable).toBe(1);
    expect(snapshot.total).toBe(3);

    // Check failure domains
    expect(snapshot.failureDomains["us-east-1"]).toBe(1);
    expect(snapshot.failureDomains["us-west-2"]).toBe(1);

    // Check degraded routes
    const degradedEntry = snapshot.entries.find((e) => e.state === "degraded");
    expect(degradedEntry).toBeDefined();
    expect(degradedEntry!.degradedRoutes).toContain("/signer/submit");

    const report = buildFleetProviderLivenessReport(snapshot);
    expect(report).toContain("=== OPENFOX FLEET PROVIDER LIVENESS ===");
    expect(report).toContain("Alive:       1");
    expect(report).toContain("Degraded:    1");
    expect(report).toContain("Unreachable: 1");
    expect(report).toContain("Failure domains:");
    expect(report).toContain("us-east-1=1");
    expect(report).toContain("degraded_routes=[/signer/submit]");
  });

  it("infers liveness from score field", async () => {
    const baseUrl = await startMultiEndpointServer({
      "/operator/providers/reputation": {
        body: {
          entries: [
            { kind: "storage", score: 90 },
            { kind: "artifacts", score: 55 },
            { kind: "signer", score: 20 },
          ],
        },
      },
    });

    const manifestPath = createManifest(
      JSON.stringify({
        version: 1,
        nodes: [{ name: "multi-1", role: "provider", baseUrl }],
      }),
    );

    const snapshot = await buildFleetProviderLivenessSnapshot({ manifestPath });
    expect(snapshot.alive).toBe(1);
    expect(snapshot.degraded).toBe(1);
    expect(snapshot.unreachable).toBe(1);
  });

  it("builds single-entry liveness from flat kind payload", async () => {
    const baseUrl = await startMultiEndpointServer({
      "/operator/providers/reputation": {
        body: {
          kind: "storage",
          state: "degraded",
          failureDomain: "eu-west-1",
          degradedRoutes: ["/storage/put"],
          lastSeenAt: "2026-03-11T00:00:00Z",
          latencyMs: 800,
        },
      },
    });

    const manifestPath = createManifest(
      JSON.stringify({
        version: 1,
        nodes: [{ name: "flat-1", role: "storage", baseUrl }],
      }),
    );

    const snapshot = await buildFleetProviderLivenessSnapshot({ manifestPath });
    expect(snapshot.degraded).toBe(1);
    expect(snapshot.entries[0]?.providerKind).toBe("storage");
    expect(snapshot.entries[0]?.failureDomain).toBe("eu-west-1");

    const report = buildFleetProviderLivenessReport(snapshot);
    expect(report).toContain("domain=eu-west-1");
    expect(report).toContain("latency=800ms");
  });
});

describe("fleet bounded recovery flows", () => {
  it("builds replication recovery snapshot from fleet nodes", async () => {
    const baseUrl = await startMultiEndpointServer({
      "/operator/fleet/recover/replication": {
        body: {
          status: "recovered",
          attempted: 5,
          recovered: 4,
          failed: 1,
        },
        method: "POST",
      },
    });

    const manifestPath = createManifest(
      JSON.stringify({
        version: 1,
        nodes: [
          { name: "storage-1", role: "storage", baseUrl },
        ],
      }),
    );

    const snapshot = await buildFleetRecoverySnapshot({
      manifestPath,
      kind: "replication",
      limit: 10,
    });

    expect(snapshot.kind).toBe("replication");
    expect(snapshot.total).toBe(1);
    expect(snapshot.entries[0]?.status).toBe("recovered");
    expect(snapshot.entries[0]?.attempted).toBe(5);
    expect(snapshot.entries[0]?.recovered).toBe(4);
    expect(snapshot.entries[0]?.failed).toBe(1);

    const report = buildFleetRecoveryReport(snapshot);
    expect(report).toContain("=== OPENFOX FLEET RECOVERY ===");
    expect(report).toContain("Kind:      replication");
    expect(report).toContain("attempted=5 recovered=4 failed=1");
    expect(report).toContain("replication recovery: 4 recovered, 1 failed");
  });

  it("builds provider route recovery snapshot", async () => {
    const baseUrl = await startMultiEndpointServer({
      "/operator/fleet/recover/provider-route": {
        body: {
          status: "partial",
          attempted: 3,
          recovered: 2,
          failed: 1,
        },
        method: "POST",
      },
    });

    const manifestPath = createManifest(
      JSON.stringify({
        version: 1,
        nodes: [{ name: "provider-1", role: "provider", baseUrl }],
      }),
    );

    const snapshot = await buildFleetRecoverySnapshot({
      manifestPath,
      kind: "provider_route",
    });

    expect(snapshot.kind).toBe("provider_route");
    expect(snapshot.entries[0]?.status).toBe("partial");
    expect(snapshot.entries[0]?.recovered).toBe(2);
  });

  it("builds callback queue recovery snapshot", async () => {
    const baseUrl = await startMultiEndpointServer({
      "/operator/fleet/recover/callback-queue": {
        body: {
          status: "recovered",
          attempted: 10,
          recovered: 10,
          failed: 0,
        },
        method: "POST",
      },
    });

    const manifestPath = createManifest(
      JSON.stringify({
        version: 1,
        nodes: [{ name: "payments-1", role: "payments", baseUrl }],
      }),
    );

    const snapshot = await buildFleetRecoverySnapshot({
      manifestPath,
      kind: "callback_queue",
    });

    expect(snapshot.kind).toBe("callback_queue");
    expect(snapshot.entries[0]?.status).toBe("recovered");
    expect(snapshot.entries[0]?.recovered).toBe(10);
    expect(snapshot.entries[0]?.failed).toBe(0);
  });

  it("marks unreachable nodes as failed in recovery", async () => {
    const manifestPath = createManifest(
      JSON.stringify({
        version: 1,
        nodes: [
          { name: "offline-1", role: "storage", baseUrl: "http://127.0.0.1:1/operator" },
        ],
      }),
    );

    const snapshot = await buildFleetRecoverySnapshot({
      manifestPath,
      kind: "replication",
    });

    expect(snapshot.entries[0]?.status).toBe("failed");
    expect(snapshot.entries[0]?.failed).toBe(1);
    expect(snapshot.failed).toBe(1);
  });

  it("classifies skipped recovery when no attempts are made", async () => {
    const baseUrl = await startMultiEndpointServer({
      "/operator/fleet/recover/replication": {
        body: {
          attempted: 0,
          recovered: 0,
          failed: 0,
        },
        method: "POST",
      },
    });

    const manifestPath = createManifest(
      JSON.stringify({
        version: 1,
        nodes: [{ name: "idle-1", role: "storage", baseUrl }],
      }),
    );

    const snapshot = await buildFleetRecoverySnapshot({
      manifestPath,
      kind: "replication",
    });

    expect(snapshot.entries[0]?.status).toBe("skipped");
    expect(snapshot.ok).toBe(1);
  });
});

describe("multi-node validation: restart, failover, partial degradation", () => {
  it("detects partial fleet degradation across multiple nodes", async () => {
    const healthyBaseUrl = await startMultiEndpointServer({
      "/operator/providers/reputation": {
        body: {
          entries: [
            { kind: "storage", state: "alive", failureDomain: "us-east-1", latencyMs: 30 },
          ],
        },
      },
      "/operator/storage/lease-health": {
        body: { totalLeases: 10, healthy: 10, warning: 0, critical: 0, entries: [] },
      },
      "/operator/storage/status": {
        body: { kind: "storage", enabled: true },
      },
    });

    const degradedBaseUrl = await startMultiEndpointServer({
      "/operator/providers/reputation": {
        body: {
          entries: [
            {
              kind: "storage",
              state: "degraded",
              failureDomain: "us-west-2",
              degradedRoutes: ["/storage/get", "/storage/put"],
              latencyMs: 2000,
            },
          ],
        },
      },
      "/operator/storage/lease-health": {
        body: {
          totalLeases: 10,
          healthy: 5,
          warning: 3,
          critical: 2,
          dueRenewals: 3,
          dueAudits: 2,
          underReplicated: 1,
          entries: [],
        },
      },
      "/operator/storage/status": {
        body: { kind: "storage", enabled: true },
      },
    });

    const offlineBaseUrl = "http://127.0.0.1:1/operator";

    const manifestPath = createManifest(
      JSON.stringify({
        version: 1,
        nodes: [
          { name: "healthy-1", role: "storage", baseUrl: healthyBaseUrl },
          { name: "degraded-1", role: "storage", baseUrl: degradedBaseUrl },
          { name: "offline-1", role: "storage", baseUrl: offlineBaseUrl },
        ],
      }),
    );

    // Validate reconciliation shows degradation
    const reconciliation = await buildFleetReconciliationSnapshot({ manifestPath });
    expect(reconciliation.ok).toBeGreaterThan(0);
    expect(reconciliation.failed).toBeGreaterThan(0);
    const criticalEntries = reconciliation.entries.filter((e) => e.critical > 0);
    expect(criticalEntries.length).toBeGreaterThan(0);

    // Validate liveness reports mixed fleet state
    const liveness = await buildFleetProviderLivenessSnapshot({ manifestPath });
    expect(liveness.alive).toBeGreaterThanOrEqual(1);
    expect(liveness.degraded).toBeGreaterThanOrEqual(1);
    expect(liveness.unreachable).toBeGreaterThanOrEqual(1);

    // Validate failure domains are tracked
    expect(liveness.failureDomains["us-east-1"]).toBe(1);
    expect(liveness.failureDomains["us-west-2"]).toBe(1);
  });

  it("validates fleet recovery after simulated restart", async () => {
    // Simulate: node was down, now responds with recovery data
    const restartedBaseUrl = await startMultiEndpointServer({
      "/operator/fleet/recover/replication": {
        body: {
          status: "recovered",
          attempted: 3,
          recovered: 3,
          failed: 0,
        },
        method: "POST",
      },
      "/operator/fleet/recover/callback-queue": {
        body: {
          status: "recovered",
          attempted: 5,
          recovered: 5,
          failed: 0,
        },
        method: "POST",
      },
    });

    const manifestPath = createManifest(
      JSON.stringify({
        version: 1,
        nodes: [
          { name: "restarted-1", role: "storage", baseUrl: restartedBaseUrl },
        ],
      }),
    );

    // Trigger replication recovery
    const replicationRecovery = await buildFleetRecoverySnapshot({
      manifestPath,
      kind: "replication",
    });
    expect(replicationRecovery.entries[0]?.status).toBe("recovered");
    expect(replicationRecovery.entries[0]?.recovered).toBe(3);

    // Trigger callback queue recovery
    const callbackRecovery = await buildFleetRecoverySnapshot({
      manifestPath,
      kind: "callback_queue",
    });
    expect(callbackRecovery.entries[0]?.status).toBe("recovered");
    expect(callbackRecovery.entries[0]?.recovered).toBe(5);
  });

  it("validates failover scenario with healthy and failed nodes", async () => {
    const primaryBaseUrl = "http://127.0.0.1:1/operator"; // simulates failed primary
    const secondaryBaseUrl = await startMultiEndpointServer({
      "/operator/fleet/recover/replication": {
        body: {
          status: "recovered",
          attempted: 8,
          recovered: 8,
          failed: 0,
        },
        method: "POST",
      },
      "/operator/providers/reputation": {
        body: {
          entries: [
            { kind: "storage", state: "alive", failureDomain: "us-east-1" },
          ],
        },
      },
    });

    const manifestPath = createManifest(
      JSON.stringify({
        version: 1,
        nodes: [
          { name: "primary-1", role: "storage", baseUrl: primaryBaseUrl },
          { name: "secondary-1", role: "storage", baseUrl: secondaryBaseUrl },
        ],
      }),
    );

    // Recovery should show primary failed, secondary recovered
    const recovery = await buildFleetRecoverySnapshot({
      manifestPath,
      kind: "replication",
    });
    expect(recovery.total).toBe(2);
    const primaryEntry = recovery.entries.find((e) => e.node === "primary-1");
    const secondaryEntry = recovery.entries.find((e) => e.node === "secondary-1");
    expect(primaryEntry?.status).toBe("failed");
    expect(secondaryEntry?.status).toBe("recovered");
    expect(secondaryEntry?.recovered).toBe(8);

    // Liveness should show secondary alive and primary unreachable
    const liveness = await buildFleetProviderLivenessSnapshot({ manifestPath });
    const primaryLiveness = liveness.entries.find((e) => e.node === "primary-1");
    const secondaryLiveness = liveness.entries.find((e) => e.node === "secondary-1");
    expect(primaryLiveness?.state).toBe("unreachable");
    expect(secondaryLiveness?.state).toBe("alive");
  });

  it("validates fleet-wide reports across all reconciliation, liveness, and recovery", async () => {
    const nodeBaseUrl = await startMultiEndpointServer({
      "/operator/storage/lease-health": {
        body: {
          lease: { total: 20, healthy: 15, warning: 3, critical: 2 },
          audit: { total: 20, healthy: 18, warning: 2, critical: 0 },
          renewal: { total: 5, healthy: 4, warning: 1, critical: 0 },
          replication: { total: 3, healthy: 2, warning: 1, critical: 0 },
        },
      },
      "/operator/storage/status": {
        body: { kind: "storage", enabled: true },
      },
      "/operator/providers/reputation": {
        body: {
          entries: [
            { kind: "storage", state: "alive", failureDomain: "az-1", latencyMs: 40 },
            { kind: "signer", state: "alive", failureDomain: "az-2", latencyMs: 25 },
          ],
        },
      },
      "/operator/fleet/recover/replication": {
        body: { status: "skipped", attempted: 0, recovered: 0, failed: 0 },
        method: "POST",
      },
    });

    const manifestPath = createManifest(
      JSON.stringify({
        version: 1,
        nodes: [
          { name: "fleet-1", role: "storage", baseUrl: nodeBaseUrl },
        ],
      }),
    );

    // Reconciliation
    const reconciliation = await buildFleetReconciliationSnapshot({ manifestPath });
    expect(reconciliation.entries.length).toBe(4); // lease, audit, renewal, replication
    const leaseRecon = reconciliation.entries.find((e) => e.kind === "lease");
    expect(leaseRecon?.total).toBe(20);
    expect(leaseRecon?.critical).toBe(2);

    // Liveness
    const liveness = await buildFleetProviderLivenessSnapshot({ manifestPath });
    expect(liveness.alive).toBe(2);
    expect(liveness.failureDomains["az-1"]).toBe(1);
    expect(liveness.failureDomains["az-2"]).toBe(1);

    // Recovery (skipped because nothing to recover)
    const recovery = await buildFleetRecoverySnapshot({
      manifestPath,
      kind: "replication",
    });
    expect(recovery.entries[0]?.status).toBe("skipped");
    expect(recovery.ok).toBe(1);
  });
});
