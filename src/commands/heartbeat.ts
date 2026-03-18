import { createLogger } from "../observability/logger.js";
import {
  withHeartbeatContext,
} from "../runtime/heartbeat-context.js";
import {
  buildCronRunsSnapshot,
  buildCronRunsReport,
  buildHeartbeatStatusSnapshot,
  buildHeartbeatStatusReport,
  disableHeartbeat,
  enableHeartbeat,
  getBuiltinHeartbeatTasks,
  queueManualWake,
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

export async function handleHeartbeatCommand(args: string[]): Promise<void> {
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
