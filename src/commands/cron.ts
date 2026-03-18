import { createLogger } from "../observability/logger.js";
import {
  withHeartbeatContext,
  runHeartbeatTaskNow,
} from "../runtime/heartbeat-context.js";
import {
  addCronTask,
  buildCronListSnapshot,
  buildCronRunsSnapshot,
  buildCronTaskSnapshot,
  buildCronListReport,
  buildCronRunsReport,
  buildCronTaskReport,
  editCronTask,
  removeCronTask,
  setCronTaskEnabled,
} from "../heartbeat/operator.js";

const logger = createLogger("main");

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

export async function handleCronCommand(args: string[]): Promise<void> {
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
