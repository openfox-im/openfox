/**
 * OpenFox Configuration
 *
 * Loads and saves ~/.openfox/openfox.json.
 * Provider settings may still be expressed using a nested provider/model
 * config shape, but the filename remains OpenFox-native.
 */

import fs from "fs";
import path from "path";
import type {
  OpenFoxConfig,
  TreasuryPolicy,
  ModelStrategyConfig,
  SoulConfig,
  AgentDiscoveryConfig,
  HexAddress,
  BountyConfig,
  OpportunityScoutConfig,
} from "./types.js";
import {
  DEFAULT_CONFIG,
  DEFAULT_TREASURY_POLICY,
  DEFAULT_MODEL_STRATEGY_CONFIG,
  DEFAULT_SOUL_CONFIG,
  DEFAULT_AGENT_DISCOVERY_CONFIG,
  DEFAULT_AGENT_DISCOVERY_FAUCET_SERVER_CONFIG,
  DEFAULT_AGENT_GATEWAY_FEEDBACK_CONFIG,
  DEFAULT_AGENT_GATEWAY_CLIENT_CONFIG,
  DEFAULT_AGENT_GATEWAY_SERVER_CONFIG,
  DEFAULT_AGENT_DISCOVERY_OBSERVATION_SERVER_CONFIG,
  DEFAULT_AGENT_DISCOVERY_POLICY_PROFILES,
  DEFAULT_AGENT_DISCOVERY_REPUTATION_UPDATE_CONFIG,
  DEFAULT_AGENT_DISCOVERY_SELECTION_POLICY,
  DEFAULT_BOUNTY_CONFIG,
  DEFAULT_BOUNTY_POLICY,
  DEFAULT_OPPORTUNITY_SCOUT_CONFIG,
} from "./types.js";
import { getOpenFoxDir } from "./identity/wallet.js";
import { loadApiKeyFromConfig } from "./identity/provision.js";
import { createLogger } from "./observability/logger.js";

const logger = createLogger("config");
const OPENFOX_CONFIG_FILENAME = "openfox.json";

type JsonRecord = Record<string, unknown>;

interface ProviderConfigCompat {
  model?: string;
  modelRef?: string;
  openaiApiKey?: string;
  anthropicApiKey?: string;
  ollamaBaseUrl?: string;
}

export function getConfigPath(): string {
  return path.join(getOpenFoxDir(), OPENFOX_CONFIG_FILENAME);
}

function readJsonFile(filePath: string): JsonRecord | null {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    return typeof raw === "object" && raw !== null ? (raw as JsonRecord) : null;
  } catch (error) {
    logger.warn(
      `Invalid JSON in ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  }
}

function getNestedRecord(value: unknown, key: string): JsonRecord | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const result = (value as JsonRecord)[key];
  return typeof result === "object" && result !== null
    ? (result as JsonRecord)
    : null;
}

function getNestedString(
  value: unknown,
  ...pathParts: string[]
): string | undefined {
  let cursor: unknown = value;
  for (const part of pathParts) {
    if (typeof cursor !== "object" || cursor === null) {
      return undefined;
    }
    cursor = (cursor as JsonRecord)[part];
  }
  return typeof cursor === "string" && cursor.trim()
    ? cursor.trim()
    : undefined;
}

function resolveSecretRef(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }

  const match = /^\$\{([A-Z0-9_]+)\}$/.exec(trimmed);
  if (match) {
    const envValue = process.env[match[1]];
    return typeof envValue === "string" && envValue.trim()
      ? envValue.trim()
      : undefined;
  }

  return trimmed;
}

function parseModelRef(modelRef: string | undefined): {
  model?: string;
  modelRef?: string;
} {
  if (!modelRef) {
    return {};
  }

  const trimmed = modelRef.trim();
  if (!trimmed) {
    return {};
  }

  const parts = trimmed.split("/").filter(Boolean);
  if (parts.length < 2) {
    return {
      model: trimmed,
      modelRef: trimmed,
    };
  }

  return {
    model: parts[parts.length - 1],
    modelRef: trimmed,
  };
}

function extractProviderCompatConfig(
  raw: JsonRecord | null,
): ProviderConfigCompat {
  if (!raw) {
    return {};
  }

  const providerRoot = getNestedRecord(
    getNestedRecord(raw, "models"),
    "providers",
  );
  const openaiProvider = providerRoot
    ? getNestedRecord(providerRoot, "openai")
    : null;
  const anthropicProvider = providerRoot
    ? getNestedRecord(providerRoot, "anthropic")
    : null;
  const ollamaProvider =
    (providerRoot ? getNestedRecord(providerRoot, "ollama") : null) ||
    (providerRoot ? getNestedRecord(providerRoot, "local") : null);

  const modelRef =
    getNestedString(raw, "agents", "defaults", "model", "primary") ||
    getNestedString(raw, "agent", "model") ||
    getNestedString(raw, "agent", "model", "primary");

  const { model } = parseModelRef(modelRef);
  const env = getNestedRecord(raw, "env");

  return {
    model,
    modelRef,
    openaiApiKey:
      resolveSecretRef(getNestedString(env, "OPENAI_API_KEY")) ||
      resolveSecretRef(getNestedString(openaiProvider, "apiKey")),
    anthropicApiKey:
      resolveSecretRef(getNestedString(env, "ANTHROPIC_API_KEY")) ||
      resolveSecretRef(getNestedString(anthropicProvider, "apiKey")),
    ollamaBaseUrl:
      resolveSecretRef(getNestedString(env, "OLLAMA_BASE_URL")) ||
      resolveSecretRef(getNestedString(ollamaProvider, "baseUrl")),
  };
}

/**
 * Load the openfox config from disk.
 * Merges with defaults and provider settings embedded in openfox.json.
 */
export function loadConfig(): OpenFoxConfig | null {
  const raw = readJsonFile(getConfigPath());
  const compat = extractProviderCompatConfig(raw);

  if (!raw) {
    return null;
  }

  const runtimeApiKey =
    (typeof process.env.OPENFOX_API_KEY === "string" &&
      process.env.OPENFOX_API_KEY.trim()) ||
    (raw &&
      typeof raw.runtimeApiKey === "string" &&
      raw.runtimeApiKey.trim()) ||
    loadApiKeyFromConfig() ||
    undefined;

  const treasuryPolicy: TreasuryPolicy = {
    ...DEFAULT_TREASURY_POLICY,
    ...((raw?.treasuryPolicy as JsonRecord | undefined) ?? {}),
  };

  for (const [key, value] of Object.entries(treasuryPolicy)) {
    if (key === "x402AllowedDomains") continue;
    if (typeof value === "number" && (value < 0 || !Number.isFinite(value))) {
      logger.warn(`Invalid treasury value for ${key}: ${value}, using default`);
      (treasuryPolicy as unknown as JsonRecord)[key] = (
        DEFAULT_TREASURY_POLICY as unknown as JsonRecord
      )[key];
    }
  }

  const modelStrategy: ModelStrategyConfig = {
    ...DEFAULT_MODEL_STRATEGY_CONFIG,
    ...((raw?.modelStrategy as JsonRecord | undefined) ?? {}),
  };

  const soulConfig: SoulConfig = {
    ...DEFAULT_SOUL_CONFIG,
    ...((raw?.soulConfig as JsonRecord | undefined) ?? {}),
  };

  const agentDiscovery: AgentDiscoveryConfig = {
    ...DEFAULT_AGENT_DISCOVERY_CONFIG,
    ...((raw?.agentDiscovery as JsonRecord | undefined) ?? {}),
    endpoints: Array.isArray(
      (raw?.agentDiscovery as JsonRecord | undefined)?.endpoints,
    )
      ? (
          (raw?.agentDiscovery as JsonRecord | undefined)
            ?.endpoints as unknown[]
        ).filter(
          (value): value is AgentDiscoveryConfig["endpoints"][number] =>
            typeof value === "object" &&
            value !== null &&
            typeof (value as JsonRecord).kind === "string" &&
            typeof (value as JsonRecord).url === "string",
        )
      : DEFAULT_AGENT_DISCOVERY_CONFIG.endpoints,
    capabilities: Array.isArray(
      (raw?.agentDiscovery as JsonRecord | undefined)?.capabilities,
    )
      ? (
          (raw?.agentDiscovery as JsonRecord | undefined)
            ?.capabilities as unknown[]
        ).filter(
          (value): value is AgentDiscoveryConfig["capabilities"][number] =>
            typeof value === "object" &&
            value !== null &&
            typeof (value as JsonRecord).name === "string" &&
            typeof (value as JsonRecord).mode === "string",
        )
      : DEFAULT_AGENT_DISCOVERY_CONFIG.capabilities,
    directoryNodeRecords: Array.isArray(
      (raw?.agentDiscovery as JsonRecord | undefined)?.directoryNodeRecords,
    )
      ? (
          (raw?.agentDiscovery as JsonRecord | undefined)
            ?.directoryNodeRecords as unknown[]
        ).filter(
          (value): value is string =>
            typeof value === "string" && value.trim().length > 0,
        )
      : DEFAULT_AGENT_DISCOVERY_CONFIG.directoryNodeRecords,
    selectionPolicy: {
      ...DEFAULT_AGENT_DISCOVERY_SELECTION_POLICY,
      ...(((raw?.agentDiscovery as JsonRecord | undefined)?.selectionPolicy as
        | JsonRecord
        | undefined) ?? {}),
    },
    policyProfiles: {
      sponsor: {
        ...DEFAULT_AGENT_DISCOVERY_POLICY_PROFILES.sponsor,
        ...(((
          (raw?.agentDiscovery as JsonRecord | undefined)?.policyProfiles as
            | JsonRecord
            | undefined
        )?.sponsor as JsonRecord | undefined) ?? {}),
      },
      observation: {
        ...DEFAULT_AGENT_DISCOVERY_POLICY_PROFILES.observation,
        ...(((
          (raw?.agentDiscovery as JsonRecord | undefined)?.policyProfiles as
            | JsonRecord
            | undefined
        )?.observation as JsonRecord | undefined) ?? {}),
      },
      oracle: {
        ...DEFAULT_AGENT_DISCOVERY_POLICY_PROFILES.oracle,
        ...(((
          (raw?.agentDiscovery as JsonRecord | undefined)?.policyProfiles as
            | JsonRecord
            | undefined
        )?.oracle as JsonRecord | undefined) ?? {}),
      },
      gateway: {
        ...DEFAULT_AGENT_DISCOVERY_POLICY_PROFILES.gateway,
        ...(((
          (raw?.agentDiscovery as JsonRecord | undefined)?.policyProfiles as
            | JsonRecord
            | undefined
        )?.gateway as JsonRecord | undefined) ?? {}),
      },
    },
    reputationUpdates: {
      ...DEFAULT_AGENT_DISCOVERY_REPUTATION_UPDATE_CONFIG,
      ...(((raw?.agentDiscovery as JsonRecord | undefined)
        ?.reputationUpdates as JsonRecord | undefined) ?? {}),
    },
    faucetServer: {
      ...DEFAULT_AGENT_DISCOVERY_FAUCET_SERVER_CONFIG,
      ...(((raw?.agentDiscovery as JsonRecord | undefined)?.faucetServer as
        | JsonRecord
        | undefined) ?? {}),
      requireNativeIdentity:
        typeof (((raw?.agentDiscovery as JsonRecord | undefined)?.faucetServer as
          | JsonRecord
          | undefined)?.requireNativeIdentity) === "boolean"
          ? ((((raw?.agentDiscovery as JsonRecord | undefined)?.faucetServer as
              | JsonRecord
              | undefined)?.requireNativeIdentity as boolean) ?? true)
          : typeof (((raw?.agentDiscovery as JsonRecord | undefined)?.faucetServer as
                | JsonRecord
                | undefined)?.requireTOSIdentity) === "boolean"
            ? ((((raw?.agentDiscovery as JsonRecord | undefined)?.faucetServer as
                | JsonRecord
                | undefined)?.requireTOSIdentity as boolean) ?? true)
            : DEFAULT_AGENT_DISCOVERY_FAUCET_SERVER_CONFIG.requireNativeIdentity,
    },
    observationServer: {
      ...DEFAULT_AGENT_DISCOVERY_OBSERVATION_SERVER_CONFIG,
      ...(((raw?.agentDiscovery as JsonRecord | undefined)
        ?.observationServer as JsonRecord | undefined) ?? {}),
    },
    gatewayServer: {
      ...DEFAULT_AGENT_GATEWAY_SERVER_CONFIG,
      ...(((raw?.agentDiscovery as JsonRecord | undefined)?.gatewayServer as
        | JsonRecord
        | undefined) ?? {}),
    },
    gatewayClient: {
      ...DEFAULT_AGENT_GATEWAY_CLIENT_CONFIG,
      ...(((raw?.agentDiscovery as JsonRecord | undefined)?.gatewayClient as
        | JsonRecord
        | undefined) ?? {}),
      gatewayBootnodes: Array.isArray(
        (raw?.agentDiscovery as JsonRecord | undefined)?.gatewayClient &&
          ((raw?.agentDiscovery as JsonRecord | undefined)?.gatewayClient as JsonRecord)
            .gatewayBootnodes,
      )
        ? ((((raw?.agentDiscovery as JsonRecord | undefined)?.gatewayClient as
            | JsonRecord
            | undefined)?.gatewayBootnodes as unknown[]) ?? [])
            .filter(
              (value): value is JsonRecord =>
                typeof value === "object" &&
                value !== null &&
                typeof (value as JsonRecord).agentId === "string" &&
                typeof (value as JsonRecord).url === "string",
            )
            .map((value) => ({
              agentId: value.agentId as string,
              url: value.url as string,
              ...(typeof value.payToAddress === "string"
                ? { payToAddress: value.payToAddress as `0x${string}` }
                : {}),
              ...(typeof value.paymentDirection === "string"
                ? {
                    paymentDirection: value.paymentDirection as
                      | "provider_pays"
                      | "requester_pays"
                      | "split",
                  }
                : {}),
              ...(typeof value.sessionFeeWei === "string"
                ? { sessionFeeWei: value.sessionFeeWei as string }
                : {}),
              ...(typeof value.perRequestFeeWei === "string"
                ? { perRequestFeeWei: value.perRequestFeeWei as string }
                : {}),
            }))
        : DEFAULT_AGENT_GATEWAY_CLIENT_CONFIG.gatewayBootnodes,
      gatewayBootnodeList:
        typeof (raw?.agentDiscovery as JsonRecord | undefined)?.gatewayClient ===
          "object" &&
        (raw?.agentDiscovery as JsonRecord | undefined)?.gatewayClient !== null &&
        typeof (
          ((raw?.agentDiscovery as JsonRecord | undefined)?.gatewayClient as JsonRecord)
            .gatewayBootnodeList
        ) === "object" &&
        ((raw?.agentDiscovery as JsonRecord | undefined)?.gatewayClient as JsonRecord)
          .gatewayBootnodeList !== null
          ? ((((raw?.agentDiscovery as JsonRecord | undefined)?.gatewayClient as
              JsonRecord).gatewayBootnodeList as JsonRecord) &&
              (() => {
                const value = (((raw?.agentDiscovery as JsonRecord | undefined)
                  ?.gatewayClient as JsonRecord).gatewayBootnodeList as JsonRecord);
                if (
                  typeof value.version !== "number" ||
                  typeof value.networkId !== "number" ||
                  typeof value.issuedAt !== "number" ||
                  typeof value.signer !== "string" ||
                  typeof value.signature !== "string" ||
                  !Array.isArray(value.entries)
                ) {
                  return undefined;
                }
                const entries = (value.entries as unknown[])
                  .filter(
                    (entry): entry is JsonRecord =>
                      typeof entry === "object" &&
                      entry !== null &&
                      typeof (entry as JsonRecord).agentId === "string" &&
                      typeof (entry as JsonRecord).url === "string",
                  )
                  .map((entry) => ({
                    agentId: entry.agentId as string,
                    url: entry.url as string,
                    ...(typeof entry.payToAddress === "string"
                      ? { payToAddress: entry.payToAddress as `0x${string}` }
                      : {}),
                    ...(typeof entry.paymentDirection === "string"
                      ? {
                          paymentDirection: entry.paymentDirection as
                            | "provider_pays"
                            | "requester_pays"
                            | "split",
                        }
                      : {}),
                    ...(typeof entry.sessionFeeWei === "string"
                      ? { sessionFeeWei: entry.sessionFeeWei as string }
                      : {}),
                    ...(typeof entry.perRequestFeeWei === "string"
                      ? { perRequestFeeWei: entry.perRequestFeeWei as string }
                      : {}),
                  }));
                return {
                  version: value.version,
                  networkId: value.networkId,
                  entries,
                  issuedAt: value.issuedAt,
                  signer: value.signer as `0x${string}`,
                  signature: value.signature as `0x${string}`,
                };
              })())
          : DEFAULT_AGENT_GATEWAY_CLIENT_CONFIG.gatewayBootnodeList,
      requireSignedBootnodeList:
        typeof (((raw?.agentDiscovery as JsonRecord | undefined)?.gatewayClient as
          | JsonRecord
          | undefined)?.requireSignedBootnodeList) === "boolean"
          ? ((((raw?.agentDiscovery as JsonRecord | undefined)?.gatewayClient as
              | JsonRecord
              | undefined)?.requireSignedBootnodeList as boolean) ?? false)
          : DEFAULT_AGENT_GATEWAY_CLIENT_CONFIG.requireSignedBootnodeList,
      routes: Array.isArray(
        (raw?.agentDiscovery as JsonRecord | undefined)?.gatewayClient &&
          ((raw?.agentDiscovery as JsonRecord | undefined)?.gatewayClient as JsonRecord)
            .routes,
      )
        ? ((((raw?.agentDiscovery as JsonRecord | undefined)?.gatewayClient as
            | JsonRecord
            | undefined)?.routes as unknown[]) ?? []).filter(
            (value): value is NonNullable<AgentDiscoveryConfig["gatewayClient"]>["routes"][number] =>
              typeof value === "object" &&
              value !== null &&
              typeof (value as JsonRecord).path === "string" &&
              typeof (value as JsonRecord).capability === "string" &&
              typeof (value as JsonRecord).mode === "string" &&
              typeof (value as JsonRecord).targetUrl === "string",
          )
        : DEFAULT_AGENT_GATEWAY_CLIENT_CONFIG.routes,
      feedback: {
        ...DEFAULT_AGENT_GATEWAY_FEEDBACK_CONFIG,
        ...((((raw?.agentDiscovery as JsonRecord | undefined)?.gatewayClient as
          | JsonRecord
          | undefined)?.feedback as JsonRecord | undefined) ?? {}),
      },
    },
  };

  const bounty: BountyConfig = {
    ...DEFAULT_BOUNTY_CONFIG,
    ...((raw?.bounty as JsonRecord | undefined) ?? {}),
    policy: {
      ...DEFAULT_BOUNTY_POLICY,
      ...((((raw?.bounty as JsonRecord | undefined)?.policy as JsonRecord | undefined) ??
        {}) as Partial<BountyConfig["policy"]>),
    },
  };

  const opportunityScout: OpportunityScoutConfig = {
    ...DEFAULT_OPPORTUNITY_SCOUT_CONFIG,
    ...((raw?.opportunityScout as JsonRecord | undefined) ?? {}),
  };

  const modelRef =
    (typeof raw?.inferenceModelRef === "string" &&
      raw.inferenceModelRef.trim()) ||
    compat.modelRef;
  const parsedModelRef = parseModelRef(modelRef);
  const inferenceModel =
    (typeof raw?.inferenceModel === "string" && raw.inferenceModel.trim()) ||
    parsedModelRef.model ||
    compat.model ||
    DEFAULT_CONFIG.inferenceModel ||
    "gpt-5.2";

  if (!modelStrategy.inferenceModel) {
    modelStrategy.inferenceModel = inferenceModel;
  }

  return {
    ...DEFAULT_CONFIG,
    ...(raw ?? {}),
    registeredRemotely: Boolean(raw?.registeredRemotely && runtimeApiKey),
    sandboxId:
      typeof raw?.sandboxId === "string"
        ? raw.sandboxId.trim()
        : DEFAULT_CONFIG.sandboxId || "",
    runtimeApiUrl:
      (typeof process.env.OPENFOX_API_URL === "string" &&
        process.env.OPENFOX_API_URL.trim()) ||
      (typeof raw?.runtimeApiUrl === "string" && raw.runtimeApiUrl.trim()) ||
      undefined,
    runtimeApiKey,
    openaiApiKey:
      (typeof process.env.OPENAI_API_KEY === "string" &&
        process.env.OPENAI_API_KEY.trim()) ||
      compat.openaiApiKey ||
      (typeof raw?.openaiApiKey === "string" && raw.openaiApiKey.trim()) ||
      undefined,
    anthropicApiKey:
      (typeof process.env.ANTHROPIC_API_KEY === "string" &&
        process.env.ANTHROPIC_API_KEY.trim()) ||
      compat.anthropicApiKey ||
      (typeof raw?.anthropicApiKey === "string" &&
        raw.anthropicApiKey.trim()) ||
      undefined,
    ollamaBaseUrl:
      (typeof process.env.OLLAMA_BASE_URL === "string" &&
        process.env.OLLAMA_BASE_URL.trim()) ||
      compat.ollamaBaseUrl ||
      (typeof raw?.ollamaBaseUrl === "string" && raw.ollamaBaseUrl.trim()) ||
      undefined,
    inferenceModel,
    inferenceModelRef: modelRef,
    walletAddress:
      typeof raw?.walletAddress === "string" && raw.walletAddress.trim()
        ? (raw.walletAddress.trim() as HexAddress)
        : typeof raw?.walletAddress === "string" &&
            raw.walletAddress.trim()
          ? (raw.walletAddress.trim() as HexAddress)
          : DEFAULT_CONFIG.walletAddress!,
    rpcUrl:
      typeof process.env.TOS_RPC_URL === "string" &&
      process.env.TOS_RPC_URL.trim()
        ? process.env.TOS_RPC_URL.trim()
        : typeof raw?.rpcUrl === "string" && raw.rpcUrl.trim()
          ? raw.rpcUrl.trim()
          : typeof raw?.rpcUrl === "string" && raw.rpcUrl.trim()
            ? raw.rpcUrl.trim()
            : DEFAULT_CONFIG.rpcUrl,
    chainId:
      typeof raw?.chainId === "number"
        ? raw.chainId
        : typeof raw?.chainId === "number"
          ? raw.chainId
          : DEFAULT_CONFIG.chainId,
    socialRelayUrl:
      typeof raw?.socialRelayUrl === "string" && raw.socialRelayUrl.trim()
        ? raw.socialRelayUrl.trim()
        : undefined,
    treasuryPolicy,
    modelStrategy,
    soulConfig,
    agentDiscovery,
    bounty,
    opportunityScout,
  } as OpenFoxConfig;
}

/**
 * Save the openfox config to disk.
 */
export function saveConfig(config: OpenFoxConfig): void {
  const dir = getOpenFoxDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }

  const configPath = getConfigPath();
  const toSave = {
    ...config,
    treasuryPolicy: config.treasuryPolicy ?? DEFAULT_TREASURY_POLICY,
    modelStrategy: config.modelStrategy ?? DEFAULT_MODEL_STRATEGY_CONFIG,
    soulConfig: config.soulConfig ?? DEFAULT_SOUL_CONFIG,
    agentDiscovery: config.agentDiscovery ?? DEFAULT_AGENT_DISCOVERY_CONFIG,
    bounty: config.bounty ?? DEFAULT_BOUNTY_CONFIG,
    opportunityScout: config.opportunityScout ?? DEFAULT_OPPORTUNITY_SCOUT_CONFIG,
  };
  fs.writeFileSync(configPath, JSON.stringify(toSave, null, 2), {
    mode: 0o600,
  });
}

/**
 * Resolve ~ paths to absolute paths.
 */
export function resolvePath(p: string): string {
  if (p.startsWith("~")) {
    return path.join(process.env.HOME || "/root", p.slice(1));
  }
  return p;
}

/**
 * Create a fresh config from setup wizard inputs.
 */
export function createConfig(params: {
  name: string;
  genesisPrompt: string;
  creatorMessage?: string;
  creatorAddress: HexAddress;
  registeredRemotely?: boolean;
  sandboxId: string;
  walletAddress: HexAddress;
  rpcUrl?: string;
  chainId?: number;
  apiKey?: string;
  openaiApiKey?: string;
  anthropicApiKey?: string;
  ollamaBaseUrl?: string;
  inferenceModel?: string;
  inferenceModelRef?: string;
  parentAddress?: HexAddress;
  treasuryPolicy?: TreasuryPolicy;
}): OpenFoxConfig {
  const normalizedSandboxId = (params.sandboxId || "").trim();
  const inferredModelRef = params.inferenceModelRef?.trim();
  const parsedModelRef = parseModelRef(inferredModelRef);
  const inferenceModel =
    params.inferenceModel?.trim() ||
    parsedModelRef.model ||
    DEFAULT_CONFIG.inferenceModel ||
    "gpt-5.2";

  return {
    name: params.name,
    genesisPrompt: params.genesisPrompt,
    creatorMessage: params.creatorMessage,
    creatorAddress: params.creatorAddress,
    registeredRemotely: Boolean(params.registeredRemotely && params.apiKey),
    sandboxId: normalizedSandboxId,
    runtimeApiUrl: undefined,
    runtimeApiKey: params.apiKey?.trim() || undefined,
    openaiApiKey: params.openaiApiKey,
    anthropicApiKey: params.anthropicApiKey,
    ollamaBaseUrl: params.ollamaBaseUrl,
    inferenceModel,
    inferenceModelRef: inferredModelRef,
    maxTokensPerTurn: DEFAULT_CONFIG.maxTokensPerTurn || 4096,
    heartbeatConfigPath:
      DEFAULT_CONFIG.heartbeatConfigPath || "~/.openfox/heartbeat.yml",
    dbPath: DEFAULT_CONFIG.dbPath || "~/.openfox/state.db",
    logLevel: (DEFAULT_CONFIG.logLevel as OpenFoxConfig["logLevel"]) || "info",
    walletAddress: params.walletAddress,
    rpcUrl: params.rpcUrl,
    chainId: params.chainId,
    version: DEFAULT_CONFIG.version || "0.2.1",
    skillsDir: DEFAULT_CONFIG.skillsDir || "~/.openfox/skills",
    maxChildren: DEFAULT_CONFIG.maxChildren || 3,
    parentAddress: params.parentAddress,
    treasuryPolicy: params.treasuryPolicy ?? DEFAULT_TREASURY_POLICY,
    modelStrategy: {
      ...DEFAULT_MODEL_STRATEGY_CONFIG,
      inferenceModel,
    },
    agentDiscovery: DEFAULT_AGENT_DISCOVERY_CONFIG,
    bounty: DEFAULT_BOUNTY_CONFIG,
    opportunityScout: DEFAULT_OPPORTUNITY_SCOUT_CONFIG,
  };
}
