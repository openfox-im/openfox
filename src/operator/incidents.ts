import fs from "fs";
import path from "path";
import {
  buildFleetReconciliationSnapshot,
  buildFleetProviderLivenessSnapshot,
  buildFleetRecoverySnapshot,
  buildFleetSnapshot,
  type FleetRecoveryKind,
  type FleetRecoverySnapshot,
} from "./fleet.js";

export type FleetIncidentKind =
  | "degraded_node"
  | "failing_route"
  | "callback_backlog"
  | "replication_drift";

export type FleetIncidentSeverity = "warning" | "critical";

export interface FleetIncidentEntry {
  incidentId: string;
  kind: FleetIncidentKind;
  severity: FleetIncidentSeverity;
  node: string;
  role: string | null;
  summary: string;
  route?: string | null;
  source: string;
  metric: number;
  details: Record<string, unknown>;
}

export interface FleetIncidentSnapshot {
  manifestPath: string;
  generatedAt: string;
  total: number;
  warning: number;
  critical: number;
  entries: FleetIncidentEntry[];
  summary: string;
  remediationHints: FleetRecoveryKind[];
}

export interface FleetIncidentTimelineRecord {
  recordedAt: string;
  snapshot: FleetIncidentSnapshot;
}

export interface FleetIncidentAlert {
  alertId: string;
  transition: "new" | "worsened" | "resolved";
  severity: FleetIncidentSeverity;
  message: string;
  incidentId: string;
  recordedAt: string;
}

export type FleetIncidentAlertChannel = "stdout" | "json-file" | "webhook";

export interface FleetIncidentAlertDeliveryResult {
  channel: FleetIncidentAlertChannel;
  delivered: number;
  target: string | null;
}

export interface FleetIncidentAlertEvaluation {
  current: FleetIncidentSnapshot;
  previous: FleetIncidentSnapshot | null;
  alerts: FleetIncidentAlert[];
}

export interface FleetIncidentRemediationRun {
  kind: FleetRecoveryKind;
  snapshot: FleetRecoverySnapshot;
}

export interface FleetIncidentRemediationSnapshot {
  manifestPath: string;
  generatedAt: string;
  runs: FleetIncidentRemediationRun[];
  summary: string;
}

function makeIncidentId(
  kind: FleetIncidentKind,
  node: string,
  route: string | null,
  source: string,
): string {
  return [kind, node, route || "-", source].join(":");
}

function severityRank(value: FleetIncidentSeverity): number {
  return value === "critical" ? 2 : 1;
}

function normalizeHistoryPath(historyPath: string): string {
  return path.resolve(historyPath);
}

export async function buildFleetIncidentSnapshot(params: {
  manifestPath: string;
}): Promise<FleetIncidentSnapshot> {
  const manifestPath = path.resolve(params.manifestPath);
  const [status, reconciliation, liveness, settlement, market] = await Promise.all([
    buildFleetSnapshot({ manifestPath, endpoint: "status" }),
    buildFleetReconciliationSnapshot({ manifestPath }),
    buildFleetProviderLivenessSnapshot({ manifestPath }),
    buildFleetSnapshot({ manifestPath, endpoint: "settlement" }),
    buildFleetSnapshot({ manifestPath, endpoint: "market" }),
  ]);

  const entries: FleetIncidentEntry[] = [];

  for (const node of status.nodes) {
    if (node.ok) continue;
    entries.push({
      incidentId: makeIncidentId("degraded_node", node.name, null, "status"),
      kind: "degraded_node",
      severity: "critical",
      node: node.name,
      role: node.role,
      summary: `Node status endpoint is failing${node.error ? ` (${node.error})` : ""}.`,
      source: "status",
      metric: node.statusCode ?? 0,
      details: {
        baseUrl: node.baseUrl,
        error: node.error ?? null,
        statusCode: node.statusCode ?? null,
      },
    });
  }

  for (const entry of liveness.entries) {
    if (entry.state === "alive") continue;
    if (entry.state === "unreachable") {
      entries.push({
        incidentId: makeIncidentId("degraded_node", entry.node, null, "provider-liveness"),
        kind: "degraded_node",
        severity: "critical",
        node: entry.node,
        role: entry.role,
        summary: `Provider is unreachable${entry.failureDomain ? ` in failure domain ${entry.failureDomain}` : ""}.`,
        source: "provider-liveness",
        metric: entry.latencyMs ?? 0,
        details: {
          providerKind: entry.providerKind,
          failureDomain: entry.failureDomain,
          lastSeenAt: entry.lastSeenAt,
        },
      });
      continue;
    }
    for (const route of entry.degradedRoutes.length > 0
      ? entry.degradedRoutes
      : ["(unspecified)"]) {
      entries.push({
        incidentId: makeIncidentId("failing_route", entry.node, route, "provider-liveness"),
        kind: "failing_route",
        severity: "warning",
        node: entry.node,
        role: entry.role,
        route,
        summary: `Provider route ${route} is degraded.`,
        source: "provider-liveness",
        metric: entry.latencyMs ?? 0,
        details: {
          providerKind: entry.providerKind,
          failureDomain: entry.failureDomain,
          lastSeenAt: entry.lastSeenAt,
        },
      });
    }
  }

  for (const entry of reconciliation.entries) {
    if (entry.kind !== "replication") continue;
    if (entry.critical === 0 && entry.warning === 0) continue;
    entries.push({
      incidentId: makeIncidentId("replication_drift", entry.node, null, "reconciliation"),
      kind: "replication_drift",
      severity: entry.critical > 0 ? "critical" : "warning",
      node: entry.node,
      role: entry.role,
      summary: `Replication drift detected (healthy=${entry.healthy}, warning=${entry.warning}, critical=${entry.critical}).`,
      source: "reconciliation",
      metric: entry.critical > 0 ? entry.critical : entry.warning,
      details: entry.details,
    });
  }

  for (const snapshot of [settlement, market]) {
    for (const node of snapshot.nodes) {
      if (!node.ok || typeof node.payload !== "object" || node.payload === null) continue;
      const payload = node.payload as { callbackPending?: number; callbackFailed?: number };
      const pending = payload.callbackPending ?? 0;
      const failed = payload.callbackFailed ?? 0;
      if (pending === 0 && failed === 0) continue;
      entries.push({
        incidentId: makeIncidentId("callback_backlog", node.name, null, snapshot.endpoint),
        kind: "callback_backlog",
        severity: failed > 0 ? "critical" : "warning",
        node: node.name,
        role: node.role,
        summary: `${snapshot.endpoint} callbacks backlog detected (pending=${pending}, failed=${failed}).`,
        source: snapshot.endpoint,
        metric: failed > 0 ? failed : pending,
        details: {
          pending,
          failed,
        },
      });
    }
  }

  const warning = entries.filter((entry) => entry.severity === "warning").length;
  const critical = entries.filter((entry) => entry.severity === "critical").length;
  const remediationHints = Array.from(
    new Set<FleetRecoveryKind>(
      entries.flatMap((entry) => {
        switch (entry.kind) {
          case "replication_drift":
            return ["replication"];
          case "failing_route":
            return ["provider_route"];
          case "callback_backlog":
            return ["callback_queue"];
          default:
            return [];
        }
      }),
    ),
  );

  return {
    manifestPath,
    generatedAt: new Date().toISOString(),
    total: entries.length,
    warning,
    critical,
    entries,
    remediationHints,
    summary:
      entries.length === 0
        ? "No fleet incidents detected."
        : `${entries.length} incident(s) detected (${critical} critical, ${warning} warning).`,
  };
}

export function buildFleetIncidentReport(snapshot: FleetIncidentSnapshot): string {
  const lines = [
    "=== OPENFOX FLEET INCIDENTS ===",
    `Manifest:  ${snapshot.manifestPath}`,
    `Generated: ${snapshot.generatedAt}`,
    `Summary:   ${snapshot.summary}`,
    snapshot.remediationHints.length
      ? `Hints:     ${snapshot.remediationHints.join(", ")}`
      : "Hints:     none",
    "",
  ];
  if (snapshot.entries.length === 0) {
    lines.push("No incidents found.");
    return lines.join("\n");
  }
  for (const entry of snapshot.entries) {
    lines.push(
      `${entry.node}${entry.role ? ` [${entry.role}]` : ""}: ${entry.kind} ${entry.severity} -> ${entry.summary}`,
    );
  }
  return lines.join("\n");
}

export function appendFleetIncidentHistory(params: {
  historyPath: string;
  snapshot: FleetIncidentSnapshot;
}): FleetIncidentTimelineRecord {
  const historyPath = normalizeHistoryPath(params.historyPath);
  fs.mkdirSync(path.dirname(historyPath), { recursive: true });
  const record: FleetIncidentTimelineRecord = {
    recordedAt: new Date().toISOString(),
    snapshot: params.snapshot,
  };
  fs.appendFileSync(historyPath, `${JSON.stringify(record)}\n`, "utf8");
  return record;
}

export function readFleetIncidentHistory(params: {
  historyPath: string;
  limit?: number;
}): FleetIncidentTimelineRecord[] {
  const historyPath = normalizeHistoryPath(params.historyPath);
  if (!fs.existsSync(historyPath)) return [];
  const limit = Math.max(1, params.limit ?? 20);
  const lines = fs
    .readFileSync(historyPath, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(-limit);
  return lines.map((line) => JSON.parse(line) as FleetIncidentTimelineRecord);
}

export function evaluateFleetIncidentAlerts(params: {
  current: FleetIncidentSnapshot;
  previous?: FleetIncidentSnapshot | null;
}): FleetIncidentAlertEvaluation {
  const currentMap = new Map(params.current.entries.map((entry) => [entry.incidentId, entry]));
  const previousMap = new Map((params.previous?.entries ?? []).map((entry) => [entry.incidentId, entry]));
  const alerts: FleetIncidentAlert[] = [];
  const recordedAt = new Date().toISOString();

  for (const entry of params.current.entries) {
    const previous = previousMap.get(entry.incidentId);
    if (!previous) {
      alerts.push({
        alertId: `${entry.incidentId}:new:${recordedAt}`,
        transition: "new",
        severity: entry.severity,
        message: `${entry.node}: ${entry.summary}`,
        incidentId: entry.incidentId,
        recordedAt,
      });
      continue;
    }
    if (severityRank(entry.severity) > severityRank(previous.severity)) {
      alerts.push({
        alertId: `${entry.incidentId}:worsened:${recordedAt}`,
        transition: "worsened",
        severity: entry.severity,
        message: `${entry.node}: ${entry.summary}`,
        incidentId: entry.incidentId,
        recordedAt,
      });
    }
  }

  for (const previous of previousMap.values()) {
    if (currentMap.has(previous.incidentId)) continue;
    alerts.push({
      alertId: `${previous.incidentId}:resolved:${recordedAt}`,
      transition: "resolved",
      severity: previous.severity,
      message: `${previous.node}: ${previous.summary}`,
      incidentId: previous.incidentId,
      recordedAt,
    });
  }

  return {
    current: params.current,
    previous: params.previous ?? null,
    alerts,
  };
}

export async function deliverFleetIncidentAlerts(params: {
  evaluation: FleetIncidentAlertEvaluation;
  channel: FleetIncidentAlertChannel;
  outputPath?: string;
  webhookUrl?: string;
}): Promise<FleetIncidentAlertDeliveryResult> {
  if (params.evaluation.alerts.length === 0) {
    return {
      channel: params.channel,
      delivered: 0,
      target:
        params.channel === "json-file"
          ? params.outputPath || null
          : params.channel === "webhook"
            ? params.webhookUrl || null
            : null,
    };
  }

  if (params.channel === "json-file") {
    if (!params.outputPath) {
      throw new Error("outputPath is required for json-file incident alert delivery");
    }
    const filePath = path.resolve(params.outputPath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    for (const alert of params.evaluation.alerts) {
      fs.appendFileSync(filePath, `${JSON.stringify(alert)}\n`, "utf8");
    }
    return { channel: "json-file", delivered: params.evaluation.alerts.length, target: filePath };
  }

  if (params.channel === "webhook") {
    if (!params.webhookUrl) {
      throw new Error("webhookUrl is required for webhook incident alert delivery");
    }
    const response = await fetch(params.webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        generatedAt: params.evaluation.current.generatedAt,
        alerts: params.evaluation.alerts,
      }),
    });
    if (!response.ok) {
      throw new Error(`incident webhook delivery failed with HTTP ${response.status}`);
    }
    return { channel: "webhook", delivered: params.evaluation.alerts.length, target: params.webhookUrl };
  }

  return { channel: "stdout", delivered: params.evaluation.alerts.length, target: null };
}

export function buildFleetIncidentAlertReport(result: FleetIncidentAlertEvaluation): string {
  const lines = [
    "=== OPENFOX FLEET INCIDENT ALERTS ===",
    `Current summary: ${result.current.summary}`,
    `Alerts:          ${result.alerts.length}`,
    "",
  ];
  if (result.alerts.length === 0) {
    lines.push("No alert transitions detected.");
    return lines.join("\n");
  }
  for (const alert of result.alerts) {
    lines.push(`${alert.transition} ${alert.severity}: ${alert.message}`);
  }
  return lines.join("\n");
}

export async function runFleetIncidentRemediation(params: {
  manifestPath: string;
  limit?: number;
  snapshot?: FleetIncidentSnapshot;
}): Promise<FleetIncidentRemediationSnapshot> {
  const snapshot = params.snapshot ?? (await buildFleetIncidentSnapshot({ manifestPath: params.manifestPath }));
  const runs: FleetIncidentRemediationRun[] = [];
  for (const kind of snapshot.remediationHints) {
    runs.push({
      kind,
      snapshot: await buildFleetRecoverySnapshot({
        manifestPath: params.manifestPath,
        kind,
        limit: params.limit,
      }),
    });
  }
  return {
    manifestPath: path.resolve(params.manifestPath),
    generatedAt: new Date().toISOString(),
    runs,
    summary:
      runs.length === 0
        ? "No incident remediation runs were required."
        : `Executed ${runs.length} remediation run(s).`,
  };
}

export function buildFleetIncidentRemediationReport(
  snapshot: FleetIncidentRemediationSnapshot,
): string {
  const lines = [
    "=== OPENFOX FLEET INCIDENT REMEDIATION ===",
    `Manifest:  ${snapshot.manifestPath}`,
    `Generated: ${snapshot.generatedAt}`,
    `Summary:   ${snapshot.summary}`,
    "",
  ];
  if (snapshot.runs.length === 0) {
    lines.push("No remediation runs executed.");
    return lines.join("\n");
  }
  for (const run of snapshot.runs) {
    lines.push(`${run.kind}: ${run.snapshot.summary}`);
  }
  return lines.join("\n");
}
