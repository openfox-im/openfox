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
import { createBountyEngine } from "./bounty/engine.js";
import { startBountyHttpServer } from "./bounty/http.js";
import { createNativeBountyPayoutSender } from "./bounty/payout.js";
import { startBountyAutomation } from "./bounty/automation.js";
import {
  fetchRemoteBounties,
  fetchRemoteBounty,
  solveRemoteQuestionBounty,
  submitRemoteBountyAnswer,
} from "./bounty/client.js";

const logger = createLogger("main");
const VERSION = "0.2.1";

function resolveBountySkillName(config: {
  role: "host" | "solver";
  skill: string;
}): string {
  if (config.role === "solver") {
    return config.skill === "question-bounty-host"
      ? "question-bounty-solver"
      : config.skill || "question-bounty-solver";
  }
  return config.skill || "question-bounty-host";
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

  if (args[0] === "logs") {
    await handleLogsCommand(args.slice(1));
    process.exit(0);
  }

  if (args[0] === "bounty") {
    await handleBountyCommand(args.slice(1));
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
  openfox logs           Show recent OpenFox service logs
  openfox bounty ...     Open, inspect, and solve question bounties
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

async function handleOnboardCommand(args: string[]): Promise<void> {
  if (args.includes("--help") || args.includes("-h") || args.includes("help")) {
    logger.info(`
OpenFox onboard

Usage:
  openfox onboard
  openfox onboard --install-daemon
  openfox onboard --force-setup
`);
    return;
  }

  const result = await runOnboard({
    installDaemon: args.includes("--install-daemon"),
    forceSetup: args.includes("--force-setup"),
  });

  logger.info(
    result.daemonInstalled
      ? "OpenFox onboarding complete. Managed service installed."
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
  openfox bounty open --question "<text>" --answer "<canonical>" [--reward-wei <wei>] [--ttl-seconds <n>]
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
      const question = readOption(args, "--question");
      const answer = readOption(args, "--answer");
      if (!question || !answer) {
        throw new Error(
          'Usage: openfox bounty open --question "<text>" --answer "<canonical>" [--reward-wei <wei>] [--ttl-seconds <n>]',
        );
      }
      const ttlSeconds = readNumberOption(
        args,
        "--ttl-seconds",
        config.bounty.defaultSubmissionTtlSeconds,
      );
      const bounty = engine.openQuestionBounty({
        question,
        referenceAnswer: answer,
        rewardWei: readOption(args, "--reward-wei") || config.bounty.rewardWei,
        submissionDeadline: new Date(Date.now() + ttlSeconds * 1000).toISOString(),
      });
      logger.info(JSON.stringify(bounty, null, 2));
      return;
    }

    if (command === "submit") {
      const bountyId = args[1];
      const answer = readOption(args, "--answer");
      if (!bountyId || !answer) {
        throw new Error(
          'Usage: openfox bounty submit <bounty-id> --answer "<text>" [--url <base-url>]',
        );
      }
      if (remoteBaseUrl) {
        logger.info(
          JSON.stringify(
            await submitRemoteBountyAnswer({
              baseUrl: remoteBaseUrl,
              bountyId,
              solverAddress: config.walletAddress,
              answer,
              solverAgentId: config.agentId || null,
            }),
            null,
            2,
          ),
        );
        return;
      }
      logger.info(
        JSON.stringify(
          await engine.submitAnswer({
            bountyId,
            answer,
            solverAddress: config.walletAddress,
            solverAgentId: config.agentId || null,
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
            await solveRemoteQuestionBounty({
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
Bounty:     ${config.bounty?.enabled ? `${config.bounty.role} @ ${config.bounty.bindHost}:${config.bounty.port}${config.bounty.pathPrefix}` : "disabled"}
Bounty auto: ${config.bounty?.enabled ? `open=${config.bounty.autoOpenOnStartup || config.bounty.autoOpenWhenIdle ? "on" : "off"} solve=${config.bounty.autoSolveOnStartup || config.bounty.autoSolveEnabled ? "on" : "off"}` : "disabled"}
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

  let faucetServer:
    | Awaited<ReturnType<typeof startAgentDiscoveryFaucetServer>>
    | undefined;
  let observationServer:
    | Awaited<ReturnType<typeof startAgentDiscoveryObservationServer>>
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
      });
      logger.info(`Agent Discovery observation provider enabled at ${observationServer.url}`);
    } catch (error) {
      logger.warn(
        `Agent Discovery observation server failed to start: ${error instanceof Error ? error.message : String(error)}`,
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
        }
      : null);

  const buildCurrentPublishedAgentDiscoveryConfig = () => {
    let current = basePublishedAgentDiscoveryConfig;
    if (liveGatewayProviderSessions.length && current) {
      const routes = buildGatewayProviderRoutes({
        config,
        faucetUrl: faucetServer?.url,
        observationUrl: observationServer?.url,
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
            description: "List currently open question bounties",
          },
          {
            name: "bounty.get",
            mode: "sponsored",
            description: "Fetch a bounty and its current status",
          },
          {
            name: "bounty.submit",
            mode: "sponsored",
            description: "Submit an answer to an open bounty",
          },
          {
            name: "bounty.result",
            mode: "sponsored",
            description: "Read the latest bounty result",
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

  // Resolve Ollama base URL: env var takes precedence over config
  const ollamaBaseUrl = process.env.OLLAMA_BASE_URL || config.ollamaBaseUrl;

  // Create inference client — pass a live registry lookup so model names like
  // "gpt-oss:120b" route to Ollama based on their registered provider, not heuristics.
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
