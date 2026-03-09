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
  getUnconsumedWakeEvents,
  insertWakeEvent,
  isHeartbeatPaused,
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
import type { OpenFoxIdentity, AgentState, Skill, SocialClientInterface } from "./types.js";
import { DEFAULT_TREASURY_POLICY } from "./types.js";
import { createLogger, setGlobalLogLevel } from "./observability/logger.js";
import {
  clearLocalAgentDiscoveryCard,
  publishLocalAgentDiscoveryCard,
} from "./agent-discovery/client.js";
import { startAgentDiscoveryFaucetServer } from "./agent-discovery/faucet-server.js";
import { startAgentDiscoveryObservationServer } from "./agent-discovery/observation-server.js";
import { startAgentDiscoveryOracleServer } from "./agent-discovery/oracle-server.js";
import { normalizeAgentDiscoveryConfig } from "./agent-discovery/types.js";
import { startAgentGatewayServer } from "./agent-gateway/server.js";
import { startAgentGatewayProviderSessions } from "./agent-gateway/client.js";
import {
  buildGatewayProviderRoutes,
  buildPublishedAgentDiscoveryConfig,
} from "./agent-gateway/publish.js";
import { deriveTOSAddressFromPrivateKey as deriveAddressFromPrivateKey } from "./tos/address.js";
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
import { createBountyEngine } from "./bounty/engine.js";
import { startBountyHttpServer } from "./bounty/http.js";
import { createNativeBountyPayoutSender } from "./bounty/payout.js";
import { startBountyAutomation } from "./bounty/automation.js";
import {
  fetchRemoteBounties,
  fetchRemoteBounty,
  solveRemoteBounty,
  submitRemoteBountySubmission,
} from "./bounty/client.js";
import { buildOpportunityReport, collectOpportunityItems } from "./opportunity/scout.js";
import { createNativeSettlementPublisher } from "./settlement/publisher.js";
import { createNativeSettlementCallbackDispatcher } from "./settlement/callbacks.js";
import { createMarketBindingPublisher } from "./market/publisher.js";
import { createMarketContractDispatcher } from "./market/contracts.js";
import { createX402PaymentManager } from "./tos/x402-server.js";

const logger = createLogger("main");
const VERSION = "0.2.1";

function resolveBountySkillName(config: {
  role: "host" | "solver";
  defaultKind: "question" | "translation" | "social_proof" | "problem_solving";
  skill: string;
}): string {
  const defaultHostSkill =
    config.defaultKind === "translation"
      ? "translation-bounty-host"
      : config.defaultKind === "social_proof"
        ? "social-bounty-host"
        : config.defaultKind === "problem_solving"
          ? "problem-bounty-host"
          : "question-bounty-host";
  const defaultSolverSkill =
    config.defaultKind === "translation"
      ? "translation-bounty-solver"
      : config.defaultKind === "social_proof"
        ? "social-bounty-solver"
        : config.defaultKind === "problem_solving"
          ? "problem-bounty-solver"
          : "question-bounty-solver";
  if (config.role === "solver") {
    return config.skill === "question-bounty-host"
      ? defaultSolverSkill
      : config.skill || defaultSolverSkill;
  }
  return config.skill || defaultHostSkill;
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

  if (args[0] === "logs") {
    await handleLogsCommand(args.slice(1));
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
  openfox logs           Show recent OpenFox service logs
  openfox bounty ...     Open, inspect, and solve task bounties
  openfox settlement ... Inspect on-chain settlement receipts and anchors
  openfox market ...     Inspect contract-native market bindings and callbacks
  openfox payments ...   Inspect and recover server-side x402 payments
  openfox scout ...      Discover earning opportunities and task surfaces
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

async function handleBountyCommand(args: string[]): Promise<void> {
  const command = args[0] || "list";
  if (args.includes("--help") || args.includes("-h") || command === "help") {
    logger.info(`
OpenFox bounty

Usage:
  openfox bounty list [--url <base-url>]
  openfox bounty status <bounty-id> [--url <base-url>]
  openfox bounty open --kind <question|translation|social_proof|problem_solving> --title "<text>" --task "<prompt>" --reference "<canonical>" [--reward-wei <wei>] [--ttl-seconds <n>] [--skill <name>]
  openfox bounty open --question "<text>" --answer "<canonical>" [--reward-wei <wei>] [--ttl-seconds <n>]
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
          'Usage: openfox bounty open --kind <question|translation|social_proof|problem_solving> --title "<text>" --task "<prompt>" --reference "<canonical>" [--reward-wei <wei>] [--ttl-seconds <n>]',
        );
      }
      const ttlSeconds = readNumberOption(
        args,
        "--ttl-seconds",
        config.bounty.defaultSubmissionTtlSeconds,
      );
      const bounty = engine.openBounty({
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
`);
    return;
  }

  if (command !== "list") {
    throw new Error(`Unknown scout command: ${command}`);
  }

  const config = loadConfig();
  if (!config) {
    throw new Error("OpenFox is not configured. Run openfox --setup first.");
  }
  const db = createDatabase(resolvePath(config.dbPath));
  try {
    const items = await collectOpportunityItems({ config, db });
    if (asJson) {
      logger.info(JSON.stringify({ items }, null, 2));
      return;
    }
    logger.info(buildOpportunityReport(items));
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

  const state = db.getAgentState();
  const turnCount = db.getTurnCount();
  const tools = db.getInstalledTools();
  const heartbeats = db.getHeartbeatEntries();
  const heartbeatPaused = isHeartbeatPaused(db.raw);
  const pendingWakes = getUnconsumedWakeEvents(db.raw);
  const skills = db.getSkills(true);
  const children = db.getChildren();
  const settlements = db.listSettlementReceipts(5);
  const settlementCallbacks = db.listSettlementCallbacks(5);
  const pendingSettlementCallbacks = db.listSettlementCallbacks(100, {
    status: "pending",
  }).length;
  const marketBindings = db.listMarketBindings(5);
  const marketCallbacks = db.listMarketContractCallbacks(5);
  const pendingMarketCallbacks = db.listMarketContractCallbacks(100, {
    status: "pending",
  }).length;
  const x402Payments = db.listX402Payments(5);
  const pendingX402Payments =
    db.listX402Payments(100, { status: "verified" }).length +
    db.listX402Payments(100, { status: "submitted" }).length;
  const failedX402Payments = db.listX402Payments(100, {
    status: "failed",
  }).length;
  const discovery = config.agentDiscovery;
  const gatewaySummary = discovery?.gatewayClient?.enabled
    ? discovery.gatewayClient.gatewayUrl || "discovery/bootnodes"
    : discovery?.gatewayServer?.enabled
      ? discovery.gatewayServer.publicBaseUrl
      : "disabled";
  const managedService = getManagedServiceStatus();

  const snapshot = {
    configured: true,
    name: config.name,
    wallet: config.walletAddress,
    service: managedService,
    discovery: {
      enabled: discovery?.enabled === true,
      gateway: gatewaySummary,
      agentId: config.agentId || null,
    },
    creator: config.creatorAddress || null,
    sandboxId: config.sandboxId || null,
    bounty: config.bounty
      ? {
          enabled: config.bounty.enabled,
          role: config.bounty.role,
          defaultKind: config.bounty.defaultKind,
          skill: config.bounty.skill,
          bind: `${config.bounty.bindHost}:${config.bounty.port}`,
          pathPrefix: config.bounty.pathPrefix,
          remoteBaseUrl: config.bounty.remoteBaseUrl || null,
          discoveryCapability: config.bounty.discoveryCapability,
          pollIntervalSeconds: config.bounty.pollIntervalSeconds,
          autoOpenOnStartup: config.bounty.autoOpenOnStartup,
          autoOpenWhenIdle: config.bounty.autoOpenWhenIdle,
          autoSolveOnStartup: config.bounty.autoSolveOnStartup,
          autoSolveEnabled: config.bounty.autoSolveEnabled,
          policy: config.bounty.policy,
        }
      : null,
    x402Payments: config.x402Server
      ? {
          enabled: config.x402Server.enabled,
          confirmationPolicy: config.x402Server.confirmationPolicy,
          retryBatchSize: config.x402Server.retryBatchSize,
          retryAfterSeconds: config.x402Server.retryAfterSeconds,
          maxAttempts: config.x402Server.maxAttempts,
          pendingCount: pendingX402Payments,
          failedCount: failedX402Payments,
          recentPayments: x402Payments.map((item) => ({
            paymentId: item.paymentId,
            serviceKind: item.serviceKind,
            status: item.status,
            requestKey: item.requestKey,
            txHash: item.txHash,
            boundKind: item.boundKind,
            boundSubjectId: item.boundSubjectId,
          })),
        }
      : null,
    settlement: config.settlement
      ? {
          enabled: config.settlement.enabled,
          sinkAddress: config.settlement.sinkAddress || null,
          waitForReceipt: config.settlement.waitForReceipt,
          gas: config.settlement.gas,
          publishBounties: config.settlement.publishBounties,
          publishObservations: config.settlement.publishObservations,
          publishOracleResults: config.settlement.publishOracleResults,
          callbacks: {
            enabled: config.settlement.callbacks.enabled,
            retryBatchSize: config.settlement.callbacks.retryBatchSize,
            retryAfterSeconds: config.settlement.callbacks.retryAfterSeconds,
            pendingCount: pendingSettlementCallbacks,
            recentCallbacks: settlementCallbacks.map((item) => ({
              callbackId: item.callbackId,
              receiptId: item.receiptId,
              kind: item.kind,
              status: item.status,
              callbackTxHash: item.callbackTxHash,
            })),
          },
          receiptCount: settlements.length,
          recentReceipts: settlements.map((item) => ({
            receiptId: item.receiptId,
            kind: item.kind,
            subjectId: item.subjectId,
            receiptHash: item.receiptHash,
            settlementTxHash: item.settlementTxHash,
          })),
        }
      : null,
    marketContracts: config.marketContracts
      ? {
          enabled: config.marketContracts.enabled,
          retryBatchSize: config.marketContracts.retryBatchSize,
          retryAfterSeconds: config.marketContracts.retryAfterSeconds,
          pendingCount: pendingMarketCallbacks,
          recentBindings: marketBindings.map((item) => ({
            bindingId: item.bindingId,
            kind: item.kind,
            subjectId: item.subjectId,
            receiptHash: item.receiptHash,
            callbackTxHash: item.callbackTxHash,
          })),
          recentCallbacks: marketCallbacks.map((item) => ({
            callbackId: item.callbackId,
            bindingId: item.bindingId,
            kind: item.kind,
            status: item.status,
            callbackTxHash: item.callbackTxHash,
            packageName: item.packageName,
            functionSignature: item.functionSignature,
          })),
        }
      : null,
    opportunityScout: config.opportunityScout
      ? {
          enabled: config.opportunityScout.enabled,
          maxItems: config.opportunityScout.maxItems,
          discoveryCapabilities: config.opportunityScout.discoveryCapabilities,
          remoteBaseUrls: config.opportunityScout.remoteBaseUrls,
        }
      : null,
    state,
    turns: turnCount,
    toolsInstalled: tools.length,
    activeSkills: skills.length,
    activeHeartbeats: heartbeats.filter((h) => h.enabled).length,
    heartbeatPaused,
    pendingWakes: pendingWakes.length,
    children: {
      alive: children.filter((c) => c.status !== "dead").length,
      total: children.length,
    },
    model: config.inferenceModelRef || config.inferenceModel,
    version: config.version,
  };

  if (options.asJson) {
    logger.info(JSON.stringify(snapshot, null, 2));
    db.close();
    return;
  }

  logger.info(`
=== OPENFOX STATUS ===
Name:       ${config.name}
Wallet:     ${config.walletAddress}
Service:    ${managedService.installed ? managedService.active || "installed" : "not installed"}
Discovery:  ${discovery?.enabled ? "enabled" : "disabled"}
Gateway:    ${gatewaySummary}
Bounty:     ${config.bounty?.enabled ? `${config.bounty.role}/${config.bounty.defaultKind} @ ${config.bounty.bindHost}:${config.bounty.port}${config.bounty.pathPrefix}` : "disabled"}
Bounty auto: ${config.bounty?.enabled ? `open=${config.bounty.autoOpenOnStartup || config.bounty.autoOpenWhenIdle ? "on" : "off"} solve=${config.bounty.autoSolveOnStartup || config.bounty.autoSolveEnabled ? "on" : "off"}` : "disabled"}
x402:       ${config.x402Server?.enabled ? `enabled (${x402Payments.length} recent payment${x402Payments.length === 1 ? "" : "s"}, ${pendingX402Payments} pending, ${failedX402Payments} failed)` : "disabled"}
Settlement: ${config.settlement?.enabled ? `enabled (${settlements.length} recent receipt${settlements.length === 1 ? "" : "s"}, ${pendingSettlementCallbacks} pending callback${pendingSettlementCallbacks === 1 ? "" : "s"})` : "disabled"}
Market:     ${config.marketContracts?.enabled ? `enabled (${marketBindings.length} recent binding${marketBindings.length === 1 ? "" : "s"}, ${pendingMarketCallbacks} pending callback${pendingMarketCallbacks === 1 ? "" : "s"})` : "disabled"}
Scout:      ${config.opportunityScout?.enabled ? "enabled" : "disabled"}
Creator:    ${config.creatorAddress}
Sandbox:    ${config.sandboxId}
State:      ${state}
Turns:      ${turnCount}
Tools:      ${tools.length} installed
Skills:     ${skills.length} active
Heartbeats: ${heartbeats.filter((h) => h.enabled).length} active
Heartbeat paused: ${heartbeatPaused ? "yes" : "no"}
Pending wakes: ${pendingWakes.length}
Children:   ${children.filter((c) => c.status !== "dead").length} alive / ${children.length} total
Agent ID:   ${config.agentId || "not configured"}
Model:      ${config.inferenceModelRef || config.inferenceModel}
Version:    ${config.version}
========================
`);

  db.close();
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
  let bountyServer:
    | Awaited<ReturnType<typeof startBountyHttpServer>>
    | undefined;
  let bountyAutomation:
    | Awaited<ReturnType<typeof startBountyAutomation>>
    | undefined;
  let gatewayServer:
    | Awaited<ReturnType<typeof startAgentGatewayServer>>
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

  // Handle graceful shutdown
  const shutdown = () => {
    logger.info(`[${new Date().toISOString()}] Shutting down...`);
    heartbeat.stop();
    db.setAgentState("sleeping");
    Promise.allSettled([
      bountyServer?.close(),
      bountyAutomation?.close(),
      gatewayProviderSessions?.close(),
      gatewayServer?.close(),
      faucetServer?.close(),
      observationServer?.close(),
      oracleServer?.close(),
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
}): boolean {
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
