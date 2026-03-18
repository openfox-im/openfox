import fs from "fs";
import path from "path";
import YAML from "yaml";

export interface FleetNodeManifest {
  name: string;
  role?: string;
  baseUrl: string;
  authToken?: string;
}

const VALID_FLEET_ROLES = new Set([
  "gateway",
  "host",
  "solver",
  "scout",
  "provider",
  "payments",
  "storage",
  "artifacts",
  "signer",
  "paymaster",
  "signer-paymaster",
]);

export interface FleetManifest {
  version: number;
  nodes: FleetNodeManifest[];
}

export interface FleetNodeResult {
  name: string;
  role: string | null;
  baseUrl: string;
  ok: boolean;
  statusCode?: number;
  payload?: unknown;
  error?: string;
}

export type FleetEndpoint =
  | "status"
  | "health"
  | "doctor"
  | "service"
  | "gateway"
  | "control"
  | "autopilot"
  | "wallet"
  | "finance"
  | "payments"
  | "settlement"
  | "market"
  | "storage"
  | "lease-health"
  | "artifacts"
  | "signer"
  | "paymaster"
  | "providers"
  | "reconciliation"
  | "provider-liveness";

export interface FleetSnapshot {
  manifestPath: string;
  endpoint: FleetEndpoint;
  total: number;
  ok: number;
  failed: number;
  nodes: FleetNodeResult[];
}

export type FleetRepairComponent = "storage" | "artifacts" | "replication";

export type FleetReconciliationKind =
  | "lease"
  | "audit"
  | "renewal"
  | "replication";

export interface FleetReconciliationEntry {
  node: string;
  role: string | null;
  kind: FleetReconciliationKind;
  total: number;
  healthy: number;
  warning: number;
  critical: number;
  details: Record<string, number>;
}

export interface FleetReconciliationSnapshot {
  manifestPath: string;
  generatedAt: string;
  total: number;
  ok: number;
  failed: number;
  entries: FleetReconciliationEntry[];
  nodes: FleetNodeResult[];
  summary: string;
}

export type FleetProviderLivenessState = "alive" | "degraded" | "unreachable";

export interface FleetProviderLivenessEntry {
  node: string;
  role: string | null;
  providerKind: string;
  state: FleetProviderLivenessState;
  failureDomain: string | null;
  degradedRoutes: string[];
  lastSeenAt: string | null;
  latencyMs: number | null;
}

export interface FleetProviderLivenessSnapshot {
  manifestPath: string;
  generatedAt: string;
  total: number;
  alive: number;
  degraded: number;
  unreachable: number;
  failureDomains: Record<string, number>;
  entries: FleetProviderLivenessEntry[];
  nodes: FleetNodeResult[];
  summary: string;
}

export type FleetRecoveryKind =
  | "replication"
  | "provider_route"
  | "callback_queue";

export type FleetRecoveryStatus = "recovered" | "partial" | "failed" | "skipped";

export interface FleetRecoveryEntry {
  node: string;
  role: string | null;
  kind: FleetRecoveryKind;
  status: FleetRecoveryStatus;
  attempted: number;
  recovered: number;
  failed: number;
  details: Record<string, unknown>;
}

export interface FleetRecoverySnapshot {
  manifestPath: string;
  generatedAt: string;
  kind: FleetRecoveryKind;
  total: number;
  ok: number;
  failed: number;
  entries: FleetRecoveryEntry[];
  nodes: FleetNodeResult[];
  summary: string;
}

export interface FleetRepairSnapshot {
  manifestPath: string;
  component: FleetRepairComponent;
  total: number;
  ok: number;
  failed: number;
  nodes: FleetNodeResult[];
}

export type FleetControlAction = "pause" | "resume" | "drain";
export type FleetRetryQueue =
  | "payments"
  | "settlement"
  | "market"
  | "signer"
  | "paymaster";

export interface FleetControlSnapshot {
  manifestPath: string;
  action: FleetControlAction;
  targetNode: string | null;
  total: number;
  ok: number;
  failed: number;
  nodes: FleetNodeResult[];
}

export interface FleetQueueRetrySnapshot {
  manifestPath: string;
  queue: FleetRetryQueue;
  targetNode: string | null;
  total: number;
  ok: number;
  failed: number;
  nodes: FleetNodeResult[];
}

export interface FleetLintIssue {
  node: string;
  role: string | null;
  severity: "error" | "warning";
  code:
    | "duplicate_name"
    | "duplicate_base_url"
    | "missing_auth_token"
    | "placeholder_auth_token"
    | "placeholder_base_url"
    | "non_https_base_url"
    | "missing_role"
    | "invalid_role"
    | "missing_gateway_role"
    | "missing_host_role"
    | "missing_provider_role";
  message: string;
}

export interface FleetLintSnapshot {
  manifestPath: string;
  total: number;
  errors: number;
  warnings: number;
  issues: FleetLintIssue[];
}

export interface FleetBundleSnapshot {
  bundlePath: string;
  exists: boolean;
  manifestPath: string | null;
  dashboardPath: string | null;
  lintPath: string | null;
  controlEventsPath: string | null;
  autopilotPath: string | null;
  approvalsPath: string | null;
  incidentsPath: string | null;
  manifest: {
    version: number | null;
    nodeCount: number;
    roles: Record<string, number>;
  } | null;
  dashboard: {
    generatedAt: string | null;
    nodeCount: number;
    failingEndpoints: string[];
  } | null;
  lint: {
    errors: number;
    warnings: number;
  } | null;
  incidents: {
    total: number;
    critical: number;
    warning: number;
  } | null;
}

function getEndpointPath(endpoint: FleetEndpoint): string {
  switch (endpoint) {
    case "status":
    case "health":
    case "doctor":
      return endpoint;
    case "service":
      return "service/status";
    case "gateway":
      return "gateway/status";
    case "control":
      return "control/status";
    case "autopilot":
      return "autopilot/status";
    case "wallet":
      return "wallet/status";
    case "finance":
      return "finance/status";
    case "payments":
      return "payments/status";
    case "settlement":
      return "settlement/status";
    case "market":
      return "market/status";
    case "storage":
      return "storage/status";
    case "lease-health":
      return "storage/lease-health";
    case "artifacts":
      return "artifacts/status";
    case "signer":
      return "signer/status";
    case "paymaster":
      return "paymaster/status";
    case "providers":
      return "providers/reputation";
    case "reconciliation":
      return "fleet/reconciliation";
    case "provider-liveness":
      return "fleet/provider-liveness";
  }
}

function readManifest(filePath: string): unknown {
  const raw = fs.readFileSync(filePath, "utf8");
  if (filePath.endsWith(".yml") || filePath.endsWith(".yaml")) {
    return YAML.parse(raw);
  }
  return JSON.parse(raw);
}

export function loadFleetManifest(filePath: string): FleetManifest {
  const manifestPath = path.resolve(filePath);
  const raw = readManifest(manifestPath) as Record<string, unknown> | null;
  if (!raw || typeof raw !== "object") {
    throw new Error(`Invalid fleet manifest: ${manifestPath}`);
  }
  const nodes = Array.isArray(raw.nodes) ? raw.nodes : [];
  const parsedNodes = nodes
    .filter(
      (entry): entry is Record<string, unknown> =>
        typeof entry === "object" &&
        entry !== null &&
        typeof entry.name === "string" &&
        typeof entry.baseUrl === "string",
    )
    .map((entry) => ({
      name: (entry.name as string).trim(),
      role:
        typeof entry.role === "string" && entry.role.trim()
          ? entry.role.trim()
          : undefined,
      baseUrl: (entry.baseUrl as string).replace(/\/+$/, ""),
      authToken:
        typeof entry.authToken === "string" && entry.authToken.trim()
          ? entry.authToken.trim()
          : undefined,
    }))
    .filter((entry) => entry.name && entry.baseUrl);

  if (parsedNodes.length === 0) {
    throw new Error(`Fleet manifest has no valid nodes: ${manifestPath}`);
  }

  return {
    version:
      typeof raw.version === "number" && Number.isFinite(raw.version)
        ? raw.version
        : 1,
    nodes: parsedNodes,
  };
}

async function fetchNodeEndpoint(
  node: FleetNodeManifest,
  endpoint: FleetEndpoint,
): Promise<FleetNodeResult> {
  const url = `${node.baseUrl}/${getEndpointPath(endpoint)}`;
  try {
    const response = await fetch(url, {
      headers: node.authToken
        ? {
            Authorization: `Bearer ${node.authToken}`,
          }
        : undefined,
    });
    const text = await response.text();
    let payload: unknown = text;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      // keep text payload
    }
    return {
      name: node.name,
      role: node.role || null,
      baseUrl: node.baseUrl,
      ok: response.ok,
      statusCode: response.status,
      payload,
      error: response.ok ? undefined : `HTTP ${response.status}`,
    };
  } catch (error) {
    return {
      name: node.name,
      role: node.role || null,
      baseUrl: node.baseUrl,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function invokeNodeAction(
  node: FleetNodeManifest,
  component: FleetRepairComponent,
  body: Record<string, unknown>,
): Promise<FleetNodeResult> {
  const url = `${node.baseUrl}/${component}/maintain`;
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(node.authToken
          ? {
              Authorization: `Bearer ${node.authToken}`,
            }
          : {}),
      },
      body: JSON.stringify(body),
    });
    const text = await response.text();
    let payload: unknown = text;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      // keep text payload
    }
    return {
      name: node.name,
      role: node.role || null,
      baseUrl: node.baseUrl,
      ok: response.ok,
      statusCode: response.status,
      payload,
      error: response.ok ? undefined : `HTTP ${response.status}`,
    };
  } catch (error) {
    return {
      name: node.name,
      role: node.role || null,
      baseUrl: node.baseUrl,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function invokeNodeControlAction(
  node: FleetNodeManifest,
  pathSuffix: string,
  body: Record<string, unknown>,
): Promise<FleetNodeResult> {
  const url = `${node.baseUrl}/${pathSuffix}`;
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(node.authToken
          ? {
              Authorization: `Bearer ${node.authToken}`,
            }
          : {}),
      },
      body: JSON.stringify(body),
    });
    const text = await response.text();
    let payload: unknown = text;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      // keep text payload
    }
    return {
      name: node.name,
      role: node.role || null,
      baseUrl: node.baseUrl,
      ok: response.ok,
      statusCode: response.status,
      payload,
      error: response.ok ? undefined : `HTTP ${response.status}`,
    };
  } catch (error) {
    return {
      name: node.name,
      role: node.role || null,
      baseUrl: node.baseUrl,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function buildFleetSnapshot(params: {
  manifestPath: string;
  endpoint: FleetEndpoint;
}): Promise<FleetSnapshot> {
  const manifestPath = path.resolve(params.manifestPath);
  const manifest = loadFleetManifest(manifestPath);
  const nodes = await Promise.all(
    manifest.nodes.map((node) => fetchNodeEndpoint(node, params.endpoint)),
  );
  const ok = nodes.filter((node) => node.ok).length;
  return {
    manifestPath,
    endpoint: params.endpoint,
    total: nodes.length,
    ok,
    failed: nodes.length - ok,
    nodes,
  };
}

export async function buildFleetRepairSnapshot(params: {
  manifestPath: string;
  component: FleetRepairComponent;
  limit?: number;
}): Promise<FleetRepairSnapshot> {
  const manifestPath = path.resolve(params.manifestPath);
  const manifest = loadFleetManifest(manifestPath);
  const nodes = await Promise.all(
    manifest.nodes.map((node) =>
      invokeNodeAction(node, params.component, {
        ...(typeof params.limit === "number" ? { limit: params.limit } : {}),
      }),
    ),
  );
  const ok = nodes.filter((node) => node.ok).length;
  return {
    manifestPath,
    component: params.component,
    total: nodes.length,
    ok,
    failed: nodes.length - ok,
    nodes,
  };
}

export async function buildFleetControlSnapshot(params: {
  manifestPath: string;
  action: FleetControlAction;
  nodeName?: string;
  actor?: string;
  reason?: string;
}): Promise<FleetControlSnapshot> {
  const manifestPath = path.resolve(params.manifestPath);
  const manifest = loadFleetManifest(manifestPath);
  const targetNodes = params.nodeName
    ? manifest.nodes.filter((node) => node.name === params.nodeName)
    : manifest.nodes;
  if (targetNodes.length === 0) {
    throw new Error(
      params.nodeName
        ? `Fleet manifest does not contain node: ${params.nodeName}`
        : `Fleet manifest has no valid nodes: ${manifestPath}`,
    );
  }
  const pathSuffix = `control/${params.action}`;
  const nodes = await Promise.all(
    targetNodes.map((node) =>
      invokeNodeControlAction(node, pathSuffix, {
        ...(params.actor ? { actor: params.actor } : {}),
        ...(params.reason ? { reason: params.reason } : {}),
      }),
    ),
  );
  const ok = nodes.filter((node) => node.ok).length;
  return {
    manifestPath,
    action: params.action,
    targetNode: params.nodeName || null,
    total: nodes.length,
    ok,
    failed: nodes.length - ok,
    nodes,
  };
}

export async function buildFleetQueueRetrySnapshot(params: {
  manifestPath: string;
  queue: FleetRetryQueue;
  nodeName?: string;
  actor?: string;
  reason?: string;
  limit?: number;
}): Promise<FleetQueueRetrySnapshot> {
  const manifestPath = path.resolve(params.manifestPath);
  const manifest = loadFleetManifest(manifestPath);
  const targetNodes = params.nodeName
    ? manifest.nodes.filter((node) => node.name === params.nodeName)
    : manifest.nodes;
  if (targetNodes.length === 0) {
    throw new Error(
      params.nodeName
        ? `Fleet manifest does not contain node: ${params.nodeName}`
        : `Fleet manifest has no valid nodes: ${manifestPath}`,
    );
  }
  const pathSuffix = `control/retry/${params.queue}`;
  const nodes = await Promise.all(
    targetNodes.map((node) =>
      invokeNodeControlAction(node, pathSuffix, {
        ...(params.actor ? { actor: params.actor } : {}),
        ...(params.reason ? { reason: params.reason } : {}),
        ...(typeof params.limit === "number" ? { limit: params.limit } : {}),
      }),
    ),
  );
  const ok = nodes.filter((node) => node.ok).length;
  return {
    manifestPath,
    queue: params.queue,
    targetNode: params.nodeName || null,
    total: nodes.length,
    ok,
    failed: nodes.length - ok,
    nodes,
  };
}

export function buildFleetReport(snapshot: FleetSnapshot): string {
  const lines = [
    "=== OPENFOX FLEET ===",
    `Manifest:  ${snapshot.manifestPath}`,
    `Endpoint:  ${snapshot.endpoint}`,
    `Healthy:   ${snapshot.ok}/${snapshot.total}`,
    "",
  ];
  for (const node of snapshot.nodes) {
    const status = node.ok ? "ok" : "failed";
    const suffix = node.error
      ? ` (${node.error})`
      : node.statusCode
        ? ` (HTTP ${node.statusCode})`
        : "";
    const payloadSummary =
      typeof node.payload === "object" &&
      node.payload !== null &&
      typeof (node.payload as { summary?: unknown }).summary === "string"
        ? ((node.payload as { summary: string }).summary)
        : null;
    lines.push(`${node.name}${node.role ? ` [${node.role}]` : ""}: ${status} -> ${node.baseUrl}${suffix}`);
    if (payloadSummary) {
      lines.push(`  ${payloadSummary}`);
    }
  }
  return lines.join("\n");
}

export function buildFleetRepairReport(snapshot: FleetRepairSnapshot): string {
  const lines = [
    "=== OPENFOX FLEET REPAIR ===",
    `Manifest:  ${snapshot.manifestPath}`,
    `Component: ${snapshot.component}`,
    `Successful: ${snapshot.ok}/${snapshot.total}`,
    "",
  ];
  for (const node of snapshot.nodes) {
    const status = node.ok ? "ok" : "failed";
    const suffix = node.error
      ? ` (${node.error})`
      : node.statusCode
        ? ` (HTTP ${node.statusCode})`
        : "";
    const summary =
      typeof node.payload === "object" &&
      node.payload !== null &&
      "kind" in node.payload
        ? JSON.stringify(node.payload)
        : null;
    lines.push(`${node.name}${node.role ? ` [${node.role}]` : ""}: ${status} -> ${node.baseUrl}${suffix}`);
    if (summary) {
      lines.push(`  ${summary}`);
    }
  }
  return lines.join("\n");
}

export function buildFleetControlReport(snapshot: FleetControlSnapshot): string {
  const lines = [
    "=== OPENFOX FLEET CONTROL ===",
    `Manifest:  ${snapshot.manifestPath}`,
    `Action:    ${snapshot.action}`,
    `Node:      ${snapshot.targetNode || "all"}`,
    `Successful: ${snapshot.ok}/${snapshot.total}`,
    "",
  ];
  for (const node of snapshot.nodes) {
    const status = node.ok ? "ok" : "failed";
    const suffix = node.error
      ? ` (${node.error})`
      : node.statusCode
        ? ` (HTTP ${node.statusCode})`
        : "";
    const summary =
      typeof node.payload === "object" &&
      node.payload !== null &&
      typeof (node.payload as { summary?: unknown }).summary === "string"
        ? (node.payload as { summary: string }).summary
        : null;
    lines.push(`${node.name}${node.role ? ` [${node.role}]` : ""}: ${status} -> ${node.baseUrl}${suffix}`);
    if (summary) lines.push(`  ${summary}`);
  }
  return lines.join("\n");
}

export function buildFleetQueueRetryReport(snapshot: FleetQueueRetrySnapshot): string {
  const lines = [
    "=== OPENFOX FLEET RETRY ===",
    `Manifest:  ${snapshot.manifestPath}`,
    `Queue:     ${snapshot.queue}`,
    `Node:      ${snapshot.targetNode || "all"}`,
    `Successful: ${snapshot.ok}/${snapshot.total}`,
    "",
  ];
  for (const node of snapshot.nodes) {
    const status = node.ok ? "ok" : "failed";
    const suffix = node.error
      ? ` (${node.error})`
      : node.statusCode
        ? ` (HTTP ${node.statusCode})`
        : "";
    const summary =
      typeof node.payload === "object" &&
      node.payload !== null &&
      typeof (node.payload as { summary?: unknown }).summary === "string"
        ? (node.payload as { summary: string }).summary
        : null;
    lines.push(`${node.name}${node.role ? ` [${node.role}]` : ""}: ${status} -> ${node.baseUrl}${suffix}`);
    if (summary) lines.push(`  ${summary}`);
  }
  return lines.join("\n");
}

function isPlaceholderValue(value: string): boolean {
  const normalized = value.toLowerCase();
  return (
    normalized.includes("replace-me") ||
    normalized.includes("example.com") ||
    normalized.includes("placeholder")
  );
}

export function buildFleetLintSnapshot(params: {
  manifestPath: string;
}): FleetLintSnapshot {
  const manifestPath = path.resolve(params.manifestPath);
  const manifest = loadFleetManifest(manifestPath);
  const issues: FleetLintIssue[] = [];
  const seenNames = new Set<string>();
  const seenBaseUrls = new Set<string>();
  const roles = new Set<string>();

  for (const node of manifest.nodes) {
    const role = node.role || null;
    const nameKey = node.name.toLowerCase();
    const baseUrlKey = node.baseUrl.toLowerCase();

    if (seenNames.has(nameKey)) {
      issues.push({
        node: node.name,
        role,
        severity: "error",
        code: "duplicate_name",
        message: `duplicate fleet node name: ${node.name}`,
      });
    } else {
      seenNames.add(nameKey);
    }

    if (seenBaseUrls.has(baseUrlKey)) {
      issues.push({
        node: node.name,
        role,
        severity: "error",
        code: "duplicate_base_url",
        message: `duplicate fleet base URL: ${node.baseUrl}`,
      });
    } else {
      seenBaseUrls.add(baseUrlKey);
    }

    if (!node.role) {
      issues.push({
        node: node.name,
        role,
        severity: "warning",
        code: "missing_role",
        message: "node has no declared role",
      });
    } else if (!VALID_FLEET_ROLES.has(node.role)) {
      issues.push({
        node: node.name,
        role,
        severity: "error",
        code: "invalid_role",
        message: `node role is not a supported public-fleet role: ${node.role}`,
      });
    } else {
      roles.add(node.role);
    }

    if (!node.authToken) {
      issues.push({
        node: node.name,
        role,
        severity: "warning",
        code: "missing_auth_token",
        message: "node has no operator auth token configured",
      });
    } else if (isPlaceholderValue(node.authToken)) {
      issues.push({
        node: node.name,
        role,
        severity: "error",
        code: "placeholder_auth_token",
        message: "node still uses a placeholder auth token",
      });
    }

    if (isPlaceholderValue(node.baseUrl)) {
      issues.push({
        node: node.name,
        role,
        severity: "error",
        code: "placeholder_base_url",
        message: "node still uses a placeholder base URL",
      });
    } else if (!node.baseUrl.startsWith("https://") && !node.baseUrl.startsWith("http://127.0.0.1") && !node.baseUrl.startsWith("http://localhost")) {
      issues.push({
        node: node.name,
        role,
        severity: "warning",
        code: "non_https_base_url",
        message: "node base URL is not HTTPS",
      });
    }
  }

  if (!roles.has("gateway")) {
    issues.push({
      node: "<fleet>",
      role: null,
      severity: "warning",
      code: "missing_gateway_role",
      message: "fleet has no gateway role; public relay and ingress paths may be unavailable",
    });
  }

  if (!roles.has("host")) {
    issues.push({
      node: "<fleet>",
      role: null,
      severity: "warning",
      code: "missing_host_role",
      message: "fleet has no host role; hosted task and bounty surfaces may be unavailable",
    });
  }

  if (
    !roles.has("storage") &&
    !roles.has("artifacts") &&
    !roles.has("signer") &&
    !roles.has("paymaster") &&
    !roles.has("signer-paymaster")
  ) {
    issues.push({
      node: "<fleet>",
      role: null,
      severity: "warning",
      code: "missing_provider_role",
      message: "fleet has no provider role for storage, artifacts, signer, or paymaster services",
    });
  }

  return {
    manifestPath,
    total: manifest.nodes.length,
    errors: issues.filter((issue) => issue.severity === "error").length,
    warnings: issues.filter((issue) => issue.severity === "warning").length,
    issues,
  };
}

export function buildFleetLintReport(snapshot: FleetLintSnapshot): string {
  const lines = [
    "=== OPENFOX FLEET LINT ===",
    `Manifest:  ${snapshot.manifestPath}`,
    `Nodes:     ${snapshot.total}`,
    `Errors:    ${snapshot.errors}`,
    `Warnings:  ${snapshot.warnings}`,
    "",
  ];
  if (snapshot.issues.length === 0) {
    lines.push("No lint issues found.");
    return lines.join("\n");
  }
  for (const issue of snapshot.issues) {
    lines.push(
      `${issue.node}${issue.role ? ` [${issue.role}]` : ""}: ${issue.severity} ${issue.code} -> ${issue.message}`,
    );
  }
  return lines.join("\n");
}

function readOptionalJson<T>(filePath: string): T | null {
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
}

export function buildFleetBundleSnapshot(params: {
  bundlePath: string;
}): FleetBundleSnapshot {
  const bundlePath = path.resolve(params.bundlePath);
  const exists = fs.existsSync(bundlePath);
  const manifestCandidates = ["fleet.yml", "fleet.yaml", "fleet.json"];
  const manifestPath =
    exists
      ? manifestCandidates
          .map((candidate) => path.join(bundlePath, candidate))
          .find((candidate) => fs.existsSync(candidate)) || null
      : null;
  const dashboardPath = exists ? path.join(bundlePath, "dashboard.json") : null;
  const lintPath = exists ? path.join(bundlePath, "fleet-lint.json") : null;
  const controlEventsPath = exists ? path.join(bundlePath, "control-events.json") : null;
  const autopilotPath = exists ? path.join(bundlePath, "autopilot.json") : null;
  const approvalsPath = exists ? path.join(bundlePath, "approvals.json") : null;
  const incidentsPath = exists ? path.join(bundlePath, "incidents.json") : null;

  const manifest = manifestPath ? loadFleetManifest(manifestPath) : null;
  const dashboard = dashboardPath ? readOptionalJson<{ generatedAt?: string; nodeCount?: number; failingEndpoints?: string[] }>(dashboardPath) : null;
  const lint = lintPath ? readOptionalJson<{ errors?: number; warnings?: number }>(lintPath) : null;
  const incidents = incidentsPath
    ? readOptionalJson<{ total?: number; critical?: number; warning?: number }>(incidentsPath)
    : null;

  const roleCounts: Record<string, number> = {};
  for (const node of manifest?.nodes ?? []) {
    const role = node.role || "unspecified";
    roleCounts[role] = (roleCounts[role] || 0) + 1;
  }

  return {
    bundlePath,
    exists,
    manifestPath,
    dashboardPath: dashboardPath && fs.existsSync(dashboardPath) ? dashboardPath : null,
    lintPath: lintPath && fs.existsSync(lintPath) ? lintPath : null,
    controlEventsPath:
      controlEventsPath && fs.existsSync(controlEventsPath) ? controlEventsPath : null,
    autopilotPath: autopilotPath && fs.existsSync(autopilotPath) ? autopilotPath : null,
    approvalsPath: approvalsPath && fs.existsSync(approvalsPath) ? approvalsPath : null,
    incidentsPath: incidentsPath && fs.existsSync(incidentsPath) ? incidentsPath : null,
    manifest: manifest
      ? {
          version: manifest.version,
          nodeCount: manifest.nodes.length,
          roles: roleCounts,
        }
      : null,
    dashboard: dashboard
      ? {
          generatedAt: dashboard.generatedAt || null,
          nodeCount: Number.isFinite(dashboard.nodeCount) ? Number(dashboard.nodeCount) : 0,
          failingEndpoints: Array.isArray(dashboard.failingEndpoints)
            ? dashboard.failingEndpoints.filter((value): value is string => typeof value === "string")
            : [],
        }
      : null,
    lint: lint
      ? {
          errors: Number.isFinite(lint.errors) ? Number(lint.errors) : 0,
          warnings: Number.isFinite(lint.warnings) ? Number(lint.warnings) : 0,
        }
      : null,
    incidents: incidents
      ? {
          total: Number.isFinite(incidents.total) ? Number(incidents.total) : 0,
          critical: Number.isFinite(incidents.critical) ? Number(incidents.critical) : 0,
          warning: Number.isFinite(incidents.warning) ? Number(incidents.warning) : 0,
        }
      : null,
  };
}

export function buildFleetBundleReport(snapshot: FleetBundleSnapshot): string {
  const lines = [
    "=== OPENFOX FLEET BUNDLE ===",
    `Bundle:    ${snapshot.bundlePath}`,
    `Exists:    ${snapshot.exists ? "yes" : "no"}`,
  ];
  if (!snapshot.exists) {
    return lines.join("\n");
  }
  lines.push(`Manifest:  ${snapshot.manifestPath || "(missing)"}`);
  lines.push(`Dashboard: ${snapshot.dashboardPath || "(missing)"}`);
  lines.push(`Lint:      ${snapshot.lintPath || "(missing)"}`);
  lines.push(`Controls:  ${snapshot.controlEventsPath ? "present" : "missing"}`);
  lines.push(`Autopilot: ${snapshot.autopilotPath ? "present" : "missing"}`);
  lines.push(`Approvals: ${snapshot.approvalsPath ? "present" : "missing"}`);
  lines.push(`Incidents: ${snapshot.incidentsPath ? "present" : "missing"}`);
  if (snapshot.manifest) {
    lines.push(
      `Roles:     ${Object.entries(snapshot.manifest.roles)
        .map(([role, count]) => `${role}=${count}`)
        .join(", ") || "(none)"}`,
    );
  }
  if (snapshot.dashboard) {
    lines.push(
      `Failures:  ${snapshot.dashboard.failingEndpoints.length ? snapshot.dashboard.failingEndpoints.join(", ") : "none"}`,
    );
  }
  if (snapshot.lint) {
    lines.push(`Lint sum:  ${snapshot.lint.errors} error(s), ${snapshot.lint.warnings} warning(s)`);
  }
  if (snapshot.incidents) {
    lines.push(
      `Incident sum: ${snapshot.incidents.total} total, critical=${snapshot.incidents.critical}, warning=${snapshot.incidents.warning}`,
    );
  }
  return lines.join("\n");
}

// ─── Fleet Reconciliation ─────────────────────────────────────────

function parseReconciliationPayload(
  node: FleetNodeResult,
): FleetReconciliationEntry[] {
  const payload = node.payload;
  if (!payload || typeof payload !== "object") return [];
  const entries: FleetReconciliationEntry[] = [];
  const raw = payload as Record<string, unknown>;

  // Extract per-kind reconciliation data from node payloads
  const kinds: FleetReconciliationKind[] = ["lease", "audit", "renewal", "replication"];
  for (const kind of kinds) {
    const section = raw[kind] as Record<string, unknown> | undefined;
    if (!section || typeof section !== "object") continue;
    entries.push({
      node: node.name,
      role: node.role,
      kind,
      total: typeof section.total === "number" ? section.total : 0,
      healthy: typeof section.healthy === "number" ? section.healthy : 0,
      warning: typeof section.warning === "number" ? section.warning : 0,
      critical: typeof section.critical === "number" ? section.critical : 0,
      details: Object.fromEntries(
        Object.entries(section).filter(
          ([k, v]) => typeof v === "number" && !["total", "healthy", "warning", "critical"].includes(k),
        ),
      ) as Record<string, number>,
    });
  }

  // If no structured sections, attempt to treat the whole payload as a flat reconciliation view
  if (entries.length === 0 && typeof raw.totalLeases === "number") {
    entries.push({
      node: node.name,
      role: node.role,
      kind: "lease",
      total: (raw.totalLeases as number) || 0,
      healthy: (raw.healthy as number) || 0,
      warning: (raw.warning as number) || 0,
      critical: (raw.critical as number) || 0,
      details: {
        dueRenewals: typeof raw.dueRenewals === "number" ? raw.dueRenewals : 0,
        dueAudits: typeof raw.dueAudits === "number" ? raw.dueAudits : 0,
        underReplicated: typeof raw.underReplicated === "number" ? raw.underReplicated : 0,
      },
    });
  }

  return entries;
}

export async function buildFleetReconciliationSnapshot(params: {
  manifestPath: string;
}): Promise<FleetReconciliationSnapshot> {
  const manifestPath = path.resolve(params.manifestPath);
  const manifest = loadFleetManifest(manifestPath);

  // Fetch lease-health and storage status from all nodes to reconcile
  const leaseHealthNodes = await Promise.all(
    manifest.nodes.map((node) => fetchNodeEndpoint(node, "lease-health")),
  );
  const storageNodes = await Promise.all(
    manifest.nodes.map((node) => fetchNodeEndpoint(node, "storage")),
  );

  const allNodes = [...leaseHealthNodes, ...storageNodes];
  const okCount = allNodes.filter((n) => n.ok).length;
  const entries: FleetReconciliationEntry[] = [];

  for (const node of leaseHealthNodes) {
    if (node.ok) {
      entries.push(...parseReconciliationPayload(node));
    }
  }

  for (const node of storageNodes) {
    if (node.ok && typeof node.payload === "object" && node.payload !== null) {
      const raw = node.payload as Record<string, unknown>;
      if (typeof raw.replication === "object" && raw.replication !== null) {
        const rep = raw.replication as Record<string, unknown>;
        entries.push({
          node: node.name,
          role: node.role,
          kind: "replication",
          total: typeof rep.targetCopies === "number" ? rep.targetCopies : 0,
          healthy: typeof rep.currentCopies === "number" ? rep.currentCopies : 0,
          warning: typeof rep.gap === "number" && (rep.gap as number) > 0 ? 1 : 0,
          critical: typeof rep.missing === "number" && (rep.missing as number) > 0 ? 1 : 0,
          details: Object.fromEntries(
            Object.entries(rep).filter(([, v]) => typeof v === "number"),
          ) as Record<string, number>,
        });
      }
    }
  }

  const totalCritical = entries.reduce((sum, e) => sum + e.critical, 0);
  const totalWarning = entries.reduce((sum, e) => sum + e.warning, 0);

  return {
    manifestPath,
    generatedAt: new Date().toISOString(),
    total: allNodes.length,
    ok: okCount,
    failed: allNodes.length - okCount,
    entries,
    nodes: allNodes,
    summary: `${entries.length} reconciliation entries, ${totalCritical} critical, ${totalWarning} warning`,
  };
}

export function buildFleetReconciliationReport(
  snapshot: FleetReconciliationSnapshot,
): string {
  const lines = [
    "=== OPENFOX FLEET RECONCILIATION ===",
    `Generated: ${snapshot.generatedAt}`,
    `Manifest:  ${snapshot.manifestPath}`,
    `Nodes:     ${snapshot.total} (ok=${snapshot.ok}, failed=${snapshot.failed})`,
    "",
  ];
  if (snapshot.entries.length === 0) {
    lines.push("No reconciliation entries found.");
    return lines.join("\n");
  }
  for (const entry of snapshot.entries) {
    lines.push(
      `${entry.node}${entry.role ? ` [${entry.role}]` : ""}: ${entry.kind} -> total=${entry.total} healthy=${entry.healthy} warning=${entry.warning} critical=${entry.critical}`,
    );
    const detailParts = Object.entries(entry.details)
      .map(([k, v]) => `${k}=${v}`)
      .join(", ");
    if (detailParts) {
      lines.push(`  ${detailParts}`);
    }
  }
  lines.push("");
  lines.push(snapshot.summary);
  return lines.join("\n");
}

// ─── Fleet Provider Liveness ──────────────────────────────────────

function parseProviderLivenessPayload(
  node: FleetNodeResult,
): FleetProviderLivenessEntry[] {
  const payload = node.payload;
  if (!payload || typeof payload !== "object") return [];
  const raw = payload as Record<string, unknown>;

  // If payload has an 'entries' array, use it
  const rawEntries = Array.isArray(raw.entries) ? raw.entries : [];
  if (rawEntries.length > 0) {
    return rawEntries.flatMap((entry: unknown) => {
      if (!entry || typeof entry !== "object") return [];
      const e = entry as Record<string, unknown>;
      return [
        {
          node: node.name,
          role: node.role,
          providerKind: typeof e.kind === "string" ? e.kind : "unknown",
          state: classifyLivenessState(e),
          failureDomain: typeof e.failureDomain === "string" ? e.failureDomain : null,
          degradedRoutes: Array.isArray(e.degradedRoutes)
            ? e.degradedRoutes.filter((r): r is string => typeof r === "string")
            : [],
          lastSeenAt: typeof e.lastSeenAt === "string" ? e.lastSeenAt : null,
          latencyMs: typeof e.latencyMs === "number" ? e.latencyMs : null,
        } satisfies FleetProviderLivenessEntry,
      ];
    });
  }

  // Otherwise build a single entry from the node itself
  if (typeof raw.kind === "string") {
    return [
      {
        node: node.name,
        role: node.role,
        providerKind: raw.kind,
        state: classifyLivenessState(raw),
        failureDomain: typeof raw.failureDomain === "string" ? raw.failureDomain : null,
        degradedRoutes: Array.isArray(raw.degradedRoutes)
          ? raw.degradedRoutes.filter((r): r is string => typeof r === "string")
          : [],
        lastSeenAt: typeof raw.lastSeenAt === "string" ? raw.lastSeenAt : null,
        latencyMs: typeof raw.latencyMs === "number" ? raw.latencyMs : null,
      },
    ];
  }

  return [];
}

function classifyLivenessState(
  entry: Record<string, unknown>,
): FleetProviderLivenessState {
  if (entry.state === "alive" || entry.state === "degraded" || entry.state === "unreachable") {
    return entry.state;
  }
  // Infer from score or status fields
  if (typeof entry.score === "number") {
    if (entry.score >= 70) return "alive";
    if (entry.score >= 40) return "degraded";
    return "unreachable";
  }
  if (entry.status === "failed" || entry.ok === false) return "unreachable";
  if (entry.status === "degraded") return "degraded";
  return "alive";
}

export async function buildFleetProviderLivenessSnapshot(params: {
  manifestPath: string;
}): Promise<FleetProviderLivenessSnapshot> {
  const manifestPath = path.resolve(params.manifestPath);
  const manifest = loadFleetManifest(manifestPath);

  const providerNodes = await Promise.all(
    manifest.nodes.map((node) => fetchNodeEndpoint(node, "providers")),
  );

  const entries: FleetProviderLivenessEntry[] = [];
  for (const node of providerNodes) {
    if (node.ok) {
      entries.push(...parseProviderLivenessPayload(node));
    } else {
      // The node itself is unreachable
      entries.push({
        node: node.name,
        role: node.role,
        providerKind: node.role || "unknown",
        state: "unreachable",
        failureDomain: null,
        degradedRoutes: [],
        lastSeenAt: null,
        latencyMs: null,
      });
    }
  }

  const alive = entries.filter((e) => e.state === "alive").length;
  const degraded = entries.filter((e) => e.state === "degraded").length;
  const unreachable = entries.filter((e) => e.state === "unreachable").length;

  const failureDomains: Record<string, number> = {};
  for (const entry of entries) {
    if (entry.failureDomain) {
      failureDomains[entry.failureDomain] = (failureDomains[entry.failureDomain] || 0) + 1;
    }
  }

  return {
    manifestPath,
    generatedAt: new Date().toISOString(),
    total: entries.length,
    alive,
    degraded,
    unreachable,
    failureDomains,
    entries,
    nodes: providerNodes,
    summary: `${entries.length} providers: ${alive} alive, ${degraded} degraded, ${unreachable} unreachable`,
  };
}

export function buildFleetProviderLivenessReport(
  snapshot: FleetProviderLivenessSnapshot,
): string {
  const lines = [
    "=== OPENFOX FLEET PROVIDER LIVENESS ===",
    `Generated:   ${snapshot.generatedAt}`,
    `Manifest:    ${snapshot.manifestPath}`,
    `Alive:       ${snapshot.alive}`,
    `Degraded:    ${snapshot.degraded}`,
    `Unreachable: ${snapshot.unreachable}`,
    "",
  ];
  if (Object.keys(snapshot.failureDomains).length > 0) {
    lines.push(
      `Failure domains: ${Object.entries(snapshot.failureDomains)
        .map(([domain, count]) => `${domain}=${count}`)
        .join(", ")}`,
    );
    lines.push("");
  }
  for (const entry of snapshot.entries) {
    const degradedSuffix =
      entry.degradedRoutes.length > 0
        ? ` degraded_routes=[${entry.degradedRoutes.join(",")}]`
        : "";
    const domainSuffix = entry.failureDomain ? ` domain=${entry.failureDomain}` : "";
    const latencySuffix = entry.latencyMs !== null ? ` latency=${entry.latencyMs}ms` : "";
    lines.push(
      `${entry.node}${entry.role ? ` [${entry.role}]` : ""}: ${entry.providerKind} ${entry.state}${domainSuffix}${degradedSuffix}${latencySuffix}`,
    );
  }
  lines.push("");
  lines.push(snapshot.summary);
  return lines.join("\n");
}

// ─── Fleet Bounded Recovery ───────────────────────────────────────

function getRecoveryPath(kind: FleetRecoveryKind): string {
  switch (kind) {
    case "replication":
      return "fleet/recover/replication";
    case "provider_route":
      return "fleet/recover/provider-route";
    case "callback_queue":
      return "fleet/recover/callback-queue";
  }
}

export async function buildFleetRecoverySnapshot(params: {
  manifestPath: string;
  kind: FleetRecoveryKind;
  limit?: number;
}): Promise<FleetRecoverySnapshot> {
  const manifestPath = path.resolve(params.manifestPath);
  const manifest = loadFleetManifest(manifestPath);
  const recoveryPath = getRecoveryPath(params.kind);

  const nodes = await Promise.all(
    manifest.nodes.map((node) =>
      invokeNodeControlAction(node, recoveryPath, {
        kind: params.kind,
        ...(typeof params.limit === "number" ? { limit: params.limit } : {}),
      }),
    ),
  );

  const entries: FleetRecoveryEntry[] = nodes.map((node) => {
    if (!node.ok) {
      return {
        node: node.name,
        role: node.role,
        kind: params.kind,
        status: "failed" as FleetRecoveryStatus,
        attempted: 0,
        recovered: 0,
        failed: 1,
        details: { error: node.error || "unknown" },
      };
    }
    const payload =
      typeof node.payload === "object" && node.payload !== null
        ? (node.payload as Record<string, unknown>)
        : {};
    const attempted = typeof payload.attempted === "number" ? payload.attempted : 0;
    const recovered = typeof payload.recovered === "number" ? payload.recovered : 0;
    const failed = typeof payload.failed === "number" ? payload.failed : 0;
    const status: FleetRecoveryStatus =
      typeof payload.status === "string" &&
      (payload.status === "recovered" || payload.status === "partial" || payload.status === "failed" || payload.status === "skipped")
        ? payload.status
        : recovered > 0 && failed === 0
          ? "recovered"
          : recovered > 0 && failed > 0
            ? "partial"
            : attempted === 0
              ? "skipped"
              : "failed";
    return {
      node: node.name,
      role: node.role,
      kind: params.kind,
      status,
      attempted,
      recovered,
      failed,
      details: payload,
    };
  });

  const okCount = entries.filter((e) => e.status === "recovered" || e.status === "skipped").length;
  const totalRecovered = entries.reduce((sum, e) => sum + e.recovered, 0);
  const totalFailed = entries.reduce((sum, e) => sum + e.failed, 0);

  return {
    manifestPath,
    generatedAt: new Date().toISOString(),
    kind: params.kind,
    total: nodes.length,
    ok: okCount,
    failed: nodes.length - okCount,
    entries,
    nodes,
    summary: `${params.kind} recovery: ${totalRecovered} recovered, ${totalFailed} failed across ${nodes.length} nodes`,
  };
}

export function buildFleetRecoveryReport(
  snapshot: FleetRecoverySnapshot,
): string {
  const lines = [
    "=== OPENFOX FLEET RECOVERY ===",
    `Generated: ${snapshot.generatedAt}`,
    `Manifest:  ${snapshot.manifestPath}`,
    `Kind:      ${snapshot.kind}`,
    `Nodes:     ${snapshot.total} (ok=${snapshot.ok}, failed=${snapshot.failed})`,
    "",
  ];
  for (const entry of snapshot.entries) {
    lines.push(
      `${entry.node}${entry.role ? ` [${entry.role}]` : ""}: ${entry.status} -> attempted=${entry.attempted} recovered=${entry.recovered} failed=${entry.failed}`,
    );
  }
  lines.push("");
  lines.push(snapshot.summary);
  return lines.join("\n");
}
