import fs from "fs";
import type BetterSqlite3 from "better-sqlite3";
import { getConfigPath, loadConfig, resolvePath } from "../config.js";
import { buildSkillStatusReport } from "../skills/loader.js";
import type { OpenFoxConfig, OpenFoxDatabase } from "../types.js";
import { getWalletPath, walletExists } from "../identity/wallet.js";
import { buildWalletStatusSnapshot } from "../wallet/operator.js";
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
import { createDatabase, getUnconsumedWakeEvents, isHeartbeatPaused } from "../state/database.js";

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
  gatewayEnabled: boolean;
  providerEnabled: boolean;
  bountyEnabled: boolean;
  bountyRole?: "host" | "solver";
  bountyAutoEnabled: boolean;
  bountyRemoteConfigured: boolean;
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
  gatewayEnabled: boolean;
  providerEnabled: boolean;
  bountyEnabled: boolean;
  bountyRole?: "host" | "solver";
  bountyAutoEnabled: boolean;
  bountyRemoteConfigured: boolean;
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

  return {
    inferenceConfigured: hasConfiguredInference(config),
    rpcConfigured: Boolean(config.rpcUrl),
    discoveryEnabled: config.agentDiscovery?.enabled === true,
    gatewayEnabled:
      config.agentDiscovery?.gatewayServer?.enabled === true ||
      config.agentDiscovery?.gatewayClient?.enabled === true,
    providerEnabled: isProviderEnabled(config),
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
        "OpenFox native transaction sending still assumes secp256k1. Use non-secp signer mode only if you intentionally switched the account and understand the signer bootstrap boundary.",
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
      gatewayEnabled: false,
      providerEnabled: false,
      bountyEnabled: false,
      bountyRole: undefined,
      bountyAutoEnabled: false,
      bountyRemoteConfigured: false,
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
      pendingWakes: 0,
      skillCount: 0,
      ineligibleEnabledSkills: [],
    };
    return { ...partial, findings: collectFindings(partial) };
  }

  const db = createDatabase(resolvePath(config.dbPath));
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
    db.close();
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
    `Provider enabled: ${yesNo(snapshot.providerEnabled)}`,
    `Gateway enabled: ${yesNo(snapshot.gatewayEnabled)}`,
    `Bounty enabled: ${yesNo(snapshot.bountyEnabled)}${snapshot.bountyRole ? ` (${snapshot.bountyRole})` : ""}`,
    `Bounty auto mode: ${yesNo(snapshot.bountyAutoEnabled)}`,
    `x402 server: ${yesNo(snapshot.x402ServerEnabled)}${snapshot.x402ServerEnabled ? ` (${snapshot.x402RecentPayments} recent, ${snapshot.x402PendingPayments} pending, ${snapshot.x402FailedPayments} failed)` : ""}`,
    `Settlement enabled: ${yesNo(snapshot.settlementEnabled)}${snapshot.settlementEnabled ? ` (${snapshot.settlementRecentCount} recent)` : ""}`,
    `Settlement callbacks: ${yesNo(snapshot.settlementCallbacksEnabled)}${snapshot.settlementCallbacksEnabled ? ` (${snapshot.settlementPendingCallbacks} pending)` : ""}`,
    `Market bindings: ${yesNo(snapshot.marketContractsEnabled)}${snapshot.marketContractsEnabled ? ` (${snapshot.marketBindingsRecentCount} recent, ${snapshot.marketPendingCallbacks} pending callbacks)` : ""}`,
    `Opportunity scout: ${yesNo(snapshot.opportunityScoutEnabled)}`,
    `Heartbeat paused: ${yesNo(snapshot.heartbeatPaused)}`,
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
