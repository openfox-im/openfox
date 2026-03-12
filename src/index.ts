#!/usr/bin/env node
/**
 * OpenFox Runtime
 *
 * The entry point for the sovereign AI agent.
 * Handles CLI args, bootstrapping, and orchestrating
 * the heartbeat daemon + agent loop.
 */

import { getWallet, getOpenFoxDir } from "./identity/wallet.js";
import { provision, loadApiKeyFromConfig } from "./identity/provision.js";
import { loadConfig, resolvePath } from "./config.js";
import { createDatabase } from "./state/database.js";
import { createRuntimeClient } from "./runtime/client.js";
import { createInferenceClient } from "./runtime/inference.js";
import { createHeartbeatDaemon } from "./heartbeat/daemon.js";
import {
  loadHeartbeatConfig,
  syncHeartbeatToDb,
  syncHeartbeatScheduleToDb,
} from "./heartbeat/config.js";
import {
  consumeNextWakeEvent,
  insertWakeEvent,
} from "./state/database.js";
import { runAgentLoop } from "./agent/loop.js";
import { ModelRegistry } from "./inference/registry.js";
import { loadSkills } from "./skills/loader.js";
import { buildSkillStatusReport } from "./skills/loader.js";
import { initStateRepo } from "./git/state-versioning.js";
import { createSocialClient } from "./social/client.js";
import { PolicyEngine } from "./agent/policy-engine.js";
import { SpendTracker } from "./agent/spend-tracker.js";
import { createDefaultRules } from "./agent/policy-rules/index.js";
import type {
  OpenFoxIdentity,
  AgentState,
  Skill,
  SocialClientInterface,
  PaymasterAuthorizationRecord,
  PaymasterQuoteRecord,
} from "./types.js";
import { DEFAULT_TREASURY_POLICY } from "./types.js";
import { createLogger, setGlobalLogLevel } from "./observability/logger.js";
import {
  clearLocalAgentDiscoveryCard,
  discoverCapabilityProviders,
  publishLocalAgentDiscoveryCard,
} from "./agent-discovery/client.js";
import { startAgentDiscoveryFaucetServer } from "./agent-discovery/faucet-server.js";
import { startAgentDiscoveryNewsFetchServer } from "./agent-discovery/news-fetch-server.js";
import { startAgentDiscoveryObservationServer } from "./agent-discovery/observation-server.js";
import { startAgentDiscoveryOracleServer } from "./agent-discovery/oracle-server.js";
import { startAgentDiscoveryProofVerifyServer } from "./agent-discovery/proof-verify-server.js";
import { startAgentDiscoverySentimentAnalysisServer } from "./agent-discovery/sentiment-analysis-server.js";
import { startAgentDiscoveryStorageServer } from "./agent-discovery/storage-server.js";
import { normalizeAgentDiscoveryConfig } from "./agent-discovery/types.js";
import { startAgentGatewayServer } from "./agent-gateway/server.js";
import { startAgentGatewayProviderSessions } from "./agent-gateway/client.js";
import {
  buildGatewayProviderRoutes,
  buildPublishedAgentDiscoveryConfig,
} from "./agent-gateway/publish.js";
import {
  deriveTOSAddressFromPrivateKey as deriveAddressFromPrivateKey,
  normalizeTOSAddress,
} from "./tos/address.js";
import {
  grantTOSCapability as grantCapability,
  registerTOSCapabilityName as registerCapabilityName,
} from "./tos/client.js";
import {
  installSkillFromGit,
  installSkillFromUrl,
} from "./skills/registry.js";
import { randomUUID } from "crypto";
import { keccak256, toHex } from "tosdk";
import {
  addCronTask,
  buildCronListSnapshot,
  buildCronRunsSnapshot,
  buildCronTaskSnapshot,
  buildCronListReport,
  buildCronRunsReport,
  buildCronTaskReport,
  buildHeartbeatStatusSnapshot,
  buildHeartbeatStatusReport,
  disableHeartbeat,
  editCronTask,
  enableHeartbeat,
  getBuiltinHeartbeatTasks,
  queueManualWake,
  removeCronTask,
  setCronTaskEnabled,
} from "./heartbeat/operator.js";
import {
  buildCombinedServiceStatusSnapshot,
  buildGatewayBootnodesSnapshot,
  buildGatewayStatusSnapshot,
  buildGatewayBootnodesReport,
  buildGatewayStatusReport,
  buildServiceHealthSnapshot,
  buildServiceStatusReport,
  runServiceHealthChecks,
} from "./service/operator.js";
import {
  buildManagedServiceStatusReport,
  getManagedServiceStatus,
  installManagedService,
  restartManagedService,
  startManagedService,
  stopManagedService,
  uninstallManagedService,
} from "./service/daemon.js";
import { buildServiceLogsReport } from "./service/logs.js";
import {
  buildDoctorReport,
  buildHealthSnapshot,
  buildHealthSnapshotReport,
} from "./doctor/report.js";
import { buildModelStatusReport, buildModelStatusSnapshot } from "./models/status.js";
import { runOnboard } from "./commands/onboard.js";
import { runWalletCommand } from "./commands/wallet.js";
import {
  exportBundledTemplate,
  listBundledTemplates,
  readBundledTemplateReadme,
} from "./commands/templates.js";
import {
  exportBundledPack,
  lintBundledPack,
  listBundledPacks,
  readBundledPackReadme,
} from "./commands/packs.js";
import { createBountyEngine } from "./bounty/engine.js";
import { startBountyHttpServer } from "./bounty/http.js";
import { createNativeBountyPayoutSender } from "./bounty/payout.js";
import { startBountyAutomation } from "./bounty/automation.js";
import {
  fetchRemoteCampaign,
  fetchRemoteCampaigns,
  fetchRemoteBounties,
  fetchRemoteBounty,
  solveRemoteBounty,
  submitRemoteBountySubmission,
} from "./bounty/client.js";
import {
  buildOpportunityReport,
  buildRankedOpportunityReport,
  collectOpportunityItems,
  rankOpportunityItems,
} from "./opportunity/scout.js";
import {
  getCurrentStrategyProfile,
  upsertStrategyProfile,
  validateStrategyProfile,
} from "./opportunity/strategy.js";
import { createNativeSettlementPublisher } from "./settlement/publisher.js";
import { createNativeSettlementCallbackDispatcher } from "./settlement/callbacks.js";
import { createMarketBindingPublisher } from "./market/publisher.js";
import { createMarketContractDispatcher } from "./market/contracts.js";
import { createX402PaymentManager } from "./tos/x402-server.js";
import { startStorageProviderServer } from "./storage/http.js";
import {
  auditStoredBundle,
  getStorageHead,
  getStoredBundle,
  renewStoredLease,
  requestStorageQuote,
  storeBundleWithProvider,
} from "./storage/client.js";
import {
  createTrackedStorageLeaseRecord,
  createTrackedStorageRenewalRecord,
  replicateTrackedLease,
} from "./storage/lifecycle.js";
import { createArtifactManager } from "./artifacts/manager.js";
import { createNativeArtifactAnchorPublisher } from "./artifacts/publisher.js";
import { startArtifactCaptureServer } from "./artifacts/server.js";
import { createEvidenceWorkflowCoordinator } from "./evidence-workflow/coordinator.js";
import {
  buildEvidenceWorkflowSummary,
  buildEvidenceWorkflowSummaryReport,
} from "./evidence-workflow/summary.js";
import {
  buildZkTlsBundleSummary,
  buildZkTlsBundleSummaryReport,
  buildProofVerificationSummary,
  buildProofVerificationSummaryReport,
  getZkTlsBundleRecord,
  getProofVerificationRecord,
  listZkTlsBundleRecords,
  listProofVerificationRecords,
} from "./proof-market/records.js";
import {
  buildCommitteeSummaryReport,
  createCommitteeManager,
} from "./committee/manager.js";
import { startSignerProviderServer } from "./signer/http.js";
import {
  fetchSignerExecutionReceipt,
  fetchSignerExecutionStatus,
  fetchSignerQuote,
  submitSignerExecution,
} from "./signer/client.js";
import { startPaymasterProviderServer } from "./paymaster/http.js";
import {
  authorizePaymasterExecution,
  fetchPaymasterAuthorizationReceipt,
  fetchPaymasterAuthorizationStatus,
  fetchPaymasterQuote,
} from "./paymaster/client.js";
import type { SignerProviderTrustTier } from "./types.js";
import type { VerifiedAgentProvider } from "./agent-discovery/types.js";
import { hashSignerPolicy } from "./signer/policy.js";
import { hashPaymasterPolicy } from "./paymaster/policy.js";
import fs from "fs/promises";
import { startOperatorApiServer } from "./operator/api.js";
import {
  buildRuntimeStatusReport,
  buildRuntimeStatusSnapshot,
} from "./operator/status.js";
import {
  buildOperatorAutopilotReport,
  buildOperatorAutopilotSnapshot,
  decideOperatorApprovalRequest,
  createOperatorApprovalRequest,
  runOperatorAutopilot,
} from "./operator/autopilot.js";
import {
  buildFleetBundleReport,
  buildFleetBundleSnapshot,
  buildFleetControlReport,
  buildFleetControlSnapshot,
  buildFleetReport,
  buildFleetLintReport,
  buildFleetLintSnapshot,
  buildFleetQueueRetryReport,
  buildFleetQueueRetrySnapshot,
  buildFleetRepairReport,
  buildFleetRepairSnapshot,
  buildFleetReconciliationReport,
  buildFleetReconciliationSnapshot,
  buildFleetProviderLivenessReport,
  buildFleetProviderLivenessSnapshot,
  buildFleetRecoveryReport,
  buildFleetRecoverySnapshot,
  buildFleetSnapshot,
  type FleetControlAction,
  type FleetRepairComponent,
  type FleetEndpoint,
  type FleetRetryQueue,
  type FleetRecoveryKind,
} from "./operator/fleet.js";
import {
  appendFleetIncidentHistory,
  buildFleetIncidentAlertReport,
  buildFleetIncidentRemediationReport,
  buildFleetIncidentReport,
  buildFleetIncidentSnapshot,
  deliverFleetIncidentAlerts,
  evaluateFleetIncidentAlerts,
  readFleetIncidentHistory,
  runFleetIncidentRemediation,
} from "./operator/incidents.js";
import {
  buildFleetDashboardReport,
  buildFleetDashboardSnapshot,
  exportFleetDashboardBundle,
  exportFleetDashboard,
} from "./operator/dashboard.js";
import {
  buildOperatorFinanceReport,
  buildOperatorFinanceSnapshot,
} from "./operator/wallet-finance.js";
import {
  deliverOwnerReportChannels,
} from "./reports/delivery.js";
import {
  buildOwnerReportInput,
  generateOwnerReport,
} from "./reports/generation.js";
import {
  generateOwnerOpportunityAlerts,
  queueOwnerOpportunityAlertAction,
} from "./reports/alerts.js";
import {
  materializeApprovedOwnerOpportunityAction,
} from "./reports/actions.js";
import {
  executeOwnerOpportunityAction,
} from "./reports/action-execution.js";
import {
  renderOwnerReportText,
} from "./reports/render.js";
import {
  startOwnerReportServer,
} from "./reports/server.js";
import {
  runArtifactMaintenance,
  runStorageMaintenance,
} from "./operator/maintenance.js";
import {
  buildProviderReputationSnapshot,
  type ProviderReputationKind,
} from "./operator/provider-reputation.js";
import { buildStorageLeaseHealthSnapshot } from "./operator/storage-health.js";
import {
  buildOracleSummary,
  buildOracleSummaryReport,
  getStoredOracleJob,
  listStoredOracleJobs,
} from "./agent-discovery/oracle-summary.js";

const logger = createLogger("main");
const VERSION = "0.2.1";

class NoopInferenceClient {
  async chat(): Promise<never> {
    throw new Error("inference is not available for this command");
  }

  setLowComputeMode(): void {}

  getDefaultModel(): string {
    return "noop";
  }
}

function resolveBountySkillName(config: {
  role: "host" | "solver";
  defaultKind:
    | "question"
    | "translation"
    | "social_proof"
    | "problem_solving"
    | "public_news_capture"
    | "oracle_evidence_capture"
    | "data_labeling";
  skill: string;
}): string {
  const defaultHostSkill =
    config.defaultKind === "translation"
      ? "translation-bounty-host"
      : config.defaultKind === "social_proof"
        ? "social-bounty-host"
        : config.defaultKind === "problem_solving"
          ? "problem-bounty-host"
          : config.defaultKind === "public_news_capture"
            ? "public-news-capture-host"
            : config.defaultKind === "oracle_evidence_capture"
              ? "oracle-evidence-capture-host"
              : config.defaultKind === "data_labeling"
                ? "data-labeling-bounty-host"
          : "question-bounty-host";
  const defaultSolverSkill =
    config.defaultKind === "translation"
      ? "translation-bounty-solver"
      : config.defaultKind === "social_proof"
        ? "social-bounty-solver"
        : config.defaultKind === "problem_solving"
          ? "problem-bounty-solver"
          : config.defaultKind === "public_news_capture"
            ? "public-news-capture-solver"
            : config.defaultKind === "oracle_evidence_capture"
              ? "oracle-evidence-capture-solver"
              : config.defaultKind === "data_labeling"
                ? "data-labeling-bounty-solver"
          : "question-bounty-solver";
  if (config.role === "solver") {
    return config.skill === "question-bounty-host"
      ? defaultSolverSkill
      : config.skill || defaultSolverSkill;
  }
  return config.skill || defaultHostSkill;
}

function createConfiguredInferenceClient(params: {
  config: NonNullable<ReturnType<typeof loadConfig>>;
  db: ReturnType<typeof createDatabase>;
}): ReturnType<typeof createInferenceClient> {
  const apiKey = params.config.runtimeApiKey || loadApiKeyFromConfig() || "";
  const modelRegistry = new ModelRegistry(params.db.raw);
  modelRegistry.initialize();
  return createInferenceClient({
    apiUrl: params.config.runtimeApiUrl || "",
    apiKey,
    defaultModel:
      params.config.inferenceModelRef || params.config.inferenceModel,
    maxTokens: params.config.maxTokensPerTurn,
    lowComputeModel: params.config.modelStrategy?.lowComputeModel || "gpt-5-mini",
    openaiApiKey: params.config.openaiApiKey,
    anthropicApiKey: params.config.anthropicApiKey,
    ollamaBaseUrl: process.env.OLLAMA_BASE_URL || params.config.ollamaBaseUrl,
    getModelProvider: (modelId) => modelRegistry.get(modelId)?.provider,
  });
}

function hasConfiguredInferenceProvider(
  config: NonNullable<ReturnType<typeof loadConfig>>,
): boolean {
  return Boolean(
    config.openaiApiKey ||
      config.anthropicApiKey ||
      config.ollamaBaseUrl ||
      config.runtimeApiKey,
  );
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  // ─── CLI Commands ────────────────────────────────────────────

  if (args.includes("--version") || args.includes("-v")) {
    logger.info(`OpenFox v${VERSION}`);
    process.exit(0);
  }

  if (args[0] === "skills") {
    await handleSkillsCommand(args.slice(1));
    process.exit(0);
  }

  if (args[0] === "heartbeat") {
    await handleHeartbeatCommand(args.slice(1));
    process.exit(0);
  }

  if (args[0] === "cron") {
    await handleCronCommand(args.slice(1));
    process.exit(0);
  }

  if (args[0] === "service") {
    await handleServiceCommand(args.slice(1));
    process.exit(0);
  }

  if (args[0] === "gateway") {
    await handleGatewayCommand(args.slice(1));
    process.exit(0);
  }

  if (args[0] === "health") {
    await handleHealthCommand(args.slice(1));
    process.exit(0);
  }

  if (args[0] === "doctor") {
    await handleDoctorCommand(args.slice(1));
    process.exit(0);
  }

  if (args[0] === "models") {
    await handleModelsCommand(args.slice(1));
    process.exit(0);
  }

  if (args[0] === "onboard") {
    await handleOnboardCommand(args.slice(1));
    process.exit(0);
  }

  if (args[0] === "wallet") {
    await runWalletCommand(args.slice(1));
    process.exit(0);
  }

  if (args[0] === "finance") {
    await handleFinanceCommand(args.slice(1));
    process.exit(0);
  }

  if (args[0] === "report") {
    await handleReportCommand(args.slice(1));
    process.exit(0);
  }

  if (args[0] === "templates") {
    await handleTemplatesCommand(args.slice(1));
    process.exit(0);
  }

  if (args[0] === "packs") {
    await handlePacksCommand(args.slice(1));
    process.exit(0);
  }

  if (args[0] === "logs") {
    await handleLogsCommand(args.slice(1));
    process.exit(0);
  }

  if (args[0] === "campaign") {
    await handleCampaignCommand(args.slice(1));
    process.exit(0);
  }

  if (args[0] === "bounty") {
    await handleBountyCommand(args.slice(1));
    process.exit(0);
  }

  if (args[0] === "settlement") {
    await handleSettlementCommand(args.slice(1));
    process.exit(0);
  }

  if (args[0] === "market") {
    await handleMarketCommand(args.slice(1));
    process.exit(0);
  }

  if (args[0] === "payments") {
    await handlePaymentsCommand(args.slice(1));
    process.exit(0);
  }

  if (args[0] === "scout") {
    await handleScoutCommand(args.slice(1));
    process.exit(0);
  }

  if (args[0] === "strategy") {
    await handleStrategyCommand(args.slice(1));
    process.exit(0);
  }

  if (args[0] === "storage") {
    await handleStorageCommand(args.slice(1));
    process.exit(0);
  }

  if (args[0] === "providers") {
    await handleProvidersCommand(args.slice(1));
    process.exit(0);
  }

  if (args[0] === "artifacts") {
    await handleArtifactCommand(args.slice(1));
    process.exit(0);
  }

  if (args[0] === "evidence") {
    await handleEvidenceCommand(args.slice(1));
    process.exit(0);
  }

  if (args[0] === "oracle") {
    await handleOracleCommand(args.slice(1));
    process.exit(0);
  }

  if (args[0] === "news") {
    await handleNewsCommand(args.slice(1));
    process.exit(0);
  }

  if (args[0] === "proof") {
    await handleProofCommand(args.slice(1));
    process.exit(0);
  }

  if (args[0] === "committee") {
    await handleCommitteeCommand(args.slice(1));
    process.exit(0);
  }

  if (args[0] === "trails") {
    await handleTrailsCommand(args.slice(1));
    process.exit(0);
  }

  if (args[0] === "signer") {
    await handleSignerCommand(args.slice(1));
    process.exit(0);
  }

  if (args[0] === "paymaster") {
    await handlePaymasterCommand(args.slice(1));
    process.exit(0);
  }

  if (args[0] === "fleet") {
    await handleFleetCommand(args.slice(1));
    process.exit(0);
  }

  if (args[0] === "autopilot") {
    await handleAutopilotCommand(args.slice(1));
    process.exit(0);
  }

  if (args[0] === "dashboard") {
    await handleDashboardCommand(args.slice(1));
    process.exit(0);
  }

  if (args[0] === "status") {
    await showStatus({ asJson: args.includes("--json") });
    process.exit(0);
  }

  if (args.includes("--help") || args.includes("-h")) {
    logger.info(`
OpenFox v${VERSION}
Sovereign AI Agent Runtime

Usage:
  openfox --run          Start the openfox (first run triggers setup wizard)
  openfox --setup        Re-run the interactive setup wizard
  openfox --configure    Edit configuration (providers, model, treasury, general)
  openfox --pick-model   Interactively pick the active inference model
  openfox --init         Initialize wallet and config directory
  openfox --status       Show current openfox status
  openfox skills ...     Inspect and manage skills
  openfox heartbeat ...  Inspect and control the heartbeat runtime
  openfox cron ...       Inspect and manage scheduled heartbeat tasks
  openfox service ...    Inspect service roles, health, and lifecycle
  openfox gateway ...    Inspect gateway configuration and bootnodes
  openfox health         Show a runtime health snapshot
  openfox doctor         Diagnose runtime/operator issues and next steps
  openfox models ...     Inspect model/provider readiness
  openfox onboard        Run setup and optionally install the managed service
  openfox wallet ...     Inspect, fund, and bootstrap the native wallet
  openfox finance ...    Inspect operator finance snapshots
  openfox report ...     Generate, inspect, and deliver owner reports
  openfox templates ...  Inspect and export bundled third-party templates
  openfox packs ...      Inspect and export bundled control-plane packs
  openfox logs           Show recent OpenFox service logs
  openfox campaign ...   Create and inspect sponsor-facing task campaigns
  openfox bounty ...     Open, inspect, and solve task bounties
  openfox settlement ... Inspect on-chain settlement receipts and anchors
  openfox market ...     Inspect contract-native market bindings and callbacks
  openfox payments ...   Inspect and recover server-side x402 payments
  openfox scout ...      Discover earning opportunities and task surfaces
  openfox strategy ...   Define and validate bounded earning strategy profiles
  openfox storage ...    Use the OpenFox storage market
  openfox providers ...  Inspect provider reputation snapshots
  openfox artifacts ...  Build and verify public news and oracle bundles
  openfox evidence ...   Run coordinator-side M-of-N evidence workflows
  openfox oracle ...     Inspect paid oracle results and summaries
  openfox news ...       Inspect zkTLS-backed news capture bundle records
  openfox proof ...      Inspect proof verification records and summaries
  openfox committee ...  Inspect and manage M-of-N committee workflows
  openfox signer ...     Use delegated signer-provider execution
  openfox paymaster ...  Use native sponsored execution through a paymaster-provider
  openfox fleet ...      Inspect multiple OpenFox nodes through operator APIs
  openfox autopilot ...  Inspect and control bounded operator automation
  openfox dashboard ...  Build fleet dashboard snapshots and exports
  openfox status         Show the current runtime status
  openfox --version      Show version
  openfox --help         Show this help

Environment:
  OPENAI_API_KEY           OpenAI API key
  ANTHROPIC_API_KEY        Anthropic API key
  OLLAMA_BASE_URL          Ollama base URL (overrides config, e.g. http://localhost:11434)
  OPENFOX_API_URL           Legacy Runtime API URL (optional)
  OPENFOX_API_KEY           Legacy Runtime API key (optional)
  TOS_RPC_URL              Chain RPC URL (overrides config for native wallet operations)
`);
    process.exit(0);
  }

  if (args.includes("--init")) {
    const { privateKey, isNew } = await getWallet();
    const address = deriveAddressFromPrivateKey(privateKey);
    logger.info(
      JSON.stringify({
        address,
        isNew,
        configDir: getOpenFoxDir(),
      }),
    );
    process.exit(0);
  }

  if (args.includes("--provision")) {
    try {
      const result = await provision();
      logger.info(JSON.stringify(result));
    } catch (err: any) {
      logger.error(`Provision failed: ${err.message}`);
      process.exit(1);
    }
    process.exit(0);
  }

  if (args.includes("--status")) {
    await showStatus({ asJson: args.includes("--json") });
    process.exit(0);
  }

  if (args.includes("--setup")) {
    const { runSetupWizard } = await import("./setup/wizard.js");
    await runSetupWizard();
    process.exit(0);
  }

  if (args.includes("--pick-model")) {
    const { runModelPicker } = await import("./setup/model-picker.js");
    await runModelPicker();
    process.exit(0);
  }

  if (args.includes("--configure")) {
    const { runConfigure } = await import("./setup/configure.js");
    await runConfigure();
    process.exit(0);
  }

  if (args.includes("--run")) {
    await run();
    return;
  }

  // Default: show help
  logger.info('Run "openfox --help" for usage information.');
  logger.info('Run "openfox --run" to start the openfox.');
}

async function handleSkillsCommand(args: string[]): Promise<void> {
  if (args.length === 0 || args[0] === "--help" || args[0] === "-h" || args[0] === "help") {
    logger.info(`
OpenFox skills

Usage:
  openfox skills list
  openfox skills status [name]
  openfox skills enable <name>
  openfox skills disable <name>
  openfox skills install --name <name> --git <repo-url>
  openfox skills install --name <name> --url <skill-md-url>
`);
    return;
  }

  const config = loadConfig();
  if (!config) {
    logger.error("OpenFox is not configured. Run openfox --setup first.");
    process.exit(1);
  }

  const db = createDatabase(resolvePath(config.dbPath));
  const skillsDir = config.skillsDir || "~/.openfox/skills";
  const command = args[0] || "list";

  try {
    if (command === "list") {
      const report = buildSkillStatusReport(skillsDir, db);
      if (report.length === 0) {
        logger.info("No skills found.");
        return;
      }
      logger.info("=== OPENFOX SKILLS ===");
      for (const entry of report) {
        const state = entry.enabled ? "enabled" : "disabled";
        const eligibility = entry.eligible ? "eligible" : "missing requirements";
        logger.info(
          `${entry.name}  [${entry.source}]  ${state}  ${eligibility}${entry.always ? "  always" : ""}`,
        );
        if (entry.description) {
          logger.info(`  ${entry.description}`);
        }
      }
      return;
    }

    if (command === "status") {
      const targetName = args[1]?.trim();
      const report = buildSkillStatusReport(skillsDir, db);
      const entries = targetName
        ? report.filter((entry) => entry.name === targetName)
        : report;
      if (entries.length === 0) {
        logger.error(targetName ? `Skill not found: ${targetName}` : "No skills found.");
        process.exit(1);
      }
      for (const entry of entries) {
        logger.info(`
=== SKILL STATUS ===
Name:        ${entry.name}
Source:      ${entry.source}
Enabled:     ${entry.enabled ? "yes" : "no"}
Eligible:    ${entry.eligible ? "yes" : "no"}
Always:      ${entry.always ? "yes" : "no"}
Path:        ${entry.path}
Homepage:    ${entry.homepage || "(none)"}
Primary env: ${entry.primaryEnv || "(none)"}
Missing bins: ${entry.missingBins.length > 0 ? entry.missingBins.join(", ") : "(none)"}
Missing any-bins set: ${entry.missingAnyBins.length > 0 ? entry.missingAnyBins.join(", ") : "(none)"}
Missing env: ${entry.missingEnv.length > 0 ? entry.missingEnv.join(", ") : "(none)"}
Install hints: ${entry.install.length > 0 ? entry.install.map((spec) => spec.label || spec.kind).join(", ") : "(none)"}
Description: ${entry.description || "(none)"}
=====================
`);
      }
      return;
    }

    if (command === "enable" || command === "disable") {
      const name = args[1]?.trim();
      if (!name) {
        logger.error(`Usage: openfox skills ${command} <name>`);
        process.exit(1);
      }
      const skill = db.getSkillByName(name);
      if (!skill) {
        logger.error(`Skill not found: ${name}`);
        process.exit(1);
      }
      db.setSkillEnabled(name, command === "enable");
      logger.info(`Skill ${command}d: ${name}`);
      return;
    }

    if (command === "install") {
      const name = readOption(args, "--name");
      const gitUrl = readOption(args, "--git");
      const url = readOption(args, "--url");

      if (!name || (!gitUrl && !url) || (gitUrl && url)) {
        logger.error("Usage: openfox skills install --name <name> (--git <repo-url> | --url <skill-md-url>)");
        process.exit(1);
      }

      const runtime = createRuntimeClient({
        apiUrl: config.runtimeApiUrl,
        apiKey: config.runtimeApiKey || loadApiKeyFromConfig() || "",
        sandboxId: config.sandboxId,
      });

      const installed = gitUrl
        ? await installSkillFromGit(gitUrl, name, skillsDir, db, runtime)
        : await installSkillFromUrl(url!, name, skillsDir, db, runtime);

      if (!installed) {
        logger.error("Skill installation failed.");
        process.exit(1);
      }
      logger.info(`Skill installed: ${installed.name} (${installed.source})`);
      return;
    }

    logger.error(`Unknown skills command: ${command}`);
    logger.info(`Available commands: list, status, install, enable, disable`);
    process.exit(1);
  } finally {
    db.close();
  }
}

function readOption(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index === -1) return undefined;
  return args[index + 1]?.trim() || undefined;
}

function readNumberOption(args: string[], flag: string, fallback: number): number {
  const raw = readOption(args, flag);
  if (!raw) return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`Invalid numeric value for ${flag}: ${raw}`);
  }
  return value;
}

function collectRepeatedOption(args: string[], flag: string): string[] {
  const values: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === flag) {
      const value = args[index + 1]?.trim();
      if (value) values.push(value);
    }
  }
  return values;
}

function readCsvOption(args: string[], flag: string): string[] | undefined {
  const raw = readOption(args, flag);
  if (!raw) return undefined;
  const values = raw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  return values.length ? values : undefined;
}

function readSignerTrustTierOption(
  args: string[],
): SignerProviderTrustTier | undefined {
  const raw = readOption(args, "--trust-tier");
  if (!raw) return undefined;
  if (
    raw !== "self_hosted" &&
    raw !== "org_trusted" &&
    raw !== "public_low_trust"
  ) {
    throw new Error(
      `Invalid --trust-tier value: ${raw}. Expected self_hosted, org_trusted, or public_low_trust.`,
    );
  }
  return raw;
}

async function resolveSignerProviderBaseUrl(params: {
  config: NonNullable<ReturnType<typeof loadConfig>>;
  capabilityPrefix: string;
  providerBaseUrl?: string;
  db?: ReturnType<typeof createDatabase>;
  requiredTrustTier?: SignerProviderTrustTier;
}): Promise<{ providerBaseUrl: string; provider?: VerifiedAgentProvider }> {
  if (params.providerBaseUrl) {
    return { providerBaseUrl: params.providerBaseUrl.replace(/\/+$/, "") };
  }
  if (!params.config.agentDiscovery?.enabled) {
    throw new Error(
      "No --provider was given and Agent Discovery is not enabled for signer discovery.",
    );
  }
  const providers = await discoverCapabilityProviders({
    config: params.config,
    capability: `${params.capabilityPrefix}.quote`,
    limit: 5,
    db: params.db,
  });
  const matchingProviders = params.requiredTrustTier
    ? providers.filter(
        (provider) =>
          provider.matchedCapability.policy?.trust_tier ===
          params.requiredTrustTier,
      )
    : providers;
  if (!matchingProviders.length) {
    throw new Error(
      params.requiredTrustTier
        ? `No signer-provider advertising ${params.capabilityPrefix}.quote with trust_tier=${params.requiredTrustTier} was discovered.`
        : `No signer-provider advertising ${params.capabilityPrefix}.quote was discovered.`,
    );
  }
  const provider = matchingProviders[0];
  const endpointUrl = provider.endpoint.url.replace(/\/+$/, "");
  return {
    provider,
    providerBaseUrl: endpointUrl.endsWith("/quote")
      ? endpointUrl.slice(0, -"/quote".length)
      : endpointUrl,
  };
}

async function resolvePaymasterProviderBaseUrl(params: {
  config: NonNullable<ReturnType<typeof loadConfig>>;
  capabilityPrefix: string;
  providerBaseUrl?: string;
  db?: ReturnType<typeof createDatabase>;
  requiredTrustTier?: SignerProviderTrustTier;
}): Promise<{ providerBaseUrl: string; provider?: VerifiedAgentProvider }> {
  if (params.providerBaseUrl) {
    return { providerBaseUrl: params.providerBaseUrl.replace(/\/+$/, "") };
  }
  if (!params.config.agentDiscovery?.enabled) {
    throw new Error(
      "No --provider was given and Agent Discovery is not enabled for paymaster discovery.",
    );
  }
  const providers = await discoverCapabilityProviders({
    config: params.config,
    capability: `${params.capabilityPrefix}.quote`,
    limit: 5,
    db: params.db,
  });
  const matchingProviders = params.requiredTrustTier
    ? providers.filter(
        (provider) =>
          provider.matchedCapability.policy?.trust_tier ===
          params.requiredTrustTier,
      )
    : providers;
  if (!matchingProviders.length) {
    throw new Error(
      params.requiredTrustTier
        ? `No paymaster-provider advertising ${params.capabilityPrefix}.quote with trust_tier=${params.requiredTrustTier} was discovered.`
        : `No paymaster-provider advertising ${params.capabilityPrefix}.quote was discovered.`,
    );
  }
  const provider = matchingProviders[0];
  const endpointUrl = provider.endpoint.url.replace(/\/+$/, "");
  return {
    provider,
    providerBaseUrl: endpointUrl.endsWith("/quote")
      ? endpointUrl.slice(0, -"/quote".length)
      : endpointUrl,
  };
}

function toPaymasterQuoteRecord(body: Record<string, unknown>): PaymasterQuoteRecord {
  const now = new Date().toISOString();
  return {
    quoteId: String(body.quote_id),
    chainId: String(body.chain_id ?? "0"),
    providerAddress: normalizeTOSAddress(String(body.provider_address)),
    sponsorAddress: normalizeTOSAddress(String(body.sponsor_address)),
    sponsorSignerType: String(body.sponsor_signer_type ?? "secp256k1"),
    walletAddress: normalizeTOSAddress(String(body.wallet_address)),
    requesterAddress: normalizeTOSAddress(String(body.requester_address)),
    requesterSignerType: String(body.requester_signer_type ?? "secp256k1"),
    targetAddress: normalizeTOSAddress(String(body.target_address)),
    valueWei: String(body.value_wei ?? "0"),
    dataHex: String(body.data_hex ?? "0x") as `0x${string}`,
    gas: String(body.gas ?? "0"),
    policyId: String(body.policy_id ?? ""),
    policyHash: String(body.policy_hash ?? "0x") as `0x${string}`,
    scopeHash: String(body.scope_hash ?? "0x") as `0x${string}`,
    delegateIdentity:
      typeof body.delegate_identity === "string" ? body.delegate_identity : null,
    trustTier: String(body.trust_tier ?? "self_hosted") as PaymasterQuoteRecord["trustTier"],
    amountWei: String(body.amount_wei ?? "0"),
    sponsorNonce: String(body.sponsor_nonce ?? "0"),
    sponsorExpiry: Number(body.sponsor_expiry ?? 0),
    status: String(body.status === "quoted" ? "quoted" : "quoted") as PaymasterQuoteRecord["status"],
    expiresAt: typeof body.expires_at === "string" ? body.expires_at : now,
    createdAt: now,
    updatedAt: now,
  };
}

function toPaymasterAuthorizationRecord(
  body: Record<string, unknown>,
  quote: PaymasterQuoteRecord,
): PaymasterAuthorizationRecord {
  const now = new Date().toISOString();
  return {
    authorizationId: String(body.authorization_id),
    quoteId: String(body.quote_id ?? quote.quoteId),
    chainId: String(body.chain_id ?? quote.chainId),
    requestKey: String(body.request_key ?? ""),
    requestHash: String(body.request_hash ?? "0x") as `0x${string}`,
    providerAddress: normalizeTOSAddress(String(body.provider_address ?? quote.providerAddress)),
    sponsorAddress: normalizeTOSAddress(String(body.sponsor_address ?? quote.sponsorAddress)),
    sponsorSignerType: String(
      body.sponsor_signer_type ?? quote.sponsorSignerType ?? "secp256k1",
    ),
    walletAddress: normalizeTOSAddress(String(body.wallet_address ?? quote.walletAddress)),
    requesterAddress: normalizeTOSAddress(
      String(body.requester_address ?? quote.requesterAddress),
    ),
    requesterSignerType: String(
      body.requester_signer_type ?? quote.requesterSignerType ?? "secp256k1",
    ),
    targetAddress: normalizeTOSAddress(String(body.target_address ?? quote.targetAddress)),
    valueWei: String(body.value_wei ?? quote.valueWei),
    dataHex: String(body.data_hex ?? quote.dataHex) as `0x${string}`,
    gas: String(body.gas ?? quote.gas),
    policyId: String(body.policy_id ?? quote.policyId),
    policyHash: String(body.policy_hash ?? quote.policyHash) as `0x${string}`,
    scopeHash: String(body.scope_hash ?? quote.scopeHash) as `0x${string}`,
    delegateIdentity:
      typeof body.delegate_identity === "string"
        ? body.delegate_identity
        : quote.delegateIdentity ?? null,
    trustTier: String(body.trust_tier ?? quote.trustTier) as PaymasterAuthorizationRecord["trustTier"],
    requestNonce: String(body.request_nonce ?? ""),
    requestExpiresAt: Number(body.request_expires_at ?? 0),
    executionNonce: String(body.execution_nonce ?? "0"),
    sponsorNonce: String(body.sponsor_nonce ?? quote.sponsorNonce),
    sponsorExpiry: Number(body.sponsor_expiry ?? quote.sponsorExpiry),
    reason: typeof body.reason === "string" ? body.reason : null,
    paymentId:
      typeof body.payment_id === "string" ? (body.payment_id as `0x${string}`) : null,
    executionSignature: null,
    sponsorSignature: null,
    submittedTxHash:
      typeof body.tx_hash === "string" ? (body.tx_hash as `0x${string}`) : null,
    submittedReceipt:
      body.receipt && typeof body.receipt === "object"
        ? (body.receipt as Record<string, unknown>)
        : null,
    receiptHash:
      typeof body.receipt_hash === "string" ? (body.receipt_hash as `0x${string}`) : null,
    status:
      body.status === "pending"
        ? "submitted"
        : body.status === "ok"
          ? "confirmed"
          : body.status === "expired"
            ? "expired"
            : "rejected",
    lastError:
      typeof body.last_error === "string"
        ? body.last_error
        : typeof body.reason === "string"
          ? body.reason
          : null,
    createdAt: now,
    updatedAt: now,
  };
}

async function withHeartbeatContext<T>(
  fn: (params: {
    config: NonNullable<ReturnType<typeof loadConfig>>;
    db: ReturnType<typeof createDatabase>;
    heartbeatConfigPath: string;
    heartbeatConfig: ReturnType<typeof loadHeartbeatConfig>;
  }) => Promise<T> | T,
): Promise<T> {
  const config = loadConfig();
  if (!config) {
    throw new Error("OpenFox is not configured. Run openfox --setup first.");
  }

  const db = createDatabase(resolvePath(config.dbPath));
  const heartbeatConfigPath = resolvePath(config.heartbeatConfigPath);
  const heartbeatConfig = loadHeartbeatConfig(heartbeatConfigPath);
  syncHeartbeatToDb(heartbeatConfig, db);
  syncHeartbeatScheduleToDb(heartbeatConfig, db.raw);

  try {
    return await fn({ config, db, heartbeatConfigPath, heartbeatConfig });
  } finally {
    db.close();
  }
}

async function runHeartbeatTaskNow(
  config: NonNullable<ReturnType<typeof loadConfig>>,
  taskName: string,
): Promise<void> {
  const { account, privateKey } = await getWallet();
  const apiKey = config.runtimeApiKey || loadApiKeyFromConfig() || "";
  const db = createDatabase(resolvePath(config.dbPath));
  const heartbeatConfigPath = resolvePath(config.heartbeatConfigPath);
  const heartbeatConfig = loadHeartbeatConfig(heartbeatConfigPath);
  syncHeartbeatToDb(heartbeatConfig, db);
  syncHeartbeatScheduleToDb(heartbeatConfig, db.raw);

  const createdAt = db.getIdentity("createdAt") || new Date().toISOString();
  const identity: OpenFoxIdentity = {
    name: config.name,
    address: config.walletAddress || deriveAddressFromPrivateKey(privateKey),
    account,
    creatorAddress: config.creatorAddress,
    sandboxId: config.sandboxId,
    apiKey,
    createdAt,
  };

  const runtime = createRuntimeClient({
    apiUrl: config.runtimeApiUrl,
    apiKey,
    sandboxId: config.sandboxId,
  });
  const skillsDir = config.skillsDir || "~/.openfox/skills";
  let skills: Skill[] = [];

  let social: SocialClientInterface | undefined;
  if (config.socialRelayUrl) {
    social = createSocialClient(config.socialRelayUrl, account);
  }

  const heartbeat = createHeartbeatDaemon({
    identity,
    config,
    heartbeatConfig,
    db,
    rawDb: db.raw,
    runtime,
    social,
  });

  try {
    await heartbeat.forceRun(taskName);
  } finally {
    heartbeat.stop();
    db.close();
  }
}

async function handleHeartbeatCommand(args: string[]): Promise<void> {
  const command = args[0] || "status";
  const asJson = args.includes("--json");
  if (command === "--help" || command === "-h" || command === "help") {
    logger.info(`
OpenFox heartbeat

Usage:
  openfox heartbeat status [--json]
  openfox heartbeat enable
  openfox heartbeat disable
  openfox heartbeat wake --reason <text>
  openfox heartbeat tasks [--json]
  openfox heartbeat history [task] [--limit N] [--json]
`);
    return;
  }

  await withHeartbeatContext(async ({ db, heartbeatConfig }) => {
    if (command === "status") {
      if (asJson) {
        logger.info(
          JSON.stringify(buildHeartbeatStatusSnapshot(db.raw, heartbeatConfig), null, 2),
        );
        return;
      }
      logger.info(buildHeartbeatStatusReport(db.raw, heartbeatConfig));
      return;
    }

    if (command === "enable") {
      enableHeartbeat(db.raw);
      logger.info("Heartbeat enabled.");
      return;
    }

    if (command === "disable") {
      disableHeartbeat(db.raw);
      logger.info("Heartbeat disabled.");
      return;
    }

    if (command === "wake") {
      const reason = readOption(args, "--reason") || args[1] || "Manual operator wake";
      queueManualWake(db.raw, reason);
      logger.info(`Queued wake event: ${reason}`);
      return;
    }

    if (command === "tasks") {
      if (asJson) {
        logger.info(JSON.stringify(getBuiltinHeartbeatTasks(), null, 2));
        return;
      }
      logger.info("=== OPENFOX HEARTBEAT TASKS ===");
      for (const task of getBuiltinHeartbeatTasks()) {
        logger.info(`${task.name}`);
        logger.info(`  ${task.description}`);
      }
      return;
    }

    if (command === "history") {
      const taskName = args[1]?.startsWith("--") ? undefined : args[1];
      const limit = readNumberOption(args, "--limit", 20);
      if (asJson) {
        logger.info(JSON.stringify(buildCronRunsSnapshot(db.raw, taskName, limit), null, 2));
        return;
      }
      logger.info(buildCronRunsReport(db.raw, taskName, limit));
      return;
    }

    throw new Error(`Unknown heartbeat command: ${command}`);
  });
}

async function handleCronCommand(args: string[]): Promise<void> {
  const command = args[0] || "list";
  const asJson = args.includes("--json");
  if (command === "--help" || command === "-h" || command === "help") {
    logger.info(`
OpenFox cron

Usage:
  openfox cron list [--json]
  openfox cron status <task> [--json]
  openfox cron add --task <name> --cron "<expr>"
  openfox cron edit <task> [--cron "<expr>"] [--enable|--disable]
  openfox cron remove <task>
  openfox cron enable <task>
  openfox cron disable <task>
  openfox cron runs [task] [--limit N] [--json]
  openfox cron run <task>
`);
    return;
  }

  await withHeartbeatContext(async ({ config, db, heartbeatConfigPath }) => {
    if (command === "list") {
      if (asJson) {
        logger.info(JSON.stringify(buildCronListSnapshot(db.raw), null, 2));
        return;
      }
      logger.info(buildCronListReport(db.raw));
      return;
    }

    if (command === "status") {
      const taskName = args[1];
      if (!taskName) {
        throw new Error("Usage: openfox cron status <task>");
      }
      if (asJson) {
        logger.info(JSON.stringify(buildCronTaskSnapshot(db.raw, taskName), null, 2));
        return;
      }
      logger.info(buildCronTaskReport(db.raw, taskName));
      return;
    }

    if (command === "add") {
      const taskName = readOption(args, "--task");
      const cronExpression = readOption(args, "--cron");
      if (!taskName || !cronExpression) {
        throw new Error("Usage: openfox cron add --task <name> --cron \"<expr>\"");
      }
      addCronTask({
        heartbeatConfigPath,
        db,
        rawDb: db.raw,
        taskName,
        schedule: cronExpression,
      });
      logger.info(`Scheduled task added: ${taskName} (${cronExpression})`);
      return;
    }

    if (command === "edit") {
      const taskName = args[1];
      if (!taskName) {
        throw new Error("Usage: openfox cron edit <task> [--cron \"<expr>\"] [--enable|--disable]");
      }
      const cronExpression = readOption(args, "--cron");
      const enabled = args.includes("--enable") ? true : args.includes("--disable") ? false : undefined;
      editCronTask({
        heartbeatConfigPath,
        db,
        rawDb: db.raw,
        taskName,
        schedule: cronExpression,
        enabled,
      });
      logger.info(`Scheduled task updated: ${taskName}`);
      return;
    }

    if (command === "remove") {
      const taskName = args[1];
      if (!taskName) {
        throw new Error("Usage: openfox cron remove <task>");
      }
      removeCronTask({
        heartbeatConfigPath,
        db,
        rawDb: db.raw,
        taskName,
      });
      logger.info(`Scheduled task removed: ${taskName}`);
      return;
    }

    if (command === "enable" || command === "disable") {
      const taskName = args[1];
      if (!taskName) {
        throw new Error(`Usage: openfox cron ${command} <task>`);
      }
      setCronTaskEnabled({
        heartbeatConfigPath,
        db,
        rawDb: db.raw,
        taskName,
        enabled: command === "enable",
      });
      logger.info(`Scheduled task ${command}d: ${taskName}`);
      return;
    }

    if (command === "runs") {
      const taskName = args[1]?.startsWith("--") ? undefined : args[1];
      const limit = readNumberOption(args, "--limit", 20);
      if (asJson) {
        logger.info(JSON.stringify(buildCronRunsSnapshot(db.raw, taskName, limit), null, 2));
        return;
      }
      logger.info(buildCronRunsReport(db.raw, taskName, limit));
      return;
    }

    if (command === "run") {
      const taskName = args[1];
      if (!taskName) {
        throw new Error("Usage: openfox cron run <task>");
      }
      await runHeartbeatTaskNow(config, taskName);
      logger.info(`Scheduled task executed: ${taskName}`);
      return;
    }

    throw new Error(`Unknown cron command: ${command}`);
  });
}

async function handleServiceCommand(args: string[]): Promise<void> {
  const command = args[0] || "status";
  const asJson = args.includes("--json");
  if (command === "--help" || command === "-h" || command === "help") {
    logger.info(`
OpenFox service

Usage:
  openfox service status [--json]
  openfox service roles [--json]
  openfox service check [--json]
  openfox service install [--force] [--no-start]
  openfox service uninstall
  openfox service start
  openfox service stop
  openfox service restart
`);
    return;
  }

  if (command === "install") {
    const force = args.includes("--force");
    const start = !args.includes("--no-start");
    const plan = installManagedService({ force, start });
    logger.info(`Installed managed service: ${plan.unitPath}`);
    logger.info(start ? "Service enabled and started." : "Service enabled.");
    return;
  }

  if (command === "uninstall") {
    const plan = uninstallManagedService();
    logger.info(`Removed managed service: ${plan.unitPath}`);
    return;
  }

  if (command === "start") {
    const plan = startManagedService();
    logger.info(`Started managed service: ${plan.unitName}`);
    return;
  }

  if (command === "stop") {
    const plan = stopManagedService();
    logger.info(`Stopped managed service: ${plan.unitName}`);
    return;
  }

  if (command === "restart") {
    const plan = restartManagedService();
    logger.info(`Restarted managed service: ${plan.unitName}`);
    return;
  }

  await withHeartbeatContext(async ({ config, db }) => {
    if (command === "status" || command === "roles") {
      if (asJson) {
        logger.info(
          JSON.stringify(
            buildCombinedServiceStatusSnapshot(getManagedServiceStatus(), config, db.raw),
            null,
            2,
          ),
        );
        return;
      }
      logger.info(buildManagedServiceStatusReport(getManagedServiceStatus()));
      logger.info(buildServiceStatusReport(config, db.raw));
      return;
    }

    if (command === "check") {
      if (asJson) {
        logger.info(JSON.stringify(await buildServiceHealthSnapshot(config), null, 2));
        return;
      }
      logger.info(await runServiceHealthChecks(config));
      return;
    }

    throw new Error(`Unknown service command: ${command}`);
  });
}

async function handleGatewayCommand(args: string[]): Promise<void> {
  const command = args[0] || "status";
  const asJson = args.includes("--json");
  if (command === "--help" || command === "-h" || command === "help") {
    logger.info(`
OpenFox gateway

Usage:
  openfox gateway status [--json]
  openfox gateway bootnodes [--json]
  openfox gateway check [--json]
`);
    return;
  }

  await withHeartbeatContext(async ({ config, db }) => {
    if (command === "status") {
      if (asJson) {
        logger.info(JSON.stringify(await buildGatewayStatusSnapshot(config, db.raw), null, 2));
        return;
      }
      logger.info(await buildGatewayStatusReport(config, db.raw));
      return;
    }

    if (command === "bootnodes") {
      if (asJson) {
        logger.info(JSON.stringify(await buildGatewayBootnodesSnapshot(config), null, 2));
        return;
      }
      logger.info(await buildGatewayBootnodesReport(config));
      return;
    }

    if (command === "check") {
      if (asJson) {
        logger.info(JSON.stringify(await buildServiceHealthSnapshot(config), null, 2));
        return;
      }
      logger.info(await runServiceHealthChecks(config));
      return;
    }

    throw new Error(`Unknown gateway command: ${command}`);
  });
}

async function handleAutopilotCommand(args: string[]): Promise<void> {
  if (args.length === 0 || args[0] === "--help" || args[0] === "-h" || args[0] === "help") {
    logger.info(`
OpenFox autopilot

Usage:
  openfox autopilot status [--json]
  openfox autopilot run [--json]
  openfox autopilot approvals [--json] [--status <status>] [--kind <kind>] [--limit <n>]
  openfox autopilot request --kind <kind> --scope <scope> [--reason <text>] [--ttl-seconds <n>] [--json]
  openfox autopilot approve <request-id> [--note <text>] [--json]
  openfox autopilot reject <request-id> [--note <text>] [--json]
`);
    return;
  }

  const config = loadConfig();
  if (!config) {
    logger.error("OpenFox is not configured. Run openfox --setup first.");
    process.exit(1);
  }

  const db = createDatabase(resolvePath(config.dbPath));
  const asJson = args.includes("--json");
  const command = args[0] || "status";

  try {
    if (command === "status") {
      const snapshot = buildOperatorAutopilotSnapshot(config, db);
      if (asJson) {
        logger.info(JSON.stringify(snapshot, null, 2));
      } else {
        logger.info(buildOperatorAutopilotReport(snapshot));
      }
      return;
    }

    if (command === "run") {
      const result = await runOperatorAutopilot({
        config,
        db,
        actor: "cli",
        reason: "manual operator run",
      });
      logger.info(asJson ? JSON.stringify(result, null, 2) : result.summary);
      return;
    }

    if (command === "approvals") {
      const limit = readNumberOption(args, "--limit", 50);
      const status = readOption(args, "--status");
      const kind = readOption(args, "--kind");
      const items = db.listOperatorApprovalRequests(limit, {
        status:
          status === "pending" ||
          status === "approved" ||
          status === "rejected" ||
          status === "expired"
            ? status
            : undefined,
        kind:
          kind === "treasury_policy_change" ||
          kind === "spend_cap_change" ||
          kind === "signer_policy_change" ||
          kind === "paymaster_policy_change"
            ? kind
            : undefined,
      });
      if (asJson) {
        logger.info(JSON.stringify({ items }, null, 2));
      } else {
        logger.info("=== OPENFOX AUTOPILOT APPROVALS ===");
        for (const item of items) {
          logger.info(
            `${item.requestId}  [${item.status}]  ${item.kind}  scope=${item.scope}  requested_by=${item.requestedBy}`,
          );
        }
        if (!items.length) logger.info("(none)");
      }
      return;
    }

    if (command === "request") {
      const kind = readOption(args, "--kind");
      const scope = readOption(args, "--scope");
      if (
        !scope ||
        !(
          kind === "treasury_policy_change" ||
          kind === "spend_cap_change" ||
          kind === "signer_policy_change" ||
          kind === "paymaster_policy_change" ||
          kind === "opportunity_action"
        )
      ) {
        logger.error("Usage: openfox autopilot request --kind <kind> --scope <scope> [--reason <text>] [--ttl-seconds <n>] [--json]");
        process.exit(1);
      }
      const record = createOperatorApprovalRequest({
        db,
        config,
        kind,
        scope,
        requestedBy: "cli",
        reason: readOption(args, "--reason"),
        ttlSeconds: readOption(args, "--ttl-seconds")
          ? readNumberOption(args, "--ttl-seconds", 0)
          : undefined,
      });
      logger.info(asJson ? JSON.stringify(record, null, 2) : `Created approval request ${record.requestId}`);
      return;
    }

    if (command === "approve" || command === "reject") {
      const requestId = args[1]?.trim();
      if (!requestId) {
        logger.error(`Usage: openfox autopilot ${command} <request-id> [--note <text>] [--json]`);
        process.exit(1);
      }
      const record = decideOperatorApprovalRequest({
        db,
        requestId,
        status: command === "approve" ? "approved" : "rejected",
        decidedBy: "cli",
        decisionNote: readOption(args, "--note"),
      });
      logger.info(asJson ? JSON.stringify(record, null, 2) : `${command}d ${record.requestId}`);
      return;
    }

    logger.error(`Unknown autopilot command: ${command}`);
    process.exit(1);
  } finally {
    db.close();
  }
}

async function handleFleetCommand(args: string[]): Promise<void> {
  const command = args[0] || "status";
  const asJson = args.includes("--json");
  const manifestPath = readFlag(args, "--manifest");
  const bundlePath = readFlag(args, "--bundle");
  const helpRequested =
    command === "--help" || command === "-h" || command === "help" || args.includes("--help") || args.includes("-h");

  if (helpRequested || (!manifestPath && command !== "bundle" && command !== "incident-history")) {
    logger.info(`
OpenFox fleet

Usage:
  openfox fleet status --manifest <path> [--json]
  openfox fleet lint --manifest <path> [--json]
  openfox fleet bundle inspect --bundle <dir> [--json]
  openfox fleet health --manifest <path> [--json]
  openfox fleet doctor --manifest <path> [--json]
  openfox fleet service --manifest <path> [--json]
  openfox fleet gateway --manifest <path> [--json]
  openfox fleet wallet --manifest <path> [--json]
  openfox fleet finance --manifest <path> [--json]
  openfox fleet payments --manifest <path> [--json]
  openfox fleet settlement --manifest <path> [--json]
  openfox fleet market --manifest <path> [--json]
  openfox fleet storage --manifest <path> [--json]
  openfox fleet lease-health --manifest <path> [--json]
  openfox fleet artifacts --manifest <path> [--json]
  openfox fleet signer --manifest <path> [--json]
  openfox fleet paymaster --manifest <path> [--json]
  openfox fleet providers --manifest <path> [--json]
  openfox fleet control <pause|resume|drain> --manifest <path> [--node <name>] [--actor <id>] [--reason <text>] [--json]
  openfox fleet retry <payments|settlement|market|signer|paymaster> --manifest <path> [--node <name>] [--actor <id>] [--reason <text>] [--limit N] [--json]
  openfox fleet repair <storage|artifacts> --manifest <path> [--limit N] [--json]
  openfox fleet reconciliation --manifest <path> [--json]
  openfox fleet provider-liveness --manifest <path> [--json]
  openfox fleet recover <replication|provider_route|callback_queue> --manifest <path> [--limit N] [--json]
  openfox fleet incidents --manifest <path> [--history-file <path>] [--record-history] [--json]
  openfox fleet incident-history --history-file <path> [--limit N] [--json]
  openfox fleet incident-alerts --manifest <path> [--history-file <path>] [--record-history] [--channel <stdout|json-file|webhook>] [--output <path>] [--webhook-url <url>] [--json]
  openfox fleet incident-remediate --manifest <path> [--limit N] [--json]
`);
    if (!manifestPath && command !== "bundle" && command !== "incident-history" && !helpRequested) {
      throw new Error("A fleet manifest is required. Use --manifest <path>.");
    }
    return;
  }

  const resolvedManifestPath = manifestPath ?? "";

  if (command === "repair") {
    const component = args[1];
    const normalizedComponent =
      component === "storage" || component === "artifacts"
        ? (component as FleetRepairComponent)
        : null;
    if (!normalizedComponent) {
      throw new Error("Usage: openfox fleet repair <storage|artifacts> --manifest <path> [--limit N] [--json]");
    }
    const snapshot = await buildFleetRepairSnapshot({
      manifestPath: resolvedManifestPath,
      component: normalizedComponent,
      limit: readNumberOption(args, "--limit", 10),
    });
    if (asJson) {
      logger.info(JSON.stringify(snapshot, null, 2));
      return;
    }
    logger.info(buildFleetRepairReport(snapshot));
    return;
  }

  if (command === "bundle") {
    const subcommand = args[1] || "inspect";
    if (subcommand !== "inspect") {
      throw new Error("Usage: openfox fleet bundle inspect --bundle <dir> [--json]");
    }
    if (!bundlePath) {
      throw new Error("A fleet bundle path is required. Use --bundle <dir>.");
    }
    const snapshot = buildFleetBundleSnapshot({ bundlePath });
    if (asJson) {
      logger.info(JSON.stringify(snapshot, null, 2));
      return;
    }
    logger.info(buildFleetBundleReport(snapshot));
    return;
  }

  if (command === "control") {
    const action = args[1];
    const normalizedAction =
      action === "pause" || action === "resume" || action === "drain"
        ? (action as FleetControlAction)
        : null;
    if (!normalizedAction) {
      throw new Error(
        "Usage: openfox fleet control <pause|resume|drain> --manifest <path> [--node <name>] [--actor <id>] [--reason <text>] [--json]",
      );
    }
    const snapshot = await buildFleetControlSnapshot({
      manifestPath: resolvedManifestPath,
      action: normalizedAction,
      nodeName: readFlag(args, "--node"),
      actor: readFlag(args, "--actor"),
      reason: readFlag(args, "--reason"),
    });
    if (asJson) {
      logger.info(JSON.stringify(snapshot, null, 2));
      return;
    }
    logger.info(buildFleetControlReport(snapshot));
    return;
  }

  if (command === "retry") {
    const queue = args[1];
    const normalizedQueue =
      queue === "payments" ||
      queue === "settlement" ||
      queue === "market" ||
      queue === "signer" ||
      queue === "paymaster"
        ? (queue as FleetRetryQueue)
        : null;
    if (!normalizedQueue) {
      throw new Error(
        "Usage: openfox fleet retry <payments|settlement|market|signer|paymaster> --manifest <path> [--node <name>] [--actor <id>] [--reason <text>] [--limit N] [--json]",
      );
    }
    const snapshot = await buildFleetQueueRetrySnapshot({
      manifestPath: resolvedManifestPath,
      queue: normalizedQueue,
      nodeName: readFlag(args, "--node"),
      actor: readFlag(args, "--actor"),
      reason: readFlag(args, "--reason"),
      limit: readNumberOption(args, "--limit", 25),
    });
    if (asJson) {
      logger.info(JSON.stringify(snapshot, null, 2));
      return;
    }
    logger.info(buildFleetQueueRetryReport(snapshot));
    return;
  }

  if (command === "lint") {
    const snapshot = buildFleetLintSnapshot({ manifestPath: resolvedManifestPath });
    if (asJson) {
      logger.info(JSON.stringify(snapshot, null, 2));
      return;
    }
    logger.info(buildFleetLintReport(snapshot));
    return;
  }

  if (command === "reconciliation") {
    const snapshot = await buildFleetReconciliationSnapshot({
      manifestPath: resolvedManifestPath,
    });
    if (asJson) {
      logger.info(JSON.stringify(snapshot, null, 2));
      return;
    }
    logger.info(buildFleetReconciliationReport(snapshot));
    return;
  }

  if (command === "provider-liveness") {
    const snapshot = await buildFleetProviderLivenessSnapshot({
      manifestPath: resolvedManifestPath,
    });
    if (asJson) {
      logger.info(JSON.stringify(snapshot, null, 2));
      return;
    }
    logger.info(buildFleetProviderLivenessReport(snapshot));
    return;
  }

  if (command === "incidents") {
    const snapshot = await buildFleetIncidentSnapshot({
      manifestPath: resolvedManifestPath,
    });
    if (args.includes("--record-history")) {
      const historyPath = readFlag(args, "--history-file");
      if (!historyPath) {
        throw new Error("Use --history-file <path> when --record-history is set.");
      }
      appendFleetIncidentHistory({ historyPath, snapshot });
    }
    if (asJson) {
      logger.info(JSON.stringify(snapshot, null, 2));
      return;
    }
    logger.info(buildFleetIncidentReport(snapshot));
    return;
  }

  if (command === "incident-history") {
    const historyPath = readFlag(args, "--history-file");
    if (!historyPath) {
      throw new Error("Usage: openfox fleet incident-history --history-file <path> [--limit N] [--json]");
    }
    const items = readFleetIncidentHistory({
      historyPath,
      limit: readNumberOption(args, "--limit", 20),
    });
    if (asJson) {
      logger.info(JSON.stringify({ items }, null, 2));
      return;
    }
    logger.info(
      [
        "=== OPENFOX FLEET INCIDENT HISTORY ===",
        `Entries: ${items.length}`,
        ...items.map(
          (item) =>
            `${item.recordedAt}  ${item.snapshot.summary}`,
        ),
      ].join("\n"),
    );
    return;
  }

  if (command === "incident-alerts") {
    const snapshot = await buildFleetIncidentSnapshot({
      manifestPath: resolvedManifestPath,
    });
    const historyPath = readFlag(args, "--history-file");
    const previous = historyPath
      ? readFleetIncidentHistory({ historyPath, limit: 1 })[0]?.snapshot ?? null
      : null;
    const evaluation = evaluateFleetIncidentAlerts({
      current: snapshot,
      previous,
    });
    const channelRaw = readOption(args, "--channel") || "stdout";
    if (!["stdout", "json-file", "webhook"].includes(channelRaw)) {
      throw new Error("Invalid --channel value. Expected stdout, json-file, or webhook.");
    }
    if (args.includes("--record-history")) {
      if (!historyPath) {
        throw new Error("Use --history-file <path> when --record-history is set.");
      }
      appendFleetIncidentHistory({ historyPath, snapshot });
    }
    const delivery = await deliverFleetIncidentAlerts({
      evaluation,
      channel: channelRaw as "stdout" | "json-file" | "webhook",
      outputPath: readFlag(args, "--output"),
      webhookUrl: readFlag(args, "--webhook-url"),
    });
    if (asJson) {
      logger.info(JSON.stringify({ evaluation, delivery }, null, 2));
      return;
    }
    logger.info(buildFleetIncidentAlertReport(evaluation));
    if (delivery.target) {
      logger.info(`Delivered ${delivery.delivered} alert(s) via ${delivery.channel} -> ${delivery.target}`);
    }
    return;
  }

  if (command === "incident-remediate") {
    const snapshot = await runFleetIncidentRemediation({
      manifestPath: resolvedManifestPath,
      limit: readNumberOption(args, "--limit", 25),
    });
    if (asJson) {
      logger.info(JSON.stringify(snapshot, null, 2));
      return;
    }
    logger.info(buildFleetIncidentRemediationReport(snapshot));
    return;
  }

  if (command === "recover") {
    const kind = args[1];
    const normalizedKind =
      kind === "replication" || kind === "provider_route" || kind === "callback_queue"
        ? (kind as FleetRecoveryKind)
        : null;
    if (!normalizedKind) {
      throw new Error(
        "Usage: openfox fleet recover <replication|provider_route|callback_queue> --manifest <path> [--limit N] [--json]",
      );
    }
    const snapshot = await buildFleetRecoverySnapshot({
      manifestPath: resolvedManifestPath,
      kind: normalizedKind,
      limit: readNumberOption(args, "--limit", 25),
    });
    if (asJson) {
      logger.info(JSON.stringify(snapshot, null, 2));
      return;
    }
    logger.info(buildFleetRecoveryReport(snapshot));
    return;
  }

  const endpoint =
    command === "status" ||
    command === "health" ||
    command === "doctor" ||
    command === "service" ||
    command === "gateway" ||
    command === "wallet" ||
    command === "finance" ||
    command === "payments" ||
    command === "settlement" ||
    command === "market" ||
    command === "storage" ||
    command === "lease-health" ||
    command === "artifacts" ||
    command === "signer" ||
    command === "paymaster" ||
    command === "providers" ||
    command === "reconciliation" ||
    command === "provider-liveness"
      ? (command as FleetEndpoint)
      : null;
  if (!endpoint) {
    throw new Error(`Unknown fleet command: ${command}`);
  }

  const snapshot = await buildFleetSnapshot({
    manifestPath: resolvedManifestPath,
    endpoint,
  });
  if (asJson) {
    logger.info(JSON.stringify(snapshot, null, 2));
    return;
  }
  logger.info(buildFleetReport(snapshot));
}

async function handleDashboardCommand(args: string[]): Promise<void> {
  const command = args[0] || "show";
  const manifestPath = readFlag(args, "--manifest");
  const asJson = args.includes("--json");
  const helpRequested =
    command === "--help" || command === "-h" || command === "help" || args.includes("--help") || args.includes("-h");

  if (helpRequested || !manifestPath) {
    logger.info(`
OpenFox dashboard

Usage:
  openfox dashboard show --manifest <path> [--json]
  openfox dashboard export --manifest <path> [--format <json|html>] [--output <path>]
  openfox dashboard bundle --manifest <path> --output <dir> [--force] [--json]
`);
    if (!manifestPath && !helpRequested) {
      throw new Error("A fleet manifest is required. Use --manifest <path>.");
    }
    return;
  }

  if (command === "show") {
    const snapshot = await buildFleetDashboardSnapshot({ manifestPath });
    if (asJson) {
      logger.info(JSON.stringify(snapshot, null, 2));
      return;
    }
    logger.info(buildFleetDashboardReport(snapshot));
    return;
  }

  if (command === "export") {
    const formatRaw = readOption(args, "--format") || "json";
    const format =
      formatRaw === "json" || formatRaw === "html"
        ? formatRaw
        : null;
    if (!format) {
      throw new Error("Invalid --format value. Expected json or html.");
    }
    const defaultOutput =
      format === "html" ? "./openfox-dashboard.html" : "./openfox-dashboard.json";
    const outputPath = resolvePath(readOption(args, "--output") || defaultOutput);
    const snapshot = await exportFleetDashboard({
      manifestPath,
      outputPath,
      format,
    });
    if (asJson) {
      logger.info(
        JSON.stringify(
          {
            format,
            outputPath,
            snapshot,
          },
          null,
          2,
        ),
      );
      return;
    }
    logger.info(`Dashboard exported to ${outputPath}`);
    logger.info(buildFleetDashboardReport(snapshot));
    return;
  }

  if (command === "bundle") {
    const outputPath = resolvePath(
      readOption(args, "--output") || "./openfox-dashboard-bundle",
    );
    const result = await exportFleetDashboardBundle({
      manifestPath,
      outputPath,
      force: args.includes("--force"),
    });
    if (asJson) {
      logger.info(JSON.stringify(result, null, 2));
      return;
    }
    logger.info(`Dashboard bundle exported to ${result.outputPath}`);
    logger.info(buildFleetDashboardReport(result.snapshot));
    return;
  }

  throw new Error(`Unknown dashboard command: ${command}`);
}

async function handleHealthCommand(args: string[]): Promise<void> {
  const asJson = args.includes("--json");
  const snapshot = await buildHealthSnapshot();
  if (asJson) {
    logger.info(JSON.stringify(snapshot, null, 2));
    return;
  }
  logger.info(buildHealthSnapshotReport(snapshot));
}

async function handleDoctorCommand(args: string[]): Promise<void> {
  const asJson = args.includes("--json");
  const snapshot = await buildHealthSnapshot();
  if (asJson) {
    logger.info(JSON.stringify(snapshot, null, 2));
    return;
  }
  logger.info(buildDoctorReport(snapshot));
}

async function handleModelsCommand(args: string[]): Promise<void> {
  const command = args[0] || "status";
  if (command === "--help" || command === "-h" || command === "help") {
    logger.info(`
OpenFox models

Usage:
  openfox models status
  openfox models status --check
  openfox models status --json
`);
    return;
  }

  if (command !== "status") {
    throw new Error(`Unknown models command: ${command}`);
  }

  const config = loadConfig();
  if (!config) {
    throw new Error("OpenFox is not configured. Run openfox --setup first.");
  }

  const snapshot = await buildModelStatusSnapshot(config, {
    check: args.includes("--check"),
  });
  if (args.includes("--json")) {
    logger.info(JSON.stringify(snapshot, null, 2));
    return;
  }
  logger.info(buildModelStatusReport(snapshot));
}

function readFlag(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

async function handleOnboardCommand(args: string[]): Promise<void> {
  if (args.includes("--help") || args.includes("-h") || args.includes("help")) {
    logger.info(`
OpenFox onboard

Usage:
  openfox onboard
  openfox onboard --install-daemon
  openfox onboard --force-setup
  openfox onboard --fund-local
  openfox onboard --fund-testnet
  openfox onboard --fund-testnet --faucet-url https://...
  openfox onboard --fund-local --wait
`);
    return;
  }

  const result = await runOnboard({
    installDaemon: args.includes("--install-daemon"),
    forceSetup: args.includes("--force-setup"),
    fundLocal: args.includes("--fund-local"),
    fundTestnet: args.includes("--fund-testnet"),
    waitForFundingReceipt: args.includes("--wait"),
    faucetUrl: readFlag(args, "--faucet-url"),
    fundingReason: readFlag(args, "--reason"),
  });

  logger.info(
    result.daemonInstalled
      ? result.fundingPerformed
        ? "OpenFox onboarding complete. Wallet funded and managed service installed."
        : "OpenFox onboarding complete. Managed service installed."
      : result.fundingPerformed
        ? "OpenFox onboarding complete. Wallet funding requested."
        : "OpenFox onboarding complete.",
  );
}

async function handleFinanceCommand(args: string[]): Promise<void> {
  const command = args[0] || "report";
  const asJson = args.includes("--json");
  if (command === "--help" || command === "-h" || command === "help") {
    logger.info(`
OpenFox finance

Usage:
  openfox finance report [--json]
`);
    return;
  }

  if (command !== "report") {
    throw new Error(`Unknown finance command: ${command}`);
  }

  const config = loadConfig();
  if (!config) {
    throw new Error("OpenFox is not configured. Run openfox --setup first.");
  }
  const db = createDatabase(resolvePath(config.dbPath));
  try {
    const snapshot = await buildOperatorFinanceSnapshot(config, db);
    if (asJson) {
      logger.info(JSON.stringify(snapshot, null, 2));
      return;
    }
    logger.info(buildOperatorFinanceReport(snapshot));
  } finally {
    db.close();
  }
}

async function handleReportCommand(args: string[]): Promise<void> {
  const command = args[0] || "daily";
  const asJson = args.includes("--json");
  if (command === "--help" || command === "-h" || command === "help") {
    logger.info(`
OpenFox report

Usage:
  openfox report daily [--json]
  openfox report weekly [--json]
  openfox report list [--period <daily|weekly>] [--limit <n>] [--json]
  openfox report get --report-id <id> [--json]
  openfox report alerts [--status <unread|read|dismissed>] [--limit <n>] [--json]
  openfox report alerts-generate [--json]
  openfox report alert-read <alert-id> [--json]
  openfox report alert-dismiss <alert-id> [--json]
  openfox report alert-request-action <alert-id> [--action <review|pursue|delegate>] [--json]
  openfox report actions [--status <queued|completed|cancelled>] [--kind <review|pursue|delegate>] [--limit <n>] [--json]
  openfox report action-executions [--action-id <id>] [--status <running|completed|failed|skipped>] [--limit <n>] [--json]
  openfox report action-execute <action-id> [--json]
  openfox report action-complete <action-id> [--result-kind <note|bounty|campaign|provider_call|artifact|report|other>] [--result-ref <ref>] [--note <text>] [--json]
  openfox report action-cancel <action-id> [--result-kind <note|bounty|campaign|provider_call|artifact|report|other>] [--result-ref <ref>] [--note <text>] [--json]
  openfox report approvals [--status <pending|approved|rejected|expired>] [--limit <n>] [--json]
  openfox report approve <request-id> [--note <text>] [--json]
  openfox report reject <request-id> [--note <text>] [--json]
  openfox report deliveries [--channel <web|email>] [--status <pending|delivered|failed>] [--limit <n>] [--json]
  openfox report send --channel <web|email> [--period <daily|weekly> | --report-id <id>] [--json]
`);
    return;
  }

  const config = loadConfig();
  if (!config) {
    throw new Error("OpenFox is not configured. Run openfox --setup first.");
  }

  const db = createDatabase(resolvePath(config.dbPath));
  try {
    if (command === "list") {
      const periodKindRaw = readOption(args, "--period");
      const periodKind =
        periodKindRaw === "daily" || periodKindRaw === "weekly"
          ? periodKindRaw
          : undefined;
      const limit = readNumberOption(args, "--limit", 20);
      const items = db.listOwnerReports(limit, { periodKind });
      if (asJson) {
        logger.info(JSON.stringify({ items }, null, 2));
        return;
      }
      if (!items.length) {
        logger.info("No owner reports found.");
        return;
      }
      logger.info("=== OPENFOX OWNER REPORTS ===");
      for (const item of items) {
        logger.info(
          `${item.reportId}  [${item.periodKind}]  ${item.generationStatus}  ${item.createdAt}`,
        );
      }
      return;
    }

    if (command === "get") {
      const reportId = readOption(args, "--report-id");
      if (!reportId) {
        throw new Error("Usage: openfox report get --report-id <id> [--json]");
      }
      const report = db.getOwnerReport(reportId);
      if (!report) {
        throw new Error(`Owner report not found: ${reportId}`);
      }
      if (asJson) {
        logger.info(JSON.stringify(report, null, 2));
        return;
      }
      logger.info(renderOwnerReportText(report));
      return;
    }

    if (command === "deliveries") {
      const channelRaw = readOption(args, "--channel");
      const channel =
        channelRaw === "web" || channelRaw === "email" ? channelRaw : undefined;
      const statusRaw = readOption(args, "--status");
      const status =
        statusRaw === "pending" ||
        statusRaw === "delivered" ||
        statusRaw === "failed"
          ? statusRaw
          : undefined;
      const limit = readNumberOption(args, "--limit", 20);
      const items = db.listOwnerReportDeliveries(limit, { channel, status });
      if (asJson) {
        logger.info(JSON.stringify({ items }, null, 2));
        return;
      }
      if (!items.length) {
        logger.info("No owner report deliveries found.");
        return;
      }
      logger.info("=== OPENFOX OWNER REPORT DELIVERIES ===");
      for (const item of items) {
        logger.info(
          `${item.deliveryId}  [${item.channel}]  ${item.status}  ${item.target}`,
        );
      }
      return;
    }

    if (command === "approvals") {
      const statusRaw = readOption(args, "--status");
      const status =
        statusRaw === "pending" ||
        statusRaw === "approved" ||
        statusRaw === "rejected" ||
        statusRaw === "expired"
          ? statusRaw
          : undefined;
      const limit = readNumberOption(args, "--limit", 20);
      const items = db.listOperatorApprovalRequests(limit, { status });
      if (asJson) {
        logger.info(JSON.stringify({ items }, null, 2));
        return;
      }
      if (!items.length) {
        logger.info("No owner approval requests found.");
        return;
      }
      logger.info("=== OPENFOX OWNER APPROVALS ===");
      for (const item of items) {
        logger.info(
          `${item.requestId}  [${item.status}]  ${item.kind}  scope=${item.scope}  requested_by=${item.requestedBy}`,
        );
      }
      return;
    }

    if (command === "alerts") {
      const statusRaw = readOption(args, "--status");
      const status =
        statusRaw === "unread" ||
        statusRaw === "read" ||
        statusRaw === "dismissed"
          ? statusRaw
          : undefined;
      const limit = readNumberOption(args, "--limit", 20);
      const items = db.listOwnerOpportunityAlerts(limit, { status });
      if (asJson) {
        logger.info(JSON.stringify({ items }, null, 2));
        return;
      }
      if (!items.length) {
        logger.info("No owner opportunity alerts found.");
        return;
      }
      logger.info("=== OPENFOX OWNER OPPORTUNITY ALERTS ===");
      for (const item of items) {
        logger.info(
          `${item.alertId}  [${item.status}]  ${item.kind}  score=${item.strategyScore ?? "n/a"}  ${item.title}`,
        );
      }
      return;
    }

    if (command === "actions") {
      const statusRaw = readOption(args, "--status");
      const status =
        statusRaw === "queued" ||
        statusRaw === "completed" ||
        statusRaw === "cancelled"
          ? statusRaw
          : undefined;
      const kindRaw = readOption(args, "--kind");
      const kind =
        kindRaw === "review" || kindRaw === "pursue" || kindRaw === "delegate"
          ? kindRaw
          : undefined;
      const limit = readNumberOption(args, "--limit", 20);
      const items = db.listOwnerOpportunityActions(limit, { status, kind });
      if (asJson) {
        logger.info(JSON.stringify({ items }, null, 2));
        return;
      }
      if (!items.length) {
        logger.info("No owner opportunity actions found.");
        return;
      }
      logger.info("=== OPENFOX OWNER OPPORTUNITY ACTIONS ===");
      for (const item of items) {
        logger.info(
          `${item.actionId}  [${item.status}]  ${item.kind}  ${item.title}`,
        );
      }
      return;
    }

    if (command === "action-executions") {
      const statusRaw = readOption(args, "--status");
      const status =
        statusRaw === "running" ||
        statusRaw === "completed" ||
        statusRaw === "failed" ||
        statusRaw === "skipped"
          ? statusRaw
          : undefined;
      const limit = readNumberOption(args, "--limit", 20);
      const items = db.listOwnerOpportunityActionExecutions(limit, {
        actionId: readOption(args, "--action-id"),
        status,
      });
      if (asJson) {
        logger.info(JSON.stringify({ items }, null, 2));
        return;
      }
      if (!items.length) {
        logger.info("No owner opportunity action executions found.");
        return;
      }
      logger.info("=== OPENFOX OWNER OPPORTUNITY ACTION EXECUTIONS ===");
      for (const item of items) {
        logger.info(
          `${item.executionId}  [${item.status}]  ${item.kind}  action=${item.actionId}  target=${item.targetRef}`,
        );
      }
      return;
    }

    if (command === "alerts-generate") {
      const result = await generateOwnerOpportunityAlerts({
        config,
        db,
      });
      if (asJson) {
        logger.info(JSON.stringify(result, null, 2));
        return;
      }
      logger.info(
        `Generated ${result.created} new owner opportunity alert(s); skipped ${result.skipped}.`,
      );
      return;
    }

    if (command === "alert-read" || command === "alert-dismiss") {
      const alertId = args[1]?.trim();
      if (!alertId) {
        throw new Error(
          `Usage: openfox report ${command} <alert-id> [--json]`,
        );
      }
      const record = db.updateOwnerOpportunityAlertStatus(
        alertId,
        command === "alert-read" ? "read" : "dismissed",
      );
      if (!record) {
        throw new Error(`Owner opportunity alert not found: ${alertId}`);
      }
      if (asJson) {
        logger.info(JSON.stringify(record, null, 2));
        return;
      }
      logger.info(
        `${command === "alert-read" ? "Marked read" : "Dismissed"} ${record.alertId}`,
      );
      return;
    }

    if (command === "alert-request-action") {
      const alertId = args[1]?.trim();
      if (!alertId) {
        throw new Error(
          "Usage: openfox report alert-request-action <alert-id> [--action <review|pursue|delegate>] [--json]",
        );
      }
      const actionRaw = readOption(args, "--action");
      const action =
        actionRaw === "review" || actionRaw === "pursue" || actionRaw === "delegate"
          ? actionRaw
          : "review";
      const result = queueOwnerOpportunityAlertAction({
        config,
        db,
        alertId,
        actionKind: action,
        requestedBy: "owner-cli",
        reason: readOption(args, "--reason"),
      });
      if (asJson) {
        logger.info(JSON.stringify(result, null, 2));
        return;
      }
      logger.info(
        `Queued ${action} action for ${result.alert.alertId} as approval request ${result.request.requestId}`,
      );
      return;
    }

    if (command === "action-execute") {
      const actionId = args[1]?.trim();
      if (!actionId) {
        throw new Error("Usage: openfox report action-execute <action-id> [--json]");
      }
      const { account } = await getWallet();
      const inference = hasConfiguredInferenceProvider(config)
        ? createConfiguredInferenceClient({ config, db })
        : new NoopInferenceClient();
      const result = await executeOwnerOpportunityAction({
        identity: {
          name: config.name,
          address: config.walletAddress,
          account,
          creatorAddress: config.creatorAddress,
          sandboxId: config.sandboxId,
          apiKey: config.runtimeApiKey || loadApiKeyFromConfig() || "",
          createdAt: new Date().toISOString(),
        },
        config,
        db,
        inference,
        actionId,
      });
      if (asJson) {
        logger.info(JSON.stringify(result, null, 2));
        return;
      }
      logger.info(
        `Executed ${result.action.actionId}: ${result.execution.status}${result.execution.executionRef ? ` (${result.execution.executionRef})` : ""}`,
      );
      return;
    }

    if (command === "action-complete" || command === "action-cancel") {
      const actionId = args[1]?.trim();
      if (!actionId) {
        throw new Error(
          `Usage: openfox report ${command} <action-id> [--json]`,
        );
      }
      const resultKindRaw = readOption(args, "--result-kind");
      const record = db.updateOwnerOpportunityActionStatus(
        actionId,
        command === "action-complete" ? "completed" : "cancelled",
        undefined,
        {
          kind:
            resultKindRaw === "note" ||
            resultKindRaw === "bounty" ||
            resultKindRaw === "campaign" ||
            resultKindRaw === "provider_call" ||
            resultKindRaw === "artifact" ||
            resultKindRaw === "report" ||
            resultKindRaw === "other"
              ? resultKindRaw
              : undefined,
          ref: readOption(args, "--result-ref"),
          note: readOption(args, "--note"),
        },
      );
      if (!record) {
        throw new Error(`Owner opportunity action not found: ${actionId}`);
      }
      if (asJson) {
        logger.info(JSON.stringify(record, null, 2));
        return;
      }
      logger.info(
        `${command === "action-complete" ? "Completed" : "Cancelled"} ${record.actionId}`,
      );
      return;
    }

    if (command === "approve" || command === "reject") {
      const requestId = args[1]?.trim();
      if (!requestId) {
        throw new Error(
          `Usage: openfox report ${command} <request-id> [--note <text>] [--json]`,
        );
      }
      const record = decideOperatorApprovalRequest({
        db,
        requestId,
        status: command === "approve" ? "approved" : "rejected",
        decidedBy: "owner-cli",
        decisionNote: readOption(args, "--note"),
      });
      const action =
        command === "approve" && record.kind === "opportunity_action"
          ? materializeApprovedOwnerOpportunityAction({
              db,
              requestId: record.requestId,
            })
          : undefined;
      if (asJson) {
        logger.info(JSON.stringify(action ? { request: record, action } : record, null, 2));
        return;
      }
      logger.info(
        `${command === "approve" ? "Approved" : "Rejected"} ${record.requestId}${action ? ` and queued ${action.actionId}` : ""}`,
      );
      return;
    }

    if (command === "send") {
      const channel = readOption(args, "--channel");
      if (channel !== "web" && channel !== "email") {
        throw new Error(
          "Usage: openfox report send --channel <web|email> [--period <daily|weekly> | --report-id <id>] [--json]",
        );
      }
      const reportId = readOption(args, "--report-id");
      const periodRaw = readOption(args, "--period");
      const periodKind =
        periodRaw === "daily" || periodRaw === "weekly" ? periodRaw : "daily";
      let report = reportId ? db.getOwnerReport(reportId) : db.getLatestOwnerReport(periodKind);
      if (!report) {
        const inference = hasConfiguredInferenceProvider(config)
          ? createConfiguredInferenceClient({ config, db })
          : undefined;
        report = await generateOwnerReport({
          config,
          db,
          inference,
          periodKind,
        });
      }
      const [result] = await deliverOwnerReportChannels({
        config,
        db,
        report,
        channels: [channel],
      });
      if (asJson) {
        logger.info(JSON.stringify(result, null, 2));
        return;
      }
      logger.info(
        [
          "Owner report delivered.",
          `Channel: ${result.channel}`,
          `Status: ${result.status}`,
          `Target: ${result.target}`,
          `Report: ${report.reportId}`,
          `Rendered path: ${result.renderedPath || "(none)"}`,
        ].join("\n"),
      );
      return;
    }

    if (command !== "daily" && command !== "weekly") {
      throw new Error(`Unknown report command: ${command}`);
    }

    const inference = hasConfiguredInferenceProvider(config)
      ? createConfiguredInferenceClient({ config, db })
      : undefined;
    const report = await generateOwnerReport({
      config,
      db,
      inference,
      periodKind: command,
    });
    if (asJson) {
      logger.info(JSON.stringify(report, null, 2));
      return;
    }
    logger.info(renderOwnerReportText(report));
  } finally {
    db.close();
  }
}

async function handleTemplatesCommand(args: string[]): Promise<void> {
  const command = args[0] || "list";
  const asJson = args.includes("--json");
  if (args.includes("--help") || args.includes("-h") || command === "help") {
    logger.info(`
OpenFox templates

Usage:
  openfox templates list [--json]
  openfox templates show <name>
  openfox templates export <name> --output <path> [--force] [--json]
`);
    return;
  }

  if (command === "list") {
    const items = listBundledTemplates();
    if (asJson) {
      logger.info(JSON.stringify({ items }, null, 2));
      return;
    }
    if (items.length === 0) {
      logger.info("No bundled templates found.");
      return;
    }
    logger.info("=== OPENFOX TEMPLATES ===");
    for (const item of items) {
      logger.info(`${item.name}`);
      if (item.description) {
        logger.info(`  ${item.description}`);
      }
    }
    return;
  }

  if (command === "show") {
    const name = args[1];
    if (!name) {
      throw new Error("Usage: openfox templates show <name>");
    }
    logger.info(readBundledTemplateReadme(name));
    return;
  }

  if (command === "export") {
    const name = args[1];
    const outputPath = readOption(args, "--output");
    if (!name || !outputPath) {
      throw new Error("Usage: openfox templates export <name> --output <path> [--force] [--json]");
    }
    const result = exportBundledTemplate({
      name,
      outputPath,
      force: args.includes("--force"),
    });
    if (asJson) {
      logger.info(JSON.stringify(result, null, 2));
      return;
    }
    logger.info(
      [
        "Template exported.",
        `Name: ${result.name}`,
        `Source: ${result.sourcePath}`,
        `Output: ${result.outputPath}`,
      ].join("\n"),
    );
    return;
  }

  throw new Error(`Unknown templates command: ${command}`);
}

async function handlePacksCommand(args: string[]): Promise<void> {
  const command = args[0] || "list";
  const asJson = args.includes("--json");
  if (args.includes("--help") || args.includes("-h") || command === "help") {
    logger.info(`
OpenFox packs

Usage:
  openfox packs list [--json]
  openfox packs show <name>
  openfox packs export <name> --output <path> [--force] [--json]
  openfox packs lint --path <dir> [--json]
`);
    return;
  }

  if (command === "list") {
    const items = listBundledPacks();
    if (asJson) {
      logger.info(JSON.stringify({ items }, null, 2));
      return;
    }
    if (items.length === 0) {
      logger.info("No bundled packs found.");
      return;
    }
    logger.info("=== OPENFOX PACKS ===");
    for (const item of items) {
      logger.info(`${item.name}${item.version ? `  v${item.version}` : ""}`);
      if (item.description) logger.info(`  ${item.description}`);
    }
    return;
  }

  if (command === "show") {
    const name = args[1];
    if (!name) throw new Error("Usage: openfox packs show <name>");
    logger.info(readBundledPackReadme(name));
    return;
  }

  if (command === "export") {
    const name = args[1];
    const outputPath = readOption(args, "--output");
    if (!name || !outputPath) {
      throw new Error("Usage: openfox packs export <name> --output <path> [--force] [--json]");
    }
    const result = exportBundledPack({
      name,
      outputPath,
      force: args.includes("--force"),
    });
    if (asJson) {
      logger.info(JSON.stringify(result, null, 2));
      return;
    }
    logger.info(
      ["Pack exported.", `Name: ${result.name}`, `Source: ${result.sourcePath}`, `Output: ${result.outputPath}`].join("\n"),
    );
    return;
  }

  if (command === "lint") {
    const packPath = readOption(args, "--path");
    if (!packPath) {
      throw new Error("Usage: openfox packs lint --path <dir> [--json]");
    }
    const result = lintBundledPack(packPath);
    if (asJson) {
      logger.info(JSON.stringify(result, null, 2));
      return;
    }
    logger.info(
      [
        "=== OPENFOX PACK LINT ===",
        `Root: ${result.rootPath}`,
        `Manifest: ${result.manifestPath || "(missing)"}`,
        `Errors: ${result.errors.length}`,
        `Warnings: ${result.warnings.length}`,
        ...result.errors.map((value) => `ERROR: ${value}`),
        ...result.warnings.map((value) => `WARN: ${value}`),
      ].join("\n"),
    );
    return;
  }

  throw new Error(`Unknown packs command: ${command}`);
}

async function handleLogsCommand(args: string[]): Promise<void> {
  if (args.includes("--help") || args.includes("-h") || args.includes("help")) {
    logger.info(`
OpenFox logs

Usage:
  openfox logs
  openfox logs --tail 200
`);
    return;
  }

  const tail = readNumberOption(args, "--tail", 200);
  logger.info(buildServiceLogsReport({ tail }));
}

async function handleCampaignCommand(args: string[]): Promise<void> {
  const command = args[0] || "list";
  if (args.includes("--help") || args.includes("-h") || command === "help") {
    logger.info(`
OpenFox campaign

Usage:
  openfox campaign list [--url <base-url>]
  openfox campaign status <campaign-id> [--url <base-url>]
  openfox campaign open --title "<text>" --description "<text>" --budget-wei <wei> [--max-open-bounties <n>] [--allowed-kinds <csv>]
`);
    return;
  }

  const config = loadConfig();
  if (!config) {
    throw new Error("OpenFox is not configured. Run openfox --setup first.");
  }
  if (!config.bounty?.enabled) {
    throw new Error("Bounty mode is not enabled in openfox.json");
  }

  const remoteBaseUrl = readOption(args, "--url");
  if (command === "list") {
    if (remoteBaseUrl) {
      logger.info(JSON.stringify(await fetchRemoteCampaigns(remoteBaseUrl), null, 2));
      return;
    }
    const db = createDatabase(resolvePath(config.dbPath));
    try {
      const engine = createBountyEngine({
        identity: {
          name: config.name,
          address: config.walletAddress,
          account: {} as any,
          creatorAddress: config.creatorAddress,
          sandboxId: config.sandboxId,
          apiKey: config.runtimeApiKey || loadApiKeyFromConfig() || "",
          createdAt: db.getIdentity("createdAt") || new Date().toISOString(),
        },
        db,
        inference: new NoopInferenceClient(),
        bountyConfig: config.bounty,
      });
      logger.info(JSON.stringify(engine.listCampaigns(), null, 2));
      return;
    } finally {
      db.close();
    }
  }

  if (command === "status") {
    const campaignId = args[1];
    if (!campaignId) {
      throw new Error("Usage: openfox campaign status <campaign-id> [--url <base-url>]");
    }
    if (remoteBaseUrl) {
      logger.info(JSON.stringify(await fetchRemoteCampaign(remoteBaseUrl, campaignId), null, 2));
      return;
    }
    const db = createDatabase(resolvePath(config.dbPath));
    try {
      const engine = createBountyEngine({
        identity: {
          name: config.name,
          address: config.walletAddress,
          account: {} as any,
          creatorAddress: config.creatorAddress,
          sandboxId: config.sandboxId,
          apiKey: config.runtimeApiKey || loadApiKeyFromConfig() || "",
          createdAt: db.getIdentity("createdAt") || new Date().toISOString(),
        },
        db,
        inference: new NoopInferenceClient(),
        bountyConfig: config.bounty,
      });
      const details = engine.getCampaignDetails(campaignId);
      if (!details) throw new Error(`Campaign not found: ${campaignId}`);
      logger.info(JSON.stringify(details, null, 2));
      return;
    } finally {
      db.close();
    }
  }

  if (command !== "open") {
    throw new Error(`Unknown campaign command: ${command}`);
  }

  const title = readOption(args, "--title");
  const description = readOption(args, "--description");
  const budgetWei = readOption(args, "--budget-wei");
  if (!title || !description || !budgetWei) {
    throw new Error(
      'Usage: openfox campaign open --title "<text>" --description "<text>" --budget-wei <wei> [--max-open-bounties <n>] [--allowed-kinds <csv>]',
    );
  }

  const db = createDatabase(resolvePath(config.dbPath));
  try {
    const engine = createBountyEngine({
      identity: {
        name: config.name,
        address: config.walletAddress,
        account: {} as any,
        creatorAddress: config.creatorAddress,
        sandboxId: config.sandboxId,
        apiKey: config.runtimeApiKey || loadApiKeyFromConfig() || "",
        createdAt: db.getIdentity("createdAt") || new Date().toISOString(),
      },
      db,
      inference: new NoopInferenceClient(),
      bountyConfig: config.bounty,
    });
    const allowedKinds = readOption(args, "--allowed-kinds")
      ?.split(",")
      .map((item) => item.trim())
      .filter(Boolean) as
      | Array<
          | "question"
          | "translation"
          | "social_proof"
          | "problem_solving"
          | "public_news_capture"
          | "oracle_evidence_capture"
        >
      | undefined;
    const campaign = engine.createCampaign({
      title,
      description,
      budgetWei,
      maxOpenBounties: readNumberOption(args, "--max-open-bounties", config.bounty.maxOpenBounties),
      allowedKinds,
    });
    logger.info(JSON.stringify(campaign, null, 2));
  } finally {
    db.close();
  }
}

async function handleBountyCommand(args: string[]): Promise<void> {
  const command = args[0] || "list";
  if (args.includes("--help") || args.includes("-h") || command === "help") {
    logger.info(`
OpenFox bounty

Usage:
  openfox bounty list [--url <base-url>]
  openfox bounty status <bounty-id> [--url <base-url>]
  openfox bounty open --kind <question|translation|social_proof|problem_solving|public_news_capture|oracle_evidence_capture|data_labeling> --title "<text>" --task "<prompt>" --reference "<canonical>" [--reward-wei <wei>] [--ttl-seconds <n>] [--skill <name>] [--campaign-id <id>]
  openfox bounty open --question "<text>" --answer "<canonical>" [--reward-wei <wei>] [--ttl-seconds <n>] [--campaign-id <id>]
  openfox bounty submit <bounty-id> --submission "<text>" [--proof-url <url>] [--url <base-url>]
  openfox bounty submit <bounty-id> --answer "<text>" [--url <base-url>]
  openfox bounty solve <bounty-id> --url <base-url>
`);
    return;
  }

  const config = loadConfig();
  if (!config) {
    throw new Error("OpenFox is not configured. Run openfox --setup first.");
  }
  if (!config.bounty?.enabled) {
    throw new Error("Bounty mode is not enabled in openfox.json");
  }

  const remoteBaseUrl = readOption(args, "--url");

  if (command === "list") {
    if (remoteBaseUrl) {
      logger.info(JSON.stringify(await fetchRemoteBounties(remoteBaseUrl), null, 2));
      return;
    }
    const db = createDatabase(resolvePath(config.dbPath));
    try {
      logger.info(JSON.stringify(db.listBounties(), null, 2));
      return;
    } finally {
      db.close();
    }
  }

  if (command === "status") {
    const bountyId = args[1];
    if (!bountyId) throw new Error("Usage: openfox bounty status <bounty-id> [--url <base-url>]");
    if (remoteBaseUrl) {
      logger.info(JSON.stringify(await fetchRemoteBounty(remoteBaseUrl, bountyId), null, 2));
      return;
    }
    const db = createDatabase(resolvePath(config.dbPath));
    try {
      const bounty = db.getBountyById(bountyId);
      if (!bounty) throw new Error(`Bounty not found: ${bountyId}`);
      logger.info(
        JSON.stringify(
          {
            bounty,
            submissions: db.listBountySubmissions(bountyId),
            result: db.getBountyResult(bountyId) ?? null,
          },
          null,
          2,
        ),
      );
      return;
    } finally {
      db.close();
    }
  }

  const db = createDatabase(resolvePath(config.dbPath));
  try {
    const { account, privateKey } = await getWallet();
    const apiKey = config.runtimeApiKey || loadApiKeyFromConfig() || "";
    const modelRegistry = new ModelRegistry(db.raw);
    modelRegistry.initialize();
    const inference = createInferenceClient({
      apiUrl: config.runtimeApiUrl || "",
      apiKey,
      defaultModel: config.inferenceModelRef || config.inferenceModel,
      maxTokens: config.maxTokensPerTurn,
      lowComputeModel: config.modelStrategy?.lowComputeModel || "gpt-5-mini",
      openaiApiKey: config.openaiApiKey,
      anthropicApiKey: config.anthropicApiKey,
      ollamaBaseUrl: process.env.OLLAMA_BASE_URL || config.ollamaBaseUrl,
      getModelProvider: (modelId) => modelRegistry.get(modelId)?.provider,
    });
    const engine = createBountyEngine({
      identity: {
        name: config.name,
        address: config.walletAddress || deriveAddressFromPrivateKey(privateKey),
        account,
        creatorAddress: config.creatorAddress,
        sandboxId: config.sandboxId,
        apiKey,
        createdAt: db.getIdentity("createdAt") || new Date().toISOString(),
      },
      db,
      inference,
      bountyConfig: config.bounty,
      payoutSender:
        config.rpcUrl && config.bounty.role === "host"
          ? createNativeBountyPayoutSender({ rpcUrl: config.rpcUrl, privateKey })
          : undefined,
    });

    if (command === "open") {
      const kind = (readOption(args, "--kind") ||
        config.bounty.defaultKind) as typeof config.bounty.defaultKind;
      const taskPrompt = readOption(args, "--task") || readOption(args, "--question");
      const referenceOutput =
        readOption(args, "--reference") || readOption(args, "--answer");
      if (!taskPrompt || !referenceOutput) {
        throw new Error(
          'Usage: openfox bounty open --kind <question|translation|social_proof|problem_solving|public_news_capture|oracle_evidence_capture|data_labeling> --title "<text>" --task "<prompt>" --reference "<canonical>" [--reward-wei <wei>] [--ttl-seconds <n>] [--campaign-id <id>]',
        );
      }
      const ttlSeconds = readNumberOption(
        args,
        "--ttl-seconds",
        config.bounty.defaultSubmissionTtlSeconds,
      );
      const bounty = engine.openBounty({
        campaignId: readOption(args, "--campaign-id") || null,
        kind,
        title: readOption(args, "--title") || taskPrompt.slice(0, 160),
        taskPrompt,
        referenceOutput,
        rewardWei: readOption(args, "--reward-wei") || config.bounty.rewardWei,
        submissionDeadline: new Date(Date.now() + ttlSeconds * 1000).toISOString(),
        skillName: readOption(args, "--skill") || resolveBountySkillName(config.bounty),
      });
      logger.info(JSON.stringify(bounty, null, 2));
      return;
    }

    if (command === "submit") {
      const bountyId = args[1];
      const submissionText =
        readOption(args, "--submission") || readOption(args, "--answer");
      if (!bountyId || !submissionText) {
        throw new Error(
          'Usage: openfox bounty submit <bounty-id> --submission "<text>" [--proof-url <url>] [--url <base-url>]',
        );
      }
      if (remoteBaseUrl) {
        logger.info(
          JSON.stringify(
            await submitRemoteBountySubmission({
              baseUrl: remoteBaseUrl,
              bountyId,
              solverAddress: config.walletAddress,
              submissionText,
              solverAgentId: config.agentId || null,
              proofUrl: readOption(args, "--proof-url") || null,
            }),
            null,
            2,
          ),
        );
        return;
      }
      logger.info(
        JSON.stringify(
          await engine.submitSubmission({
            bountyId,
            submissionText,
            solverAddress: config.walletAddress,
            solverAgentId: config.agentId || null,
            proofUrl: readOption(args, "--proof-url") || null,
          }),
          null,
          2,
        ),
      );
      return;
    }

    if (command === "solve") {
      const bountyId = args[1];
      if (!bountyId || !remoteBaseUrl) {
        throw new Error("Usage: openfox bounty solve <bounty-id> --url <base-url>");
      }
        logger.info(
          JSON.stringify(
            await solveRemoteBounty({
              baseUrl: remoteBaseUrl,
              bountyId,
              solverAddress: config.walletAddress,
              solverAgentId: config.agentId || null,
              inference,
              skillInstructions:
                db.getSkillByName(
                  resolveBountySkillName(config.bounty),
                )?.instructions,
            }),
            null,
            2,
        ),
      );
      return;
    }

    throw new Error(`Unknown bounty command: ${command}`);
  } finally {
    db.close();
  }
}

async function handleSettlementCommand(args: string[]): Promise<void> {
  const command = args[0] || "list";
  const asJson = args.includes("--json");
  if (args.includes("--help") || args.includes("-h") || command === "help") {
    logger.info(`
OpenFox settlement

Usage:
  openfox settlement list [--kind <bounty|observation|oracle>] [--limit N] [--json]
  openfox settlement callbacks [--kind <bounty|observation|oracle>] [--status <pending|confirmed|failed>] [--limit N] [--json]
  openfox settlement get --receipt-id <id> [--json]
  openfox settlement get --kind <bounty|observation|oracle> --subject-id <id> [--json]
`);
    return;
  }

  const config = loadConfig();
  if (!config) {
    throw new Error("OpenFox is not configured. Run openfox --setup first.");
  }

  const db = createDatabase(resolvePath(config.dbPath));
  try {
    if (command === "list") {
      const kind = readOption(args, "--kind") as "bounty" | "observation" | "oracle" | undefined;
      const limit = readNumberOption(args, "--limit", 20);
      const items = db.listSettlementReceipts(limit, kind);
      if (asJson) {
        logger.info(JSON.stringify({ items }, null, 2));
        return;
      }
      if (items.length === 0) {
        logger.info("No settlement receipts found.");
        return;
      }
      logger.info("=== OPENFOX SETTLEMENT RECEIPTS ===");
      for (const item of items) {
        logger.info(
          `${item.receiptId}  [${item.kind}]  subject=${item.subjectId}  tx=${item.settlementTxHash || "(pending)"}`,
        );
        if (item.artifactUrl) {
          logger.info(`  artifact: ${item.artifactUrl}`);
        }
      }
      return;
    }

    if (command === "callbacks") {
      const kind = readOption(args, "--kind") as "bounty" | "observation" | "oracle" | undefined;
      const status = readOption(args, "--status") as "pending" | "confirmed" | "failed" | undefined;
      const limit = readNumberOption(args, "--limit", 20);
      const items = db.listSettlementCallbacks(limit, { kind, status });
      if (asJson) {
        logger.info(JSON.stringify({ items }, null, 2));
        return;
      }
      if (items.length === 0) {
        logger.info("No settlement callbacks found.");
        return;
      }
      logger.info("=== OPENFOX SETTLEMENT CALLBACKS ===");
      for (const item of items) {
        logger.info(
          `${item.callbackId}  [${item.kind}]  status=${item.status}  attempts=${item.attemptCount}/${item.maxAttempts}  tx=${item.callbackTxHash || "(none)"}`,
        );
        logger.info(`  receipt=${item.receiptId}  contract=${item.contractAddress}`);
        if (item.lastError) {
          logger.info(`  error=${item.lastError}`);
        }
      }
      return;
    }

    if (command === "get") {
      const receiptId = readOption(args, "--receipt-id");
      const kind = readOption(args, "--kind") as "bounty" | "observation" | "oracle" | undefined;
      const subjectId = readOption(args, "--subject-id");
      const record = receiptId
        ? db.getSettlementReceiptById(receiptId)
        : kind && subjectId
          ? db.getSettlementReceipt(kind, subjectId)
          : undefined;
      if (!record) {
        throw new Error(
          receiptId
            ? `Settlement receipt not found: ${receiptId}`
            : "Usage: openfox settlement get --receipt-id <id> | --kind <kind> --subject-id <id>",
        );
      }
      if (asJson) {
        logger.info(
          JSON.stringify(
            {
              ...record,
              callback: db.getSettlementCallbackByReceiptId(record.receiptId) ?? null,
            },
            null,
            2,
          ),
        );
        return;
      }
      const callback = db.getSettlementCallbackByReceiptId(record.receiptId);
      logger.info(`
=== OPENFOX SETTLEMENT RECEIPT ===
Receipt:     ${record.receiptId}
Kind:        ${record.kind}
Subject:     ${record.subjectId}
Receipt hash:${record.receiptHash}
Artifact:    ${record.artifactUrl || "(none)"}
Payment tx:  ${record.paymentTxHash || "(none)"}
Payout tx:   ${record.payoutTxHash || "(none)"}
Anchor tx:   ${record.settlementTxHash || "(pending)"}
Callback:    ${callback ? `${callback.status} -> ${callback.contractAddress}` : "(none)"}
Callback tx: ${callback?.callbackTxHash || "(none)"}
Created:     ${record.createdAt}
Updated:     ${record.updatedAt}
=================================
`);
      return;
    }

    throw new Error(`Unknown settlement command: ${command}`);
  } finally {
    db.close();
  }
}

async function handleMarketCommand(args: string[]): Promise<void> {
  const command = args[0] || "list";
  const asJson = args.includes("--json");
  if (args.includes("--help") || args.includes("-h") || command === "help") {
    logger.info(`
OpenFox market

Usage:
  openfox market list [--kind <bounty|observation|oracle>] [--limit N] [--json]
  openfox market callbacks [--kind <bounty|observation|oracle>] [--status <pending|confirmed|failed>] [--limit N] [--json]
  openfox market get --binding-id <id> [--json]
  openfox market get --kind <bounty|observation|oracle> --subject-id <id> [--json]
`);
    return;
  }

  const config = loadConfig();
  if (!config) {
    throw new Error("OpenFox is not configured. Run openfox --setup first.");
  }

  const db = createDatabase(resolvePath(config.dbPath));
  try {
    if (command === "list") {
      const kind = readOption(args, "--kind") as "bounty" | "observation" | "oracle" | undefined;
      const limit = readNumberOption(args, "--limit", 20);
      const items = db.listMarketBindings(limit, kind);
      if (asJson) {
        logger.info(JSON.stringify({ items }, null, 2));
        return;
      }
      if (items.length === 0) {
        logger.info("No market bindings found.");
        return;
      }
      logger.info("=== OPENFOX MARKET BINDINGS ===");
      for (const item of items) {
        logger.info(
          `${item.bindingId}  [${item.kind}]  subject=${item.subjectId}  callback=${item.callbackTxHash || "(pending)"}`,
        );
        if (item.receipt.artifactUrl) {
          logger.info(`  artifact: ${item.receipt.artifactUrl}`);
        }
      }
      return;
    }

    if (command === "callbacks") {
      const kind = readOption(args, "--kind") as "bounty" | "observation" | "oracle" | undefined;
      const status = readOption(args, "--status") as "pending" | "confirmed" | "failed" | undefined;
      const limit = readNumberOption(args, "--limit", 20);
      const items = db.listMarketContractCallbacks(limit, { kind, status });
      if (asJson) {
        logger.info(JSON.stringify({ items }, null, 2));
        return;
      }
      if (items.length === 0) {
        logger.info("No market callbacks found.");
        return;
      }
      logger.info("=== OPENFOX MARKET CALLBACKS ===");
      for (const item of items) {
        logger.info(
          `${item.callbackId}  [${item.kind}]  status=${item.status}  attempts=${item.attemptCount}/${item.maxAttempts}  tx=${item.callbackTxHash || "(none)"}`,
        );
        logger.info(
          `  binding=${item.bindingId}  contract=${item.contractAddress}  call=${item.packageName}:${item.functionSignature}`,
        );
        if (item.lastError) {
          logger.info(`  error=${item.lastError}`);
        }
      }
      return;
    }

    if (command === "get") {
      const bindingId = readOption(args, "--binding-id");
      const kind = readOption(args, "--kind") as "bounty" | "observation" | "oracle" | undefined;
      const subjectId = readOption(args, "--subject-id");
      const record = bindingId
        ? db.getMarketBindingById(bindingId)
        : kind && subjectId
          ? db.getMarketBinding(kind, subjectId)
          : undefined;
      if (!record) {
        throw new Error(
          bindingId
            ? `Market binding not found: ${bindingId}`
            : "Usage: openfox market get --binding-id <id> | --kind <kind> --subject-id <id>",
        );
      }
      if (asJson) {
        logger.info(
          JSON.stringify(
            {
              ...record,
              callback: db.getMarketContractCallbackByBindingId(record.bindingId) ?? null,
            },
            null,
            2,
          ),
        );
        return;
      }
      const callback = db.getMarketContractCallbackByBindingId(record.bindingId);
      logger.info(`
=== OPENFOX MARKET BINDING ===
Binding:     ${record.bindingId}
Kind:        ${record.kind}
Subject:     ${record.subjectId}
Binding hash:${record.receiptHash}
Artifact:    ${record.receipt.artifactUrl || "(none)"}
Payment tx:  ${record.receipt.paymentTxHash || "(none)"}
Callback:    ${callback ? `${callback.status} -> ${callback.contractAddress}` : "(none)"}
Callback tx: ${callback?.callbackTxHash || "(none)"}
Package:     ${callback ? `${callback.packageName}:${callback.functionSignature}` : "(none)"}
Created:     ${record.createdAt}
Updated:     ${record.updatedAt}
==============================
`);
      return;
    }

    throw new Error(`Unknown market command: ${command}`);
  } finally {
    db.close();
  }
}

async function handlePaymentsCommand(args: string[]): Promise<void> {
  const command = args[0] || "list";
  const asJson = args.includes("--json");
  if (args.includes("--help") || args.includes("-h") || command === "help") {
    logger.info(`
OpenFox payments

Usage:
  openfox payments list [--service <observation|oracle|gateway_request|gateway_session>] [--status <verified|submitted|confirmed|failed|replaced>] [--bound <true|false>] [--limit N] [--json]
  openfox payments get --payment-id <id> [--json]
  openfox payments get --service <observation|oracle|gateway_request|gateway_session> --request-key <key> [--json]
  openfox payments retry [--limit N] [--json]
`);
    return;
  }

  const config = loadConfig();
  if (!config) {
    throw new Error("OpenFox is not configured. Run openfox --setup first.");
  }

  const db = createDatabase(resolvePath(config.dbPath));
  try {
    if (command === "list") {
      const serviceKind = readOption(args, "--service") as
        | "observation"
        | "oracle"
        | "gateway_request"
        | "gateway_session"
        | undefined;
      const status = readOption(args, "--status") as
        | "verified"
        | "submitted"
        | "confirmed"
        | "failed"
        | "replaced"
        | undefined;
      const boundRaw = readOption(args, "--bound");
      const bound =
        boundRaw === "true" ? true : boundRaw === "false" ? false : undefined;
      const limit = readNumberOption(args, "--limit", 20);
      const items = db.listX402Payments(limit, { serviceKind, status, bound });
      if (asJson) {
        logger.info(JSON.stringify({ items }, null, 2));
        return;
      }
      if (items.length === 0) {
        logger.info("No x402 payments found.");
        return;
      }
      logger.info("=== OPENFOX X402 PAYMENTS ===");
      for (const item of items) {
        logger.info(
          `${item.paymentId}  [${item.serviceKind}]  status=${item.status}  amount=${item.amountWei}  tx=${item.txHash}`,
        );
        logger.info(
          `  request=${item.requestKey}  payer=${item.payerAddress}  bound=${item.boundSubjectId ? `${item.boundKind}:${item.boundSubjectId}` : "(none)"}`,
        );
        if (item.lastError) {
          logger.info(`  error=${item.lastError}`);
        }
      }
      return;
    }

    if (command === "get") {
      const paymentId = readOption(args, "--payment-id");
      const serviceKind = readOption(args, "--service") as
        | "observation"
        | "oracle"
        | "gateway_request"
        | "gateway_session"
        | undefined;
      const requestKey = readOption(args, "--request-key");
      const record = paymentId
        ? db.getX402Payment(paymentId as `0x${string}`)
        : serviceKind && requestKey
          ? db.getLatestX402PaymentByRequestKey(serviceKind, requestKey)
          : undefined;
      if (!record) {
        throw new Error(
          paymentId
            ? `x402 payment not found: ${paymentId}`
            : "Usage: openfox payments get --payment-id <id> | --service <service> --request-key <key>",
        );
      }
      if (asJson) {
        logger.info(JSON.stringify(record, null, 2));
        return;
      }
      logger.info(`
=== OPENFOX X402 PAYMENT ===
Payment:     ${record.paymentId}
Service:     ${record.serviceKind}
Request key: ${record.requestKey}
Request hash:${record.requestHash}
Payer:       ${record.payerAddress}
Provider:    ${record.providerAddress}
Nonce:       ${record.txNonce}
Amount:      ${record.amountWei}
Status:      ${record.status}
Policy:      ${record.confirmationPolicy}
Attempts:    ${record.attemptCount}/${record.maxAttempts}
Tx hash:     ${record.txHash}
Bound:       ${record.boundSubjectId ? `${record.boundKind}:${record.boundSubjectId}` : "(none)"}
Artifact:    ${record.artifactUrl || "(none)"}
Last error:  ${record.lastError || "(none)"}
Updated:     ${record.updatedAt}
============================
`);
      return;
    }

    if (command === "retry") {
      if (!config.rpcUrl) {
        throw new Error("x402 payment retries require rpcUrl to be configured.");
      }
      if (!config.x402Server?.enabled) {
        throw new Error("x402 server-side payment handling is disabled in config.");
      }
      const limit = readNumberOption(args, "--limit", config.x402Server.retryBatchSize);
      const result = await createX402PaymentManager({
        db,
        rpcUrl: config.rpcUrl,
        config: config.x402Server,
      }).retryPending(limit);
      if (asJson) {
        logger.info(JSON.stringify(result, null, 2));
        return;
      }
      logger.info(`
=== OPENFOX X402 RETRY ===
Processed: ${result.processed}
Confirmed: ${result.confirmed}
Pending:   ${result.pending}
Failed:    ${result.failed}
==========================
`);
      return;
    }

    throw new Error(`Unknown payments command: ${command}`);
  } finally {
    db.close();
  }
}

async function handleScoutCommand(args: string[]): Promise<void> {
  const command = args[0] || "list";
  const asJson = args.includes("--json");
  if (args.includes("--help") || args.includes("-h") || command === "help") {
    logger.info(`
OpenFox scout

Usage:
  openfox scout list [--json]
  openfox scout rank [--json]
`);
    return;
  }

  if (command !== "list" && command !== "rank") {
    throw new Error(`Unknown scout command: ${command}`);
  }

  const config = loadConfig();
  if (!config) {
    throw new Error("OpenFox is not configured. Run openfox --setup first.");
  }
  const db = createDatabase(resolvePath(config.dbPath));
  try {
    const items = await collectOpportunityItems({ config, db });
    if (command === "rank") {
      const strategy = getCurrentStrategyProfile(db);
      const ranked = rankOpportunityItems({
        items,
        strategy,
        maxItems: config.opportunityScout?.maxItems,
      });
      if (asJson) {
        logger.info(JSON.stringify({ strategy, items: ranked }, null, 2));
        return;
      }
      logger.info(buildRankedOpportunityReport(ranked, strategy));
      return;
    }
    if (asJson) {
      logger.info(JSON.stringify({ items }, null, 2));
      return;
    }
    logger.info(buildOpportunityReport(items));
  } finally {
    db.close();
  }
}

async function handleStrategyCommand(args: string[]): Promise<void> {
  const command = args[0] || "show";
  const asJson = args.includes("--json");
  if (args.includes("--help") || args.includes("-h") || command === "help") {
    logger.info(`
OpenFox strategy

Usage:
  openfox strategy show [--json]
  openfox strategy validate [--json]
  openfox strategy set [--name <text>] [--revenue-target-wei <wei>] [--max-spend-wei <wei>] [--min-margin-bps <n>] [--opportunity-kinds <csv>] [--provider-classes <csv>] [--trust-tiers <csv>] [--automation-level <manual|assisted|bounded_auto>] [--report-cadence <on_demand|daily|weekly>] [--max-deadline-hours <n>] [--json]
`);
    return;
  }

  if (!["show", "set", "validate"].includes(command)) {
    throw new Error(`Unknown strategy command: ${command}`);
  }

  const config = loadConfig();
  if (!config) {
    throw new Error("OpenFox is not configured. Run openfox --setup first.");
  }
  const db = createDatabase(resolvePath(config.dbPath));
  try {
    if (command === "show") {
      const strategy = getCurrentStrategyProfile(db);
      if (asJson) {
        logger.info(JSON.stringify(strategy, null, 2));
        return;
      }
      logger.info(JSON.stringify(strategy, null, 2));
      return;
    }

    if (command === "validate") {
      const strategy = getCurrentStrategyProfile(db);
      const validation = validateStrategyProfile(strategy);
      if (asJson) {
        logger.info(JSON.stringify({ strategy, validation }, null, 2));
        return;
      }
      logger.info(JSON.stringify({ strategy, validation }, null, 2));
      return;
    }

    const strategy = upsertStrategyProfile(db, {
      name: readOption(args, "--name"),
      revenueTargetWei: readOption(args, "--revenue-target-wei"),
      maxSpendPerOpportunityWei: readOption(args, "--max-spend-wei"),
      minMarginBps: (() => {
        const raw = readOption(args, "--min-margin-bps");
        return raw ? Number.parseInt(raw, 10) : undefined;
      })(),
      enabledOpportunityKinds: readCsvOption(args, "--opportunity-kinds") as
        | ("bounty" | "campaign" | "provider")[]
        | undefined,
      enabledProviderClasses: readCsvOption(args, "--provider-classes") as
        | (
            | "task_market"
            | "observation"
            | "oracle"
            | "sponsored_execution"
            | "storage_artifacts"
            | "general_provider"
          )[]
        | undefined,
      allowedTrustTiers: readCsvOption(args, "--trust-tiers") as
        | ("self_hosted" | "org_trusted" | "public_low_trust" | "unknown")[]
        | undefined,
      automationLevel: readOption(args, "--automation-level") as
        | "manual"
        | "assisted"
        | "bounded_auto"
        | undefined,
      reportCadence: readOption(args, "--report-cadence") as
        | "on_demand"
        | "daily"
        | "weekly"
        | undefined,
      maxDeadlineHours: (() => {
        const raw = readOption(args, "--max-deadline-hours");
        return raw ? Number.parseInt(raw, 10) : undefined;
      })(),
    });
    const validation = validateStrategyProfile(strategy);
    if (asJson) {
      logger.info(JSON.stringify({ strategy, validation }, null, 2));
      return;
    }
    logger.info(JSON.stringify({ strategy, validation }, null, 2));
  } finally {
    db.close();
  }
}

async function handleStorageCommand(args: string[]): Promise<void> {
  const command = args[0] || "list";
  const asJson = args.includes("--json");
  if (args.includes("--help") || args.includes("-h") || command === "help") {
    logger.info(`
OpenFox storage

Usage:
  openfox storage list [--status <quoted|active|expired|released>] [--cid <cid>] [--json]
  openfox storage quote --provider <base-url> --input <path> [--kind <kind>] [--ttl-seconds N] [--json]
  openfox storage put --provider <base-url> --input <path> [--kind <kind>] [--ttl-seconds N] [--quote-id <id>] [--json]
  openfox storage renew --provider <base-url> --lease <lease-id> [--ttl-seconds N] [--json]
  openfox storage replicate --provider <base-url> --lease <lease-id> [--ttl-seconds N] [--json]
  openfox storage head --provider <base-url> --cid <cid> [--json]
  openfox storage get --provider <base-url> --cid <cid> [--output <path>] [--json]
  openfox storage audit --provider <base-url> --lease <lease-id> [--json]
  openfox storage lease-health [--limit N] [--json]
  openfox storage maintain [--limit N] [--json]
`);
    return;
  }

  const config = loadConfig();
  if (!config) {
    throw new Error("OpenFox is not configured. Run openfox --setup first.");
  }
  const db = createDatabase(resolvePath(config.dbPath));
  try {
    if (command === "maintain") {
      const result = await runStorageMaintenance({
        config,
        db,
        limit: readNumberOption(args, "--limit", 10),
      });
      logger.info(JSON.stringify(result, null, 2));
      return;
    }

    if (command === "lease-health") {
      const result = buildStorageLeaseHealthSnapshot({
        config,
        db,
        limit: readNumberOption(args, "--limit", 25),
      });
      logger.info(JSON.stringify(result, null, 2));
      return;
    }

    if (command === "list") {
      const status = readOption(args, "--status") as
        | "quoted"
        | "active"
        | "expired"
        | "released"
        | undefined;
      const cid = readOption(args, "--cid") || undefined;
      const leases = db.listStorageLeases(50, { status, cid });
      const renewals = db.listStorageRenewals(20, cid ? { cid } : undefined);
      const audits = db.listStorageAudits(20);
      const anchors = db.listStorageAnchors(20);
      if (asJson) {
        logger.info(JSON.stringify({ leases, renewals, audits, anchors }, null, 2));
        return;
      }
      logger.info(`
=== OPENFOX STORAGE LEASES ===
Leases: ${leases.length}
Renewals: ${renewals.length}
Audits: ${audits.length}
Anchors: ${anchors.length}
${leases
  .map(
    (item) =>
      `${item.leaseId}  status=${item.status}  cid=${item.cid}  kind=${item.bundleKind}  expires=${item.receipt.expiresAt}${item.providerBaseUrl ? `  provider=${item.providerBaseUrl}` : ""}`,
  )
  .join("\n")}
==============================
`);
      return;
    }

    const providerBaseUrl = readOption(args, "--provider");
    if (!providerBaseUrl) {
      throw new Error("Missing --provider <base-url>.");
    }

    if (command === "quote") {
      const inputPath = readOption(args, "--input");
      if (!inputPath) throw new Error("Missing --input <path>.");
      const ttlSeconds = readNumberOption(
        args,
        "--ttl-seconds",
        config.storage?.defaultTtlSeconds ?? 86400,
      );
      const result = await requestStorageQuote({
        providerBaseUrl,
        inputPath: resolvePath(inputPath),
        bundleKind: readOption(args, "--kind") || "artifact.bundle",
        requesterAddress: config.walletAddress,
        ttlSeconds,
      });
      logger.info(asJson ? JSON.stringify(result, null, 2) : JSON.stringify(result, null, 2));
      return;
    }

    if (command === "put") {
      const inputPath = readOption(args, "--input");
      if (!inputPath) throw new Error("Missing --input <path>.");
      const ttlSeconds = readNumberOption(
        args,
        "--ttl-seconds",
        config.storage?.defaultTtlSeconds ?? 86400,
      );
      const { account } = await getWallet();
      const result = await storeBundleWithProvider({
        providerBaseUrl,
        inputPath: resolvePath(inputPath),
        bundleKind: readOption(args, "--kind") || "artifact.bundle",
        requesterAccount: account,
        requesterAddress: config.walletAddress,
        ttlSeconds,
        quoteId: readOption(args, "--quote-id"),
      });
      db.upsertStorageLease(
        createTrackedStorageLeaseRecord({
          response: result,
          requesterAddress: config.walletAddress,
          providerBaseUrl,
          requestKey: `storage:cli-put:${result.lease_id}:${Date.now()}`,
        }),
      );
      logger.info(asJson ? JSON.stringify(result, null, 2) : JSON.stringify(result, null, 2));
      return;
    }

    if (command === "renew") {
      const leaseId = readOption(args, "--lease");
      if (!leaseId) throw new Error("Missing --lease <lease-id>.");
      const { account } = await getWallet();
      const ttlValue = readOption(args, "--ttl-seconds");
      const ttlSeconds = ttlValue ? Number(ttlValue) : undefined;
      if (
        ttlValue &&
        (ttlSeconds === undefined ||
          !Number.isFinite(ttlSeconds) ||
          ttlSeconds <= 0)
      ) {
        throw new Error("Invalid --ttl-seconds value.");
      }
      const result = await renewStoredLease({
        providerBaseUrl,
        leaseId,
        requesterAccount: account,
        requesterAddress: config.walletAddress,
        ttlSeconds,
      });
      db.upsertStorageLease(
        createTrackedStorageLeaseRecord({
          response: result,
          requesterAddress: config.walletAddress,
          providerBaseUrl,
          requestKey: `storage:cli-renew:${leaseId}:${Date.now()}`,
          createdAt:
            db.getStorageLease(leaseId)?.createdAt || new Date().toISOString(),
        }),
      );
      db.upsertStorageRenewal(
        createTrackedStorageRenewalRecord({
          response: result,
          requesterAddress: config.walletAddress,
          providerBaseUrl,
        }),
      );
      logger.info(asJson ? JSON.stringify(result, null, 2) : JSON.stringify(result, null, 2));
      return;
    }

    if (command === "replicate") {
      const leaseId = readOption(args, "--lease");
      if (!leaseId) throw new Error("Missing --lease <lease-id>.");
      const sourceLease = db.getStorageLease(leaseId);
      if (!sourceLease) {
        throw new Error(`Storage lease not found: ${leaseId}`);
      }
      const { account } = await getWallet();
      const ttlSeconds = readNumberOption(
        args,
        "--ttl-seconds",
        sourceLease.ttlSeconds,
      );
      const result = await replicateTrackedLease({
        sourceLease,
        targetProviderBaseUrl: providerBaseUrl,
        requesterAccount: account as any,
        requesterAddress: config.walletAddress,
        ttlSeconds,
        db,
      });
      logger.info(asJson ? JSON.stringify(result, null, 2) : JSON.stringify(result, null, 2));
      return;
    }

    if (command === "head") {
      const cid = readOption(args, "--cid");
      if (!cid) throw new Error("Missing --cid <cid>.");
      const result = await getStorageHead({ providerBaseUrl, cid });
      logger.info(asJson ? JSON.stringify(result, null, 2) : JSON.stringify(result, null, 2));
      return;
    }

    if (command === "get") {
      const cid = readOption(args, "--cid");
      if (!cid) throw new Error("Missing --cid <cid>.");
      const result = await getStoredBundle({
        providerBaseUrl,
        cid,
        outputPath: readOption(args, "--output")
          ? resolvePath(readOption(args, "--output")!)
          : undefined,
      });
      logger.info(asJson ? JSON.stringify(result, null, 2) : JSON.stringify(result, null, 2));
      return;
    }

    if (command === "audit") {
      const leaseId = readOption(args, "--lease");
      if (!leaseId) throw new Error("Missing --lease <lease-id>.");
      const result = await auditStoredBundle({ providerBaseUrl, leaseId });
      logger.info(asJson ? JSON.stringify(result, null, 2) : JSON.stringify(result, null, 2));
      return;
    }

    throw new Error(`Unknown storage command: ${command}`);
  } finally {
    db.close();
  }
}

async function handleProvidersCommand(args: string[]): Promise<void> {
  const command = args[0] || "reputation";
  const asJson = args.includes("--json");
  if (args.includes("--help") || args.includes("-h") || command === "help") {
    logger.info(`
OpenFox providers

Usage:
  openfox providers reputation [--kind <storage|artifacts|signer|paymaster>] [--limit N] [--json]
`);
    return;
  }

  if (command !== "reputation") {
    throw new Error(`Unknown providers command: ${command}`);
  }

  const config = loadConfig();
  if (!config) {
    throw new Error("OpenFox is not configured. Run openfox --setup first.");
  }
  const db = createDatabase(resolvePath(config.dbPath));
  try {
    const kindValue = readOption(args, "--kind");
    const kind =
      kindValue === "storage" ||
      kindValue === "artifacts" ||
      kindValue === "signer" ||
      kindValue === "paymaster"
        ? (kindValue as ProviderReputationKind)
        : undefined;
    const snapshot = buildProviderReputationSnapshot({
      db,
      kind,
      limit: readNumberOption(args, "--limit", 25),
    });
    if (asJson) {
      logger.info(JSON.stringify(snapshot, null, 2));
      return;
    }
    logger.info(`
=== OPENFOX PROVIDER REPUTATION ===
Generated: ${snapshot.generatedAt}
Providers: ${snapshot.totalProviders}
Weak:      ${snapshot.weakProviders}
${snapshot.entries
  .map(
    (entry) =>
      `${entry.kind}  ${entry.providerAddress || entry.providerBaseUrl || entry.providerKey}  score=${entry.score}  grade=${entry.grade}  success=${entry.successCount}  failure=${entry.failureCount}  pending=${entry.pendingCount}`,
  )
  .join("\n")}
===================================
`);
  } finally {
    db.close();
  }
}

async function handleArtifactCommand(args: string[]): Promise<void> {
  const command = args[0] || "list";
  const asJson = args.includes("--json");
  if (args.includes("--help") || args.includes("-h") || command === "help") {
    logger.info(`
OpenFox artifacts

Usage:
  openfox artifacts list [--kind <public_news.capture|oracle.evidence|oracle.aggregate|committee.vote>] [--status <stored|verified|anchored|failed>] [--source-url-prefix <url>] [--subject <text>] [--query <text>] [--anchored] [--verified] [--json]
  openfox artifacts get --artifact-id <id> [--json]
  openfox artifacts capture-news --title "<text>" --source-url <url> [--headline "<text>"] [--body-file <path> | --body-text <text>] [--provider <base-url>] [--ttl-seconds N] [--anchor] [--json]
  openfox artifacts oracle-evidence --title "<text>" --question "<text>" [--evidence-file <path> | --evidence-text <text>] [--source-url <url>] [--provider <base-url>] [--ttl-seconds N] [--anchor] [--json]
  openfox artifacts oracle-aggregate --title "<text>" --question "<text>" --result "<text>" [--votes-file <path>] [--evidence-artifact <id>]... [--provider <base-url>] [--ttl-seconds N] [--anchor] [--json]
  openfox artifacts committee-vote --title "<text>" --question "<text>" --voter-id "<id>" --vote "<text>" [--evidence-artifact <id>]... [--provider <base-url>] [--ttl-seconds N] [--anchor] [--json]
  openfox artifacts verify --artifact-id <id> [--json]
  openfox artifacts anchor --artifact-id <id> [--json]
  openfox artifacts maintain [--limit N] [--json]
`);
    return;
  }

  const config = loadConfig();
  if (!config) {
    throw new Error("OpenFox is not configured. Run openfox --setup first.");
  }
  const db = createDatabase(resolvePath(config.dbPath));
  try {
    if (command === "maintain") {
      const result = await runArtifactMaintenance({
        config,
        db,
        limit: readNumberOption(args, "--limit", 10),
      });
      logger.info(JSON.stringify(result, null, 2));
      return;
    }

    const { account, privateKey } = await getWallet();
    const anchorPublisher =
      config.artifacts?.anchor.enabled && config.rpcUrl
        ? createNativeArtifactAnchorPublisher({
            db,
            rpcUrl: config.rpcUrl,
            privateKey,
            config: config.artifacts.anchor,
            publisherAddress: config.walletAddress,
          })
        : undefined;
    const manager = createArtifactManager({
      identity: {
        name: config.name,
        address: config.walletAddress,
        account,
        creatorAddress: config.creatorAddress,
        sandboxId: config.sandboxId,
        apiKey: config.runtimeApiKey || loadApiKeyFromConfig() || "",
        createdAt: db.getIdentity("createdAt") || new Date().toISOString(),
      },
      requesterAccount: account,
      db,
      config: config.artifacts ?? {
        enabled: false,
        publishToDiscovery: true,
        defaultProviderBaseUrl: undefined,
        defaultTtlSeconds: 604800,
        autoAnchorOnStore: false,
        captureCapability: "public_news.capture",
        evidenceCapability: "oracle.evidence",
        aggregateCapability: "oracle.aggregate",
        verificationCapability: "artifact.verify",
        service: {
          enabled: false,
          bindHost: "127.0.0.1",
          port: 4896,
          pathPrefix: "/artifacts",
          requireNativeIdentity: true,
          maxBodyBytes: 256 * 1024,
          maxTextChars: 32 * 1024,
        },
        anchor: {
          enabled: false,
          gas: "180000",
          waitForReceipt: true,
          receiptTimeoutMs: 60000,
        },
      },
      anchorPublisher,
    });

    if (command === "list") {
      const kind = readOption(args, "--kind") as
        | "public_news.capture"
        | "oracle.evidence"
        | "oracle.aggregate"
        | "committee.vote"
        | undefined;
      const status = readOption(args, "--status") as
        | "stored"
        | "verified"
        | "anchored"
        | "failed"
        | undefined;
      const sourceUrlPrefix = readOption(args, "--source-url-prefix");
      const subjectContains = readOption(args, "--subject");
      const query = readOption(args, "--query");
      const anchoredOnly = args.includes("--anchored");
      const verifiedOnly = args.includes("--verified");
      const items = manager.listArtifacts(50, {
        kind,
        status,
        sourceUrlPrefix,
        subjectContains,
        query,
        anchoredOnly,
        verifiedOnly,
      });
      if (asJson) {
        logger.info(JSON.stringify({ items }, null, 2));
        return;
      }
      logger.info(
        [
          "=== OPENFOX ARTIFACTS ===",
          `Artifacts: ${items.length}`,
          ...items.map(
            (item) =>
              `${item.artifactId}  [${item.kind}]  status=${item.status}  cid=${item.cid}  title=${item.title}`,
          ),
          "=========================",
        ].join("\n"),
      );
      return;
    }

    if (command === "get") {
      const artifactId = readOption(args, "--artifact-id");
      if (!artifactId) throw new Error("Missing --artifact-id <id>.");
      const artifact = manager.getArtifact(artifactId);
      if (!artifact) throw new Error(`Artifact not found: ${artifactId}`);
      const verification = db.getArtifactVerificationByArtifactId(artifactId) ?? null;
      const anchor = db.getArtifactAnchorByArtifactId(artifactId) ?? null;
      logger.info(JSON.stringify({ artifact, verification, anchor }, null, 2));
      return;
    }

    if (command === "capture-news") {
      const title = readOption(args, "--title");
      const sourceUrl = readOption(args, "--source-url");
      const headline = readOption(args, "--headline") || title;
      const bodyFile = readOption(args, "--body-file");
      const bodyTextOption = readOption(args, "--body-text");
      if (!title || !sourceUrl || !headline || (!bodyFile && !bodyTextOption)) {
        throw new Error(
          "Usage: openfox artifacts capture-news --title <text> --source-url <url> [--headline <text>] [--body-file <path> | --body-text <text>] [--provider <base-url>] [--ttl-seconds N] [--anchor]",
        );
      }
      const bodyText = bodyTextOption ?? (await fs.readFile(resolvePath(bodyFile!), "utf8"));
      const result = await manager.capturePublicNews({
        providerBaseUrl: readOption(args, "--provider") || undefined,
        title,
        sourceUrl,
        headline,
        bodyText,
        ttlSeconds: readNumberOption(
          args,
          "--ttl-seconds",
          config.artifacts?.defaultTtlSeconds ?? 604800,
        ),
        autoAnchor: args.includes("--anchor"),
      });
      logger.info(JSON.stringify(result, null, 2));
      return;
    }

    if (command === "oracle-evidence") {
      const title = readOption(args, "--title");
      const question = readOption(args, "--question");
      const evidenceFile = readOption(args, "--evidence-file");
      const evidenceTextOption = readOption(args, "--evidence-text");
      if (!title || !question || (!evidenceFile && !evidenceTextOption)) {
        throw new Error(
          "Usage: openfox artifacts oracle-evidence --title <text> --question <text> [--evidence-file <path> | --evidence-text <text>] [--source-url <url>] [--provider <base-url>] [--ttl-seconds N] [--anchor]",
        );
      }
      const evidenceText =
        evidenceTextOption ?? (await fs.readFile(resolvePath(evidenceFile!), "utf8"));
      const result = await manager.createOracleEvidence({
        providerBaseUrl: readOption(args, "--provider") || undefined,
        title,
        question,
        evidenceText,
        sourceUrl: readOption(args, "--source-url") || undefined,
        ttlSeconds: readNumberOption(
          args,
          "--ttl-seconds",
          config.artifacts?.defaultTtlSeconds ?? 604800,
        ),
        autoAnchor: args.includes("--anchor"),
      });
      logger.info(JSON.stringify(result, null, 2));
      return;
    }

    if (command === "oracle-aggregate") {
      const title = readOption(args, "--title");
      const question = readOption(args, "--question");
      const resultText = readOption(args, "--result");
      if (!title || !question || !resultText) {
        throw new Error(
          "Usage: openfox artifacts oracle-aggregate --title <text> --question <text> --result <text> [--votes-file <path>] [--evidence-artifact <id>]... [--provider <base-url>] [--ttl-seconds N] [--anchor]",
        );
      }
      const evidenceArtifactIds = collectRepeatedOption(args, "--evidence-artifact");
      const votesFile = readOption(args, "--votes-file");
      const committeeVotes = votesFile
        ? (JSON.parse(await fs.readFile(resolvePath(votesFile), "utf8")) as Array<Record<string, unknown>>)
        : [];
      const result = await manager.createOracleAggregate({
        providerBaseUrl: readOption(args, "--provider") || undefined,
        title,
        question,
        resultText,
        committeeVotes,
        evidenceArtifactIds,
        ttlSeconds: readNumberOption(
          args,
          "--ttl-seconds",
          config.artifacts?.defaultTtlSeconds ?? 604800,
        ),
        autoAnchor: args.includes("--anchor"),
      });
      logger.info(JSON.stringify(result, null, 2));
      return;
    }

    if (command === "committee-vote") {
      const title = readOption(args, "--title");
      const question = readOption(args, "--question");
      const voterId = readOption(args, "--voter-id");
      const voteText = readOption(args, "--vote");
      if (!title || !question || !voterId || !voteText) {
        throw new Error(
          "Usage: openfox artifacts committee-vote --title <text> --question <text> --voter-id <id> --vote <text> [--evidence-artifact <id>]... [--provider <base-url>] [--ttl-seconds N] [--anchor]",
        );
      }
      const evidenceArtifactIds = collectRepeatedOption(args, "--evidence-artifact");
      const result = await manager.createCommitteeVote({
        providerBaseUrl: readOption(args, "--provider") || undefined,
        title,
        question,
        voterId,
        voteText,
        evidenceArtifactIds,
        ttlSeconds: readNumberOption(
          args,
          "--ttl-seconds",
          config.artifacts?.defaultTtlSeconds ?? 604800,
        ),
        autoAnchor: args.includes("--anchor"),
      });
      logger.info(JSON.stringify(result, null, 2));
      return;
    }

    if (command === "verify") {
      const artifactId = readOption(args, "--artifact-id");
      if (!artifactId) throw new Error("Missing --artifact-id <id>.");
      const result = await manager.verifyArtifact({ artifactId });
      logger.info(JSON.stringify(result, null, 2));
      return;
    }

    if (command === "anchor") {
      const artifactId = readOption(args, "--artifact-id");
      if (!artifactId) throw new Error("Missing --artifact-id <id>.");
      const result = await manager.anchorArtifact({ artifactId });
      logger.info(JSON.stringify(result, null, 2));
      return;
    }

    throw new Error(`Unknown artifacts command: ${command}`);
  } finally {
    db.close();
  }
}

async function handleEvidenceCommand(args: string[]): Promise<void> {
  const command = args[0] || "list";
  const asJson = args.includes("--json");
  if (args.includes("--help") || args.includes("-h") || command === "help") {
    logger.info(`
OpenFox evidence

Usage:
  openfox evidence list [--limit N] [--json]
  openfox evidence get --run-id <id> [--json]
  openfox evidence summary [--limit N] [--json]
  openfox evidence run --title "<text>" --question "<text>" --source-url <url>... --news-fetch-url <base-url> --proof-verify-url <base-url> --quorum-m N [--quorum-n N] [--storage-url <base-url>] [--ttl-seconds N] [--json]
`);
    return;
  }

  const config = loadConfig();
  if (!config) {
    throw new Error("OpenFox is not configured. Run openfox --setup first.");
  }

  const db = createDatabase(resolvePath(config.dbPath));
  try {
    if (command === "list") {
      const limit = readNumberOption(args, "--limit", 20);
      const coordinator = createEvidenceWorkflowCoordinator({
        identity: {
          name: config.name,
          address: config.walletAddress,
          account: ({} as OpenFoxIdentity["account"]),
          creatorAddress: config.creatorAddress,
          sandboxId: config.sandboxId,
          apiKey: config.runtimeApiKey || loadApiKeyFromConfig() || "",
          createdAt: db.getIdentity("createdAt") || new Date().toISOString(),
        },
        config,
        db,
      });
      const items = coordinator.list(limit);
      if (asJson) {
        logger.info(JSON.stringify({ items }, null, 2));
        return;
      }
      if (items.length === 0) {
        logger.info("No evidence workflow runs found.");
        return;
      }
      logger.info("=== OPENFOX EVIDENCE WORKFLOWS ===");
      for (const item of items) {
        logger.info(
          `${item.runId}  status=${item.status}  quorum=${item.validCount}/${item.quorumN}  title=${item.title}`,
        );
        if (item.aggregateResultUrl) {
          logger.info(`  aggregate: ${item.aggregateResultUrl}`);
        }
        if (item.aggregateError) {
          logger.info(`  aggregate_error: ${item.aggregateError}`);
        }
      }
      return;
    }

    if (command === "get") {
      const runId = readOption(args, "--run-id");
      if (!runId) throw new Error("Usage: openfox evidence get --run-id <id> [--json]");
      const coordinator = createEvidenceWorkflowCoordinator({
        identity: {
          name: config.name,
          address: config.walletAddress,
          account: ({} as OpenFoxIdentity["account"]),
          creatorAddress: config.creatorAddress,
          sandboxId: config.sandboxId,
          apiKey: config.runtimeApiKey || loadApiKeyFromConfig() || "",
          createdAt: db.getIdentity("createdAt") || new Date().toISOString(),
        },
        config,
        db,
      });
      const item = coordinator.get(runId);
      if (!item) throw new Error(`Evidence workflow run not found: ${runId}`);
      logger.info(JSON.stringify(item, null, 2));
      return;
    }

    if (command === "summary") {
      const snapshot = buildEvidenceWorkflowSummary({
        db,
        limit: readNumberOption(args, "--limit", 20),
      });
      if (asJson) {
        logger.info(JSON.stringify(snapshot, null, 2));
        return;
      }
      logger.info(buildEvidenceWorkflowSummaryReport(snapshot));
      return;
    }

    if (command === "run") {
      const title = readOption(args, "--title");
      const question = readOption(args, "--question");
      const sourceUrls = collectRepeatedOption(args, "--source-url");
      const newsFetchBaseUrl = readOption(args, "--news-fetch-url");
      const proofVerifyBaseUrl = readOption(args, "--proof-verify-url");
      const storageBaseUrl = readOption(args, "--storage-url");
      if (!title || !question || sourceUrls.length === 0 || !newsFetchBaseUrl || !proofVerifyBaseUrl) {
        throw new Error(
          'Usage: openfox evidence run --title "<text>" --question "<text>" --source-url <url>... --news-fetch-url <base-url> --proof-verify-url <base-url> --quorum-m N [--quorum-n N] [--storage-url <base-url>] [--ttl-seconds N] [--json]',
        );
      }
      const quorumM = readNumberOption(args, "--quorum-m", 0);
      const quorumNRaw = readOption(args, "--quorum-n");
      const quorumN = quorumNRaw ? Number.parseInt(quorumNRaw, 10) : undefined;
      if (quorumNRaw && (!Number.isFinite(quorumN) || !quorumN || quorumN <= 0)) {
        throw new Error(`Invalid numeric value for --quorum-n: ${quorumNRaw}`);
      }
      const ttlRaw = readOption(args, "--ttl-seconds");
      const ttlSeconds = ttlRaw ? Number.parseInt(ttlRaw, 10) : undefined;
      if (ttlRaw && (!Number.isFinite(ttlSeconds) || !ttlSeconds || ttlSeconds <= 0)) {
        throw new Error(`Invalid numeric value for --ttl-seconds: ${ttlRaw}`);
      }
      const { account, privateKey } = await getWallet();
      const coordinator = createEvidenceWorkflowCoordinator({
        identity: {
          name: config.name,
          address: config.walletAddress || deriveAddressFromPrivateKey(privateKey),
          account,
          creatorAddress: config.creatorAddress,
          sandboxId: config.sandboxId,
          apiKey: config.runtimeApiKey || loadApiKeyFromConfig() || "",
          createdAt: db.getIdentity("createdAt") || new Date().toISOString(),
        },
        config,
        db,
        account,
      });
      const record = await coordinator.run({
        title,
        question,
        sourceUrls,
        newsFetchBaseUrl,
        proofVerifyBaseUrl,
        storageBaseUrl,
        quorumM,
        quorumN,
        ttlSeconds,
      });
      logger.info(JSON.stringify(record, null, 2));
      return;
    }

    throw new Error(`Unknown evidence command: ${command}`);
  } finally {
    db.close();
  }
}

async function handleOracleCommand(args: string[]): Promise<void> {
  const command = args[0] || "list";
  const asJson = args.includes("--json");
  if (args.includes("--help") || args.includes("-h") || command === "help") {
    logger.info(`
OpenFox oracle

Usage:
  openfox oracle list [--limit N] [--json]
  openfox oracle get --result-id <id> [--json]
  openfox oracle summary [--limit N] [--json]
`);
    return;
  }

  const config = loadConfig();
  if (!config) {
    throw new Error("OpenFox is not configured. Run openfox --setup first.");
  }

  const db = createDatabase(resolvePath(config.dbPath));
  try {
    if (command === "list") {
      const items = listStoredOracleJobs(db, readNumberOption(args, "--limit", 20));
      if (asJson) {
        logger.info(JSON.stringify({ items }, null, 2));
        return;
      }
      if (!items.length) {
        logger.info("No oracle results found.");
        return;
      }
      logger.info("=== OPENFOX ORACLE RESULTS ===");
      for (const item of items) {
        logger.info(
          `${item.resultId}  kind=${item.response.query_kind}  confidence=${item.response.confidence.toFixed(4)}  settled=${item.response.settlement_tx_hash ? "yes" : "no"}`,
        );
      }
      return;
    }

    if (command === "get") {
      const resultId = readOption(args, "--result-id");
      if (!resultId) throw new Error("Usage: openfox oracle get --result-id <id> [--json]");
      const item = getStoredOracleJob(db, resultId);
      if (!item) throw new Error(`Oracle result not found: ${resultId}`);
      logger.info(JSON.stringify(item, null, 2));
      return;
    }

    if (command === "summary") {
      const snapshot = buildOracleSummary({
        db,
        limit: readNumberOption(args, "--limit", 20),
      });
      if (asJson) {
        logger.info(JSON.stringify(snapshot, null, 2));
        return;
      }
      logger.info(buildOracleSummaryReport(snapshot));
      return;
    }

    throw new Error(`Unknown oracle command: ${command}`);
  } finally {
    db.close();
  }
}

async function handleNewsCommand(args: string[]): Promise<void> {
  const command = args[0] || "list";
  const asJson = args.includes("--json");
  if (args.includes("--help") || args.includes("-h") || command === "help") {
    logger.info(`
OpenFox news

Usage:
  openfox news list [--limit N] [--json]
  openfox news get --record-id <id> [--json]
  openfox news summary [--limit N] [--json]
`);
    return;
  }

  const config = loadConfig();
  if (!config) {
    throw new Error("OpenFox is not configured. Run openfox --setup first.");
  }

  const db = createDatabase(resolvePath(config.dbPath));
  try {
    if (command === "list") {
      const items = listZkTlsBundleRecords(db, readNumberOption(args, "--limit", 20));
      if (asJson) {
        logger.info(JSON.stringify({ items }, null, 2));
        return;
      }
      if (!items.length) {
        logger.info("No zkTLS bundle records found.");
        return;
      }
      logger.info("=== OPENFOX NEWS CAPTURE BUNDLES ===");
      for (const item of items) {
        logger.info(
          `${item.recordId}  policy=${item.originClaims.sourcePolicyId || "(unspecified)"}  host=${item.originClaims.sourcePolicyHost || new URL(item.originClaims.canonicalUrl).hostname}  bundle=${item.bundleFormat}`,
        );
      }
      return;
    }

    if (command === "get") {
      const recordId = readOption(args, "--record-id");
      if (!recordId) throw new Error("Usage: openfox news get --record-id <id> [--json]");
      const item = getZkTlsBundleRecord(db, recordId);
      if (!item) throw new Error(`zkTLS bundle record not found: ${recordId}`);
      logger.info(JSON.stringify(item, null, 2));
      return;
    }

    if (command === "summary") {
      const snapshot = buildZkTlsBundleSummary(db, readNumberOption(args, "--limit", 20));
      if (asJson) {
        logger.info(JSON.stringify(snapshot, null, 2));
        return;
      }
      logger.info(buildZkTlsBundleSummaryReport(snapshot));
      return;
    }

    throw new Error(`Unknown news command: ${command}`);
  } finally {
    db.close();
  }
}

async function handleProofCommand(args: string[]): Promise<void> {
  const command = args[0] || "list";
  const asJson = args.includes("--json");
  if (args.includes("--help") || args.includes("-h") || command === "help") {
    logger.info(`
OpenFox proof

Usage:
  openfox proof list [--limit N] [--json]
  openfox proof get --record-id <id> [--json]
  openfox proof summary [--limit N] [--json]
`);
    return;
  }

  const config = loadConfig();
  if (!config) {
    throw new Error("OpenFox is not configured. Run openfox --setup first.");
  }

  const db = createDatabase(resolvePath(config.dbPath));
  try {
    if (command === "list") {
      const items = listProofVerificationRecords(db, readNumberOption(args, "--limit", 20));
      if (asJson) {
        logger.info(JSON.stringify({ items }, null, 2));
        return;
      }
      if (!items.length) {
        logger.info("No proof verification records found.");
        return;
      }
      logger.info("=== OPENFOX PROOF VERIFICATIONS ===");
      for (const item of items) {
        logger.info(
          `${item.recordId}  class=${item.verifierClass}  mode=${item.verificationMode}  verdict=${item.verdict}  reason=${item.verdictReason}`,
        );
      }
      return;
    }

    if (command === "get") {
      const recordId = readOption(args, "--record-id");
      if (!recordId) throw new Error("Usage: openfox proof get --record-id <id> [--json]");
      const item = getProofVerificationRecord(db, recordId);
      if (!item) throw new Error(`Proof verification record not found: ${recordId}`);
      logger.info(JSON.stringify(item, null, 2));
      return;
    }

    if (command === "summary") {
      const snapshot = buildProofVerificationSummary(db, readNumberOption(args, "--limit", 20));
      if (asJson) {
        logger.info(JSON.stringify(snapshot, null, 2));
        return;
      }
      logger.info(buildProofVerificationSummaryReport(snapshot));
      return;
    }

    throw new Error(`Unknown proof command: ${command}`);
  } finally {
    db.close();
  }
}

async function handleCommitteeCommand(args: string[]): Promise<void> {
  const command = args[0] || "list";
  const asJson = args.includes("--json");
  if (args.includes("--help") || args.includes("-h") || command === "help") {
    logger.info(`
OpenFox committee

Usage:
  openfox committee list [--kind <evidence|oracle>] [--limit N] [--json]
  openfox committee get --run-id <id> [--json]
  openfox committee summary [--kind <evidence|oracle>] [--limit N] [--json]
  openfox committee create --kind <evidence|oracle> --title <text> --question <text> --committee-size N --threshold-m N --member <id>... [--payout-total-wei <wei>] [--max-reruns N] [--subject-ref <ref>] [--artifact-id <id>]... [--json]
  openfox committee vote --run-id <id> --member-id <id> --decision <accept|reject|inconclusive> [--result-hash <0x...>] [--reason-code <code>] [--signature <0x...>] [--payout-address <0x...>] [--metadata-file <path>] [--json]
  openfox committee mark-failed --run-id <id> --member-id <id> --reason <text> [--json]
  openfox committee rerun --run-id <id> [--json]
  openfox committee tally --run-id <id> [--json]
  openfox committee payout --run-id <id> [--json]
`);
    return;
  }

  const config = loadConfig();
  if (!config) {
    throw new Error("OpenFox is not configured. Run openfox --setup first.");
  }

  const db = createDatabase(resolvePath(config.dbPath));
  const manager = createCommitteeManager(db);
  try {
    const kind = readOption(args, "--kind") as "evidence" | "oracle" | undefined;

    if (command === "list") {
      const items = manager
        .list(readNumberOption(args, "--limit", 20))
        .filter((item) => !kind || item.kind === kind);
      if (asJson) {
        logger.info(JSON.stringify({ items }, null, 2));
        return;
      }
      if (!items.length) {
        logger.info("No committee runs found.");
        return;
      }
      logger.info("=== OPENFOX COMMITTEE RUNS ===");
      for (const item of items) {
        logger.info(
          `${item.runId}  kind=${item.kind}  status=${item.status}  quorum=${item.thresholdM}/${item.committeeSize}  reruns=${item.rerunCount}/${item.maxReruns}`,
        );
      }
      return;
    }

    if (command === "get") {
      const runId = readOption(args, "--run-id");
      if (!runId) throw new Error("Usage: openfox committee get --run-id <id> [--json]");
      const item = manager.get(runId);
      if (!item) throw new Error(`Committee run not found: ${runId}`);
      logger.info(JSON.stringify(item, null, 2));
      return;
    }

    if (command === "summary") {
      const snapshot = manager.buildSummary(readNumberOption(args, "--limit", 20), kind);
      if (asJson) {
        logger.info(JSON.stringify(snapshot, null, 2));
        return;
      }
      logger.info(buildCommitteeSummaryReport(snapshot));
      return;
    }

    if (command === "create") {
      const createKind = kind;
      const title = readOption(args, "--title");
      const question = readOption(args, "--question");
      const committeeSize = readNumberOption(args, "--committee-size", 0);
      const thresholdM = readNumberOption(args, "--threshold-m", 0);
      const memberIds = collectRepeatedOption(args, "--member");
      if (!createKind || !title || !question || committeeSize <= 0 || thresholdM <= 0 || memberIds.length === 0) {
        throw new Error(
          "Usage: openfox committee create --kind <evidence|oracle> --title <text> --question <text> --committee-size N --threshold-m N --member <id>... [--payout-total-wei <wei>] [--max-reruns N] [--subject-ref <ref>] [--artifact-id <id>]... [--json]",
        );
      }
      const item = manager.createRun({
        kind: createKind,
        title,
        question,
        subjectRef: readOption(args, "--subject-ref") || null,
        artifactIds: collectRepeatedOption(args, "--artifact-id"),
        committeeSize,
        thresholdM,
        payoutTotalWei: readOption(args, "--payout-total-wei") || "0",
        maxReruns: readNumberOption(args, "--max-reruns", 1),
        members: memberIds.map((memberId) => ({ memberId })),
      });
      logger.info(JSON.stringify(item, null, 2));
      return;
    }

    if (command === "vote") {
      const runId = readOption(args, "--run-id");
      const memberId = readOption(args, "--member-id");
      const decision = readOption(args, "--decision") as
        | "accept"
        | "reject"
        | "inconclusive"
        | undefined;
      if (!runId || !memberId || !decision) {
        throw new Error(
          "Usage: openfox committee vote --run-id <id> --member-id <id> --decision <accept|reject|inconclusive> [--result-hash <0x...>] [--reason-code <code>] [--signature <0x...>] [--payout-address <0x...>] [--metadata-file <path>] [--json]",
        );
      }
      const metadataFile = readOption(args, "--metadata-file");
      const metadata = metadataFile
        ? (JSON.parse(await fs.readFile(resolvePath(metadataFile), "utf8")) as Record<string, unknown>)
        : undefined;
      const item = manager.recordVote({
        runId,
        memberId,
        decision,
        resultHash: (readOption(args, "--result-hash") || null) as `0x${string}` | null,
        reasonCode: readOption(args, "--reason-code") || null,
        signature: (readOption(args, "--signature") || null) as `0x${string}` | null,
        payoutAddress: readOption(args, "--payout-address") || null,
        metadata,
      });
      logger.info(JSON.stringify(item, null, 2));
      return;
    }

    if (command === "mark-failed") {
      const runId = readOption(args, "--run-id");
      const memberId = readOption(args, "--member-id");
      const reason = readOption(args, "--reason");
      if (!runId || !memberId || !reason) {
        throw new Error("Usage: openfox committee mark-failed --run-id <id> --member-id <id> --reason <text> [--json]");
      }
      logger.info(JSON.stringify(manager.markMemberFailed({ runId, memberId, reason }), null, 2));
      return;
    }

    if (command === "rerun") {
      const runId = readOption(args, "--run-id");
      if (!runId) throw new Error("Usage: openfox committee rerun --run-id <id> [--json]");
      logger.info(JSON.stringify(manager.rerun(runId), null, 2));
      return;
    }

    if (command === "tally") {
      const runId = readOption(args, "--run-id");
      if (!runId) throw new Error("Usage: openfox committee tally --run-id <id> [--json]");
      logger.info(JSON.stringify(manager.tally(runId), null, 2));
      return;
    }

    if (command === "payout") {
      const runId = readOption(args, "--run-id");
      if (!runId) throw new Error("Usage: openfox committee payout --run-id <id> [--json]");
      logger.info(JSON.stringify(manager.markPaid(runId), null, 2));
      return;
    }

    throw new Error(`Unknown committee command: ${command}`);
  } finally {
    db.close();
  }
}

async function handleTrailsCommand(args: string[]): Promise<void> {
  const command = args[0] || "list";
  const asJson = args.includes("--json");
  if (args.includes("--help") || args.includes("-h") || command === "help") {
    logger.info(`
OpenFox trails

Usage:
  openfox trails list [--subject-kind <storage_lease|storage_renewal|storage_audit|storage_anchor|artifact|artifact_verification|artifact_anchor>] [--subject-id <id>] [--execution-kind <signer_execution|paymaster_authorization>] [--limit N] [--json]
  openfox trails get --trail-id <id> [--json]
`);
    return;
  }

  const config = loadConfig();
  if (!config) {
    throw new Error("OpenFox is not configured. Run openfox --setup first.");
  }
  const db = createDatabase(resolvePath(config.dbPath));
  try {
    if (command === "get") {
      const trailId = readOption(args, "--trail-id");
      if (!trailId) throw new Error("Missing --trail-id <id>.");
      const item = db.getExecutionTrail(trailId);
      if (!item) throw new Error(`Execution trail not found: ${trailId}`);
      logger.info(JSON.stringify(item, null, 2));
      return;
    }

    if (command !== "list") {
      throw new Error(`Unknown trails command: ${command}`);
    }

    const subjectKind = readOption(args, "--subject-kind") as
      | "storage_lease"
      | "storage_renewal"
      | "storage_audit"
      | "storage_anchor"
      | "artifact"
      | "artifact_verification"
      | "artifact_anchor"
      | undefined;
    const executionKind = readOption(args, "--execution-kind") as
      | "signer_execution"
      | "paymaster_authorization"
      | undefined;
    const subjectId = readOption(args, "--subject-id");
    const items = db.listExecutionTrails(readNumberOption(args, "--limit", 50), {
      subjectKind,
      subjectId: subjectId || undefined,
      executionKind,
    });
    if (asJson) {
      logger.info(JSON.stringify({ items }, null, 2));
      return;
    }
    logger.info(
      [
        "=== OPENFOX EXECUTION TRAILS ===",
        `Trails: ${items.length}`,
        ...items.map(
          (item) =>
            `${item.trailId}  ${item.subjectKind}:${item.subjectId}  ${item.executionKind}:${item.executionRecordId}  mode=${item.linkMode}`,
        ),
        "================================",
      ].join("\n"),
    );
  } finally {
    db.close();
  }
}

async function handleSignerCommand(args: string[]): Promise<void> {
  const command = args[0];
  if (!command || command === "--help" || command === "help") {
    logger.info(`
OpenFox signer

Usage:
  openfox signer list [--status <pending|submitted|confirmed|failed|rejected>] [--json]
  openfox signer get --execution <id> [--json]
  openfox signer discover [--capability-prefix <prefix>] [--json]
  openfox signer quote [--provider <base-url>] [--capability-prefix <prefix>] [--trust-tier <tier>] --target <address> [--value-wei <wei>] [--data <hex>] [--gas <gas>] [--reason <text>] [--json]
  openfox signer submit [--provider <base-url>] [--capability-prefix <prefix>] [--trust-tier <tier>] --quote-id <id> --target <address> [--value-wei <wei>] [--data <hex>] [--gas <gas>] [--reason <text>] [--json]
  openfox signer status --provider <base-url> --execution <id> [--json]
  openfox signer receipt --provider <base-url> --execution <id> [--json]
`);
    return;
  }

  const config = loadConfig();
  if (!config) {
    throw new Error("OpenFox is not configured. Run `openfox --setup` first.");
  }
  const db = createDatabase(resolvePath(config.dbPath));
  try {
    const wantsJson = args.includes("--json");
    if (command === "list") {
      const status = readOption(args, "--status") as
        | "pending"
        | "submitted"
        | "confirmed"
        | "failed"
        | "rejected"
        | undefined;
      const items = db.listSignerExecutions(50, status ? { status } : undefined);
      if (wantsJson) {
        logger.info(JSON.stringify(items, null, 2));
        return;
      }
      if (!items.length) {
        logger.info("No signer executions found.");
        return;
      }
      for (const item of items) {
        logger.info(
          `${item.executionId}  [${item.status}] wallet=${item.walletAddress} target=${item.targetAddress} tx=${item.submittedTxHash || "(pending)"}`,
        );
      }
      return;
    }

    if (command === "get") {
      const executionId = readOption(args, "--execution");
      if (!executionId) {
        throw new Error("Usage: openfox signer get --execution <id> [--json]");
      }
      const record = db.getSignerExecution(executionId);
      if (!record) {
        throw new Error(`Signer execution not found: ${executionId}`);
      }
      logger.info(JSON.stringify(record, null, 2));
      return;
    }

    if (command === "discover") {
      const capabilityPrefix =
        readOption(args, "--capability-prefix") ||
        config.signerProvider?.capabilityPrefix ||
        "signer";
      const requiredTrustTier = readSignerTrustTierOption(args);
      const providers = (await discoverCapabilityProviders({
        config,
        capability: `${capabilityPrefix}.quote`,
        limit: 10,
        db,
      })).filter((provider) =>
        requiredTrustTier
          ? provider.matchedCapability.policy?.trust_tier === requiredTrustTier
          : true,
      );
      const discovered = providers.map((provider) => ({
        providerAddress: provider.search.primaryIdentity,
        nodeId: provider.search.nodeId,
        capability: provider.matchedCapability.name,
        mode: provider.matchedCapability.mode,
        endpoint: provider.endpoint.url,
        trustTier: provider.matchedCapability.policy?.trust_tier ?? null,
        trust: provider.search.trust,
      }));
      if (wantsJson) {
        logger.info(JSON.stringify(discovered, null, 2));
        return;
      }
      if (!discovered.length) {
        logger.info("No signer providers discovered.");
        return;
      }
      for (const provider of discovered) {
        logger.info(
          `${provider.providerAddress}  capability=${provider.capability}  mode=${provider.mode}  trust_tier=${provider.trustTier || "(unknown)"}  endpoint=${provider.endpoint}`,
        );
      }
      return;
    }

    if (command === "quote") {
      const capabilityPrefix =
        readOption(args, "--capability-prefix") ||
        config.signerProvider?.capabilityPrefix ||
        "signer";
      const requiredTrustTier = readSignerTrustTierOption(args);
      const { providerBaseUrl, provider } = await resolveSignerProviderBaseUrl({
        config,
        capabilityPrefix,
        providerBaseUrl: readOption(args, "--provider"),
        db,
        requiredTrustTier,
      });
      const target = readOption(args, "--target");
      if (!providerBaseUrl || !target) {
        throw new Error("Usage: openfox signer quote [--provider <base-url>] [--capability-prefix <prefix>] [--trust-tier <tier>] --target <address> [--value-wei <wei>] [--data <hex>] [--gas <gas>] [--reason <text>] [--json]");
      }
      const result = await fetchSignerQuote({
        providerBaseUrl,
        requesterAddress: config.walletAddress,
        target: target as `0x${string}`,
        valueWei: readOption(args, "--value-wei") || "0",
        data: (readOption(args, "--data") as `0x${string}` | undefined) ?? undefined,
        gas: readOption(args, "--gas") || undefined,
        reason: readOption(args, "--reason") || undefined,
      });
      if (
        requiredTrustTier &&
        result.trust_tier &&
        result.trust_tier !== requiredTrustTier
      ) {
        throw new Error(
          `Signer provider returned trust_tier=${String(result.trust_tier)} but ${requiredTrustTier} was required.`,
        );
      }
      if (
        !requiredTrustTier &&
        (result.trust_tier === "public_low_trust" ||
          provider?.matchedCapability.policy?.trust_tier === "public_low_trust")
      ) {
        logger.warn(
          "Selected signer-provider is public_low_trust. Re-run with --trust-tier self_hosted or --trust-tier org_trusted for a stricter policy boundary.",
        );
      }
      logger.info(JSON.stringify(result, null, 2));
      return;
    }

    if (command === "submit") {
      const capabilityPrefix =
        readOption(args, "--capability-prefix") ||
        config.signerProvider?.capabilityPrefix ||
        "signer";
      const requiredTrustTier = readSignerTrustTierOption(args);
      const { providerBaseUrl, provider } = await resolveSignerProviderBaseUrl({
        config,
        capabilityPrefix,
        providerBaseUrl: readOption(args, "--provider"),
        db,
        requiredTrustTier,
      });
      const quoteId = readOption(args, "--quote-id");
      const target = readOption(args, "--target");
      if (!providerBaseUrl || !quoteId || !target) {
        throw new Error("Usage: openfox signer submit [--provider <base-url>] [--capability-prefix <prefix>] [--trust-tier <tier>] --quote-id <id> --target <address> [--value-wei <wei>] [--data <hex>] [--gas <gas>] [--reason <text>] [--json]");
      }
      if (!config.rpcUrl) {
        throw new Error("rpcUrl is required for signer submit");
      }
      const { account } = await getWallet();
      const result = await submitSignerExecution({
        providerBaseUrl,
        account,
        rpcUrl: config.rpcUrl,
        requesterAddress: config.walletAddress,
        quoteId,
        target: target as `0x${string}`,
        valueWei: readOption(args, "--value-wei") || "0",
        data: (readOption(args, "--data") as `0x${string}` | undefined) ?? undefined,
        gas: readOption(args, "--gas") || undefined,
        requestNonce: randomUUID().replace(/-/g, ""),
        requestExpiresAt: Math.floor(Date.now() / 1000) + 300,
        reason: readOption(args, "--reason") || undefined,
      });
      if (
        !requiredTrustTier &&
        provider?.matchedCapability.policy?.trust_tier === "public_low_trust"
      ) {
        logger.warn(
          "Submitted through a public_low_trust signer-provider. Prefer --trust-tier self_hosted or org_trusted for higher-value delegated execution.",
        );
      }
      logger.info(JSON.stringify(result.body, null, 2));
      return;
    }

    if (command === "status") {
      const providerBaseUrl = readOption(args, "--provider");
      const executionId = readOption(args, "--execution");
      if (!providerBaseUrl || !executionId) {
        throw new Error("Usage: openfox signer status --provider <base-url> --execution <id> [--json]");
      }
      const result = await fetchSignerExecutionStatus(providerBaseUrl, executionId);
      logger.info(JSON.stringify(result, null, 2));
      return;
    }

    if (command === "receipt") {
      const providerBaseUrl = readOption(args, "--provider");
      const executionId = readOption(args, "--execution");
      if (!providerBaseUrl || !executionId) {
        throw new Error("Usage: openfox signer receipt --provider <base-url> --execution <id> [--json]");
      }
      const result = await fetchSignerExecutionReceipt(providerBaseUrl, executionId);
      logger.info(JSON.stringify(result, null, 2));
      return;
    }

    throw new Error(`Unknown signer command: ${command}`);
  } finally {
    db.close();
  }
}

async function handlePaymasterCommand(args: string[]): Promise<void> {
  const command = args[0];
  if (!command || command === "--help" || command === "help") {
    logger.info(`
OpenFox paymaster

Usage:
  openfox paymaster list [--kind <quote|authorization>] [--status <quoted|used|expired|authorized|submitted|confirmed|failed|rejected>] [--json]
  openfox paymaster get (--quote <id> | --authorization <id>) [--json]
  openfox paymaster discover [--capability-prefix <prefix>] [--trust-tier <tier>] [--json]
  openfox paymaster quote [--provider <base-url>] [--capability-prefix <prefix>] [--trust-tier <tier>] [--wallet <address>] --target <address> [--value-wei <wei>] [--data <hex>] [--gas <gas>] [--reason <text>] [--json]
  openfox paymaster authorize [--provider <base-url>] [--capability-prefix <prefix>] [--trust-tier <tier>] --quote-id <id> [--reason <text>] [--json]
  openfox paymaster status --provider <base-url> --authorization <id> [--json]
  openfox paymaster receipt --provider <base-url> --authorization <id> [--json]
`);
    return;
  }

  const config = loadConfig();
  if (!config) {
    throw new Error("OpenFox is not configured. Run `openfox --setup` first.");
  }
  const db = createDatabase(resolvePath(config.dbPath));
  try {
    const wantsJson = args.includes("--json");
    if (command === "list") {
      const kind = (readOption(args, "--kind") || "authorization").trim().toLowerCase();
      if (kind === "quote") {
        const status = readOption(args, "--status") as
          | "quoted"
          | "used"
          | "expired"
          | undefined;
        const items = db.listPaymasterQuotes(50, status ? { status } : undefined);
        if (wantsJson) {
          logger.info(JSON.stringify(items, null, 2));
          return;
        }
        if (!items.length) {
          logger.info("No paymaster quotes found.");
          return;
        }
        for (const item of items) {
          logger.info(
            `${item.quoteId}  [${item.status}] wallet=${item.walletAddress} sponsor=${item.sponsorAddress} target=${item.targetAddress} amount=${item.amountWei}`,
          );
        }
        return;
      }
      const status = readOption(args, "--status") as
        | "authorized"
        | "submitted"
        | "confirmed"
        | "failed"
        | "rejected"
        | "expired"
        | undefined;
      const items = db.listPaymasterAuthorizations(50, status ? { status } : undefined);
      if (wantsJson) {
        logger.info(JSON.stringify(items, null, 2));
        return;
      }
      if (!items.length) {
        logger.info("No paymaster authorizations found.");
        return;
      }
      for (const item of items) {
        logger.info(
          `${item.authorizationId}  [${item.status}] wallet=${item.walletAddress} sponsor=${item.sponsorAddress} target=${item.targetAddress} tx=${item.submittedTxHash || "(pending)"}`,
        );
      }
      return;
    }

    if (command === "get") {
      const quoteId = readOption(args, "--quote");
      const authorizationId = readOption(args, "--authorization");
      if (!quoteId && !authorizationId) {
        throw new Error("Usage: openfox paymaster get (--quote <id> | --authorization <id>) [--json]");
      }
      const record = quoteId
        ? db.getPaymasterQuote(quoteId)
        : db.getPaymasterAuthorization(authorizationId!);
      if (!record) {
        throw new Error(
          quoteId
            ? `Paymaster quote not found: ${quoteId}`
            : `Paymaster authorization not found: ${authorizationId}`,
        );
      }
      logger.info(JSON.stringify(record, null, 2));
      return;
    }

    if (command === "discover") {
      const capabilityPrefix =
        readOption(args, "--capability-prefix") ||
        config.paymasterProvider?.capabilityPrefix ||
        "paymaster";
      const requiredTrustTier = readSignerTrustTierOption(args);
      const providers = (await discoverCapabilityProviders({
        config,
        capability: `${capabilityPrefix}.quote`,
        limit: 10,
        db,
      })).filter((provider) =>
        requiredTrustTier
          ? provider.matchedCapability.policy?.trust_tier === requiredTrustTier
          : true,
      );
      const discovered = providers.map((provider) => ({
        providerAddress: provider.search.primaryIdentity,
        nodeId: provider.search.nodeId,
        capability: provider.matchedCapability.name,
        mode: provider.matchedCapability.mode,
        endpoint: provider.endpoint.url,
        trustTier: provider.matchedCapability.policy?.trust_tier ?? null,
        sponsorAddress: provider.matchedCapability.policy?.sponsor_address ?? null,
        trust: provider.search.trust,
      }));
      if (wantsJson) {
        logger.info(JSON.stringify(discovered, null, 2));
        return;
      }
      if (!discovered.length) {
        logger.info("No paymaster providers discovered.");
        return;
      }
      for (const provider of discovered) {
        logger.info(
          `${provider.providerAddress}  capability=${provider.capability}  mode=${provider.mode}  trust_tier=${provider.trustTier || "(unknown)"}  sponsor=${provider.sponsorAddress || "(unset)"}  endpoint=${provider.endpoint}`,
        );
      }
      return;
    }

    if (command === "quote") {
      const capabilityPrefix =
        readOption(args, "--capability-prefix") ||
        config.paymasterProvider?.capabilityPrefix ||
        "paymaster";
      const requiredTrustTier = readSignerTrustTierOption(args);
      const { providerBaseUrl, provider } = await resolvePaymasterProviderBaseUrl({
        config,
        capabilityPrefix,
        providerBaseUrl: readOption(args, "--provider"),
        db,
        requiredTrustTier,
      });
      const target = readOption(args, "--target");
      if (!providerBaseUrl || !target) {
        throw new Error("Usage: openfox paymaster quote [--provider <base-url>] [--capability-prefix <prefix>] [--trust-tier <tier>] [--wallet <address>] --target <address> [--value-wei <wei>] [--data <hex>] [--gas <gas>] [--reason <text>] [--json]");
      }
      const result = await fetchPaymasterQuote({
        providerBaseUrl,
        requesterAddress: config.walletAddress,
        walletAddress: (readOption(args, "--wallet") as `0x${string}` | undefined) ?? undefined,
        target: target as `0x${string}`,
        valueWei: readOption(args, "--value-wei") || "0",
        data: (readOption(args, "--data") as `0x${string}` | undefined) ?? undefined,
        gas: readOption(args, "--gas") || undefined,
        reason: readOption(args, "--reason") || undefined,
      });
      const quoteRecord = toPaymasterQuoteRecord(result);
      db.upsertPaymasterQuote(quoteRecord);
      if (
        requiredTrustTier &&
        result.trust_tier &&
        result.trust_tier !== requiredTrustTier
      ) {
        throw new Error(
          `Paymaster provider returned trust_tier=${String(result.trust_tier)} but ${requiredTrustTier} was required.`,
        );
      }
      if (
        !requiredTrustTier &&
        (result.trust_tier === "public_low_trust" ||
          provider?.matchedCapability.policy?.trust_tier === "public_low_trust")
      ) {
        logger.warn(
          "Selected paymaster-provider is public_low_trust. Re-run with --trust-tier self_hosted or --trust-tier org_trusted for a stricter sponsorship boundary.",
        );
      }
      logger.info(JSON.stringify(result, null, 2));
      return;
    }

    if (command === "authorize") {
      const capabilityPrefix =
        readOption(args, "--capability-prefix") ||
        config.paymasterProvider?.capabilityPrefix ||
        "paymaster";
      const requiredTrustTier = readSignerTrustTierOption(args);
      const { providerBaseUrl, provider } = await resolvePaymasterProviderBaseUrl({
        config,
        capabilityPrefix,
        providerBaseUrl: readOption(args, "--provider"),
        db,
        requiredTrustTier,
      });
      const quoteId = readOption(args, "--quote-id");
      if (!providerBaseUrl || !quoteId) {
        throw new Error("Usage: openfox paymaster authorize [--provider <base-url>] [--capability-prefix <prefix>] [--trust-tier <tier>] --quote-id <id> [--reason <text>] [--json]");
      }
      if (!config.rpcUrl) {
        throw new Error("rpcUrl is required for paymaster authorize");
      }
      const quote = db.getPaymasterQuote(quoteId);
      if (!quote) {
        throw new Error(`Paymaster quote not found locally: ${quoteId}. Run \`openfox paymaster quote\` first.`);
      }
      const { account } = await getWallet();
      const result = await authorizePaymasterExecution({
        providerBaseUrl,
        rpcUrl: config.rpcUrl,
        account,
        requesterAddress: config.walletAddress,
        quote,
        requestNonce: randomUUID().replace(/-/g, ""),
        requestExpiresAt: Math.floor(Date.now() / 1000) + 300,
        reason: readOption(args, "--reason") || undefined,
      });
      const authorization = toPaymasterAuthorizationRecord(result.body, quote);
      db.upsertPaymasterAuthorization(authorization);
      db.upsertPaymasterQuote({
        ...quote,
        status: authorization.status === "rejected" ? quote.status : "used",
        updatedAt: new Date().toISOString(),
      });
      if (
        !requiredTrustTier &&
        provider?.matchedCapability.policy?.trust_tier === "public_low_trust"
      ) {
        logger.warn(
          "Authorized through a public_low_trust paymaster-provider. Prefer --trust-tier self_hosted or org_trusted for higher-value sponsored execution.",
        );
      }
      logger.info(JSON.stringify(result.body, null, 2));
      return;
    }

    if (command === "status") {
      const providerBaseUrl = readOption(args, "--provider");
      const authorizationId = readOption(args, "--authorization");
      if (!providerBaseUrl || !authorizationId) {
        throw new Error("Usage: openfox paymaster status --provider <base-url> --authorization <id> [--json]");
      }
      const result = await fetchPaymasterAuthorizationStatus(providerBaseUrl, authorizationId);
      logger.info(JSON.stringify(result, null, 2));
      return;
    }

    if (command === "receipt") {
      const providerBaseUrl = readOption(args, "--provider");
      const authorizationId = readOption(args, "--authorization");
      if (!providerBaseUrl || !authorizationId) {
        throw new Error("Usage: openfox paymaster receipt --provider <base-url> --authorization <id> [--json]");
      }
      const result = await fetchPaymasterAuthorizationReceipt(providerBaseUrl, authorizationId);
      logger.info(JSON.stringify(result, null, 2));
      return;
    }

    throw new Error(`Unknown paymaster command: ${command}`);
  } finally {
    db.close();
  }
}

// ─── Status Command ────────────────────────────────────────────

async function showStatus(options: { asJson?: boolean } = {}): Promise<void> {
  const config = loadConfig();
  if (!config) {
    if (options.asJson) {
      logger.info(
        JSON.stringify({ configured: false, message: "OpenFox is not configured." }, null, 2),
      );
    } else {
      logger.info("OpenFox is not configured. Run the setup script first.");
    }
    return;
  }

  const dbPath = resolvePath(config.dbPath);
  const db = createDatabase(dbPath);
  try {
    const snapshot = buildRuntimeStatusSnapshot(config, db);
    if (options.asJson) {
      logger.info(JSON.stringify(snapshot, null, 2));
      return;
    }
    logger.info(buildRuntimeStatusReport(snapshot));
  } finally {
    db.close();
  }
}

// ─── Main Run ──────────────────────────────────────────────────

async function run(): Promise<void> {
  logger.info(`[${new Date().toISOString()}] OpenFox v${VERSION} starting...`);

  // Load config — first run triggers interactive setup wizard
  let config = loadConfig();
  if (!config) {
    const { runSetupWizard } = await import("./setup/wizard.js");
    config = await runSetupWizard();
  }

  // Load wallet
  const { account, privateKey } = await getWallet();
  const apiKey = config.runtimeApiKey || loadApiKeyFromConfig() || "";
  if (!hasConfiguredInference(config)) {
    logger.error(
      "No inference provider configured. Set OpenAI/Anthropic API keys or OLLAMA_BASE_URL, then run openfox --setup or --configure.",
    );
    process.exit(1);
  }

  // Initialize database
  const dbPath = resolvePath(config.dbPath);
  const db = createDatabase(dbPath);

  // Persist createdAt: only set if not already stored (never overwrite)
  const existingCreatedAt = db.getIdentity("createdAt");
  const createdAt = existingCreatedAt || new Date().toISOString();
  if (!existingCreatedAt) {
    db.setIdentity("createdAt", createdAt);
  }

  // Build identity
  const address = config.walletAddress || deriveAddressFromPrivateKey(privateKey);

  const identity: OpenFoxIdentity = {
    name: config.name,
    address,
    account,
    creatorAddress: config.creatorAddress,
    sandboxId: config.sandboxId,
    apiKey,
    createdAt,
  };

  // Store identity in DB
  db.setIdentity("name", config.name);
  db.setIdentity("address", address);
  db.setIdentity("creator", config.creatorAddress);
  db.setIdentity("sandbox", config.sandboxId);
  const storedOpenFoxId = db.getIdentity("openfoxId");
  const openfoxId = storedOpenFoxId || config.sandboxId || randomUUID();
  if (!storedOpenFoxId) {
    db.setIdentity("openfoxId", openfoxId);
  }

  // Create Runtime client
  const runtime = createRuntimeClient({
    apiUrl: config.runtimeApiUrl,
    apiKey,
    sandboxId: config.sandboxId,
  });
  const skillsDir = config.skillsDir || "~/.openfox/skills";
  let skills: Skill[] = [];
  const ollamaBaseUrl = process.env.OLLAMA_BASE_URL || config.ollamaBaseUrl;
  const modelRegistry = new ModelRegistry(db.raw);
  modelRegistry.initialize();
  const inference = createInferenceClient({
    apiUrl: config.runtimeApiUrl || "",
    apiKey,
    defaultModel: config.inferenceModelRef || config.inferenceModel,
    maxTokens: config.maxTokensPerTurn,
    lowComputeModel: config.modelStrategy?.lowComputeModel || "gpt-5-mini",
    openaiApiKey: config.openaiApiKey,
    anthropicApiKey: config.anthropicApiKey,
    ollamaBaseUrl,
    getModelProvider: (modelId) => modelRegistry.get(modelId)?.provider,
  });

  if (ollamaBaseUrl) {
    logger.info(`[${new Date().toISOString()}] Ollama backend: ${ollamaBaseUrl}`);
  }

  let faucetServer:
    | Awaited<ReturnType<typeof startAgentDiscoveryFaucetServer>>
    | undefined;
  let observationServer:
    | Awaited<ReturnType<typeof startAgentDiscoveryObservationServer>>
    | undefined;
  let oracleServer:
    | Awaited<ReturnType<typeof startAgentDiscoveryOracleServer>>
    | undefined;
  let newsFetchServer:
    | Awaited<ReturnType<typeof startAgentDiscoveryNewsFetchServer>>
    | undefined;
  let proofVerifyServer:
    | Awaited<ReturnType<typeof startAgentDiscoveryProofVerifyServer>>
    | undefined;
  let discoveryStorageServer:
    | Awaited<ReturnType<typeof startAgentDiscoveryStorageServer>>
    | undefined;
  let sentimentAnalysisServer:
    | Awaited<ReturnType<typeof startAgentDiscoverySentimentAnalysisServer>>
    | undefined;
  let storageServer:
    | Awaited<ReturnType<typeof startStorageProviderServer>>
    | undefined;
  let artifactServer:
    | Awaited<ReturnType<typeof startArtifactCaptureServer>>
    | undefined;
  let signerProviderServer:
    | Awaited<ReturnType<typeof startSignerProviderServer>>
    | undefined;
  let paymasterProviderServer:
    | Awaited<ReturnType<typeof startPaymasterProviderServer>>
    | undefined;
  let bountyServer:
    | Awaited<ReturnType<typeof startBountyHttpServer>>
    | undefined;
  let bountyAutomation:
    | Awaited<ReturnType<typeof startBountyAutomation>>
    | undefined;
  let runtimeArtifactManager: ReturnType<typeof createArtifactManager> | undefined;
  let gatewayServer:
    | Awaited<ReturnType<typeof startAgentGatewayServer>>
    | undefined;
  let operatorApiServer:
    | Awaited<ReturnType<typeof startOperatorApiServer>>
    | undefined;
  let ownerReportServer:
    | Awaited<ReturnType<typeof startOwnerReportServer>>
    | undefined;
  let gatewayProviderSessions:
    | Awaited<ReturnType<typeof startAgentGatewayProviderSessions>>
    | undefined;
  let liveGatewayProviderSessions: NonNullable<
    Awaited<ReturnType<typeof startAgentGatewayProviderSessions>>
  >["sessions"] = [];
  const settlementPublisher =
    config.settlement?.enabled && config.rpcUrl
      ? createNativeSettlementPublisher({
          db,
          rpcUrl: config.rpcUrl,
          privateKey,
          config: config.settlement,
          publisherAddress: address,
        })
      : undefined;
  const settlementCallbacks =
    config.settlement?.enabled &&
    config.settlement.callbacks.enabled &&
    config.rpcUrl
      ? createNativeSettlementCallbackDispatcher({
          db,
          rpcUrl: config.rpcUrl,
          privateKey,
          config: config.settlement.callbacks,
        })
      : undefined;
  const marketBindingPublisher = config.marketContracts?.enabled
    ? createMarketBindingPublisher({ db })
    : undefined;
  const marketContracts =
    config.marketContracts?.enabled && config.rpcUrl
      ? createMarketContractDispatcher({
          db,
          rpcUrl: config.rpcUrl,
          privateKey,
          config: config.marketContracts,
        })
      : undefined;

  if (config.agentDiscovery?.faucetServer?.enabled) {
    try {
      faucetServer = await startAgentDiscoveryFaucetServer({
        identity,
        config,
        address,
        privateKey,
        db,
        faucetConfig: config.agentDiscovery.faucetServer,
      });
      logger.info(`Agent Discovery faucet provider enabled at ${faucetServer.url}`);
    } catch (error) {
      logger.warn(
        `Agent Discovery faucet server failed to start: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  if (config.agentDiscovery?.observationServer?.enabled) {
    try {
      observationServer = await startAgentDiscoveryObservationServer({
        identity,
        config,
        address,
        db,
        observationConfig: config.agentDiscovery.observationServer,
        marketBindingPublisher,
        marketContracts,
        settlementPublisher: config.settlement?.publishObservations
          ? settlementPublisher
          : undefined,
        settlementCallbacks,
      });
      logger.info(`Agent Discovery observation provider enabled at ${observationServer.url}`);
    } catch (error) {
      logger.warn(
        `Agent Discovery observation server failed to start: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  if (config.agentDiscovery?.oracleServer?.enabled) {
    try {
      oracleServer = await startAgentDiscoveryOracleServer({
        identity,
        config,
        address,
        db,
        inference,
        oracleConfig: config.agentDiscovery.oracleServer,
        marketBindingPublisher,
        marketContracts,
        settlementPublisher: config.settlement?.publishOracleResults
          ? settlementPublisher
          : undefined,
        settlementCallbacks,
      });
      logger.info(`Agent Discovery oracle provider enabled at ${oracleServer.url}`);
    } catch (error) {
      logger.warn(
        `Agent Discovery oracle server failed to start: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  if (config.agentDiscovery?.newsFetchServer?.enabled) {
    try {
      newsFetchServer = await startAgentDiscoveryNewsFetchServer({
        identity,
        config,
        address,
        db,
        newsFetchConfig: config.agentDiscovery.newsFetchServer,
      });
      logger.info(`Agent Discovery news.fetch provider enabled at ${newsFetchServer.url}`);
    } catch (error) {
      logger.warn(
        `Agent Discovery news.fetch server failed to start: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  if (config.agentDiscovery?.proofVerifyServer?.enabled) {
    try {
      proofVerifyServer = await startAgentDiscoveryProofVerifyServer({
        identity,
        config,
        address,
        db,
        proofVerifyConfig: config.agentDiscovery.proofVerifyServer,
      });
      logger.info(`Agent Discovery proof.verify provider enabled at ${proofVerifyServer.url}`);
    } catch (error) {
      logger.warn(
        `Agent Discovery proof.verify server failed to start: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  if (config.agentDiscovery?.sentimentAnalysisServer?.enabled) {
    try {
      sentimentAnalysisServer = await startAgentDiscoverySentimentAnalysisServer({
        identity,
        config,
        address,
        db,
        inference,
        sentimentConfig: config.agentDiscovery.sentimentAnalysisServer,
      });
      logger.info(`Agent Discovery sentiment.analyze provider enabled at ${sentimentAnalysisServer.url}`);
    } catch (error) {
      logger.warn(
        `Agent Discovery sentiment analysis server failed to start: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  if (config.agentDiscovery?.storageServer?.enabled) {
    try {
      discoveryStorageServer = await startAgentDiscoveryStorageServer({
        identity,
        config,
        address,
        db,
        storageConfig: config.agentDiscovery.storageServer,
      });
      logger.info(`Agent Discovery storage provider enabled at ${discoveryStorageServer.url}`);
    } catch (error) {
      logger.warn(
        `Agent Discovery storage server failed to start: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  if (config.storage?.enabled) {
    try {
      storageServer = await startStorageProviderServer({
        identity,
        config,
        address,
        privateKey,
        db,
        storageConfig: config.storage,
      });
      logger.info(`Storage provider enabled at ${storageServer.url}`);
    } catch (error) {
      logger.warn(
        `Storage provider failed to start: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  if (config.artifacts?.enabled) {
    try {
      const artifactAnchorPublisher =
        config.artifacts.anchor.enabled && config.rpcUrl
          ? createNativeArtifactAnchorPublisher({
              db,
              rpcUrl: config.rpcUrl,
              privateKey,
              config: config.artifacts.anchor,
              publisherAddress: config.walletAddress,
            })
          : undefined;
      runtimeArtifactManager = createArtifactManager({
        identity,
        requesterAccount: account,
        db,
        config: {
          ...config.artifacts,
          defaultProviderBaseUrl:
            config.artifacts.defaultProviderBaseUrl || storageServer?.url,
        },
        anchorPublisher: artifactAnchorPublisher,
      });
      if (config.artifacts.service.enabled) {
        artifactServer = await startArtifactCaptureServer({
          identity,
          db,
          manager: runtimeArtifactManager,
          config: config.artifacts.service,
          captureCapability: config.artifacts.captureCapability,
          evidenceCapability: config.artifacts.evidenceCapability,
        });
        logger.info(`Artifact capture service enabled at ${artifactServer.url}`);
      }
    } catch (error) {
      logger.warn(
        `Artifact pipeline startup failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  if (config.signerProvider?.enabled) {
    try {
      signerProviderServer = await startSignerProviderServer({
        identity,
        config,
        db,
        address,
        privateKey,
        signerConfig: config.signerProvider,
      });
      logger.info(`Signer provider enabled at ${signerProviderServer.url}`);
    } catch (error) {
      logger.warn(
        `Signer provider failed to start: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  if (config.paymasterProvider?.enabled) {
    try {
      paymasterProviderServer = await startPaymasterProviderServer({
        identity,
        config,
        db,
        address,
        privateKey,
        paymasterConfig: config.paymasterProvider,
      });
      logger.info(`Paymaster provider enabled at ${paymasterProviderServer.url}`);
    } catch (error) {
      logger.warn(
        `Paymaster provider failed to start: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  if (config.agentDiscovery?.gatewayServer?.enabled) {
    try {
      if (
        config.agentDiscovery.gatewayServer.registerCapabilityOnStartup &&
        config.rpcUrl
      ) {
        try {
          await registerCapabilityName({
            rpcUrl: config.rpcUrl,
            privateKey,
            name: config.agentDiscovery.gatewayServer.capability,
            waitForReceipt: false,
          });
        } catch (error) {
          logger.warn(
            `Gateway capability registration skipped: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
      if (
        config.agentDiscovery.gatewayServer.grantCapabilityBit !== undefined &&
        config.rpcUrl
      ) {
        try {
          await grantCapability({
            rpcUrl: config.rpcUrl,
            privateKey,
            target: address,
            bit: config.agentDiscovery.gatewayServer.grantCapabilityBit,
            waitForReceipt: false,
          });
        } catch (error) {
          logger.warn(
            `Gateway capability grant skipped: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
      gatewayServer = await startAgentGatewayServer({
        identity,
        config,
        db,
        gatewayConfig: config.agentDiscovery.gatewayServer,
      });
      logger.info(`Agent Gateway relay enabled at ${gatewayServer.sessionUrl}`);
    } catch (error) {
      logger.warn(
        `Agent Gateway server failed to start: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  const basePublishedAgentDiscoveryConfig =
    normalizeAgentDiscoveryConfig(config.agentDiscovery) ??
    (config.agentDiscovery?.enabled &&
    config.agentDiscovery.publishCard &&
    config.agentDiscovery.gatewayServer?.enabled
      ? {
          ...config.agentDiscovery,
          endpoints: [],
          capabilities: [],
          faucetServer: config.agentDiscovery.faucetServer
            ? { ...config.agentDiscovery.faucetServer, enabled: false }
            : undefined,
          observationServer: config.agentDiscovery.observationServer
            ? { ...config.agentDiscovery.observationServer, enabled: false }
            : undefined,
          oracleServer: config.agentDiscovery.oracleServer
            ? { ...config.agentDiscovery.oracleServer, enabled: false }
            : undefined,
          newsFetchServer: config.agentDiscovery.newsFetchServer
            ? { ...config.agentDiscovery.newsFetchServer, enabled: false }
            : undefined,
          proofVerifyServer: config.agentDiscovery.proofVerifyServer
            ? { ...config.agentDiscovery.proofVerifyServer, enabled: false }
            : undefined,
          storageServer: config.agentDiscovery.storageServer
            ? { ...config.agentDiscovery.storageServer, enabled: false }
            : undefined,
        }
      : null);

  const buildCurrentPublishedAgentDiscoveryConfig = () => {
    let current = basePublishedAgentDiscoveryConfig;
    if (liveGatewayProviderSessions.length && current) {
      const routes = buildGatewayProviderRoutes({
        config,
        faucetUrl: faucetServer?.url,
        observationUrl: observationServer?.url,
        oracleUrl: oracleServer?.url,
        newsFetchUrl: newsFetchServer?.url,
        proofVerifyUrl: proofVerifyServer?.url,
        signerUrl: signerProviderServer?.url,
        paymasterUrl: paymasterProviderServer?.url,
        storageUrl: storageServer?.url,
        discoveryStorageUrl: discoveryStorageServer?.url,
        artifactUrl: artifactServer?.url,
      });
      current = buildPublishedAgentDiscoveryConfig({
        baseConfig: current,
        gatewayServer,
        gatewayServerConfig: config.agentDiscovery?.gatewayServer,
        providerSessions: liveGatewayProviderSessions,
        providerRoutes: routes,
      });
    } else if (current && gatewayServer) {
      current = buildPublishedAgentDiscoveryConfig({
        baseConfig: current,
        gatewayServer,
        gatewayServerConfig: config.agentDiscovery?.gatewayServer,
      });
    }
    if (current && bountyServer && config.bounty?.enabled && config.bounty.role === "host") {
      const endpointUrl = bountyServer.url;
      current = {
        ...current,
        endpoints: [
          ...current.endpoints,
          {
            kind: "http",
            url: endpointUrl,
            role: "requester_invocation",
          },
        ],
        capabilities: [
          ...current.capabilities,
          {
            name: "bounty.list",
            mode: "sponsored",
            description: "List currently open task bounties",
          },
          {
            name: "bounty.get",
            mode: "sponsored",
            description: "Fetch a task bounty and its current status",
          },
          {
            name: "bounty.submit",
            mode: "sponsored",
            description: "Submit a solution to an open bounty",
          },
          {
            name: "bounty.result",
            mode: "sponsored",
            description: "Read the latest bounty result",
          },
          {
            name: "task.list",
            mode: "sponsored",
            description: "List currently open task marketplace items",
          },
          {
            name: "task.get",
            mode: "sponsored",
            description: "Fetch a task and its current status",
          },
          {
            name: "task.submit",
            mode: "sponsored",
            description: "Submit a solution to an open task",
          },
          {
            name: "task.result",
            mode: "sponsored",
            description: "Read the latest task result",
          },
          {
            name: "translation.submit",
            mode: "sponsored",
            description: "Submit an answer to an open translation task",
          },
          {
            name: "social.submit",
            mode: "sponsored",
            description: "Submit a proof to an open social task",
          },
          {
            name: "task.solve",
            mode: "sponsored",
            description: "Submit a solution to an open third-party problem-solving task",
          },
        ],
      };
    }
    if (
      current &&
      signerProviderServer &&
      config.signerProvider?.enabled &&
      config.signerProvider.publishToDiscovery
    ) {
      const signerPolicyHash = hashSignerPolicy({
        providerAddress: address,
        policy: config.signerProvider.policy,
      });
      const signerPolicy = {
        trust_tier: config.signerProvider.policy.trustTier,
        wallet_address:
          config.signerProvider.policy.walletAddress || address,
        policy_id: config.signerProvider.policy.policyId,
        policy_hash: signerPolicyHash,
        delegate_identity:
          config.signerProvider.policy.delegateIdentity || null,
        expires_at: config.signerProvider.policy.expiresAt || null,
      };
      current = {
        ...current,
        endpoints: [
          ...current.endpoints,
          {
            kind: "http",
            url: signerProviderServer.url,
            role: "requester_invocation",
          },
        ],
        capabilities: [
          ...current.capabilities,
          {
            name: `${config.signerProvider.capabilityPrefix}.quote`,
            mode: "sponsored",
            policy: signerPolicy,
            description: "Request one bounded signer-provider execution quote",
          },
          {
            name: `${config.signerProvider.capabilityPrefix}.submit`,
            mode: "paid",
            priceModel: "x402-exact",
            policy: signerPolicy,
            description: "Submit one bounded signer-provider execution request",
          },
          {
            name: `${config.signerProvider.capabilityPrefix}.status`,
            mode: "sponsored",
            policy: signerPolicy,
            description: "Fetch signer-provider execution status",
          },
          {
            name: `${config.signerProvider.capabilityPrefix}.receipt`,
            mode: "sponsored",
            policy: signerPolicy,
            description: "Fetch signer-provider execution receipt",
          },
        ],
      };
    }
    if (
      current &&
      paymasterProviderServer &&
      config.paymasterProvider?.enabled &&
      config.paymasterProvider.publishToDiscovery
    ) {
      const paymasterPolicyHash = hashPaymasterPolicy({
        providerAddress: address,
        policy: config.paymasterProvider.policy,
      });
      const paymasterPolicy = {
        trust_tier: config.paymasterProvider.policy.trustTier,
        sponsor_address:
          config.paymasterProvider.policy.sponsorAddress || address,
        policy_id: config.paymasterProvider.policy.policyId,
        policy_hash: paymasterPolicyHash,
        delegate_identity:
          config.paymasterProvider.policy.delegateIdentity || null,
        expires_at: config.paymasterProvider.policy.expiresAt || null,
      };
      current = {
        ...current,
        endpoints: [
          ...current.endpoints,
          {
            kind: "http",
            url: paymasterProviderServer.url,
            role: "requester_invocation",
          },
        ],
        capabilities: [
          ...current.capabilities,
          {
            name: `${config.paymasterProvider.capabilityPrefix}.quote`,
            mode: "sponsored",
            policy: paymasterPolicy,
            description: "Request one bounded paymaster-provider sponsorship quote",
          },
          {
            name: `${config.paymasterProvider.capabilityPrefix}.authorize`,
            mode: "paid",
            priceModel: "x402-exact",
            policy: paymasterPolicy,
            description: "Authorize one bounded sponsored execution through a paymaster-provider",
          },
          {
            name: `${config.paymasterProvider.capabilityPrefix}.status`,
            mode: "sponsored",
            policy: paymasterPolicy,
            description: "Fetch paymaster-provider authorization status",
          },
          {
            name: `${config.paymasterProvider.capabilityPrefix}.receipt`,
            mode: "sponsored",
            policy: paymasterPolicy,
            description: "Fetch paymaster-provider authorization receipt",
          },
        ],
      };
    }
    if (current && storageServer && config.storage?.enabled && config.storage.publishToDiscovery) {
      current = {
        ...current,
        endpoints: [
          ...current.endpoints,
          {
            kind: "http",
            url: storageServer.url,
            role: "requester_invocation",
          },
        ],
        capabilities: [
          ...current.capabilities,
          {
            name: `${config.storage.capabilityPrefix}.quote`,
            mode: "sponsored",
            description: "Quote immutable bundle storage leases",
          },
          {
            name: `${config.storage.capabilityPrefix}.put`,
            mode: "paid",
            priceModel: "x402-exact",
            description: "Store an immutable bundle by CID and receive a signed lease receipt",
          },
          {
            name: `${config.storage.capabilityPrefix}.head`,
            mode: "sponsored",
            description: "Read metadata for a stored bundle lease",
          },
          {
            name: `${config.storage.capabilityPrefix}.get`,
            mode: config.storage.allowAnonymousGet ? "sponsored" : "paid",
            priceModel: config.storage.allowAnonymousGet ? undefined : "x402-exact",
            description: "Retrieve a stored bundle by CID",
          },
          {
            name: `${config.storage.capabilityPrefix}.audit`,
            mode: "sponsored",
            description: "Audit whether a provider still holds a leased bundle",
          },
        ],
      };
    }
    if (current && artifactServer && config.artifacts?.enabled && config.artifacts.publishToDiscovery) {
      current = {
        ...current,
        endpoints: [
          ...current.endpoints,
          {
            kind: "http",
            url: artifactServer.url,
            role: "requester_invocation",
          },
        ],
        capabilities: [
          ...current.capabilities,
          {
            name: config.artifacts.captureCapability,
            mode: "sponsored",
            description: "Capture public news into immutable artifact bundles",
          },
          {
            name: config.artifacts.evidenceCapability,
            mode: "sponsored",
            description: "Capture oracle evidence into immutable artifact bundles",
          },
          {
            name: config.artifacts.aggregateCapability,
            mode: "paid",
            priceModel: "x402-exact",
            description: "Build aggregate oracle artifact bundles from stored evidence",
          },
          {
            name: config.artifacts.verificationCapability,
            mode: "sponsored",
            description: "Verify stored artifact bundles and publish verification receipts",
          },
        ],
      };
    }
    return current;
  };

  const syncPublishedAgentDiscoveryCard = async (reason: string) => {
    if (!(config.agentDiscovery?.enabled && config.agentDiscovery.publishCard)) {
      return;
    }
    const publishedAgentDiscoveryConfig = buildCurrentPublishedAgentDiscoveryConfig();
    if (
      !publishedAgentDiscoveryConfig ||
      !publishedAgentDiscoveryConfig.endpoints.length ||
      !publishedAgentDiscoveryConfig.capabilities.length
    ) {
      await clearLocalAgentDiscoveryCard({
        config,
        db,
      });
      logger.info(`Cleared Agent Discovery card because ${reason}`);
      return;
    }
    const published = await publishLocalAgentDiscoveryCard({
      identity,
      config,
      address,
      db,
      agentDiscoveryOverride: publishedAgentDiscoveryConfig,
      overrideIsNormalized: true,
    });
    if (published) {
      logger.info(
        `Published Agent Discovery card seq=${published.card.card_seq} on ${published.info.nodeId || "local node"} (${reason})`,
      );
    }
  };

  if (config.agentDiscovery?.gatewayClient?.enabled) {
    try {
      const routes = buildGatewayProviderRoutes({
        config,
        faucetUrl: faucetServer?.url,
        observationUrl: observationServer?.url,
        oracleUrl: oracleServer?.url,
        newsFetchUrl: newsFetchServer?.url,
        proofVerifyUrl: proofVerifyServer?.url,
        signerUrl: signerProviderServer?.url,
        paymasterUrl: paymasterProviderServer?.url,
        storageUrl: storageServer?.url,
        discoveryStorageUrl: discoveryStorageServer?.url,
        artifactUrl: artifactServer?.url,
      });
      if (!routes.length) {
        logger.warn(
          "Agent Gateway client enabled but no local provider routes were available",
        );
      } else {
        gatewayProviderSessions = await startAgentGatewayProviderSessions({
          identity,
          config,
          address,
          routes,
          db,
          privateKey,
        });
        logger.info(
          `Agent Gateway provider sessions opened via ${gatewayProviderSessions.sessions
            .map((session) => session.gatewayUrl)
            .join(", ")}`,
        );
        liveGatewayProviderSessions = [...gatewayProviderSessions.sessions];
        for (const session of gatewayProviderSessions.sessions) {
          void session.closed.then(async () => {
            liveGatewayProviderSessions = liveGatewayProviderSessions.filter(
              (entry) => entry !== session,
            );
            try {
              await syncPublishedAgentDiscoveryCard(
                liveGatewayProviderSessions.length
                  ? "gateway session changed"
                  : "all gateway sessions closed",
              );
            } catch (error) {
              logger.warn(
                `Agent Discovery sync after gateway session close failed: ${error instanceof Error ? error.message : String(error)}`,
              );
            }
          });
        }
      }
    } catch (error) {
      logger.warn(
        `Agent Gateway provider session failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  if (config.agentDiscovery?.enabled && config.agentDiscovery.publishCard) {
    try {
      await syncPublishedAgentDiscoveryCard("startup");
    } catch (error) {
      logger.warn(
        `Agent Discovery publish skipped: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  // Register openfox identity (one-time, immutable)
  const registrationState = db.getIdentity("remoteRegistrationStatus");
  if (registrationState !== "registered" && config.runtimeApiUrl && apiKey) {
    try {
      const genesisPromptHash = config.genesisPrompt
        ? keccak256(toHex(config.genesisPrompt))
        : undefined;
        await runtime.registerOpenFox({
          openfoxId,
          openfoxAddress: address,
          creatorAddress: config.creatorAddress,
          name: config.name,
        bio: config.creatorMessage || "",
        genesisPromptHash,
        account,
      });
      db.setIdentity("remoteRegistrationStatus", "registered");
      logger.info(`[${new Date().toISOString()}] OpenFox identity registered.`);
    } catch (err: any) {
      const status = err?.status;
      if (status === 409) {
        db.setIdentity("remoteRegistrationStatus", "conflict");
        logger.warn(`[${new Date().toISOString()}] OpenFox identity conflict: ${err.message}`);
      } else {
        db.setIdentity("remoteRegistrationStatus", "failed");
        logger.warn(`[${new Date().toISOString()}] OpenFox identity registration failed: ${err.message}`);
      }
    }
  }

  try {
    skills = loadSkills(skillsDir, db);
    logger.info(`[${new Date().toISOString()}] Loaded ${skills.length} skills.`);
  } catch (err: any) {
    logger.warn(`[${new Date().toISOString()}] Skills loading failed: ${err.message}`);
  }

  if (config.bounty?.enabled && config.bounty.role === "host") {
    try {
      const bountyEngine = createBountyEngine({
        identity,
        db,
        inference,
        bountyConfig: config.bounty,
        skillInstructions:
          db.getSkillByName(resolveBountySkillName(config.bounty))
            ?.instructions,
        payoutSender: config.rpcUrl
          ? createNativeBountyPayoutSender({
              rpcUrl: config.rpcUrl,
              privateKey,
            })
          : undefined,
        artifactManager: runtimeArtifactManager,
        marketBindingPublisher,
        marketContractDispatcher: marketContracts,
        settlementPublisher: config.settlement?.publishBounties
          ? settlementPublisher
          : undefined,
        settlementCallbacks,
      });
      bountyServer = await startBountyHttpServer({
        bountyConfig: config.bounty,
        engine: bountyEngine,
      });
      bountyAutomation = startBountyAutomation({
        identity,
        config,
        db,
        inference,
        engine: bountyEngine,
        onEvent: (message) => logger.info(`[bounty] ${message}`),
      });
      logger.info(`Bounty host server enabled at ${bountyServer.url}`);
      if (config.agentDiscovery?.enabled && config.agentDiscovery.publishCard) {
        await syncPublishedAgentDiscoveryCard("bounty server startup");
      }
    } catch (error) {
      logger.warn(
        `Bounty host server failed to start: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  } else if (config.bounty?.enabled && config.bounty.role === "solver") {
    try {
      bountyAutomation = startBountyAutomation({
        identity,
        config,
        db,
        inference,
        onEvent: (message) => logger.info(`[bounty] ${message}`),
      });
      logger.info("Bounty solver automation enabled");
    } catch (error) {
      logger.warn(
        `Bounty solver automation failed to start: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  // Create social client
  let social: SocialClientInterface | undefined;
  if (config.socialRelayUrl) {
    social = createSocialClient(config.socialRelayUrl, account);
    logger.info(`[${new Date().toISOString()}] Social relay: ${config.socialRelayUrl}`);
  }

  // Initialize PolicyEngine + SpendTracker (Phase 1.4)
  const treasuryPolicy = config.treasuryPolicy ?? DEFAULT_TREASURY_POLICY;
  const rules = createDefaultRules(treasuryPolicy);
  const policyEngine = new PolicyEngine(db.raw, rules);
  const spendTracker = new SpendTracker(db.raw);

  // Load and sync heartbeat config
  const heartbeatConfigPath = resolvePath(config.heartbeatConfigPath);
  const heartbeatConfig = loadHeartbeatConfig(heartbeatConfigPath);
  syncHeartbeatToDb(heartbeatConfig, db);

  // Initialize state repo (git)
  try {
    await initStateRepo(runtime);
    logger.info(`[${new Date().toISOString()}] State repo initialized.`);
  } catch (err: any) {
    logger.warn(`[${new Date().toISOString()}] State repo init failed: ${err.message}`);
  }

  // Start heartbeat daemon (Phase 1.1: DurableScheduler)
  const heartbeat = createHeartbeatDaemon({
    identity,
    config,
    heartbeatConfig,
    db,
    rawDb: db.raw,
    runtime,
    social,
    onWakeRequest: (reason) => {
      logger.info(`[HEARTBEAT] Wake request: ${reason}`);
      // Phase 1.1: Use wake_events table instead of KV wake_request
      insertWakeEvent(db.raw, 'heartbeat', reason);
    },
  });

  heartbeat.start();
  logger.info(`[${new Date().toISOString()}] Heartbeat daemon started.`);

  if (config.operatorApi?.enabled) {
    try {
      operatorApiServer = await startOperatorApiServer({
        config,
        db,
      });
    } catch (error) {
      logger.warn(
        `Operator API failed to start: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  if (config.ownerReports?.enabled && config.ownerReports.web.enabled) {
    try {
      ownerReportServer = await startOwnerReportServer({
        config,
        db,
      });
      if (ownerReportServer) {
        logger.info(`Owner report server enabled at ${ownerReportServer.url}`);
      }
    } catch (error) {
      logger.warn(
        `Owner report server failed to start: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  // Handle graceful shutdown
  const shutdown = () => {
    logger.info(`[${new Date().toISOString()}] Shutting down...`);
    heartbeat.stop();
    db.setAgentState("sleeping");
    Promise.allSettled([
      bountyServer?.close(),
      bountyAutomation?.close(),
      signerProviderServer?.close(),
      paymasterProviderServer?.close(),
      storageServer?.close(),
      artifactServer?.close(),
      gatewayProviderSessions?.close(),
      gatewayServer?.close(),
      operatorApiServer?.close(),
      ownerReportServer?.close(),
      faucetServer?.close(),
      observationServer?.close(),
      oracleServer?.close(),
      newsFetchServer?.close(),
      proofVerifyServer?.close(),
      discoveryStorageServer?.close(),
    ]).finally(() => {
      db.close();
      process.exit(0);
    });
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);

  // ─── Main Run Loop ──────────────────────────────────────────
  // The openfox alternates between running and sleeping.
  // The heartbeat can wake it up.

  while (true) {
    try {
      // Reload skills (may have changed since last loop)
      try {
        skills = loadSkills(skillsDir, db);
      } catch (error) {
        logger.error("Skills reload failed", error instanceof Error ? error : undefined);
      }

      // Run the agent loop
      await runAgentLoop({
        identity,
        config,
        db,
        runtime,
        inference,
        social,
        skills,
        policyEngine,
        spendTracker,
        ollamaBaseUrl,
        onStateChange: (state: AgentState) => {
          logger.info(`[${new Date().toISOString()}] State: ${state}`);
        },
        onTurnComplete: (turn) => {
          logger.info(
            `[${new Date().toISOString()}] Turn ${turn.id}: ${turn.toolCalls.length} tools, ${turn.tokenUsage.totalTokens} tokens`,
          );
        },
      });

      // Agent loop exited (sleeping or dead)
      const state = db.getAgentState();

      if (state === "dead") {
        logger.info(`[${new Date().toISOString()}] OpenFox is dead. Heartbeat will continue.`);
        // In dead state, we just wait for funding
        // The heartbeat will keep checking and broadcasting distress
        await sleep(300_000); // Check every 5 minutes
        continue;
      }

      if (state === "sleeping") {
        const sleepUntilStr = db.getKV("sleep_until");
        const sleepUntil = sleepUntilStr
          ? new Date(sleepUntilStr).getTime()
          : Date.now() + 60_000;
        const sleepMs = Math.max(sleepUntil - Date.now(), 10_000);
        logger.info(
          `[${new Date().toISOString()}] Sleeping for ${Math.round(sleepMs / 1000)}s`,
        );

        // Sleep, but check for wake requests periodically
        const checkInterval = Math.min(sleepMs, 30_000);
        let slept = 0;
        while (slept < sleepMs) {
          await sleep(checkInterval);
          slept += checkInterval;

          // Phase 1.1: Check for wake events from wake_events table (atomic consume)
          const wakeEvent = consumeNextWakeEvent(db.raw);
          if (wakeEvent) {
            logger.info(
              `[${new Date().toISOString()}] Woken by ${wakeEvent.source}: ${wakeEvent.reason}`,
            );
            db.deleteKV("sleep_until");
            break;
          }
        }

        // Clear sleep state
        db.deleteKV("sleep_until");
        continue;
      }
    } catch (err: any) {
      logger.error(
        `[${new Date().toISOString()}] Fatal error in run loop: ${err.message}`,
      );
      // Wait before retrying
      await sleep(30_000);
    }
  }
}

function hasConfiguredInference(config: {
  openaiApiKey?: string;
  anthropicApiKey?: string;
  ollamaBaseUrl?: string;
  runtimeApiKey?: string;
  runtimeApiUrl?: string;
  inferenceModelRef?: string;
  modelStrategy?: { inferenceModel?: string };
}): boolean {
  // claude-code provider uses the locally installed CLI (no API key needed)
  const modelRef = config.inferenceModelRef || config.modelStrategy?.inferenceModel || "";
  if (modelRef.startsWith("claude-code/")) return true;

  return Boolean(
    config.openaiApiKey ||
    config.anthropicApiKey ||
    config.ollamaBaseUrl ||
    (config.runtimeApiKey && config.runtimeApiUrl),
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Entry Point ───────────────────────────────────────────────

main().catch((err) => {
  logger.error(`Fatal: ${err.message}`);
  process.exit(1);
});
