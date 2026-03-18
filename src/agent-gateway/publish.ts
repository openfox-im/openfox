import type { AgentDiscoveryConfig, OpenFoxConfig } from "../types.js";
import type {
  StartedAgentGatewayServer,
  StartedAgentGatewayProviderSession,
  AgentGatewayProviderRoute,
} from "./types.js";

function endpointKindFromUrl(url: string): "http" | "https" | "ws" {
  if (url.startsWith("https://")) return "https";
  if (url.startsWith("ws://") || url.startsWith("wss://")) return "ws";
  return "http";
}

function appendUrlPath(url: string, suffix: string): string {
  return `${url.replace(/\/+$/, "")}/${suffix.replace(/^\/+/, "")}`;
}

function uniqueByName<T>(
  entries: T[],
  keyFn: (entry: T) => string,
): T[] {
  const out: T[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    const key = keyFn(entry);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(entry);
  }
  return out;
}

export function buildGatewayProviderRoutes(params: {
  config: OpenFoxConfig;
  faucetUrl?: string;
  observationUrl?: string;
  oracleUrl?: string;
  newsFetchUrl?: string;
  proofVerifyUrl?: string;
  signerUrl?: string;
  paymasterUrl?: string;
  storageUrl?: string;
  discoveryStorageUrl?: string;
  artifactUrl?: string;
  mailUrl?: string;
}): AgentGatewayProviderRoute[] {
  const routes: AgentGatewayProviderRoute[] = [
    ...(params.config.agentDiscovery?.gatewayClient?.routes ?? []),
  ];
  const faucet = params.config.agentDiscovery?.faucetServer;
  if (
    faucet?.enabled &&
    params.faucetUrl &&
    !routes.some((entry) => entry.capability === faucet.capability)
  ) {
    routes.push({
      path: "/faucet",
      capability: faucet.capability,
      mode: "sponsored",
      targetUrl: params.faucetUrl,
    });
  }
  const observation = params.config.agentDiscovery?.observationServer;
  if (
    observation?.enabled &&
    params.observationUrl &&
    !routes.some((entry) => entry.capability === observation.capability)
  ) {
    routes.push({
      path: "/observe-once",
      capability: observation.capability,
      mode: "paid",
      targetUrl: params.observationUrl,
    });
  }
  const oracle = params.config.agentDiscovery?.oracleServer;
  if (
    oracle?.enabled &&
    params.oracleUrl &&
    !routes.some((entry) => entry.capability === oracle.capability)
  ) {
    routes.push({
      path: "/oracle/resolve",
      capability: oracle.capability,
      mode: "paid",
      targetUrl: params.oracleUrl,
    });
  }
  const newsFetch = params.config.agentDiscovery?.newsFetchServer;
  if (
    newsFetch?.enabled &&
    params.newsFetchUrl &&
    !routes.some((entry) => entry.capability === newsFetch.capability)
  ) {
    routes.push({
      path: "/news/fetch",
      capability: newsFetch.capability,
      mode: "paid",
      targetUrl: params.newsFetchUrl,
    });
  }
  const proofVerify = params.config.agentDiscovery?.proofVerifyServer;
  if (
    proofVerify?.enabled &&
    params.proofVerifyUrl &&
    !routes.some((entry) => entry.capability === proofVerify.capability)
  ) {
    routes.push({
      path: "/proof/verify",
      capability: proofVerify.capability,
      mode: "paid",
      targetUrl: params.proofVerifyUrl,
    });
  }
  const signer = params.config.signerProvider;
  if (
    signer?.enabled &&
    params.signerUrl
  ) {
    const pathPrefix = signer.pathPrefix.replace(/\/+$/, "");
    if (!routes.some((entry) => entry.capability === `${signer.capabilityPrefix}.quote`)) {
      routes.push({
        path: `${pathPrefix}/quote`,
        capability: `${signer.capabilityPrefix}.quote`,
        mode: "sponsored",
        targetUrl: `${params.signerUrl}/quote`,
      });
    }
    if (!routes.some((entry) => entry.capability === `${signer.capabilityPrefix}.submit`)) {
      routes.push({
        path: `${pathPrefix}/submit`,
        capability: `${signer.capabilityPrefix}.submit`,
        mode: "paid",
        targetUrl: `${params.signerUrl}/submit`,
      });
    }
    if (!routes.some((entry) => entry.capability === `${signer.capabilityPrefix}.status`)) {
      routes.push({
        path: `${pathPrefix}/status`,
        capability: `${signer.capabilityPrefix}.status`,
        mode: "sponsored",
        targetUrl: `${params.signerUrl}/status`,
      });
    }
    if (!routes.some((entry) => entry.capability === `${signer.capabilityPrefix}.receipt`)) {
      routes.push({
        path: `${pathPrefix}/receipt`,
        capability: `${signer.capabilityPrefix}.receipt`,
        mode: "sponsored",
        targetUrl: `${params.signerUrl}/receipt`,
      });
    }
  }
  const paymaster = params.config.paymasterProvider;
  if (paymaster?.enabled && params.paymasterUrl) {
    const pathPrefix = paymaster.pathPrefix.replace(/\/+$/, "");
    if (!routes.some((entry) => entry.capability === `${paymaster.capabilityPrefix}.quote`)) {
      routes.push({
        path: `${pathPrefix}/quote`,
        capability: `${paymaster.capabilityPrefix}.quote`,
        mode: "sponsored",
        targetUrl: `${params.paymasterUrl}/quote`,
      });
    }
    if (!routes.some((entry) => entry.capability === `${paymaster.capabilityPrefix}.authorize`)) {
      routes.push({
        path: `${pathPrefix}/authorize`,
        capability: `${paymaster.capabilityPrefix}.authorize`,
        mode: "paid",
        targetUrl: `${params.paymasterUrl}/authorize`,
      });
    }
    if (!routes.some((entry) => entry.capability === `${paymaster.capabilityPrefix}.status`)) {
      routes.push({
        path: `${pathPrefix}/status`,
        capability: `${paymaster.capabilityPrefix}.status`,
        mode: "sponsored",
        targetUrl: `${params.paymasterUrl}/status`,
      });
    }
    if (!routes.some((entry) => entry.capability === `${paymaster.capabilityPrefix}.receipt`)) {
      routes.push({
        path: `${pathPrefix}/receipt`,
        capability: `${paymaster.capabilityPrefix}.receipt`,
        mode: "sponsored",
        targetUrl: `${params.paymasterUrl}/receipt`,
      });
    }
  }
  const storage = params.config.storage;
  if (
    storage?.enabled &&
    storage.publishToDiscovery &&
    params.storageUrl &&
    !routes.some((entry) => entry.capability === `${storage.capabilityPrefix}.put`)
  ) {
    routes.push({
      path: "/storage",
      capability: `${storage.capabilityPrefix}.put`,
      mode: "paid",
      targetUrl: params.storageUrl,
    });
  }
  const discoveryStorage = params.config.agentDiscovery?.storageServer;
  if (discoveryStorage?.enabled && params.discoveryStorageUrl) {
    if (
      !routes.some(
        (entry) => entry.capability === discoveryStorage.putCapability,
      )
    ) {
      routes.push({
        path: "/discovery-storage/put",
        capability: discoveryStorage.putCapability,
        mode: "paid",
        targetUrl: appendUrlPath(params.discoveryStorageUrl, "put"),
      });
    }
    if (
      !routes.some(
        (entry) => entry.capability === discoveryStorage.getCapability,
      )
    ) {
      routes.push({
        path: "/discovery-storage/get",
        capability: discoveryStorage.getCapability,
        mode: "paid",
        targetUrl: appendUrlPath(params.discoveryStorageUrl, "get"),
      });
    }
  }
  const artifacts = params.config.artifacts;
  if (
    artifacts?.enabled &&
    artifacts.service.enabled &&
    params.artifactUrl
  ) {
    const pathPrefix = artifacts.service.pathPrefix.replace(/\/+$/, "");
    if (!routes.some((entry) => entry.capability === artifacts.captureCapability)) {
      routes.push({
        path: `${pathPrefix}/capture-news`,
        capability: artifacts.captureCapability,
        mode: "sponsored",
        targetUrl: `${params.artifactUrl}/capture-news`,
      });
    }
    if (!routes.some((entry) => entry.capability === artifacts.evidenceCapability)) {
      routes.push({
        path: `${pathPrefix}/oracle-evidence`,
        capability: artifacts.evidenceCapability,
        mode: "sponsored",
        targetUrl: `${params.artifactUrl}/oracle-evidence`,
      });
    }
  }
  const mail = params.config.agentDiscovery?.mailServer;
  if (
    mail?.enabled &&
    params.mailUrl &&
    !routes.some((entry) => entry.capability === mail.capability)
  ) {
    routes.push({
      path: "/mail/deliver",
      capability: mail.capability,
      mode: "sponsored",
      targetUrl: `${params.mailUrl}/deliver`,
    });
  }
  return uniqueByName(routes, (entry) => `${entry.path}:${entry.capability}`);
}

export function buildPublishedAgentDiscoveryConfig(params: {
  baseConfig: AgentDiscoveryConfig;
  gatewayServer?: StartedAgentGatewayServer;
  gatewayServerConfig?: NonNullable<OpenFoxConfig["agentDiscovery"]>["gatewayServer"];
  providerSession?: StartedAgentGatewayProviderSession;
  providerSessions?: StartedAgentGatewayProviderSession[];
  providerRoutes?: AgentGatewayProviderRoute[];
}): AgentDiscoveryConfig {
  const endpoints = [...params.baseConfig.endpoints];
  const capabilities = [...params.baseConfig.capabilities];
  const hiddenLocalTargets = new Set(
    (params.providerRoutes ?? []).map((route) => route.targetUrl),
  );

  const publishedEndpoints = endpoints.filter(
    (entry) => !hiddenLocalTargets.has(entry.url),
  );

  const sessions = params.providerSessions?.length
    ? params.providerSessions
    : params.providerSession
      ? [params.providerSession]
      : [];
  if (sessions.length && params.providerRoutes?.length) {
    for (const session of sessions) {
      for (const allocation of session.allocatedEndpoints) {
        publishedEndpoints.push({
          kind: endpointKindFromUrl(allocation.public_url),
          url: allocation.public_url,
          viaGateway: session.gatewayAgentId,
        });
      }
    }
  }

  if (params.gatewayServer && params.gatewayServerConfig?.enabled) {
    if (
      !capabilities.some(
        (entry) => entry.name === params.gatewayServerConfig?.capability,
      )
    ) {
      capabilities.push({
        name: params.gatewayServerConfig.capability,
        mode: params.gatewayServerConfig.mode,
        priceModel: params.gatewayServerConfig.priceModel,
        description: "Agent Gateway relay capability",
        policy: {
          payment_direction: params.gatewayServerConfig.paymentDirection,
          session_fee_tos: params.gatewayServerConfig.sessionFeeWei,
          per_request_fee_tos: params.gatewayServerConfig.perRequestFeeWei,
          max_sessions: params.gatewayServerConfig.maxSessions,
          max_bandwidth_kbps: params.gatewayServerConfig.maxBandwidthKbps,
          max_routes_per_session: params.gatewayServerConfig.maxRoutesPerSession,
          supported_transports: params.gatewayServerConfig.supportedTransports,
          session_ttl_seconds: params.gatewayServerConfig.sessionTtlSeconds,
          latency_slo_ms: params.gatewayServerConfig.latencySloMs,
          availability_slo: params.gatewayServerConfig.availabilitySlo,
        },
      });
    }
    publishedEndpoints.push({
      kind: "ws",
      url: params.gatewayServer.sessionUrl,
      role: "provider_relay",
    });
    publishedEndpoints.push({
      kind: endpointKindFromUrl(params.gatewayServer.publicBaseUrl),
      url: params.gatewayServer.publicBaseUrl,
      role: "requester_invocation",
    });
  }

  return {
    ...params.baseConfig,
    endpoints: uniqueByName(
      publishedEndpoints,
      (entry) =>
        `${entry.kind}:${entry.url}:${entry.viaGateway || ""}:${entry.role || ""}`,
    ),
    capabilities: uniqueByName(
      capabilities,
      (entry) => entry.name.toLowerCase(),
    ),
    faucetServer: params.baseConfig.faucetServer
      ? {
          ...params.baseConfig.faucetServer,
          enabled: false,
        }
      : undefined,
    observationServer: params.baseConfig.observationServer
      ? {
          ...params.baseConfig.observationServer,
          enabled: false,
        }
      : undefined,
    oracleServer: params.baseConfig.oracleServer
      ? {
          ...params.baseConfig.oracleServer,
          enabled: false,
        }
      : undefined,
    newsFetchServer: params.baseConfig.newsFetchServer
      ? {
          ...params.baseConfig.newsFetchServer,
          enabled: false,
        }
      : undefined,
    proofVerifyServer: params.baseConfig.proofVerifyServer
      ? {
          ...params.baseConfig.proofVerifyServer,
          enabled: false,
        }
      : undefined,
    storageServer: params.baseConfig.storageServer
      ? {
          ...params.baseConfig.storageServer,
          enabled: false,
        }
      : undefined,
    mailServer: params.baseConfig.mailServer
      ? {
          ...params.baseConfig.mailServer,
          enabled: false,
        }
      : undefined,
  };
}
