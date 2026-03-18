/**
 * Pipeline Factory
 *
 * GTOS 2046: Creates a fully configured IntentPipeline from OpenFox config
 * and state. Reads config, initializes the FinancialRouter, TerminalRegistry,
 * AuditJournal, and policies, then returns a ready-to-use IntentPipeline.
 */

import type { OpenFoxConfig, OpenFoxDatabase } from "../types.js";
import type { PipelineConfig } from "./types.js";
import type { SponsorPolicy } from "../sponsor/types.js";
import type { RoutingPolicy } from "../routing/types.js";
import { IntentPipeline } from "./executor.js";
import type { ChainExecutor } from "./executor.js";
import { FinancialRouter } from "../routing/router.js";
import { TerminalRegistry } from "../terminal/registry.js";
import { SessionStore } from "../terminal/session-store.js";
import { AuditJournal } from "../audit/journal.js";
import { DEFAULT_ESCALATION_RULES } from "../intent/escalation.js";
import { RPCChainExecutor, type ChainExecutorConfig } from "./chain-executor.js";
import { SponsoredChainExecutor, type SponsorConfig } from "./sponsored-executor.js";
import { checkSchemaCompatibility } from "./schema-check.js";
import { checkMatrixCompatibility } from "./compat-matrix.js";
import {
  discoverIntentRouteProviders,
  discoverIntentSponsorQuotes,
} from "../agent-discovery/financial-discovery.js";

const DEFAULT_SPONSOR_POLICY: SponsorPolicy = {
  preferredSponsors: [],
  maxFeePercent: 1.0,
  maxFeeAbsolute: "1000000000000000000", // 1 TOS
  minTrustTier: 1,
  strategy: "cheapest",
  fallbackEnabled: true,
  autoSelectEnabled: true,
};

const DEFAULT_ROUTING_POLICY: RoutingPolicy = {
  strategy: "balanced",
  minTrustTier: 1,
  maxFeePercent: 5,
  maxLatencyMs: 10000,
  preferredProviders: [],
  excludedProviders: [],
  requireSponsor: false,
  allowGateway: true,
  maxHops: 2,
};

export interface CreatePipelineOptions {
  /** Override the default chain executor (useful for live execution). */
  chainExecutor?: ChainExecutor;
  /** Override the default sponsor policy. */
  sponsorPolicy?: Partial<SponsorPolicy>;
  /** Override the default routing policy. */
  routingPolicy?: Partial<RoutingPolicy>;
  /** Override auto-approve setting (default: true). */
  autoApprove?: boolean;
  /** Override audit enabled setting (default: true). */
  auditEnabled?: boolean;
  /** Override default TTL in seconds (default: 300). */
  defaultTTL?: number;
}

/**
 * Creates a fully configured IntentPipeline from OpenFox config and state.
 *
 * @param config - The OpenFox configuration.
 * @param db - The OpenFox database (must expose the underlying sqlite handle via `.db`).
 * @param options - Optional overrides for pipeline sub-components.
 */
export function createPipeline(
  config: OpenFoxConfig,
  db: OpenFoxDatabase,
  options?: CreatePipelineOptions,
): IntentPipeline {
  const sponsorPolicy: SponsorPolicy = {
    ...DEFAULT_SPONSOR_POLICY,
    ...options?.sponsorPolicy,
  };

  const routingPolicy: RoutingPolicy = {
    ...DEFAULT_ROUTING_POLICY,
    ...options?.routingPolicy,
  };

  const pipelineConfig: PipelineConfig = {
    defaultTTL: options?.defaultTTL ?? 300,
    sponsorPolicy,
    routingPolicy,
    escalationRules: DEFAULT_ESCALATION_RULES,
    autoApprove: options?.autoApprove ?? true,
    auditEnabled: options?.auditEnabled ?? true,
  };

  const router = new FinancialRouter(routingPolicy);
  const terminal = createTerminalRegistry(db);

  // Create audit journal if the database exposes a raw sqlite handle.
  // The OpenFoxDatabase wraps better-sqlite3; we access `.db` when available.
  let audit: AuditJournal | undefined;
  const rawDb = (db as unknown as { db?: import("better-sqlite3").Database }).db;
  if (rawDb) {
    audit = new AuditJournal(rawDb);
  }

  return new IntentPipeline({
    router,
    terminal,
    audit,
    config: pipelineConfig,
    chainExecutor: options?.chainExecutor,
    routeDiscoveryProvider: config.agentDiscovery?.enabled
      ? async (params) => discoverIntentRouteProviders({
          config,
          db,
          execution: params,
        })
      : undefined,
    sponsorQuoteProvider: config.agentDiscovery?.enabled
      ? async (params) => discoverIntentSponsorQuotes({
          config,
          db,
          execution: params,
        })
      : undefined,
  });
}

/**
 * Create a standalone TerminalRegistry (for terminal management commands).
 * When a database is provided, sessions are persisted via SessionStore.
 */
export function createTerminalRegistry(db?: OpenFoxDatabase): TerminalRegistry {
  const rawDb = db
    ? (db as unknown as { db?: import("better-sqlite3").Database }).db
    : undefined;
  const store = rawDb ? new SessionStore(rawDb) : undefined;
  return new TerminalRegistry(store);
}

/**
 * Create a standalone AuditJournal from the database.
 * Returns null if the raw sqlite handle is not available.
 */
export function createAuditJournal(db: OpenFoxDatabase): AuditJournal | null {
  const rawDb = (db as unknown as { db?: import("better-sqlite3").Database }).db;
  if (!rawDb) return null;
  return new AuditJournal(rawDb);
}

/**
 * Creates a fully configured IntentPipeline with a real RPC chain executor,
 * replacing simulated execution with live transaction submission to a GTOS node.
 *
 * @param config - The OpenFox configuration.
 * @param db - The OpenFox database.
 * @param chainConfig - Configuration for the RPC chain executor.
 * @param options - Optional overrides for pipeline sub-components.
 */
export async function createLivePipeline(
  config: OpenFoxConfig,
  db: OpenFoxDatabase,
  chainConfig: ChainExecutorConfig,
  options?: Omit<CreatePipelineOptions, "chainExecutor">,
): Promise<IntentPipeline> {
  // Check boundary schema compatibility with the GTOS node at startup.
  const schemaResult = await checkSchemaCompatibility(chainConfig.rpcUrl);
  if (!schemaResult.compatible) {
    const msg = `GTOS schema incompatibility: ${schemaResult.message}`;
    if (schemaResult.remoteVersion === "unknown") {
      // Node may not support the RPC yet — warn but continue.
      console.warn(`[openfox] ${msg} (continuing with degraded compatibility checks)`);
    } else {
      throw new Error(msg);
    }
  }

  // Cross-check against the compatibility matrix if the remote version is known.
  if (schemaResult.remoteVersion !== "unknown") {
    const matrixResult = checkMatrixCompatibility(
      "openfox",
      "gtos",
      schemaResult.remoteVersion,
    );
    if (!matrixResult.compatible) {
      throw new Error(`Compatibility matrix check failed: ${matrixResult.reason}`);
    }
  }

  const executor = new RPCChainExecutor(chainConfig);
  return createPipeline(config, db, {
    ...options,
    chainExecutor: executor.toChainExecutor(),
  });
}

/**
 * Creates a fully configured IntentPipeline with a sponsored (gasless)
 * chain executor. Transactions are submitted through a paymaster that
 * covers gas fees on behalf of the user.
 *
 * @param config - The OpenFox configuration.
 * @param db - The OpenFox database.
 * @param chainConfig - Configuration for the base RPC chain executor.
 * @param sponsorConfig - Configuration for the sponsor/paymaster.
 * @param options - Optional overrides for pipeline sub-components.
 */
export function createSponsoredPipeline(
  config: OpenFoxConfig,
  db: OpenFoxDatabase,
  chainConfig: ChainExecutorConfig,
  sponsorConfig: SponsorConfig,
  options?: Omit<CreatePipelineOptions, "chainExecutor">,
): IntentPipeline {
  const baseExecutor = new RPCChainExecutor(chainConfig);
  const sponsoredExecutor = new SponsoredChainExecutor(
    baseExecutor,
    sponsorConfig,
  );
  return createPipeline(config, db, {
    ...options,
    chainExecutor: sponsoredExecutor.toChainExecutor(),
  });
}
