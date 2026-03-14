#!/usr/bin/env node
/**
 * OpenFox Runtime
 *
 * The entry point for the sovereign AI agent.
 * Handles CLI args, bootstrapping, and orchestrating
 * the heartbeat daemon + agent loop.
 */

import { getWallet, getOpenFoxDir } from "./identity/wallet.js";
import { provision } from "./identity/provision.js";
import { deriveAddressFromPrivateKey } from "./chain/address.js";
import { createLogger, StructuredLogger } from "./observability/logger.js";
import { prettySink } from "./observability/pretty-sink.js";
import { showStatus } from "./commands/status.js";
import { run } from "./runtime/run.js";

// Command handlers
import { handleSkillsCommand } from "./commands/skills.js";
import { handleHeartbeatCommand } from "./commands/heartbeat.js";
import { handleCronCommand } from "./commands/cron.js";
import { handleServiceCommand } from "./commands/service.js";
import { handleGatewayCommand } from "./commands/gateway.js";
import { handleHealthCommand, handleDoctorCommand, handleModelsCommand } from "./commands/health.js";
import { handleOnboardCommand } from "./commands/onboard.js";
import { runWalletCommand } from "./commands/wallet.js";
import { handleFinanceCommand } from "./commands/finance.js";
import { handleReportCommand } from "./commands/report.js";
import { handleTemplatesCommand } from "./commands/templates.js";
import { handlePacksCommand } from "./commands/packs.js";
import { handleLogsCommand } from "./commands/logs.js";
import { handleCampaignCommand } from "./commands/campaign.js";
import { handleBountyCommand } from "./commands/bounty.js";
import { handleSettlementCommand } from "./commands/settlement.js";
import { handleMarketCommand } from "./commands/market.js";
import { handlePaymentsCommand } from "./commands/payments.js";
import { handleScoutCommand } from "./commands/scout.js";
import { handleStrategyCommand } from "./commands/strategy.js";
import { handleStorageCommand } from "./commands/storage.js";
import { handleProvidersCommand } from "./commands/providers.js";
import { handleArtifactCommand } from "./commands/artifacts.js";
import { handleEvidenceCommand } from "./commands/evidence.js";
import { handleOracleCommand } from "./commands/oracle.js";
import { handleNewsCommand } from "./commands/news.js";
import { handleProofCommand } from "./commands/proof.js";
import { handleCommitteeCommand } from "./commands/committee.js";
import { handleTrailsCommand } from "./commands/trails.js";
import { handleGroupCommand } from "./commands/group.js";
import { handleWorldCommand } from "./commands/world.js";
import { handleSignerCommand } from "./commands/signer.js";
import { handlePaymasterCommand } from "./commands/paymaster.js";
import { handleFleetCommand } from "./commands/fleet.js";
import { handleAutopilotCommand } from "./commands/autopilot.js";
import { handleDashboardCommand } from "./commands/dashboard.js";

const logger = createLogger("main");
const VERSION = "0.2.1";

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  // ─── CLI Commands ────────────────────────────────────────────

  if (args.includes("--version") || args.includes("-v")) {
    logger.info(`OpenFox v${VERSION}`);
    process.exit(0);
  }

  if (args[0] === "skills") { await handleSkillsCommand(args.slice(1)); process.exit(0); }
  if (args[0] === "heartbeat") { await handleHeartbeatCommand(args.slice(1)); process.exit(0); }
  if (args[0] === "cron") { await handleCronCommand(args.slice(1)); process.exit(0); }
  if (args[0] === "service") { await handleServiceCommand(args.slice(1)); process.exit(0); }
  if (args[0] === "gateway") { await handleGatewayCommand(args.slice(1)); process.exit(0); }
  if (args[0] === "health") { await handleHealthCommand(args.slice(1)); process.exit(0); }
  if (args[0] === "doctor") { await handleDoctorCommand(args.slice(1)); process.exit(0); }
  if (args[0] === "models") { await handleModelsCommand(args.slice(1)); process.exit(0); }
  if (args[0] === "onboard") { await handleOnboardCommand(args.slice(1)); process.exit(0); }
  if (args[0] === "wallet") { await runWalletCommand(args.slice(1)); process.exit(0); }
  if (args[0] === "finance") { await handleFinanceCommand(args.slice(1)); process.exit(0); }
  if (args[0] === "report") { await handleReportCommand(args.slice(1)); process.exit(0); }
  if (args[0] === "templates") { await handleTemplatesCommand(args.slice(1)); process.exit(0); }
  if (args[0] === "packs") { await handlePacksCommand(args.slice(1)); process.exit(0); }
  if (args[0] === "logs") { await handleLogsCommand(args.slice(1)); process.exit(0); }
  if (args[0] === "campaign") { await handleCampaignCommand(args.slice(1)); process.exit(0); }
  if (args[0] === "bounty") { await handleBountyCommand(args.slice(1)); process.exit(0); }
  if (args[0] === "settlement") { await handleSettlementCommand(args.slice(1)); process.exit(0); }
  if (args[0] === "market") { await handleMarketCommand(args.slice(1)); process.exit(0); }
  if (args[0] === "payments") { await handlePaymentsCommand(args.slice(1)); process.exit(0); }
  if (args[0] === "scout") { await handleScoutCommand(args.slice(1)); process.exit(0); }
  if (args[0] === "strategy") { await handleStrategyCommand(args.slice(1)); process.exit(0); }
  if (args[0] === "storage") { await handleStorageCommand(args.slice(1)); process.exit(0); }
  if (args[0] === "providers") { await handleProvidersCommand(args.slice(1)); process.exit(0); }
  if (args[0] === "artifacts") { await handleArtifactCommand(args.slice(1)); process.exit(0); }
  if (args[0] === "evidence") { await handleEvidenceCommand(args.slice(1)); process.exit(0); }
  if (args[0] === "oracle") { await handleOracleCommand(args.slice(1)); process.exit(0); }
  if (args[0] === "news") { await handleNewsCommand(args.slice(1)); process.exit(0); }
  if (args[0] === "proof") { await handleProofCommand(args.slice(1)); process.exit(0); }
  if (args[0] === "committee") { await handleCommitteeCommand(args.slice(1)); process.exit(0); }
  if (args[0] === "trails") { await handleTrailsCommand(args.slice(1)); process.exit(0); }
  if (args[0] === "group") { await handleGroupCommand(args.slice(1)); process.exit(0); }
  if (args[0] === "world") { await handleWorldCommand(args.slice(1)); process.exit(0); }
  if (args[0] === "signer") { await handleSignerCommand(args.slice(1)); process.exit(0); }
  if (args[0] === "paymaster") { await handlePaymasterCommand(args.slice(1)); process.exit(0); }
  if (args[0] === "fleet") { await handleFleetCommand(args.slice(1)); process.exit(0); }
  if (args[0] === "autopilot") { await handleAutopilotCommand(args.slice(1)); process.exit(0); }
  if (args[0] === "dashboard") { await handleDashboardCommand(args.slice(1)); process.exit(0); }

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
  openfox group ...      Create and inspect local Fox communities
  openfox world ...      Inspect the local metaWorld activity feed
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
    StructuredLogger.setSink(prettySink);
    await run();
    return;
  }

  // Default: show help
  logger.info('Run "openfox --help" for usage information.');
  logger.info('Run "openfox --run" to start the openfox.');
}

// ─── Entry Point ───────────────────────────────────────────────

main().catch((err) => {
  logger.error(`Fatal: ${err.message}`);
  process.exit(1);
});
