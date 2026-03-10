import fs from "fs";
import path from "path";
import YAML from "yaml";

export interface FleetNodeManifest {
  name: string;
  role?: string;
  baseUrl: string;
  authToken?: string;
}

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
  | "storage"
  | "artifacts"
  | "signer"
  | "paymaster";

export interface FleetSnapshot {
  manifestPath: string;
  endpoint: FleetEndpoint;
  total: number;
  ok: number;
  failed: number;
  nodes: FleetNodeResult[];
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
    case "storage":
      return "storage/status";
    case "artifacts":
      return "artifacts/status";
    case "signer":
      return "signer/status";
    case "paymaster":
      return "paymaster/status";
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
