import fs from "fs";
import http from "http";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import {
  appendFleetIncidentHistory,
  buildFleetIncidentAlertReport,
  buildFleetIncidentReport,
  buildFleetIncidentRemediationReport,
  buildFleetIncidentSnapshot,
  deliverFleetIncidentAlerts,
  evaluateFleetIncidentAlerts,
  readFleetIncidentHistory,
  runFleetIncidentRemediation,
} from "../operator/incidents.js";

const servers: http.Server[] = [];
const tempDirs: string[] = [];

async function startRouteServer(
  routes: Record<string, { status?: number; body: unknown }>,
): Promise<string> {
  const server = http.createServer((req, res) => {
    const route = routes[req.url || ""];
    if (!route) {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "not found", path: req.url }));
      return;
    }
    res.writeHead(route.status ?? 200, { "content-type": "application/json" });
    res.end(JSON.stringify(route.body));
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("failed to bind test server");
  }
  return `http://127.0.0.1:${address.port}/operator`;
}

function createManifest(nodes: Array<Record<string, unknown>>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openfox-fleet-incidents-"));
  tempDirs.push(dir);
  const manifestPath = path.join(dir, "fleet.json");
  fs.writeFileSync(
    manifestPath,
    JSON.stringify({
      version: 1,
      nodes,
    }),
    "utf8",
  );
  return manifestPath;
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

describe("fleet incidents", () => {
  it("builds canonical incident snapshots across degraded nodes, routes, backlogs, and replication drift", async () => {
    const healthyBaseUrl = await startRouteServer({
      "/operator/status": { body: { ok: true, configured: true } },
      "/operator/providers/reputation": {
        body: {
          entries: [
            {
              kind: "storage",
              status: "degraded",
              degradedRoutes: ["storage.put"],
              failureDomain: "region-a",
              latencyMs: 120,
              lastSeenAt: "2026-03-11T00:00:00.000Z",
            },
          ],
        },
      },
      "/operator/lease-health": {
        body: {
          totalLeases: 2,
          healthy: 1,
          warning: 1,
          critical: 0,
          dueRenewals: 1,
          dueAudits: 0,
          underReplicated: 0,
        },
      },
      "/operator/storage/status": {
        body: {
          kind: "storage",
          summary: "storage degraded",
          replication: {
            targetCopies: 3,
            currentCopies: 2,
            gap: 1,
            missing: 0,
          },
        },
      },
      "/operator/settlement/status": {
        body: {
          callbackPending: 3,
          callbackFailed: 1,
          summary: "callback backlog",
        },
      },
      "/operator/market/status": { body: { callbackPending: 0, callbackFailed: 0 } },
      "/operator/fleet/recover/replication": {
        body: { status: "recovered", attempted: 1, recovered: 1, failed: 0 },
      },
      "/operator/fleet/recover/provider-route": {
        body: { status: "partial", attempted: 1, recovered: 1, failed: 0 },
      },
      "/operator/fleet/recover/callback-queue": {
        body: { status: "recovered", attempted: 2, recovered: 2, failed: 0 },
      },
    });
    const failingBaseUrl = await startRouteServer({
      "/operator/status": { status: 503, body: { error: "offline" } },
      "/operator/providers/reputation": {
        body: {
          entries: [
            {
              kind: "gateway",
              status: "unreachable",
              failureDomain: "region-b",
            },
          ],
        },
      },
      "/operator/lease-health": {
        body: {
          totalLeases: 0,
          healthy: 0,
          warning: 0,
          critical: 0,
        },
      },
      "/operator/storage/status": {
        body: {
          kind: "storage",
          replication: {
            targetCopies: 2,
            currentCopies: 0,
            gap: 2,
            missing: 1,
          },
        },
      },
      "/operator/settlement/status": {
        body: { callbackPending: 0, callbackFailed: 0 },
      },
      "/operator/market/status": {
        body: { callbackPending: 2, callbackFailed: 0 },
      },
      "/operator/fleet/recover/replication": {
        body: { status: "failed", attempted: 1, recovered: 0, failed: 1 },
      },
      "/operator/fleet/recover/provider-route": {
        body: { status: "recovered", attempted: 1, recovered: 1, failed: 0 },
      },
      "/operator/fleet/recover/callback-queue": {
        body: { status: "skipped", attempted: 0, recovered: 0, failed: 0 },
      },
    });

    const manifestPath = createManifest([
      { name: "alpha", role: "storage", baseUrl: healthyBaseUrl },
      { name: "beta", role: "gateway", baseUrl: failingBaseUrl },
    ]);

    const snapshot = await buildFleetIncidentSnapshot({ manifestPath });

    expect(snapshot.total).toBeGreaterThanOrEqual(5);
    expect(snapshot.critical).toBeGreaterThanOrEqual(2);
    expect(snapshot.warning).toBeGreaterThanOrEqual(2);
    expect(snapshot.entries.some((entry) => entry.kind === "degraded_node")).toBe(true);
    expect(snapshot.entries.some((entry) => entry.kind === "failing_route")).toBe(true);
    expect(snapshot.entries.some((entry) => entry.kind === "callback_backlog")).toBe(true);
    expect(snapshot.entries.some((entry) => entry.kind === "replication_drift")).toBe(true);
    expect(snapshot.remediationHints).toEqual(
      expect.arrayContaining(["replication", "provider_route", "callback_queue"]),
    );
    expect(buildFleetIncidentReport(snapshot)).toContain("OPENFOX FLEET INCIDENTS");

    const remediation = await runFleetIncidentRemediation({
      manifestPath,
      snapshot,
    });
    expect(remediation.runs.length).toBe(3);
    expect(buildFleetIncidentRemediationReport(remediation)).toContain(
      "OPENFOX FLEET INCIDENT REMEDIATION",
    );
  });

  it("records incident history and derives alert transitions and deliveries", async () => {
    const historyDir = fs.mkdtempSync(path.join(os.tmpdir(), "openfox-fleet-history-"));
    tempDirs.push(historyDir);
    const historyPath = path.join(historyDir, "history.ndjson");

    const previous = {
      manifestPath: "fleet.json",
      generatedAt: "2026-03-11T00:00:00.000Z",
      total: 1,
      warning: 1,
      critical: 0,
      remediationHints: ["provider_route"] as const,
      summary: "1 incident(s) detected (0 critical, 1 warning).",
      entries: [
        {
          incidentId: "failing_route:alpha:storage.put:provider-liveness",
          kind: "failing_route" as const,
          severity: "warning" as const,
          node: "alpha",
          role: "storage",
          route: "storage.put",
          summary: "Provider route storage.put is degraded.",
          source: "provider-liveness",
          metric: 120,
          details: {},
        },
      ],
    };
    const current = {
      manifestPath: "fleet.json",
      generatedAt: "2026-03-11T01:00:00.000Z",
      total: 1,
      warning: 0,
      critical: 1,
      remediationHints: ["provider_route"] as const,
      summary: "1 incident(s) detected (1 critical, 0 warning).",
      entries: [
        {
          incidentId: "failing_route:alpha:storage.put:provider-liveness",
          kind: "failing_route" as const,
          severity: "critical" as const,
          node: "alpha",
          role: "storage",
          route: "storage.put",
          summary: "Provider route storage.put is degraded.",
          source: "provider-liveness",
          metric: 300,
          details: {},
        },
      ],
    };

    appendFleetIncidentHistory({ historyPath, snapshot: previous });
    appendFleetIncidentHistory({ historyPath, snapshot: current });

    const history = readFleetIncidentHistory({ historyPath, limit: 10 });
    expect(history).toHaveLength(2);
    expect(history[1]?.snapshot.critical).toBe(1);

    const evaluation = evaluateFleetIncidentAlerts({ current, previous });
    expect(evaluation.alerts).toHaveLength(1);
    expect(evaluation.alerts[0]?.transition).toBe("worsened");
    expect(buildFleetIncidentAlertReport(evaluation)).toContain("worsened critical");

    const outputPath = path.join(historyDir, "alerts.ndjson");
    const delivery = await deliverFleetIncidentAlerts({
      evaluation,
      channel: "json-file",
      outputPath,
    });
    expect(delivery.delivered).toBe(1);
    expect(fs.readFileSync(outputPath, "utf8")).toContain("worsened");

    const resolvedEvaluation = evaluateFleetIncidentAlerts({
      current: {
        manifestPath: "fleet.json",
        generatedAt: "2026-03-11T02:00:00.000Z",
        total: 0,
        warning: 0,
        critical: 0,
        remediationHints: [],
        summary: "No fleet incidents detected.",
        entries: [],
      },
      previous: current,
    });
    expect(resolvedEvaluation.alerts).toHaveLength(1);
    expect(resolvedEvaluation.alerts[0]?.transition).toBe("resolved");
  });
});
