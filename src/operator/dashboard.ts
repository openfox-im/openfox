import fs from "fs";
import path from "path";
import {
  buildFleetIncidentSnapshot,
  type FleetIncidentSnapshot,
} from "./incidents.js";
import {
  buildFleetLintSnapshot,
  buildFleetSnapshot,
  loadFleetManifest,
  type FleetEndpoint,
  type FleetSnapshot,
} from "./fleet.js";

export const DEFAULT_DASHBOARD_ENDPOINTS: FleetEndpoint[] = [
  "status",
  "health",
  "service",
  "gateway",
  "control",
  "autopilot",
  "wallet",
  "finance",
  "payments",
  "settlement",
  "market",
  "storage",
  "lease-health",
  "artifacts",
  "signer",
  "paymaster",
  "providers",
  "reconciliation",
  "provider-liveness",
];

interface FleetFinanceNodeSummary {
  name: string;
  role: string | null;
  revenueTomi30d: string;
  costTomi30d: string;
  netTomi30d: string;
  pendingReceivablesTomi: string;
  pendingPayablesTomi: string;
  negativeMargin: boolean;
}

interface FleetFinanceRoleSummary {
  role: string;
  nodes: number;
  revenueTomi30d: string;
  costTomi30d: string;
  netTomi30d: string;
}

interface FleetCapabilitySummary {
  capability: string;
  confirmedRevenueTomi: string;
  confirmedCostTomi: string;
  pendingRevenueTomi: string;
  pendingCostTomi: string;
}

interface FleetCustomerSummary {
  address: string;
  kind: "customer" | "provider";
  confirmedRevenueTomi: string;
  confirmedCostTomi: string;
  pendingRevenueTomi: string;
  pendingCostTomi: string;
  interactions: number;
}

export interface FleetFinanceSummary {
  totals: {
    revenueTomi30d: string;
    costTomi30d: string;
    netTomi30d: string;
    pendingReceivablesTomi: string;
    pendingPayablesTomi: string;
  };
  roles: FleetFinanceRoleSummary[];
  nodes: FleetFinanceNodeSummary[];
  capabilities: FleetCapabilitySummary[];
  customers: FleetCustomerSummary[];
  delayedQueues: {
    settlementPending: number;
    settlementFailed: number;
    marketPending: number;
    marketFailed: number;
  };
  warnings: string[];
}

export interface FleetDashboardSnapshot {
  generatedAt: string;
  manifestPath: string;
  nodeCount: number;
  roles: Record<string, number>;
  endpointSummaries: Array<{
    endpoint: FleetEndpoint;
    total: number;
    ok: number;
    failed: number;
  }>;
  failingEndpoints: FleetEndpoint[];
  snapshots: Record<FleetEndpoint, FleetSnapshot>;
  financeSummary: FleetFinanceSummary;
  incidents: FleetIncidentSnapshot;
}

export interface FleetDashboardBundleResult {
  outputPath: string;
  manifestCopyPath: string;
  lintPath: string;
  jsonPath: string;
  htmlPath: string;
  controlEventsPath: string;
  autopilotPath: string;
  approvalsPath: string;
  incidentsPath: string;
  snapshot: FleetDashboardSnapshot;
}

interface FleetAuditBundleSnapshot {
  generatedAt: string;
  manifestPath: string;
  path: string;
  total: number;
  ok: number;
  failed: number;
  nodes: Array<{
    name: string;
    role: string | null;
    baseUrl: string;
    ok: boolean;
    statusCode?: number;
    payload?: unknown;
    error?: string;
  }>;
}

function summarizeRoles(manifestPath: string): {
  nodeCount: number;
  roles: Record<string, number>;
} {
  const manifest = loadFleetManifest(manifestPath);
  const roles: Record<string, number> = {};
  for (const node of manifest.nodes) {
    const role = node.role || "unspecified";
    roles[role] = (roles[role] || 0) + 1;
  }
  return {
    nodeCount: manifest.nodes.length,
    roles,
  };
}

function summaryString(snapshot: FleetSnapshot): string {
  return `${snapshot.ok}/${snapshot.total} healthy`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function payloadSummary(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  if (
    "summary" in payload &&
    typeof (payload as { summary?: unknown }).summary === "string"
  ) {
    return (payload as { summary: string }).summary;
  }
  return JSON.stringify(payload);
}

async function fetchAuditNode(
  params: {
    name: string;
    role?: string;
    baseUrl: string;
    authToken?: string;
  },
  requestPath: string,
): Promise<FleetAuditBundleSnapshot["nodes"][number]> {
  const url = `${params.baseUrl.replace(/\/+$/, "")}/${requestPath.replace(/^\/+/, "")}`;
  try {
    const response = await fetch(url, {
      headers: params.authToken
        ? {
            Authorization: `Bearer ${params.authToken}`,
          }
        : undefined,
    });
    const text = await response.text();
    let payload: unknown = text;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      // keep raw text payload
    }
    return {
      name: params.name,
      role: params.role || null,
      baseUrl: params.baseUrl,
      ok: response.ok,
      statusCode: response.status,
      payload,
      error: response.ok ? undefined : `HTTP ${response.status}`,
    };
  } catch (error) {
    return {
      name: params.name,
      role: params.role || null,
      baseUrl: params.baseUrl,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function buildFleetAuditBundleSnapshot(params: {
  manifestPath: string;
  requestPath: string;
}): Promise<FleetAuditBundleSnapshot> {
  const manifestPath = path.resolve(params.manifestPath);
  const manifest = loadFleetManifest(manifestPath);
  const nodes = await Promise.all(
    manifest.nodes.map((node) =>
      fetchAuditNode(
        {
          name: node.name,
          role: node.role,
          baseUrl: node.baseUrl,
          authToken: node.authToken,
        },
        params.requestPath,
      ),
    ),
  );
  const ok = nodes.filter((node) => node.ok).length;
  return {
    generatedAt: new Date().toISOString(),
    manifestPath,
    path: params.requestPath,
    total: nodes.length,
    ok,
    failed: nodes.length - ok,
    nodes,
  };
}

function toBigInt(value: string | bigint | null | undefined): bigint {
  if (typeof value === "bigint") return value;
  if (!value) return 0n;
  return BigInt(value);
}

function formatTOS(value: bigint): string {
  const sign = value < 0n ? "-" : "";
  const abs = value < 0n ? -value : value;
  const whole = abs / 10n ** 18n;
  const fraction = abs % 10n ** 18n;
  if (fraction === 0n) return `${sign}${whole.toString()} TOS`;
  const decimals = fraction.toString().padStart(18, "0").replace(/0+$/, "");
  return `${sign}${whole.toString()}.${decimals.slice(0, 6)} TOS`;
}

function buildFleetFinanceSummary(
  snapshots: Record<FleetEndpoint, FleetSnapshot>,
): FleetFinanceSummary {
  const roleMap = new Map<string, { nodes: number; revenueTomi30d: bigint; costTomi30d: bigint; netTomi30d: bigint }>();
  const capabilityMap = new Map<string, { confirmedRevenueTomi: bigint; confirmedCostTomi: bigint; pendingRevenueTomi: bigint; pendingCostTomi: bigint }>();
  const customerMap = new Map<string, { address: string; kind: "customer" | "provider"; confirmedRevenueTomi: bigint; confirmedCostTomi: bigint; pendingRevenueTomi: bigint; pendingCostTomi: bigint; interactions: number }>();
  const nodeSummaries: FleetFinanceNodeSummary[] = [];
  const warnings: string[] = [];
  let revenueTomi30d = 0n;
  let costTomi30d = 0n;
  let netTomi30d = 0n;
  let pendingReceivablesTomi = 0n;
  let pendingPayablesTomi = 0n;
  let settlementPending = 0;
  let settlementFailed = 0;
  let marketPending = 0;
  let marketFailed = 0;

  for (const node of snapshots.finance?.nodes ?? []) {
    if (!node.ok || typeof node.payload !== "object" || node.payload === null) continue;
    const payload = node.payload as {
      periods?: { trailing30d?: { revenueTomi?: string; costTomi?: string; netTomi?: string } };
      pendingReceivablesTomi?: string;
      pendingPayablesTomi?: string;
    };
    const period = payload.periods?.trailing30d;
    const nodeRevenue = toBigInt(period?.revenueTomi);
    const nodeCost = toBigInt(period?.costTomi);
    const nodeNet = toBigInt(period?.netTomi);
    const nodeReceivables = toBigInt(payload.pendingReceivablesTomi);
    const nodePayables = toBigInt(payload.pendingPayablesTomi);
    revenueTomi30d += nodeRevenue;
    costTomi30d += nodeCost;
    netTomi30d += nodeNet;
    pendingReceivablesTomi += nodeReceivables;
    pendingPayablesTomi += nodePayables;
    nodeSummaries.push({
      name: node.name,
      role: node.role,
      revenueTomi30d: nodeRevenue.toString(),
      costTomi30d: nodeCost.toString(),
      netTomi30d: nodeNet.toString(),
      pendingReceivablesTomi: nodeReceivables.toString(),
      pendingPayablesTomi: nodePayables.toString(),
      negativeMargin: nodeNet < 0n,
    });
    const roleKey = node.role || "unspecified";
    const roleEntry = roleMap.get(roleKey) ?? {
      nodes: 0,
      revenueTomi30d: 0n,
      costTomi30d: 0n,
      netTomi30d: 0n,
    };
    roleEntry.nodes += 1;
    roleEntry.revenueTomi30d += nodeRevenue;
    roleEntry.costTomi30d += nodeCost;
    roleEntry.netTomi30d += nodeNet;
    roleMap.set(roleKey, roleEntry);
    if (nodeNet < 0n) {
      warnings.push(`${node.name}${node.role ? ` [${node.role}]` : ""} has negative 30d margin.`);
    }
  }

  for (const node of snapshots.payments?.nodes ?? []) {
    if (!node.ok || typeof node.payload !== "object" || node.payload === null) continue;
    const payload = node.payload as {
      capabilities?: Array<{
        capability: string;
        confirmedRevenueTomi: string;
        confirmedCostTomi: string;
        pendingRevenueTomi: string;
        pendingCostTomi: string;
      }>;
      counterparties?: Array<{
        address: string;
        kind: "customer" | "provider";
        confirmedRevenueTomi: string;
        confirmedCostTomi: string;
        pendingRevenueTomi: string;
        pendingCostTomi: string;
        confirmedCount: number;
        pendingCount: number;
      }>;
    };
    for (const entry of payload.capabilities ?? []) {
      const current = capabilityMap.get(entry.capability) ?? {
        confirmedRevenueTomi: 0n,
        confirmedCostTomi: 0n,
        pendingRevenueTomi: 0n,
        pendingCostTomi: 0n,
      };
      current.confirmedRevenueTomi += toBigInt(entry.confirmedRevenueTomi);
      current.confirmedCostTomi += toBigInt(entry.confirmedCostTomi);
      current.pendingRevenueTomi += toBigInt(entry.pendingRevenueTomi);
      current.pendingCostTomi += toBigInt(entry.pendingCostTomi);
      capabilityMap.set(entry.capability, current);
    }
    for (const entry of payload.counterparties ?? []) {
      const key = `${entry.kind}:${entry.address}`;
      const current = customerMap.get(key) ?? {
        address: entry.address,
        kind: entry.kind,
        confirmedRevenueTomi: 0n,
        confirmedCostTomi: 0n,
        pendingRevenueTomi: 0n,
        pendingCostTomi: 0n,
        interactions: 0,
      };
      current.confirmedRevenueTomi += toBigInt(entry.confirmedRevenueTomi);
      current.confirmedCostTomi += toBigInt(entry.confirmedCostTomi);
      current.pendingRevenueTomi += toBigInt(entry.pendingRevenueTomi);
      current.pendingCostTomi += toBigInt(entry.pendingCostTomi);
      current.interactions += (entry.confirmedCount ?? 0) + (entry.pendingCount ?? 0);
      customerMap.set(key, current);
    }
  }

  for (const node of snapshots.settlement?.nodes ?? []) {
    if (!node.ok || typeof node.payload !== "object" || node.payload === null) continue;
    const payload = node.payload as { callbackPending?: number; callbackFailed?: number };
    settlementPending += payload.callbackPending ?? 0;
    settlementFailed += payload.callbackFailed ?? 0;
  }
  for (const node of snapshots.market?.nodes ?? []) {
    if (!node.ok || typeof node.payload !== "object" || node.payload === null) continue;
    const payload = node.payload as { callbackPending?: number; callbackFailed?: number };
    marketPending += payload.callbackPending ?? 0;
    marketFailed += payload.callbackFailed ?? 0;
  }
  if (settlementPending > 0 || settlementFailed > 0) {
    warnings.push(`Settlement callbacks are delaying revenue recognition (pending=${settlementPending}, failed=${settlementFailed}).`);
  }
  if (marketPending > 0 || marketFailed > 0) {
    warnings.push(`Market callbacks are delaying contract binding visibility (pending=${marketPending}, failed=${marketFailed}).`);
  }

  return {
    totals: {
      revenueTomi30d: revenueTomi30d.toString(),
      costTomi30d: costTomi30d.toString(),
      netTomi30d: netTomi30d.toString(),
      pendingReceivablesTomi: pendingReceivablesTomi.toString(),
      pendingPayablesTomi: pendingPayablesTomi.toString(),
    },
    roles: Array.from(roleMap.entries())
      .map(([role, entry]) => ({
        role,
        nodes: entry.nodes,
        revenueTomi30d: entry.revenueTomi30d.toString(),
        costTomi30d: entry.costTomi30d.toString(),
        netTomi30d: entry.netTomi30d.toString(),
      }))
      .sort((a, b) => (toBigInt(b.netTomi30d) > toBigInt(a.netTomi30d) ? 1 : -1)),
    nodes: nodeSummaries.sort((a, b) => (toBigInt(b.netTomi30d) > toBigInt(a.netTomi30d) ? 1 : -1)),
    capabilities: Array.from(capabilityMap.entries())
      .map(([capability, entry]) => ({
        capability,
        confirmedRevenueTomi: entry.confirmedRevenueTomi.toString(),
        confirmedCostTomi: entry.confirmedCostTomi.toString(),
        pendingRevenueTomi: entry.pendingRevenueTomi.toString(),
        pendingCostTomi: entry.pendingCostTomi.toString(),
      }))
      .sort((a, b) =>
        toBigInt(b.confirmedRevenueTomi) + toBigInt(b.pendingRevenueTomi) >
        toBigInt(a.confirmedRevenueTomi) + toBigInt(a.pendingRevenueTomi)
          ? 1
          : -1,
      )
      .slice(0, 10),
    customers: Array.from(customerMap.values())
      .map((entry) => ({
        address: entry.address,
        kind: entry.kind,
        confirmedRevenueTomi: entry.confirmedRevenueTomi.toString(),
        confirmedCostTomi: entry.confirmedCostTomi.toString(),
        pendingRevenueTomi: entry.pendingRevenueTomi.toString(),
        pendingCostTomi: entry.pendingCostTomi.toString(),
        interactions: entry.interactions,
      }))
      .sort((a, b) =>
        toBigInt(b.confirmedRevenueTomi) + toBigInt(b.pendingRevenueTomi) + toBigInt(b.confirmedCostTomi) + toBigInt(b.pendingCostTomi) >
        toBigInt(a.confirmedRevenueTomi) + toBigInt(a.pendingRevenueTomi) + toBigInt(a.confirmedCostTomi) + toBigInt(a.pendingCostTomi)
          ? 1
          : -1,
      )
      .slice(0, 10),
    delayedQueues: {
      settlementPending,
      settlementFailed,
      marketPending,
      marketFailed,
    },
    warnings,
  };
}

export async function buildFleetDashboardSnapshot(params: {
  manifestPath: string;
  endpoints?: FleetEndpoint[];
}): Promise<FleetDashboardSnapshot> {
  const manifestPath = path.resolve(params.manifestPath);
  const endpoints = params.endpoints ?? DEFAULT_DASHBOARD_ENDPOINTS;
  const roleSummary = summarizeRoles(manifestPath);
  const snapshotEntries = await Promise.all(
    endpoints.map(async (endpoint) => {
      const snapshot = await buildFleetSnapshot({
        manifestPath,
        endpoint,
      });
      return [endpoint, snapshot] as const;
    }),
  );
  const snapshots = Object.fromEntries(snapshotEntries) as Record<
    FleetEndpoint,
    FleetSnapshot
  >;
  const incidents = await buildFleetIncidentSnapshot({ manifestPath });
  const endpointSummaries = endpoints.map((endpoint) => ({
    endpoint,
    total: snapshots[endpoint].total,
    ok: snapshots[endpoint].ok,
    failed: snapshots[endpoint].failed,
  }));
  return {
    generatedAt: new Date().toISOString(),
    manifestPath,
    nodeCount: roleSummary.nodeCount,
    roles: roleSummary.roles,
    endpointSummaries,
    failingEndpoints: endpointSummaries
      .filter((entry) => entry.failed > 0)
      .map((entry) => entry.endpoint),
    snapshots,
    financeSummary: buildFleetFinanceSummary(snapshots),
    incidents,
  };
}

export function buildFleetDashboardReport(
  snapshot: FleetDashboardSnapshot,
): string {
  const lines = [
    "=== OPENFOX DASHBOARD ===",
    `Generated: ${snapshot.generatedAt}`,
    `Manifest:  ${snapshot.manifestPath}`,
    `Nodes:     ${snapshot.nodeCount}`,
    `Roles:     ${Object.entries(snapshot.roles)
      .map(([role, count]) => `${role}=${count}`)
      .join(", ")}`,
    "",
    "Endpoint Summary:",
  ];
  for (const entry of snapshot.endpointSummaries) {
    lines.push(
      `- ${entry.endpoint}: ${entry.ok}/${entry.total} healthy${
        entry.failed ? `, failed=${entry.failed}` : ""
      }`,
    );
  }
  if (snapshot.failingEndpoints.length) {
    lines.push("");
    lines.push(`Failing endpoints: ${snapshot.failingEndpoints.join(", ")}`);
  }
  lines.push("");
  lines.push(
    `Fleet finance: 30d revenue=${formatTOS(toBigInt(snapshot.financeSummary.totals.revenueTomi30d))}, cost=${formatTOS(toBigInt(snapshot.financeSummary.totals.costTomi30d))}, net=${formatTOS(toBigInt(snapshot.financeSummary.totals.netTomi30d))}`,
  );
  if (snapshot.financeSummary.warnings.length) {
    lines.push("Warnings:");
    for (const warning of snapshot.financeSummary.warnings) {
      lines.push(`- ${warning}`);
    }
  }
  lines.push("");
  lines.push(
    `Incidents: ${snapshot.incidents.total} total (${snapshot.incidents.critical} critical, ${snapshot.incidents.warning} warning)`,
  );
  return lines.join("\n");
}

export function buildFleetDashboardHtml(
  snapshot: FleetDashboardSnapshot,
): string {
  const roleRows = Object.entries(snapshot.roles)
    .map(
      ([role, count]) =>
        `<tr><td>${escapeHtml(role)}</td><td>${count}</td></tr>`,
    )
    .join("");
  const endpointRows = snapshot.endpointSummaries
    .map(
      (entry) =>
        `<tr><td>${escapeHtml(entry.endpoint)}</td><td>${entry.ok}</td><td>${entry.failed}</td><td>${entry.total}</td></tr>`,
    )
    .join("");
  const financeRows = snapshot.financeSummary.roles
    .map(
      (entry) =>
        `<tr><td>${escapeHtml(entry.role)}</td><td>${entry.nodes}</td><td>${escapeHtml(formatTOS(toBigInt(entry.revenueTomi30d)))}</td><td>${escapeHtml(formatTOS(toBigInt(entry.costTomi30d)))}</td><td>${escapeHtml(formatTOS(toBigInt(entry.netTomi30d)))}</td></tr>`,
    )
    .join("");
  const capabilityRows = snapshot.financeSummary.capabilities
    .map(
      (entry) =>
        `<tr><td>${escapeHtml(entry.capability)}</td><td>${escapeHtml(formatTOS(toBigInt(entry.confirmedRevenueTomi)))}</td><td>${escapeHtml(formatTOS(toBigInt(entry.confirmedCostTomi)))}</td><td>${escapeHtml(formatTOS(toBigInt(entry.pendingRevenueTomi)))}</td><td>${escapeHtml(formatTOS(toBigInt(entry.pendingCostTomi)))}</td></tr>`,
    )
    .join("");
  const customerRows = snapshot.financeSummary.customers
    .map(
      (entry) =>
        `<tr><td>${escapeHtml(entry.kind)}</td><td>${escapeHtml(entry.address)}</td><td>${escapeHtml(formatTOS(toBigInt(entry.confirmedRevenueTomi)))}</td><td>${escapeHtml(formatTOS(toBigInt(entry.confirmedCostTomi)))}</td><td>${escapeHtml(formatTOS(toBigInt(entry.pendingRevenueTomi) + toBigInt(entry.pendingCostTomi)))}</td><td>${entry.interactions}</td></tr>`,
    )
    .join("");
  const warningItems = snapshot.financeSummary.warnings
    .map((warning) => `<li>${escapeHtml(warning)}</li>`)
    .join("");
  const incidentItems = snapshot.incidents.entries
    .slice(0, 10)
    .map(
      (entry) =>
        `<li><strong>${escapeHtml(entry.severity)}</strong> ${escapeHtml(entry.node)}: ${escapeHtml(entry.summary)}</li>`,
    )
    .join("");
  const sections = snapshot.endpointSummaries.map(({ endpoint }) => {
    const section = snapshot.snapshots[endpoint];
    if (!section) return "";
    const rows = section.nodes
      .map((node) => {
        const summary = payloadSummary(node.payload);
        return `<tr>
  <td>${escapeHtml(node.name)}</td>
  <td>${escapeHtml(node.role || "")}</td>
  <td>${node.ok ? "ok" : "failed"}</td>
  <td>${escapeHtml(node.baseUrl)}</td>
  <td>${escapeHtml(summary || node.error || "")}</td>
</tr>`;
      })
      .join("");
    return `<section>
  <h2>${escapeHtml(endpoint)} (${escapeHtml(summaryString(section))})</h2>
  <table>
    <thead><tr><th>Node</th><th>Role</th><th>Status</th><th>Base URL</th><th>Summary</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
</section>`;
  }).join("");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>OpenFox Fleet Dashboard</title>
  <style>
    body { font-family: sans-serif; margin: 24px; color: #111; }
    h1, h2 { margin-bottom: 8px; }
    table { border-collapse: collapse; width: 100%; margin-bottom: 24px; }
    th, td { border: 1px solid #ddd; padding: 8px; text-align: left; vertical-align: top; }
    thead { background: #f5f5f5; }
    .meta { margin-bottom: 16px; color: #444; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 24px; }
  </style>
</head>
<body>
  <h1>OpenFox Fleet Dashboard</h1>
  <div class="meta">
    <div><strong>Generated:</strong> ${escapeHtml(snapshot.generatedAt)}</div>
    <div><strong>Manifest:</strong> ${escapeHtml(snapshot.manifestPath)}</div>
    <div><strong>Nodes:</strong> ${snapshot.nodeCount}</div>
    <div><strong>Failing endpoints:</strong> ${escapeHtml(snapshot.failingEndpoints.join(", ") || "none")}</div>
  </div>
  <div class="grid">
    <section>
      <h2>Roles</h2>
      <table>
        <thead><tr><th>Role</th><th>Count</th></tr></thead>
        <tbody>${roleRows}</tbody>
      </table>
    </section>
    <section>
      <h2>Endpoint Summary</h2>
      <table>
        <thead><tr><th>Endpoint</th><th>Healthy</th><th>Failed</th><th>Total</th></tr></thead>
        <tbody>${endpointRows}</tbody>
      </table>
    </section>
    <section>
      <h2>Fleet Finance</h2>
      <table>
        <thead><tr><th>30d Revenue</th><th>30d Cost</th><th>30d Net</th><th>Pending Receivables</th><th>Pending Payables</th></tr></thead>
        <tbody><tr>
          <td>${escapeHtml(formatTOS(toBigInt(snapshot.financeSummary.totals.revenueTomi30d)))}</td>
          <td>${escapeHtml(formatTOS(toBigInt(snapshot.financeSummary.totals.costTomi30d)))}</td>
          <td>${escapeHtml(formatTOS(toBigInt(snapshot.financeSummary.totals.netTomi30d)))}</td>
          <td>${escapeHtml(formatTOS(toBigInt(snapshot.financeSummary.totals.pendingReceivablesTomi)))}</td>
          <td>${escapeHtml(formatTOS(toBigInt(snapshot.financeSummary.totals.pendingPayablesTomi)))}</td>
        </tr></tbody>
      </table>
      <div><strong>Delayed queues:</strong> settlement pending=${snapshot.financeSummary.delayedQueues.settlementPending}, settlement failed=${snapshot.financeSummary.delayedQueues.settlementFailed}, market pending=${snapshot.financeSummary.delayedQueues.marketPending}, market failed=${snapshot.financeSummary.delayedQueues.marketFailed}</div>
      ${
        warningItems
          ? `<div><strong>Warnings</strong><ul>${warningItems}</ul></div>`
          : ""
      }
      <div><strong>Incidents:</strong> ${snapshot.incidents.total} total (${snapshot.incidents.critical} critical, ${snapshot.incidents.warning} warning)</div>
      ${
        incidentItems
          ? `<div><strong>Top Incidents</strong><ul>${incidentItems}</ul></div>`
          : ""
      }
    </section>
  </div>
  <section>
    <h2>Role Margin Breakdown</h2>
    <table>
      <thead><tr><th>Role</th><th>Nodes</th><th>30d Revenue</th><th>30d Cost</th><th>30d Net</th></tr></thead>
      <tbody>${financeRows}</tbody>
    </table>
  </section>
  <section>
    <h2>Capability Breakdown</h2>
    <table>
      <thead><tr><th>Capability</th><th>Confirmed Revenue</th><th>Confirmed Cost</th><th>Pending Revenue</th><th>Pending Cost</th></tr></thead>
      <tbody>${capabilityRows}</tbody>
    </table>
  </section>
  <section>
    <h2>Top Counterparties</h2>
    <table>
      <thead><tr><th>Kind</th><th>Address</th><th>Confirmed Revenue</th><th>Confirmed Cost</th><th>Pending Exposure</th><th>Interactions</th></tr></thead>
      <tbody>${customerRows}</tbody>
    </table>
  </section>
  ${sections}
</body>
</html>`;
}

export async function exportFleetDashboard(params: {
  manifestPath: string;
  outputPath: string;
  format: "json" | "html";
}): Promise<FleetDashboardSnapshot> {
  const snapshot = await buildFleetDashboardSnapshot({
    manifestPath: params.manifestPath,
  });
  const outputPath = path.resolve(params.outputPath);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const content =
    params.format === "html"
      ? buildFleetDashboardHtml(snapshot)
      : JSON.stringify(snapshot, null, 2);
  fs.writeFileSync(outputPath, content, "utf8");
  return snapshot;
}

export async function exportFleetDashboardBundle(params: {
  manifestPath: string;
  outputPath: string;
  force?: boolean;
}): Promise<FleetDashboardBundleResult> {
  const manifestPath = path.resolve(params.manifestPath);
  const outputPath = path.resolve(params.outputPath);
  if (fs.existsSync(outputPath)) {
    if (!params.force) {
      throw new Error(
        `Output path already exists: ${outputPath}. Re-run with --force to overwrite.`,
      );
    }
    fs.rmSync(outputPath, { recursive: true, force: true });
  }
  fs.mkdirSync(outputPath, { recursive: true });

  const manifestCopyPath = path.join(outputPath, path.basename(manifestPath));
  fs.copyFileSync(manifestPath, manifestCopyPath);

  const snapshot = await buildFleetDashboardSnapshot({ manifestPath });
  const lint = buildFleetLintSnapshot({ manifestPath });
  const controlEvents = await buildFleetAuditBundleSnapshot({
    manifestPath,
    requestPath: "control/events?limit=100",
  });
  const autopilot = await buildFleetAuditBundleSnapshot({
    manifestPath,
    requestPath: "autopilot/status",
  });
  const approvals = await buildFleetAuditBundleSnapshot({
    manifestPath,
    requestPath: "autopilot/approvals?limit=100",
  });
  const jsonPath = path.join(outputPath, "dashboard.json");
  const htmlPath = path.join(outputPath, "dashboard.html");
  const lintPath = path.join(outputPath, "fleet-lint.json");
  const controlEventsPath = path.join(outputPath, "control-events.json");
  const autopilotPath = path.join(outputPath, "autopilot.json");
  const approvalsPath = path.join(outputPath, "approvals.json");
  const incidentsPath = path.join(outputPath, "incidents.json");

  fs.writeFileSync(jsonPath, JSON.stringify(snapshot, null, 2), "utf8");
  fs.writeFileSync(htmlPath, buildFleetDashboardHtml(snapshot), "utf8");
  fs.writeFileSync(lintPath, JSON.stringify(lint, null, 2), "utf8");
  fs.writeFileSync(
    controlEventsPath,
    JSON.stringify(controlEvents, null, 2),
    "utf8",
  );
  fs.writeFileSync(autopilotPath, JSON.stringify(autopilot, null, 2), "utf8");
  fs.writeFileSync(approvalsPath, JSON.stringify(approvals, null, 2), "utf8");
  fs.writeFileSync(incidentsPath, JSON.stringify(snapshot.incidents, null, 2), "utf8");

  return {
    outputPath,
    manifestCopyPath,
    lintPath,
    jsonPath,
    htmlPath,
    controlEventsPath,
    autopilotPath,
    approvalsPath,
    incidentsPath,
    snapshot,
  };
}
