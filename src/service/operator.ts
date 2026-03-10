import type BetterSqlite3 from "better-sqlite3";
import type { OpenFoxConfig } from "../types.js";
import { verifyGatewayBootnodeList } from "../agent-gateway/bootnodes.js";
import type { ManagedServiceStatus } from "./daemon.js";

type DatabaseType = BetterSqlite3.Database;

interface HealthProbeResult {
  name: string;
  url: string;
  ok: boolean;
  status?: number;
  details?: string;
}

export interface ServiceRouteSnapshot {
  path: string;
  capability: string;
  mode: string;
  targetUrl: string;
}

export interface ServiceStatusSnapshot {
  roles: string[];
  discoveryEnabled: boolean;
  rpcUrl: string | null;
  chainId: number | null;
  x402Server:
    | {
        enabled: true;
        confirmationPolicy: string;
        retryBatchSize: number;
        retryAfterSeconds: number;
        maxAttempts: number;
      }
    | { enabled: false };
  providerSurfaces: {
    faucet:
      | {
          url: string;
          capability: string;
        }
      | null;
    observation:
      | {
          url: string;
          capability: string;
        }
      | null;
    oracle:
      | {
          url: string;
          capability: string;
        }
      | null;
    storage:
      | {
          url: string;
          capabilityPrefix: string;
          allowAnonymousGet: boolean;
          autoAudit: boolean;
          autoRenew: boolean;
          replicationTarget: number;
          configuredReplicationProviders: number;
        }
      | null;
    artifacts:
      | {
          url: string;
          captureCapability: string;
          evidenceCapability: string;
        }
      | null;
    routes: ServiceRouteSnapshot[];
  };
  gatewayServer:
    | {
        enabled: true;
        publicBaseUrl: string;
        sessionUrl: string;
        healthzUrl: string;
        capability: string;
        mode: string;
        paymentDirection: string;
      }
    | { enabled: false };
  gatewayClient:
    | {
        enabled: true;
        maxSessions: number;
        e2e: boolean;
        requireSignedBootnodeList: boolean;
        configuredBootnodes: number;
        pinnedGatewayUrl: string | null;
      }
    | { enabled: false };
  gatewayCache?: {
    providerSessionCacheEntries: number;
    serverSessionCacheEntries: number;
  };
}

export interface GatewayBootnodeSnapshot {
  signedList: {
    present: boolean;
    valid: boolean | null;
    signer: string | null;
    entries: number;
  };
  entries: Array<{
    agentId: string;
    url: string;
    payToAddress?: string;
    paymentDirection?: string;
  }>;
}

export interface GatewayStatusSnapshot {
  server:
    | {
        enabled: true;
        capability: string;
        publicBaseUrl: string;
        bind: string;
        paymentDirection: string;
        mode: string;
      }
    | { enabled: false };
  client:
    | {
        enabled: true;
        maxSessions: number;
        routes: number;
        e2e: boolean;
        requireSignedBootnodeList: boolean;
        pinnedGatewayUrl: string | null;
        signedBootnodeList: {
          present: boolean;
          valid: boolean | null;
          signer: string | null;
          entries: number;
        };
      }
    | { enabled: false };
  cache?: {
    providerSessionKeys: string[];
    serverSessionKeys: string[];
  };
}

export interface GatewayHealthSnapshot {
  checks: HealthProbeResult[];
}

function yesNo(value: boolean): string {
  return value ? "yes" : "no";
}

function buildLocalHttpUrl(host: string, port: number, pathname: string): string {
  const normalizedHost = host === "0.0.0.0" ? "127.0.0.1" : host;
  const path = pathname.startsWith("/") ? pathname : `/${pathname}`;
  return `http://${normalizedHost}:${port}${path}`;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function detectServiceRoles(config: OpenFoxConfig): string[] {
  const roles: string[] = [];
  if (config.agentDiscovery?.enabled) {
    roles.push("requester");
  }
  if (
    config.agentDiscovery?.faucetServer?.enabled ||
    config.agentDiscovery?.observationServer?.enabled ||
    config.agentDiscovery?.oracleServer?.enabled ||
    config.storage?.enabled ||
    config.artifacts?.enabled ||
    (config.agentDiscovery?.gatewayClient?.enabled &&
      (config.agentDiscovery.gatewayClient.routes?.length ?? 0) > 0)
  ) {
    roles.push("provider");
  }
  if (config.agentDiscovery?.gatewayServer?.enabled) {
    roles.push("gateway");
  }
  return uniqueStrings(roles);
}

function inferProviderRoutes(config: OpenFoxConfig): Array<{
  path: string;
  capability: string;
  mode: string;
  targetUrl: string;
}> {
  const routes = [...(config.agentDiscovery?.gatewayClient?.routes ?? [])];
  const faucet = config.agentDiscovery?.faucetServer;
  if (faucet?.enabled && faucet.port > 0) {
    routes.push({
      path: "/faucet",
      capability: faucet.capability,
      mode: "sponsored",
      targetUrl: buildLocalHttpUrl(faucet.bindHost, faucet.port, faucet.path),
    });
  }
  const observation = config.agentDiscovery?.observationServer;
  if (observation?.enabled && observation.port > 0) {
    routes.push({
      path: "/observe-once",
      capability: observation.capability,
      mode: "paid",
      targetUrl: buildLocalHttpUrl(
        observation.bindHost,
        observation.port,
        observation.path,
      ),
    });
  }
  const oracle = config.agentDiscovery?.oracleServer;
  if (oracle?.enabled && oracle.port > 0) {
    routes.push({
      path: "/oracle/resolve",
      capability: oracle.capability,
      mode: "paid",
      targetUrl: buildLocalHttpUrl(oracle.bindHost, oracle.port, oracle.path),
    });
  }
  const storage = config.storage;
  if (storage?.enabled && storage.port > 0) {
    routes.push({
      path: `${storage.pathPrefix.replace(/\/$/, "")}/put`,
      capability: `${storage.capabilityPrefix}.put`,
      mode: "paid",
      targetUrl: buildLocalHttpUrl(storage.bindHost, storage.port, `${storage.pathPrefix}/put`),
    });
    routes.push({
      path: `${storage.pathPrefix.replace(/\/$/, "")}/renew`,
      capability: `${storage.capabilityPrefix}.renew`,
      mode: "paid",
      targetUrl: buildLocalHttpUrl(storage.bindHost, storage.port, `${storage.pathPrefix}/renew`),
    });
  }
  const artifacts = config.artifacts;
  if (artifacts?.enabled && artifacts.service?.enabled && artifacts.service.port > 0) {
    routes.push({
      path: `${artifacts.service.pathPrefix.replace(/\/$/, "")}/capture-news`,
      capability: artifacts.captureCapability,
      mode: "sponsored",
      targetUrl: buildLocalHttpUrl(
        artifacts.service.bindHost,
        artifacts.service.port,
        `${artifacts.service.pathPrefix}/capture-news`,
      ),
    });
    routes.push({
      path: `${artifacts.service.pathPrefix.replace(/\/$/, "")}/oracle-evidence`,
      capability: artifacts.evidenceCapability,
      mode: "sponsored",
      targetUrl: buildLocalHttpUrl(
        artifacts.service.bindHost,
        artifacts.service.port,
        `${artifacts.service.pathPrefix}/oracle-evidence`,
      ),
    });
  }
  return routes;
}

function listGatewaySessionCache(rawDb: DatabaseType): Array<{
  key: string;
  value: string;
}> {
  return rawDb
    .prepare(
      "SELECT key, value FROM kv WHERE key LIKE 'agent_gateway:last_session:%' ORDER BY key ASC",
    )
    .all() as Array<{ key: string; value: string }>;
}

function listGatewayServerSessionCache(rawDb: DatabaseType): Array<{
  key: string;
  value: string;
}> {
  return rawDb
    .prepare(
      "SELECT key, value FROM kv WHERE key LIKE 'agent_gateway:server_session:%' ORDER BY key ASC",
    )
    .all() as Array<{ key: string; value: string }>;
}

async function probeHttpJson(url: string): Promise<HealthProbeResult> {
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(3000),
    });
    const body = await response.text();
    return {
      name: url,
      url,
      ok: response.ok,
      status: response.status,
      details: body.slice(0, 200),
    };
  } catch (error) {
    return {
      name: url,
      url,
      ok: false,
      details: error instanceof Error ? error.message : String(error),
    };
  }
}

async function probeRpc(rpcUrl: string): Promise<HealthProbeResult> {
  try {
    const response = await fetch(rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tos_chainId",
        params: [],
      }),
      signal: AbortSignal.timeout(3000),
    });
    const body = await response.text();
    return {
      name: "rpc",
      url: rpcUrl,
      ok: response.ok && body.includes("\"result\""),
      status: response.status,
      details: body.slice(0, 200),
    };
  } catch (error) {
    return {
      name: "rpc",
      url: rpcUrl,
      ok: false,
      details: error instanceof Error ? error.message : String(error),
    };
  }
}

export function buildServiceStatusReport(
  config: OpenFoxConfig,
  rawDb?: DatabaseType,
): string {
  const snapshot = buildServiceStatusSnapshot(config, rawDb);
  const lines = [
    "=== OPENFOX SERVICES ===",
    `Roles: ${snapshot.roles.length ? snapshot.roles.join(", ") : "(none)"}`,
    `Discovery: ${yesNo(snapshot.discoveryEnabled)}`,
    `RPC: ${snapshot.rpcUrl || "(unset)"}${snapshot.chainId ? ` (chain ${snapshot.chainId})` : ""}`,
  ];

  lines.push("", "x402 server:");
  if (snapshot.x402Server.enabled) {
    lines.push(`  - confirmation policy: ${snapshot.x402Server.confirmationPolicy}`);
    lines.push(`  - retry batch size: ${snapshot.x402Server.retryBatchSize}`);
    lines.push(`  - retry after seconds: ${snapshot.x402Server.retryAfterSeconds}`);
    lines.push(`  - max attempts: ${snapshot.x402Server.maxAttempts}`);
  } else {
    lines.push("  (disabled)");
  }

  lines.push("", "Provider surfaces:");
  if (snapshot.providerSurfaces.faucet) {
    lines.push(
      `  - faucet: ${snapshot.providerSurfaces.faucet.url}  capability=${snapshot.providerSurfaces.faucet.capability}`,
    );
  }
  if (snapshot.providerSurfaces.observation) {
    lines.push(
      `  - observation: ${snapshot.providerSurfaces.observation.url}  capability=${snapshot.providerSurfaces.observation.capability}`,
    );
  }
  if (snapshot.providerSurfaces.oracle) {
    lines.push(
      `  - oracle: ${snapshot.providerSurfaces.oracle.url}  capability=${snapshot.providerSurfaces.oracle.capability}`,
    );
  }
  if (snapshot.providerSurfaces.storage) {
    lines.push(
      `  - storage: ${snapshot.providerSurfaces.storage.url}  capability_prefix=${snapshot.providerSurfaces.storage.capabilityPrefix}  anonymous_get=${yesNo(snapshot.providerSurfaces.storage.allowAnonymousGet)}  auto_audit=${yesNo(snapshot.providerSurfaces.storage.autoAudit)}  auto_renew=${yesNo(snapshot.providerSurfaces.storage.autoRenew)}  replication_target=${snapshot.providerSurfaces.storage.replicationTarget}`,
    );
  }
  if (snapshot.providerSurfaces.artifacts) {
    lines.push(
      `  - artifacts: ${snapshot.providerSurfaces.artifacts.url}  capture=${snapshot.providerSurfaces.artifacts.captureCapability}  evidence=${snapshot.providerSurfaces.artifacts.evidenceCapability}`,
    );
  }
  for (const route of snapshot.providerSurfaces.routes) {
    lines.push(
      `  - route: ${route.path} -> ${route.targetUrl}  capability=${route.capability}  mode=${route.mode}`,
    );
  }
  if (
    !snapshot.providerSurfaces.faucet &&
    !snapshot.providerSurfaces.observation &&
    !snapshot.providerSurfaces.oracle &&
    !snapshot.providerSurfaces.storage &&
    !snapshot.providerSurfaces.artifacts &&
    snapshot.providerSurfaces.routes.length === 0
  ) {
    lines.push("  (none)");
  }

  lines.push("", "Gateway server:");
  if (snapshot.gatewayServer.enabled) {
    lines.push(`  - public base: ${snapshot.gatewayServer.publicBaseUrl}`);
    lines.push(`  - session url: ${snapshot.gatewayServer.sessionUrl}`);
    lines.push(`  - healthz: ${snapshot.gatewayServer.healthzUrl}`);
    lines.push(
      `  - mode=${snapshot.gatewayServer.mode} payment_direction=${snapshot.gatewayServer.paymentDirection} capability=${snapshot.gatewayServer.capability}`,
    );
  } else {
    lines.push("  (disabled)");
  }

  lines.push("", "Gateway client:");
  if (snapshot.gatewayClient.enabled) {
    lines.push(`  - max sessions: ${snapshot.gatewayClient.maxSessions}`);
    lines.push(`  - e2e: ${yesNo(snapshot.gatewayClient.e2e)}`);
    lines.push(
      `  - signed bootnode list required: ${yesNo(snapshot.gatewayClient.requireSignedBootnodeList)}`,
    );
    lines.push(`  - configured bootnodes: ${snapshot.gatewayClient.configuredBootnodes}`);
    if (snapshot.gatewayClient.pinnedGatewayUrl) {
      lines.push(`  - pinned gateway url: ${snapshot.gatewayClient.pinnedGatewayUrl}`);
    }
  } else {
    lines.push("  (disabled)");
  }

  if (snapshot.gatewayCache) {
    lines.push("", "Gateway cache:");
    lines.push(
      `  - provider session cache entries: ${snapshot.gatewayCache.providerSessionCacheEntries}`,
    );
    lines.push(
      `  - server session cache entries: ${snapshot.gatewayCache.serverSessionCacheEntries}`,
    );
  }

  lines.push("========================");
  return lines.join("\n");
}

export function buildServiceStatusSnapshot(
  config: OpenFoxConfig,
  rawDb?: DatabaseType,
): ServiceStatusSnapshot {
  const gatewayServer = config.agentDiscovery?.gatewayServer;
  const gatewayClient = config.agentDiscovery?.gatewayClient;
  const faucet = config.agentDiscovery?.faucetServer;
  const observation = config.agentDiscovery?.observationServer;
  const oracle = config.agentDiscovery?.oracleServer;
  const storage = config.storage;
  const artifacts = config.artifacts;

  return {
    roles: detectServiceRoles(config),
    discoveryEnabled: config.agentDiscovery?.enabled === true,
    rpcUrl: config.rpcUrl || null,
    chainId: config.chainId ?? null,
    x402Server: config.x402Server?.enabled
      ? {
          enabled: true,
          confirmationPolicy: config.x402Server.confirmationPolicy,
          retryBatchSize: config.x402Server.retryBatchSize,
          retryAfterSeconds: config.x402Server.retryAfterSeconds,
          maxAttempts: config.x402Server.maxAttempts,
        }
      : { enabled: false },
    providerSurfaces: {
      faucet:
        faucet?.enabled && faucet.port > 0
          ? {
              url: buildLocalHttpUrl(faucet.bindHost, faucet.port, faucet.path),
              capability: faucet.capability,
            }
          : null,
      observation:
        observation?.enabled && observation.port > 0
          ? {
              url: buildLocalHttpUrl(
                observation.bindHost,
                observation.port,
                observation.path,
              ),
              capability: observation.capability,
            }
          : null,
      oracle:
        oracle?.enabled && oracle.port > 0
          ? {
              url: buildLocalHttpUrl(oracle.bindHost, oracle.port, oracle.path),
              capability: oracle.capability,
            }
          : null,
      storage:
        storage?.enabled && storage.port > 0
          ? {
              url: buildLocalHttpUrl(storage.bindHost, storage.port, storage.pathPrefix),
              capabilityPrefix: storage.capabilityPrefix,
              allowAnonymousGet: storage.allowAnonymousGet,
              autoAudit: storage.leaseHealth?.autoAudit === true,
              autoRenew: storage.leaseHealth?.autoRenew === true,
              replicationTarget: storage.replication?.enabled
                ? storage.replication.targetCopies
                : 1,
              configuredReplicationProviders:
                storage.replication?.providerBaseUrls?.length ?? 0,
            }
          : null,
      artifacts:
        artifacts?.enabled && artifacts.service?.enabled && artifacts.service.port > 0
          ? {
              url: buildLocalHttpUrl(
                artifacts.service.bindHost,
                artifacts.service.port,
                artifacts.service.pathPrefix,
              ),
              captureCapability: artifacts.captureCapability,
              evidenceCapability: artifacts.evidenceCapability,
            }
          : null,
      routes: inferProviderRoutes(config),
    },
    gatewayServer: gatewayServer?.enabled
      ? {
          enabled: true,
          publicBaseUrl: gatewayServer.publicBaseUrl,
          sessionUrl: `${gatewayServer.publicBaseUrl.replace(/^http/, "ws").replace(/\/$/, "")}${gatewayServer.sessionPath.startsWith("/") ? gatewayServer.sessionPath : `/${gatewayServer.sessionPath}`}`,
          healthzUrl: `${gatewayServer.publicBaseUrl.replace(/\/$/, "")}${gatewayServer.publicPathPrefix.startsWith("/") ? gatewayServer.publicPathPrefix : `/${gatewayServer.publicPathPrefix}`}/healthz`,
          capability: gatewayServer.capability,
          mode: gatewayServer.mode,
          paymentDirection: gatewayServer.paymentDirection || "requester_pays",
        }
      : { enabled: false },
    gatewayClient: gatewayClient?.enabled
      ? {
          enabled: true,
          maxSessions: gatewayClient.maxGatewaySessions,
          e2e: gatewayClient.enableE2E === true,
          requireSignedBootnodeList: gatewayClient.requireSignedBootnodeList === true,
          configuredBootnodes: gatewayClient.gatewayBootnodes.length,
          pinnedGatewayUrl: gatewayClient.gatewayUrl || null,
        }
      : { enabled: false },
    gatewayCache: rawDb
      ? {
          providerSessionCacheEntries: listGatewaySessionCache(rawDb).length,
          serverSessionCacheEntries: listGatewayServerSessionCache(rawDb).length,
        }
      : undefined,
  };
}

export async function buildGatewayStatusReport(
  config: OpenFoxConfig,
  rawDb?: DatabaseType,
): Promise<string> {
  const snapshot = await buildGatewayStatusSnapshot(config, rawDb);
  const lines = ["=== OPENFOX GATEWAY ==="];

  if (snapshot.server.enabled) {
    lines.push("Server: enabled");
    lines.push(`  capability: ${snapshot.server.capability}`);
    lines.push(`  public base: ${snapshot.server.publicBaseUrl}`);
    lines.push(`  bind: ${snapshot.server.bind}`);
    lines.push(`  payment direction: ${snapshot.server.paymentDirection}`);
    lines.push(`  mode: ${snapshot.server.mode}`);
  } else {
    lines.push("Server: disabled");
  }

  if (snapshot.client.enabled) {
    lines.push("Client: enabled");
    lines.push(`  max sessions: ${snapshot.client.maxSessions}`);
    lines.push(`  routes: ${snapshot.client.routes}`);
    lines.push(`  e2e: ${yesNo(snapshot.client.e2e)}`);
    lines.push(
      `  signed bootnode list required: ${yesNo(snapshot.client.requireSignedBootnodeList)}`,
    );
    if (snapshot.client.pinnedGatewayUrl) {
      lines.push(`  pinned gateway: ${snapshot.client.pinnedGatewayUrl}`);
    }
    if (snapshot.client.signedBootnodeList.present) {
      lines.push(
        `  signed bootnode list: ${snapshot.client.signedBootnodeList.valid ? "valid" : "invalid"}`,
      );
      lines.push(
        `  signed bootnode signer: ${snapshot.client.signedBootnodeList.signer}`,
      );
      lines.push(
        `  signed bootnode entries: ${snapshot.client.signedBootnodeList.entries}`,
      );
    } else {
      lines.push("  signed bootnode list: (none)");
    }
  } else {
    lines.push("Client: disabled");
  }

  if (snapshot.cache) {
    if (snapshot.cache.providerSessionKeys.length) {
      lines.push("Provider session cache:");
      for (const key of snapshot.cache.providerSessionKeys) {
        lines.push(`  - ${key}`);
      }
    }
    if (snapshot.cache.serverSessionKeys.length) {
      lines.push("Server session cache:");
      for (const key of snapshot.cache.serverSessionKeys) {
        lines.push(`  - ${key}`);
      }
    }
  }

  lines.push("=======================");
  return lines.join("\n");
}

export async function buildGatewayStatusSnapshot(
  config: OpenFoxConfig,
  rawDb?: DatabaseType,
): Promise<GatewayStatusSnapshot> {
  const gatewayServer = config.agentDiscovery?.gatewayServer;
  const gatewayClient = config.agentDiscovery?.gatewayClient;
  const signedBootnodeList =
    gatewayClient?.enabled && gatewayClient.gatewayBootnodeList
      ? {
          present: true,
          valid: await verifyGatewayBootnodeList(
            gatewayClient.gatewayBootnodeList,
            config,
          ),
          signer: gatewayClient.gatewayBootnodeList.signer,
          entries: gatewayClient.gatewayBootnodeList.entries.length,
        }
      : {
          present: false,
          valid: null,
          signer: null,
          entries: 0,
        };

  return {
    server: gatewayServer?.enabled
      ? {
          enabled: true,
          capability: gatewayServer.capability,
          publicBaseUrl: gatewayServer.publicBaseUrl,
          bind: `${gatewayServer.bindHost}:${gatewayServer.port}`,
          paymentDirection: gatewayServer.paymentDirection || "requester_pays",
          mode: gatewayServer.mode,
        }
      : { enabled: false },
    client: gatewayClient?.enabled
      ? {
          enabled: true,
          maxSessions: gatewayClient.maxGatewaySessions,
          routes: gatewayClient.routes.length,
          e2e: gatewayClient.enableE2E === true,
          requireSignedBootnodeList: gatewayClient.requireSignedBootnodeList === true,
          pinnedGatewayUrl: gatewayClient.gatewayUrl || null,
          signedBootnodeList,
        }
      : { enabled: false },
    cache: rawDb
      ? {
          providerSessionKeys: listGatewaySessionCache(rawDb).map((entry) => entry.key),
          serverSessionKeys: listGatewayServerSessionCache(rawDb).map((entry) => entry.key),
        }
      : undefined,
  };
}

export async function buildGatewayBootnodesReport(
  config: OpenFoxConfig,
): Promise<string> {
  const snapshot = await buildGatewayBootnodesSnapshot(config);
  const lines = ["=== OPENFOX GATEWAY BOOTNODES ==="];
  if (!config.agentDiscovery?.gatewayClient?.enabled) {
    lines.push("Gateway client disabled.", "================================");
    return lines.join("\n");
  }

  if (snapshot.signedList.present) {
    lines.push(`Signed list: ${snapshot.signedList.valid ? "valid" : "invalid"}`);
    lines.push(`Signer: ${snapshot.signedList.signer}`);
  } else {
    lines.push("Signed list: (none)");
  }

  if (snapshot.entries.length === 0) {
    lines.push("(no bootnodes configured)", "================================");
    return lines.join("\n");
  }
  for (const entry of snapshot.entries) {
    lines.push(
      `- ${entry.agentId}  ${entry.url}${entry.payToAddress ? `  pay_to=${entry.payToAddress}` : ""}${entry.paymentDirection ? `  payment=${entry.paymentDirection}` : ""}`,
    );
  }
  lines.push("================================");
  return lines.join("\n");
}

export async function buildGatewayBootnodesSnapshot(
  config: OpenFoxConfig,
): Promise<GatewayBootnodeSnapshot> {
  const gatewayClient = config.agentDiscovery?.gatewayClient;
  if (!gatewayClient?.enabled) {
    return {
      signedList: {
        present: false,
        valid: null,
        signer: null,
        entries: 0,
      },
      entries: [],
    };
  }

  const signedList = gatewayClient.gatewayBootnodeList
    ? {
        present: true,
        valid: await verifyGatewayBootnodeList(gatewayClient.gatewayBootnodeList, config),
        signer: gatewayClient.gatewayBootnodeList.signer,
        entries: gatewayClient.gatewayBootnodeList.entries.length,
      }
    : {
        present: false,
        valid: null,
        signer: null,
        entries: 0,
      };

  return {
    signedList,
    entries: gatewayClient.gatewayBootnodeList?.entries || gatewayClient.gatewayBootnodes,
  };
}

export async function runServiceHealthChecks(
  config: OpenFoxConfig,
): Promise<string> {
  const snapshot = await buildServiceHealthSnapshot(config);
  const lines = ["=== OPENFOX SERVICE CHECK ==="];
  if (snapshot.checks.length === 0) {
    lines.push("(no checks configured)", "============================");
    return lines.join("\n");
  }

  for (const result of snapshot.checks) {
    lines.push(
      `- ${result.ok ? "OK" : "FAIL"}  ${result.url}${result.status ? `  status=${result.status}` : ""}${result.details ? `  ${result.details}` : ""}`,
    );
  }
  lines.push("============================");
  return lines.join("\n");
}

export async function buildServiceHealthSnapshot(
  config: OpenFoxConfig,
): Promise<GatewayHealthSnapshot> {
  const checks: HealthProbeResult[] = [];

  if (config.rpcUrl) {
    checks.push(await probeRpc(config.rpcUrl));
  }

  const faucet = config.agentDiscovery?.faucetServer;
  if (faucet?.enabled && faucet.port > 0) {
    const base = buildLocalHttpUrl(faucet.bindHost, faucet.port, faucet.path);
    checks.push(await probeHttpJson(`${base}/healthz`));
  }

  const observation = config.agentDiscovery?.observationServer;
  if (observation?.enabled && observation.port > 0) {
    const base = buildLocalHttpUrl(
      observation.bindHost,
      observation.port,
      observation.path,
    );
    checks.push(await probeHttpJson(`${base}/healthz`));
  }

  const oracle = config.agentDiscovery?.oracleServer;
  if (oracle?.enabled && oracle.port > 0) {
    const base = buildLocalHttpUrl(oracle.bindHost, oracle.port, oracle.path);
    checks.push(await probeHttpJson(`${base}/healthz`));
  }

  const storage = config.storage;
  if (storage?.enabled && storage.port > 0) {
    const base = buildLocalHttpUrl(storage.bindHost, storage.port, storage.pathPrefix);
    checks.push(await probeHttpJson(`${base}/healthz`));
  }
  const artifacts = config.artifacts;
  if (artifacts?.enabled && artifacts.service?.enabled && artifacts.service.port > 0) {
    const base = buildLocalHttpUrl(
      artifacts.service.bindHost,
      artifacts.service.port,
      artifacts.service.pathPrefix,
    );
    checks.push(await probeHttpJson(`${base}/healthz`));
  }

  const gatewayServer = config.agentDiscovery?.gatewayServer;
  if (gatewayServer?.enabled) {
    const prefix = gatewayServer.publicPathPrefix.startsWith("/")
      ? gatewayServer.publicPathPrefix
      : `/${gatewayServer.publicPathPrefix}`;
    checks.push(
      await probeHttpJson(
        `${gatewayServer.publicBaseUrl.replace(/\/$/, "")}${prefix}/healthz`,
      ),
    );
  }

  return { checks };
}

export function buildCombinedServiceStatusSnapshot(
  managedService: ManagedServiceStatus,
  config: OpenFoxConfig,
  rawDb?: DatabaseType,
): {
  managedService: ManagedServiceStatus;
  service: ServiceStatusSnapshot;
} {
  return {
    managedService,
    service: buildServiceStatusSnapshot(config, rawDb),
  };
}
