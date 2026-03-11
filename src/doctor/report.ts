import fs from "fs";
import type BetterSqlite3 from "better-sqlite3";
import { getConfigPath, loadConfig, resolvePath } from "../config.js";
import { buildSkillStatusReport } from "../skills/loader.js";
import type { OpenFoxConfig, OpenFoxDatabase } from "../types.js";
import { getWalletPath, walletExists } from "../identity/wallet.js";
import { buildWalletStatusSnapshot } from "../wallet/operator.js";
import { TOSRpcClient } from "../tos/client.js";
import {
  buildGatewayStatusReport,
  buildServiceStatusReport,
  runServiceHealthChecks,
} from "../service/operator.js";
import {
  getManagedServiceStatus,
  buildManagedServiceStatusReport,
  type ManagedServiceStatus,
} from "../service/daemon.js";
import {
  createDatabase,
  getUnconsumedWakeEvents,
  isHeartbeatPaused,
  isOperatorDrained,
} from "../state/database.js";
import { buildProviderReputationSnapshot } from "../operator/provider-reputation.js";
import { buildStorageLeaseHealthSnapshot } from "../operator/storage-health.js";
import { buildOperatorAutopilotSnapshot } from "../operator/autopilot.js";

export type DoctorSeverity = "ok" | "warn" | "error";

export interface DoctorFinding {
  id: string;
  severity: DoctorSeverity;
  summary: string;
  recommendation?: string;
}

export interface HealthSnapshot {
  configPath: string;
  walletPath: string;
  configPresent: boolean;
  walletPresent: boolean;
  inferenceConfigured: boolean;
  rpcConfigured: boolean;
  discoveryEnabled: boolean;
  operatorApiEnabled: boolean;
  operatorApiReady: boolean;
  autopilotEnabled: boolean;
  autopilotPendingApprovals: number;
  autopilotQuarantinedProviders: number;
  gatewayEnabled: boolean;
  providerEnabled: boolean;
  signerProviderEnabled: boolean;
  signerProviderReady: boolean;
  signerRecentQuotes: number;
  signerRecentExecutions: number;
  signerPendingExecutions: number;
  signerPolicyConfigured: boolean;
  signerPolicyExpired: boolean;
  paymasterProviderEnabled: boolean;
  paymasterProviderReady: boolean;
  paymasterRecentQuotes: number;
  paymasterRecentAuthorizations: number;
  paymasterPendingAuthorizations: number;
  paymasterPolicyConfigured: boolean;
  paymasterPolicyExpired: boolean;
  paymasterSponsorFunded: boolean | null;
  paymasterSignerParityAligned: boolean;
  bountyEnabled: boolean;
  bountyRole?: "host" | "solver";
  bountyAutoEnabled: boolean;
  bountyRemoteConfigured: boolean;
  storageEnabled: boolean;
  storageReady: boolean;
  storageAnonymousGet: boolean;
  storageAnchorEnabled: boolean;
  storageRecentLeases: number;
  storageActiveLeases: number;
  storageRecentRenewals: number;
  storageRecentAudits: number;
  storageRecentAnchors: number;
  storageDueRenewals: number;
  storageDueAudits: number;
  storageCriticalLeases: number;
  storageUnderReplicatedBundles: number;
  storageReplicationReady: boolean;
  artifactsEnabled: boolean;
  artifactsReady: boolean;
  artifactsRecentCount: number;
  artifactsVerifiedCount: number;
  artifactsAnchoredCount: number;
  weakProviderCount: number;
  criticalProviderKinds: string[];
  x402ServerEnabled: boolean;
  x402ServerReady: boolean;
  x402RecentPayments: number;
  x402PendingPayments: number;
  x402FailedPayments: number;
  x402UnboundPayments: number;
  settlementEnabled: boolean;
  settlementReady: boolean;
  settlementRecentCount: number;
  settlementCallbacksEnabled: boolean;
  settlementPendingCallbacks: number;
  settlementMisconfiguredKinds: string[];
  marketContractsEnabled: boolean;
  marketContractsReady: boolean;
  marketBindingsRecentCount: number;
  marketPendingCallbacks: number;
  marketMisconfiguredKinds: string[];
  opportunityScoutEnabled: boolean;
  managedService: ManagedServiceStatus;
  heartbeatPaused: boolean;
  operatorDrained: boolean;
  pendingWakes: number;
  skillCount: number;
  ineligibleEnabledSkills: string[];
  walletSignerType?: string;
  walletSignerDefaulted?: boolean;
  serviceStatusReport?: string;
  gatewayStatusReport?: string;
  serviceHealthReport?: string;
  findings: DoctorFinding[];
}

function yesNo(value: boolean): string {
  return value ? "yes" : "no";
}

function hasConfiguredInference(config: OpenFoxConfig): boolean {
  return Boolean(
    config.openaiApiKey ||
      config.anthropicApiKey ||
      config.ollamaBaseUrl ||
      config.inferenceModelRef ||
      config.inferenceModel,
  );
}

function isProviderEnabled(config: OpenFoxConfig): boolean {
  return Boolean(
      config.agentDiscovery?.faucetServer?.enabled ||
      config.agentDiscovery?.observationServer?.enabled ||
      config.agentDiscovery?.oracleServer?.enabled ||
      config.signerProvider?.enabled ||
      config.paymasterProvider?.enabled ||
      config.storage?.enabled ||
      (config.agentDiscovery?.gatewayClient?.enabled &&
        (config.agentDiscovery.gatewayClient.routes?.length ?? 0) > 0),
  );
}

async function buildConfigSnapshot(
  config: OpenFoxConfig,
  db: OpenFoxDatabase,
): Promise<{
  inferenceConfigured: boolean;
  rpcConfigured: boolean;
  discoveryEnabled: boolean;
  operatorApiEnabled: boolean;
  operatorApiReady: boolean;
  autopilotEnabled: boolean;
  autopilotPendingApprovals: number;
  autopilotQuarantinedProviders: number;
  gatewayEnabled: boolean;
  providerEnabled: boolean;
  signerProviderEnabled: boolean;
  signerProviderReady: boolean;
  signerRecentQuotes: number;
  signerRecentExecutions: number;
  signerPendingExecutions: number;
  signerPolicyConfigured: boolean;
  signerPolicyExpired: boolean;
  paymasterProviderEnabled: boolean;
  paymasterProviderReady: boolean;
  paymasterRecentQuotes: number;
  paymasterRecentAuthorizations: number;
  paymasterPendingAuthorizations: number;
  paymasterPolicyConfigured: boolean;
  paymasterPolicyExpired: boolean;
  paymasterSponsorFunded: boolean | null;
  paymasterSignerParityAligned: boolean;
  bountyEnabled: boolean;
  bountyRole?: "host" | "solver";
  bountyAutoEnabled: boolean;
  bountyRemoteConfigured: boolean;
  storageEnabled: boolean;
  storageReady: boolean;
  storageAnonymousGet: boolean;
  storageAnchorEnabled: boolean;
  storageRecentLeases: number;
  storageActiveLeases: number;
  storageRecentRenewals: number;
  storageRecentAudits: number;
  storageRecentAnchors: number;
  storageDueRenewals: number;
  storageDueAudits: number;
  storageCriticalLeases: number;
  storageUnderReplicatedBundles: number;
  storageReplicationReady: boolean;
  artifactsEnabled: boolean;
  artifactsReady: boolean;
  artifactsRecentCount: number;
  artifactsVerifiedCount: number;
  artifactsAnchoredCount: number;
  weakProviderCount: number;
  criticalProviderKinds: string[];
  x402ServerEnabled: boolean;
  x402ServerReady: boolean;
  x402RecentPayments: number;
  x402PendingPayments: number;
  x402FailedPayments: number;
  x402UnboundPayments: number;
  settlementEnabled: boolean;
  settlementReady: boolean;
  settlementRecentCount: number;
  settlementCallbacksEnabled: boolean;
  settlementPendingCallbacks: number;
  settlementMisconfiguredKinds: string[];
  marketContractsEnabled: boolean;
  marketContractsReady: boolean;
  marketBindingsRecentCount: number;
  marketPendingCallbacks: number;
  marketMisconfiguredKinds: string[];
  opportunityScoutEnabled: boolean;
  skillCount: number;
  ineligibleEnabledSkills: string[];
  heartbeatPaused: boolean;
  operatorDrained: boolean;
  pendingWakes: number;
  serviceStatusReport: string;
  gatewayStatusReport: string;
  serviceHealthReport: string;
}> {
  const skillEntries = buildSkillStatusReport(config.skillsDir || "~/.openfox/skills", db);
  const enabledSkills = skillEntries.filter((entry) => entry.enabled);
  const ineligibleEnabledSkills = enabledSkills
    .filter((entry) => !entry.eligible)
    .map((entry) => entry.name);
  const activeStorageLeases = config.storage?.enabled
    ? db.listStorageLeases(500, { status: "active" })
    : [];
  const storageLeaseHealth = buildStorageLeaseHealthSnapshot({
    config,
    db,
    limit: 500,
  });
  const providerReputation = buildProviderReputationSnapshot({
    db,
    limit: 500,
  });
  const autopilot = buildOperatorAutopilotSnapshot(config, db);
  const storageDueRenewals = config.storage?.enabled
    ? activeStorageLeases.filter((lease) => {
        const leadMs =
          (config.storage?.leaseHealth.renewalLeadSeconds ?? 0) * 1000;
        return new Date(lease.receipt.expiresAt).getTime() - Date.now() <= leadMs;
      }).length
    : 0;
  const storageUnderReplicatedBundles = config.storage?.enabled
    ? Math.max(
        0,
        Array.from(
          activeStorageLeases.reduce((map, lease) => {
            const items = map.get(lease.cid) ?? [];
            items.push(lease);
            map.set(lease.cid, items);
            return map;
          }, new Map<string, typeof activeStorageLeases>()),
        ).filter(([, leases]) => {
          const target = config.storage?.replication.enabled
            ? config.storage.replication.targetCopies
            : 1;
          return leases.length < target;
        }).length,
      )
    : 0;
  const sponsorAddress =
    config.paymasterProvider?.enabled && config.paymasterProvider.policy.sponsorAddress
      ? config.paymasterProvider.policy.sponsorAddress
      : config.paymasterProvider?.enabled
        ? config.walletAddress
        : undefined;
  let paymasterSponsorFunded: boolean | null = null;
  if (config.paymasterProvider?.enabled && config.rpcUrl && sponsorAddress) {
    try {
      const rpc = new TOSRpcClient({ rpcUrl: config.rpcUrl });
      const sponsorBalance = await rpc.getBalance(sponsorAddress as `0x${string}`);
      paymasterSponsorFunded = sponsorBalance > 0n;
    } catch {
      paymasterSponsorFunded = null;
    }
  }

  return {
    inferenceConfigured: hasConfiguredInference(config),
    rpcConfigured: Boolean(config.rpcUrl),
    discoveryEnabled: config.agentDiscovery?.enabled === true,
    operatorApiEnabled: config.operatorApi?.enabled === true,
    operatorApiReady: Boolean(
      !config.operatorApi?.enabled || config.operatorApi.authToken,
    ),
    autopilotEnabled: autopilot.enabled,
    autopilotPendingApprovals: autopilot.approvals.pending,
    autopilotQuarantinedProviders: autopilot.quarantinedProviders.length,
    gatewayEnabled:
      config.agentDiscovery?.gatewayServer?.enabled === true ||
      config.agentDiscovery?.gatewayClient?.enabled === true,
    providerEnabled: isProviderEnabled(config),
    signerProviderEnabled: config.signerProvider?.enabled === true,
    signerProviderReady: Boolean(!config.signerProvider?.enabled || config.rpcUrl),
    signerRecentQuotes: config.signerProvider?.enabled ? db.listSignerQuotes(20).length : 0,
    signerRecentExecutions: config.signerProvider?.enabled
      ? db.listSignerExecutions(20).length
      : 0,
    signerPendingExecutions: config.signerProvider?.enabled
      ? db.listSignerExecutions(100, { status: "pending" }).length +
        db.listSignerExecutions(100, { status: "submitted" }).length
      : 0,
    signerPolicyConfigured: Boolean(
      !config.signerProvider?.enabled ||
        ((config.signerProvider.policy.allowedTargets?.length ?? 0) > 0 &&
          config.signerProvider.policy.policyId),
    ),
    signerPolicyExpired: Boolean(
      config.signerProvider?.enabled &&
        config.signerProvider.policy.expiresAt &&
        new Date(config.signerProvider.policy.expiresAt).getTime() <= Date.now(),
    ),
    paymasterProviderEnabled: config.paymasterProvider?.enabled === true,
    paymasterProviderReady: Boolean(!config.paymasterProvider?.enabled || config.rpcUrl),
    paymasterRecentQuotes: config.paymasterProvider?.enabled
      ? db.listPaymasterQuotes(20).length
      : 0,
    paymasterRecentAuthorizations: config.paymasterProvider?.enabled
      ? db.listPaymasterAuthorizations(20).length
      : 0,
    paymasterPendingAuthorizations: config.paymasterProvider?.enabled
      ? db.listPaymasterAuthorizations(100, { status: "authorized" }).length +
        db.listPaymasterAuthorizations(100, { status: "submitted" }).length
      : 0,
    paymasterPolicyConfigured: Boolean(
      !config.paymasterProvider?.enabled ||
        (config.paymasterProvider.policy.policyId &&
          (config.paymasterProvider.policy.allowedTargets?.length ?? 0) > 0),
    ),
    paymasterPolicyExpired: Boolean(
      config.paymasterProvider?.enabled &&
        config.paymasterProvider.policy.expiresAt &&
        new Date(config.paymasterProvider.policy.expiresAt).getTime() <= Date.now(),
    ),
    paymasterSponsorFunded,
    paymasterSignerParityAligned: Boolean(
      !config.paymasterProvider?.enabled || config.rpcUrl,
    ),
    bountyEnabled: config.bounty?.enabled === true,
    bountyRole: config.bounty?.enabled ? config.bounty.role : undefined,
    bountyAutoEnabled: Boolean(
      config.bounty?.enabled &&
        (config.bounty.autoOpenOnStartup ||
          config.bounty.autoOpenWhenIdle ||
          config.bounty.autoSolveOnStartup ||
          config.bounty.autoSolveEnabled),
    ),
    bountyRemoteConfigured: Boolean(config.bounty?.remoteBaseUrl),
    storageEnabled: config.storage?.enabled === true,
    storageReady: Boolean(
      !config.storage?.enabled || !config.storage.anchor.enabled || config.rpcUrl,
    ),
    storageAnonymousGet: config.storage?.allowAnonymousGet === true,
    storageAnchorEnabled:
      config.storage?.enabled === true && config.storage.anchor.enabled === true,
    storageRecentLeases: config.storage?.enabled ? db.listStorageLeases(20).length : 0,
    storageActiveLeases: activeStorageLeases.length,
    storageRecentRenewals: config.storage?.enabled
      ? db.listStorageRenewals(20).length
      : 0,
    storageRecentAudits: config.storage?.enabled ? db.listStorageAudits(20).length : 0,
    storageRecentAnchors: config.storage?.enabled ? db.listStorageAnchors(20).length : 0,
    storageDueRenewals,
    storageDueAudits: storageLeaseHealth.dueAudits,
    storageCriticalLeases: storageLeaseHealth.critical,
    storageUnderReplicatedBundles,
    storageReplicationReady: Boolean(
      !config.storage?.enabled ||
        !config.storage.replication?.enabled ||
        config.storage.replication.targetCopies <= 1 ||
        (config.storage.replication.providerBaseUrls?.length ?? 0) > 0,
    ),
    artifactsEnabled: config.artifacts?.enabled === true,
    artifactsReady: Boolean(
      !config.artifacts?.enabled ||
        config.artifacts.defaultProviderBaseUrl ||
        config.storage?.enabled,
    ),
    artifactsRecentCount: config.artifacts?.enabled ? db.listArtifacts(20).length : 0,
    artifactsVerifiedCount: config.artifacts?.enabled
      ? db.listArtifacts(100, { status: "verified" }).length
      : 0,
    artifactsAnchoredCount: config.artifacts?.enabled
      ? db.listArtifacts(100, { status: "anchored" }).length
      : 0,
    weakProviderCount: providerReputation.weakProviders,
    criticalProviderKinds: Array.from(
      new Set(
        providerReputation.entries
          .filter((entry) => entry.score < 50)
          .map((entry) => entry.kind),
      ),
    ),
    x402ServerEnabled: config.x402Server?.enabled === true,
    x402ServerReady: Boolean(!config.x402Server?.enabled || config.rpcUrl),
    x402RecentPayments: config.x402Server?.enabled ? db.listX402Payments(20).length : 0,
    x402PendingPayments: config.x402Server?.enabled
      ? db.listX402Payments(100, { status: "verified" }).length +
        db.listX402Payments(100, { status: "submitted" }).length
      : 0,
    x402FailedPayments: config.x402Server?.enabled
      ? db.listX402Payments(100, { status: "failed" }).length
      : 0,
    x402UnboundPayments: config.x402Server?.enabled
      ? db.listX402Payments(100, { bound: false }).length
      : 0,
    settlementEnabled: config.settlement?.enabled === true,
    settlementReady: Boolean(!config.settlement?.enabled || config.rpcUrl),
    settlementRecentCount: config.settlement?.enabled
      ? db.listSettlementReceipts(5).length
      : 0,
    settlementCallbacksEnabled:
      config.settlement?.enabled === true &&
      config.settlement.callbacks.enabled === true,
    settlementPendingCallbacks:
      config.settlement?.enabled && config.settlement.callbacks.enabled
        ? db.listSettlementCallbacks(100, { status: "pending" }).length
        : 0,
    settlementMisconfiguredKinds:
      config.settlement?.enabled && config.settlement.callbacks.enabled
        ? (["bounty", "observation", "oracle"] as const).filter((kind) => {
            const target = config.settlement?.callbacks[kind];
            return target?.enabled && !target.contractAddress;
          })
        : [],
    marketContractsEnabled: config.marketContracts?.enabled === true,
    marketContractsReady: Boolean(
      !config.marketContracts?.enabled ||
        config.rpcUrl ||
        !(["bounty", "observation", "oracle"] as const).some(
          (kind) => config.marketContracts?.[kind]?.enabled,
        ),
    ),
    marketBindingsRecentCount: config.marketContracts?.enabled
      ? db.listMarketBindings(5).length
      : 0,
    marketPendingCallbacks: config.marketContracts?.enabled
      ? db.listMarketContractCallbacks(100, { status: "pending" }).length
      : 0,
    marketMisconfiguredKinds: config.marketContracts?.enabled
      ? (["bounty", "observation", "oracle"] as const).filter((kind) => {
          const target = config.marketContracts?.[kind];
          return (
            target?.enabled &&
            (!target.contractAddress || !target.packageName || !target.functionSignature)
          );
        })
      : [],
    opportunityScoutEnabled: config.opportunityScout?.enabled === true,
    skillCount: enabledSkills.length,
    ineligibleEnabledSkills,
    heartbeatPaused: isHeartbeatPaused(db.raw),
    operatorDrained: isOperatorDrained(db.raw),
    pendingWakes: getUnconsumedWakeEvents(db.raw).length,
    serviceStatusReport: buildServiceStatusReport(config, db.raw),
    gatewayStatusReport: await buildGatewayStatusReport(config, db.raw),
    serviceHealthReport: await runServiceHealthChecks(config),
  };
}

function collectFindings(
  snapshot: Omit<HealthSnapshot, "findings">,
): DoctorFinding[] {
  const findings: DoctorFinding[] = [];

  if (!snapshot.configPresent) {
    findings.push({
      id: "config-missing",
      severity: "error",
      summary: "OpenFox config is missing.",
      recommendation: "Run `openfox --setup` to create ~/.openfox/openfox.json.",
    });
  } else {
    findings.push({ id: "config-present", severity: "ok", summary: "Config file found." });
  }

  if (!snapshot.walletPresent) {
    findings.push({
      id: "wallet-missing",
      severity: "error",
      summary: "OpenFox wallet is missing.",
      recommendation: "Run `openfox --setup` to create ~/.openfox/wallet.json.",
    });
  } else {
    findings.push({ id: "wallet-present", severity: "ok", summary: "Wallet file found." });
  }

  if (!snapshot.inferenceConfigured) {
    findings.push({
      id: "inference-missing",
      severity: "error",
      summary: "No inference provider is configured.",
      recommendation:
        "Set OpenAI/Anthropic credentials or OLLAMA_BASE_URL, then run `openfox --configure`.",
    });
  } else {
    findings.push({
      id: "inference-configured",
      severity: "ok",
      summary: "Inference provider configuration is present.",
    });
  }

  if (!snapshot.rpcConfigured) {
    findings.push({
      id: "rpc-missing",
      severity: "warn",
      summary: "No chain RPC URL is configured.",
      recommendation: "Set `rpcUrl` in ~/.openfox/openfox.json for native wallet and service flows.",
    });
  } else {
    findings.push({
      id: "rpc-configured",
      severity: "ok",
      summary: "Chain RPC URL is configured.",
    });
  }

  if (snapshot.operatorApiEnabled && !snapshot.operatorApiReady) {
    findings.push({
      id: "operator-api-misconfigured",
      severity: "error",
      summary: "Operator API is enabled without an auth token.",
      recommendation:
        "Set operatorApi.authToken in ~/.openfox/openfox.json before exposing multi-node operator endpoints.",
    });
  } else if (snapshot.operatorApiEnabled) {
    findings.push({
      id: "operator-api-enabled",
      severity: "ok",
      summary: "Operator API is enabled for remote status and audit access.",
    });
  }

  if (snapshot.autopilotEnabled) {
    findings.push({
      id: "autopilot-enabled",
      severity: snapshot.autopilotPendingApprovals > 0 ? "warn" : "ok",
      summary:
        snapshot.autopilotPendingApprovals > 0
          ? `Operator autopilot is enabled with ${snapshot.autopilotPendingApprovals} pending approval request(s).`
          : "Operator autopilot is enabled for low-risk maintenance.",
      recommendation:
        snapshot.autopilotPendingApprovals > 0
          ? "Run `openfox autopilot approvals --json` and explicitly approve or reject pending high-risk requests."
          : undefined,
    });
    if (snapshot.autopilotQuarantinedProviders > 0) {
      findings.push({
        id: "autopilot-provider-quarantine",
        severity: "warn",
        summary: `Operator autopilot has quarantined ${snapshot.autopilotQuarantinedProviders} provider(s).`,
        recommendation:
          "Inspect provider reputation snapshots and operator control events before widening policy or restoring providers.",
      });
    }
  }

  if (
    snapshot.walletSignerType &&
    snapshot.walletSignerType !== "address" &&
    snapshot.walletSignerType !== "secp256k1"
  ) {
    findings.push({
      id: "non-secp-signer-active",
      severity: "warn",
      summary: `Active signer metadata is ${snapshot.walletSignerType}.`,
      recommendation:
        "OpenFox local wallet flows still use the built-in secp256k1 wallet. Use non-secp signer mode only if you intentionally switched the on-chain signer metadata and understand the delegated execution boundary.",
    });
  }

  if (!snapshot.managedService.available) {
    findings.push({
      id: "service-manager-unavailable",
      severity: "warn",
      summary: "Managed service lifecycle is unavailable on this host.",
      recommendation: snapshot.managedService.details,
    });
  } else if (!snapshot.managedService.installed) {
    findings.push({
      id: "service-not-installed",
      severity: "warn",
      summary: "OpenFox is not installed as a managed service.",
      recommendation: "Run `openfox service install` if this agent should stay up in the background.",
    });
  } else {
    findings.push({
      id: "service-installed",
      severity: snapshot.managedService.active === "active" ? "ok" : "warn",
      summary:
        snapshot.managedService.active === "active"
          ? "Managed service is installed and active."
          : "Managed service is installed but not active.",
      recommendation:
        snapshot.managedService.active === "active"
          ? undefined
          : "Run `openfox service start` or `openfox service restart`.",
    });
  }

  if (snapshot.heartbeatPaused) {
    findings.push({
      id: "heartbeat-paused",
      severity: "warn",
      summary: "Heartbeat is currently paused.",
      recommendation: "Run `openfox heartbeat enable` to resume scheduled activity.",
    });
  } else {
    findings.push({
      id: "heartbeat-running",
      severity: "ok",
      summary: "Heartbeat is enabled.",
    });
  }

  if (snapshot.operatorDrained) {
    findings.push({
      id: "operator-drained",
      severity: "warn",
      summary: "Operator node is drained and will not accept new work automatically.",
      recommendation:
        "Run `openfox heartbeat enable` or `openfox service status` locally, or use the operator control surface to resume the node when maintenance is complete.",
    });
  }

  if (snapshot.pendingWakes > 0) {
    findings.push({
      id: "pending-wakes",
      severity: "warn",
      summary: `${snapshot.pendingWakes} pending manual wake event(s) remain in the queue.`,
      recommendation: "Run `openfox --run` or inspect `openfox heartbeat history`.",
    });
  }

  if (snapshot.ineligibleEnabledSkills.length > 0) {
    findings.push({
      id: "ineligible-skills",
      severity: "warn",
      summary: `Enabled skills are missing requirements: ${snapshot.ineligibleEnabledSkills.join(", ")}`,
      recommendation: "Run `openfox skills status <name>` to inspect missing bins or env vars.",
    });
  } else if (snapshot.skillCount > 0) {
    findings.push({
      id: "skills-eligible",
      severity: "ok",
      summary: `${snapshot.skillCount} enabled skill(s) are eligible.`,
    });
  }

  const healthReport = snapshot.serviceHealthReport || "";
  if (snapshot.rpcConfigured && healthReport.includes("ERROR rpc")) {
    findings.push({
      id: "rpc-unreachable",
      severity: "error",
      summary: "Configured chain RPC probe failed.",
      recommendation: "Check the node, RPC URL, and chain service status.",
    });
  } else if (snapshot.rpcConfigured) {
    findings.push({
      id: "rpc-healthy",
      severity: "ok",
      summary: "Chain RPC probe succeeded.",
    });
  }

  if (snapshot.opportunityScoutEnabled && !snapshot.rpcConfigured && !snapshot.discoveryEnabled) {
    findings.push({
      id: "scout-no-sources",
      severity: "warn",
      summary: "Opportunity scout is enabled without RPC or discovery inputs.",
      recommendation: "Configure rpcUrl, discovery, or remote task URLs so scout has sources to inspect.",
    });
  }

  if (snapshot.gatewayEnabled && healthReport.includes("ERROR gateway")) {
    findings.push({
      id: "gateway-unhealthy",
      severity: "warn",
      summary: "Gateway health probe failed.",
      recommendation: "Run `openfox gateway status` and verify the public base URL and healthz path.",
    });
  }

  if (snapshot.providerEnabled && healthReport.includes("ERROR provider")) {
    findings.push({
      id: "provider-unhealthy",
      severity: "warn",
      summary: "One or more provider health probes failed.",
      recommendation: "Run `openfox service check` and inspect local provider routes.",
    });
  }

  if (snapshot.signerProviderEnabled) {
    findings.push({
      id: "signer-provider-enabled",
      severity:
        !snapshot.signerProviderReady ||
        !snapshot.signerPolicyConfigured ||
        snapshot.signerPolicyExpired
          ? "error"
          : "ok",
      summary:
        !snapshot.signerProviderReady
          ? "Signer-provider is enabled but no chain RPC is configured."
          : !snapshot.signerPolicyConfigured
            ? "Signer-provider is enabled but the policy is missing allowed targets or policy_id."
            : snapshot.signerPolicyExpired
              ? "Signer-provider is enabled but the configured policy has expired."
              : `Signer-provider is enabled (${snapshot.signerRecentQuotes} recent quote${snapshot.signerRecentQuotes === 1 ? "" : "s"}, ${snapshot.signerRecentExecutions} recent execution${snapshot.signerRecentExecutions === 1 ? "" : "s"}).`,
      recommendation:
        !snapshot.signerProviderReady
          ? "Set `rpcUrl` so OpenFox can submit signer-provider executions on-chain."
          : !snapshot.signerPolicyConfigured
            ? "Set `signerProvider.policy.policyId` and at least one `allowedTargets` entry."
            : snapshot.signerPolicyExpired
              ? "Extend `signerProvider.policy.expiresAt` or remove the expiry."
              : snapshot.signerPendingExecutions > 0
                ? "Run `openfox signer list --status pending` to inspect pending delegated executions."
                : undefined,
    });
  }

  if (snapshot.paymasterProviderEnabled) {
    findings.push({
      id: "paymaster-provider-enabled",
      severity:
        !snapshot.paymasterProviderReady ||
        !snapshot.paymasterPolicyConfigured ||
        snapshot.paymasterPolicyExpired ||
        snapshot.paymasterSponsorFunded === false
          ? "error"
          : "ok",
      summary:
        !snapshot.paymasterProviderReady
          ? "Paymaster-provider is enabled but no chain RPC is configured."
          : !snapshot.paymasterPolicyConfigured
            ? "Paymaster-provider is enabled but the policy is missing allowed targets or policy_id."
            : snapshot.paymasterPolicyExpired
              ? "Paymaster-provider is enabled but the configured policy has expired."
              : snapshot.paymasterSponsorFunded === false
                ? "Paymaster-provider is enabled but the sponsor address appears unfunded."
                : `Paymaster-provider is enabled (${snapshot.paymasterRecentQuotes} recent quote${snapshot.paymasterRecentQuotes === 1 ? "" : "s"}, ${snapshot.paymasterRecentAuthorizations} recent authorization${snapshot.paymasterRecentAuthorizations === 1 ? "" : "s"}).`
      ,
      recommendation:
        !snapshot.paymasterProviderReady
          ? "Set `rpcUrl` so OpenFox can authorize and submit sponsored transactions on-chain."
          : !snapshot.paymasterPolicyConfigured
            ? "Set `paymasterProvider.policy.policyId` and at least one `allowedTargets` entry."
            : snapshot.paymasterPolicyExpired
              ? "Extend `paymasterProvider.policy.expiresAt` or remove the expiry."
              : snapshot.paymasterSponsorFunded === false
                ? "Fund `paymasterProvider.policy.sponsorAddress` (or the local wallet when unset) with native TOS."
                : snapshot.paymasterPendingAuthorizations > 0
                  ? "Run `openfox paymaster list --status authorized` to inspect pending sponsored executions."
                  : undefined,
    });
  }

  if (snapshot.bountyEnabled) {
    findings.push({
      id: "bounty-enabled",
      severity: "ok",
      summary: `Bounty mode is enabled (${snapshot.bountyRole || "unknown"}).`,
    });
    if (snapshot.bountyRole === "host" && !snapshot.rpcConfigured) {
      findings.push({
        id: "bounty-host-rpc-missing",
        severity: "error",
        summary: "Bounty host is enabled but no chain RPC is configured.",
        recommendation:
          "Set `rpcUrl` so the host can send native TOS rewards after judging.",
      });
    }
    if (
      snapshot.bountyRole === "solver" &&
      snapshot.bountyAutoEnabled &&
      !snapshot.bountyRemoteConfigured &&
      !snapshot.discoveryEnabled
    ) {
      findings.push({
        id: "bounty-solver-no-source",
        severity: "error",
        summary:
          "Bounty solver automation is enabled but no remote host or discovery source is configured.",
        recommendation:
          "Set `bounty.remoteBaseUrl` or enable Agent Discovery so the solver can find hosts.",
      });
    }
  }

  if (snapshot.storageEnabled) {
    findings.push({
      id: "storage-enabled",
      severity: snapshot.storageReady ? "ok" : "error",
      summary: snapshot.storageReady
        ? `Storage market is enabled (${snapshot.storageActiveLeases} active lease${snapshot.storageActiveLeases === 1 ? "" : "s"}, ${snapshot.storageRecentRenewals} recent renewal${snapshot.storageRecentRenewals === 1 ? "" : "s"}, ${snapshot.storageRecentAnchors} recent anchor${snapshot.storageRecentAnchors === 1 ? "" : "s"}).`
        : "Storage market is enabled but storage anchoring has no chain RPC configured.",
      recommendation: snapshot.storageReady
        ? undefined
        : "Set `rpcUrl` or disable `storage.anchor.enabled` so storage anchors can be published cleanly.",
    });
    if (!snapshot.storageAnonymousGet) {
      findings.push({
        id: "storage-anonymous-get-disabled",
        severity: "warn",
        summary: "Storage retrieval requires paid or authenticated access.",
        recommendation:
          "This is expected for private providers. Enable `storage.allowAnonymousGet` if public retrieval is required.",
      });
    }
    if (snapshot.storageDueRenewals > 0) {
      findings.push({
        id: "storage-renewals-due",
        severity: "warn",
        summary: `${snapshot.storageDueRenewals} storage lease renewal${snapshot.storageDueRenewals === 1 ? "" : "s"} are due soon.`,
        recommendation:
          "Run `openfox storage renew` manually or keep `storage.leaseHealth.autoRenew` enabled.",
      });
    }
    if (!snapshot.storageReplicationReady) {
      findings.push({
        id: "storage-replication-misconfigured",
        severity: "warn",
        summary:
          "Storage replication is enabled with more than one target copy, but no replication providers are configured.",
        recommendation:
          "Set `storage.replication.providerBaseUrls` or reduce `storage.replication.targetCopies` to 1.",
      });
    } else if (snapshot.storageUnderReplicatedBundles > 0) {
      findings.push({
        id: "storage-under-replicated",
        severity: "warn",
        summary: `${snapshot.storageUnderReplicatedBundles} stored bundle${snapshot.storageUnderReplicatedBundles === 1 ? "" : "s"} do not meet the replication target.`,
        recommendation:
          "Run `openfox storage replicate` or keep `storage.leaseHealth.autoReplicate` enabled with valid replication providers.",
      });
    }
    if (snapshot.storageDueAudits > 0) {
      findings.push({
        id: "storage-audits-due",
        severity: "warn",
        summary: `${snapshot.storageDueAudits} storage lease audit${snapshot.storageDueAudits === 1 ? "" : "s"} are overdue.`,
        recommendation:
          "Run `openfox storage lease-health --json` or `openfox storage maintain` to inspect and refresh overdue lease audits.",
      });
    }
    if (snapshot.storageCriticalLeases > 0) {
      findings.push({
        id: "storage-critical-leases",
        severity: "error",
        summary: `${snapshot.storageCriticalLeases} storage lease${snapshot.storageCriticalLeases === 1 ? "" : "s"} are currently in critical health.`,
        recommendation:
          "Run `openfox storage lease-health --json` to identify expired, failed-audit, or under-replicated leases.",
      });
    }
  }
  if (snapshot.artifactsEnabled) {
    findings.push({
      id: "artifacts-enabled",
      severity: snapshot.artifactsReady ? "ok" : "warn",
      summary: snapshot.artifactsReady
        ? `Artifact pipeline is enabled (${snapshot.artifactsRecentCount} recent artifact${snapshot.artifactsRecentCount === 1 ? "" : "s"}, ${snapshot.artifactsAnchoredCount} anchored).`
        : "Artifact pipeline is enabled but has no default provider and no local storage provider.",
      recommendation: snapshot.artifactsReady
        ? "Use `openfox artifacts list` to inspect stored public news and oracle bundles."
        : "Set `artifacts.defaultProviderBaseUrl` or enable a local storage provider so artifact flows can store bundles.",
    });
  }

  if (snapshot.weakProviderCount > 0) {
    findings.push({
      id: "provider-reputation-weak",
      severity: "warn",
      summary: `${snapshot.weakProviderCount} provider reputation snapshot${snapshot.weakProviderCount === 1 ? "" : "s"} are currently weak.`,
      recommendation:
        snapshot.criticalProviderKinds.length > 0
          ? `Run \`openfox providers reputation --json\` and inspect weak providers in: ${snapshot.criticalProviderKinds.join(", ")}.`
          : "Run `openfox providers reputation --json` to inspect weak provider scores and recent failures.",
    });
  }

  if (snapshot.x402ServerEnabled) {
    findings.push({
      id: "x402-server-enabled",
      severity: snapshot.x402ServerReady ? "ok" : "error",
      summary: snapshot.x402ServerReady
        ? `Server-side x402 payments are enabled (${snapshot.x402RecentPayments} recent ledgered payment${snapshot.x402RecentPayments === 1 ? "" : "s"}).`
        : "Server-side x402 payments are enabled but no chain RPC is configured.",
      recommendation: snapshot.x402ServerReady
        ? undefined
        : "Set `rpcUrl` so OpenFox can verify, broadcast, and confirm incoming x402 payments.",
    });
    if (snapshot.x402FailedPayments > 0) {
      findings.push({
        id: "x402-payments-failed",
        severity: "warn",
        summary: `${snapshot.x402FailedPayments} x402 payment ledger item(s) are currently failed.`,
        recommendation:
          "Run `openfox payments list --status failed` and `openfox payments retry` to inspect and recover failed payment sends.",
      });
    }
    if (snapshot.x402PendingPayments > 0) {
      findings.push({
        id: "x402-payments-pending",
        severity: "warn",
        summary: `${snapshot.x402PendingPayments} x402 payment ledger item(s) are pending submission or confirmation.`,
        recommendation:
          "Run `openfox payments list --status submitted` or `openfox payments list --status verified` to inspect pending payment delivery.",
      });
    }
    if (snapshot.x402UnboundPayments > 0) {
      findings.push({
        id: "x402-payments-unbound",
        severity: "warn",
        summary: `${snapshot.x402UnboundPayments} x402 payment ledger item(s) are not yet bound to a service result.`,
        recommendation:
          "Run `openfox payments list --bound false` to verify that each accepted payment is attached to a stored business artifact.",
      });
    }
  }

  if (snapshot.settlementEnabled) {
    findings.push({
      id: "settlement-enabled",
      severity: snapshot.settlementReady ? "ok" : "error",
      summary: snapshot.settlementReady
        ? `Settlement anchoring is enabled (${snapshot.settlementRecentCount} recent receipt${snapshot.settlementRecentCount === 1 ? "" : "s"}).`
        : "Settlement anchoring is enabled but no chain RPC is configured.",
      recommendation: snapshot.settlementReady
        ? undefined
        : "Set `rpcUrl` so OpenFox can publish settlement anchors on-chain.",
    });
  }

  if (snapshot.settlementCallbacksEnabled) {
    findings.push({
      id: "settlement-callbacks-enabled",
      severity: snapshot.settlementMisconfiguredKinds.length ? "error" : "ok",
      summary: snapshot.settlementMisconfiguredKinds.length
        ? `Settlement callbacks are enabled but missing contract addresses for: ${snapshot.settlementMisconfiguredKinds.join(", ")}.`
        : `Settlement callbacks are enabled (${snapshot.settlementPendingCallbacks} pending callback${snapshot.settlementPendingCallbacks === 1 ? "" : "s"}).`,
      recommendation: snapshot.settlementMisconfiguredKinds.length
        ? "Set contractAddress for each enabled settlement callback target."
        : snapshot.settlementPendingCallbacks > 0
          ? "Run `openfox settlement callbacks --status pending` to inspect pending callback delivery."
          : undefined,
    });
  }

  if (snapshot.marketContractsEnabled) {
    findings.push({
      id: "market-contracts-enabled",
      severity: snapshot.marketContractsReady ? "ok" : "error",
      summary: snapshot.marketContractsReady
        ? `Contract-native market bindings are enabled (${snapshot.marketBindingsRecentCount} recent binding${snapshot.marketBindingsRecentCount === 1 ? "" : "s"}).`
        : "Contract-native market bindings are enabled but no chain RPC is configured.",
      recommendation: snapshot.marketContractsReady
        ? undefined
        : "Set `rpcUrl` so OpenFox can dispatch market contract callbacks on-chain.",
    });
    findings.push({
      id: "market-contract-callbacks-enabled",
      severity: snapshot.marketMisconfiguredKinds.length ? "error" : "ok",
      summary: snapshot.marketMisconfiguredKinds.length
        ? `Market contract callbacks are enabled but missing contract metadata for: ${snapshot.marketMisconfiguredKinds.join(", ")}.`
        : `Market contract callbacks are enabled (${snapshot.marketPendingCallbacks} pending callback${snapshot.marketPendingCallbacks === 1 ? "" : "s"}).`,
      recommendation: snapshot.marketMisconfiguredKinds.length
        ? "Set contractAddress, packageName, and functionSignature for each enabled market callback target."
        : snapshot.marketPendingCallbacks > 0
          ? "Run `openfox market callbacks --status pending` to inspect pending contract delivery."
          : undefined,
    });
  }

  return findings;
}

export async function buildHealthSnapshot(
  explicitConfig?: OpenFoxConfig | null,
  explicitDb?: OpenFoxDatabase,
): Promise<HealthSnapshot> {
  const configPath = getConfigPath();
  const walletPath = getWalletPath();
  const config = explicitConfig === undefined ? loadConfig() : explicitConfig;
  const managedService = getManagedServiceStatus();

  if (!config) {
    const partial: Omit<HealthSnapshot, "findings"> = {
      configPath,
      walletPath,
      configPresent: fs.existsSync(configPath),
      walletPresent: walletExists(),
      inferenceConfigured: false,
      rpcConfigured: false,
      discoveryEnabled: false,
      operatorApiEnabled: false,
      operatorApiReady: false,
      autopilotEnabled: false,
      autopilotPendingApprovals: 0,
      autopilotQuarantinedProviders: 0,
      gatewayEnabled: false,
      providerEnabled: false,
      signerProviderEnabled: false,
      signerProviderReady: false,
      signerRecentQuotes: 0,
      signerRecentExecutions: 0,
      signerPendingExecutions: 0,
      signerPolicyConfigured: false,
      signerPolicyExpired: false,
      paymasterProviderEnabled: false,
      paymasterProviderReady: false,
      paymasterRecentQuotes: 0,
      paymasterRecentAuthorizations: 0,
      paymasterPendingAuthorizations: 0,
      paymasterPolicyConfigured: false,
      paymasterPolicyExpired: false,
      paymasterSponsorFunded: null,
      paymasterSignerParityAligned: true,
      bountyEnabled: false,
      bountyRole: undefined,
      bountyAutoEnabled: false,
      bountyRemoteConfigured: false,
      storageEnabled: false,
      storageReady: false,
      storageAnonymousGet: false,
      storageAnchorEnabled: false,
      storageRecentLeases: 0,
      storageActiveLeases: 0,
      storageRecentRenewals: 0,
      storageRecentAudits: 0,
      storageRecentAnchors: 0,
      storageDueRenewals: 0,
      storageDueAudits: 0,
      storageCriticalLeases: 0,
      storageUnderReplicatedBundles: 0,
      storageReplicationReady: false,
      artifactsEnabled: false,
      artifactsReady: false,
      artifactsRecentCount: 0,
      artifactsVerifiedCount: 0,
      artifactsAnchoredCount: 0,
      weakProviderCount: 0,
      criticalProviderKinds: [],
      x402ServerEnabled: false,
      x402ServerReady: false,
      x402RecentPayments: 0,
      x402PendingPayments: 0,
      x402FailedPayments: 0,
      x402UnboundPayments: 0,
      settlementEnabled: false,
      settlementReady: false,
      settlementRecentCount: 0,
      settlementCallbacksEnabled: false,
      settlementPendingCallbacks: 0,
      settlementMisconfiguredKinds: [],
      marketContractsEnabled: false,
      marketContractsReady: false,
      marketBindingsRecentCount: 0,
      marketPendingCallbacks: 0,
      marketMisconfiguredKinds: [],
      opportunityScoutEnabled: false,
      managedService,
      heartbeatPaused: false,
      operatorDrained: false,
      pendingWakes: 0,
      skillCount: 0,
      ineligibleEnabledSkills: [],
    };
    return { ...partial, findings: collectFindings(partial) };
  }

  const db = explicitDb ?? createDatabase(resolvePath(config.dbPath));
  try {
    const details = await buildConfigSnapshot(config, db);
    let walletSignerType: string | undefined;
    let walletSignerDefaulted: boolean | undefined;
    if (config.rpcUrl && walletExists()) {
      try {
        const walletStatus = await buildWalletStatusSnapshot(config);
        walletSignerType = walletStatus.signer?.type;
        walletSignerDefaulted = walletStatus.signer?.defaulted;
      } catch {
        walletSignerType = undefined;
        walletSignerDefaulted = undefined;
      }
    }
    const partial: Omit<HealthSnapshot, "findings"> = {
      configPath,
      walletPath,
      configPresent: true,
      walletPresent: walletExists(),
      managedService,
      walletSignerType,
      walletSignerDefaulted,
      ...details,
    };
    return { ...partial, findings: collectFindings(partial) };
  } finally {
    if (!explicitDb) {
      db.close();
    }
  }
}

export function buildHealthSnapshotReport(snapshot: HealthSnapshot): string {
  return [
    "=== OPENFOX HEALTH ===",
    `Config: ${yesNo(snapshot.configPresent)} (${snapshot.configPath})`,
    `Wallet: ${yesNo(snapshot.walletPresent)} (${snapshot.walletPath})`,
    `Inference configured: ${yesNo(snapshot.inferenceConfigured)}`,
    `RPC configured: ${yesNo(snapshot.rpcConfigured)}`,
    `Discovery enabled: ${yesNo(snapshot.discoveryEnabled)}`,
    `Operator API enabled: ${yesNo(snapshot.operatorApiEnabled)}${snapshot.operatorApiEnabled ? ` (auth=${snapshot.operatorApiReady ? "configured" : "missing"})` : ""}`,
    `Operator autopilot: ${yesNo(snapshot.autopilotEnabled)}${snapshot.autopilotEnabled ? ` (${snapshot.autopilotPendingApprovals} pending approvals, ${snapshot.autopilotQuarantinedProviders} quarantined providers)` : ""}`,
    `Provider enabled: ${yesNo(snapshot.providerEnabled)}`,
    `Signer provider enabled: ${yesNo(snapshot.signerProviderEnabled)}${snapshot.signerProviderEnabled ? ` (${snapshot.signerRecentQuotes} quotes, ${snapshot.signerRecentExecutions} executions, ${snapshot.signerPendingExecutions} pending)` : ""}`,
    `Paymaster provider enabled: ${yesNo(snapshot.paymasterProviderEnabled)}${snapshot.paymasterProviderEnabled ? ` (${snapshot.paymasterRecentQuotes} quotes, ${snapshot.paymasterRecentAuthorizations} authorizations, ${snapshot.paymasterPendingAuthorizations} pending, sponsor funded=${snapshot.paymasterSponsorFunded === null ? "unknown" : yesNo(snapshot.paymasterSponsorFunded)}, signer parity=${snapshot.paymasterSignerParityAligned ? "aligned" : "limited"})` : ""}`,
    `Gateway enabled: ${yesNo(snapshot.gatewayEnabled)}`,
    `Bounty enabled: ${yesNo(snapshot.bountyEnabled)}${snapshot.bountyRole ? ` (${snapshot.bountyRole})` : ""}`,
    `Bounty auto mode: ${yesNo(snapshot.bountyAutoEnabled)}`,
    `Storage enabled: ${yesNo(snapshot.storageEnabled)}${snapshot.storageEnabled ? ` (${snapshot.storageActiveLeases} active, ${snapshot.storageRecentRenewals} renewals, ${snapshot.storageRecentAudits} audits, ${snapshot.storageRecentAnchors} anchors, ${snapshot.storageUnderReplicatedBundles} under-replicated)` : ""}`,
    `Artifacts enabled: ${yesNo(snapshot.artifactsEnabled)}${snapshot.artifactsEnabled ? ` (${snapshot.artifactsRecentCount} recent, ${snapshot.artifactsVerifiedCount} verified, ${snapshot.artifactsAnchoredCount} anchored)` : ""}`,
    `x402 server: ${yesNo(snapshot.x402ServerEnabled)}${snapshot.x402ServerEnabled ? ` (${snapshot.x402RecentPayments} recent, ${snapshot.x402PendingPayments} pending, ${snapshot.x402FailedPayments} failed)` : ""}`,
    `Settlement enabled: ${yesNo(snapshot.settlementEnabled)}${snapshot.settlementEnabled ? ` (${snapshot.settlementRecentCount} recent)` : ""}`,
    `Settlement callbacks: ${yesNo(snapshot.settlementCallbacksEnabled)}${snapshot.settlementCallbacksEnabled ? ` (${snapshot.settlementPendingCallbacks} pending)` : ""}`,
    `Market bindings: ${yesNo(snapshot.marketContractsEnabled)}${snapshot.marketContractsEnabled ? ` (${snapshot.marketBindingsRecentCount} recent, ${snapshot.marketPendingCallbacks} pending callbacks)` : ""}`,
    `Opportunity scout: ${yesNo(snapshot.opportunityScoutEnabled)}`,
    `Heartbeat paused: ${yesNo(snapshot.heartbeatPaused)}`,
    `Operator drained: ${yesNo(snapshot.operatorDrained)}`,
    `Pending wakes: ${snapshot.pendingWakes}`,
    `Enabled skills: ${snapshot.skillCount}`,
    "",
    buildManagedServiceStatusReport(snapshot.managedService),
    ...(snapshot.serviceStatusReport ? ["", snapshot.serviceStatusReport] : []),
    ...(snapshot.gatewayStatusReport ? ["", snapshot.gatewayStatusReport] : []),
    ...(snapshot.serviceHealthReport ? ["", snapshot.serviceHealthReport] : []),
  ].join("\n");
}

export function buildDoctorReport(snapshot: HealthSnapshot): string {
  const errors = snapshot.findings.filter((finding) => finding.severity === "error");
  const warnings = snapshot.findings.filter((finding) => finding.severity === "warn");
  const oks = snapshot.findings.filter((finding) => finding.severity === "ok");

  const lines = [
    "=== OPENFOX DOCTOR ===",
    `Errors: ${errors.length}`,
    `Warnings: ${warnings.length}`,
    `Checks OK: ${oks.length}`,
    "",
  ];

  for (const finding of snapshot.findings) {
    const badge =
      finding.severity === "error"
        ? "ERROR"
        : finding.severity === "warn"
          ? "WARN "
          : "OK   ";
    lines.push(`${badge} ${finding.summary}`);
    if (finding.recommendation) {
      lines.push(`      ${finding.recommendation}`);
    }
  }

  lines.push("=======================");
  return lines.join("\n");
}
