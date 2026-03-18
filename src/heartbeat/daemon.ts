/**
 * Heartbeat Daemon
 *
 * Runs periodic tasks on cron schedules inside the same Node.js process.
 * The heartbeat runs even when the agent is sleeping.
 * It IS the openfox's pulse. When it stops, the openfox is dead.
 *
 * Phase 1.1: Replaced fragile setInterval with DurableScheduler.
 * - No setInterval remains; uses recursive setTimeout for overlap protection
 * - Tick frequency derived from config.defaultIntervalMs, not log level
 * - lowComputeMultiplier applied to non-essential tasks via scheduler
 */

import type {
  OpenFoxConfig,
  OpenFoxDatabase,
  RuntimeClient,
  OpenFoxIdentity,
  HeartbeatConfig,
  HeartbeatTaskFn,
  HeartbeatLegacyContext,
  SocialClientInterface,
} from "../types.js";
import { BUILTIN_TASKS } from "./tasks.js";
import { DurableScheduler } from "./scheduler.js";
import { syncHeartbeatScheduleToDb } from "./config.js";
import type BetterSqlite3 from "better-sqlite3";
import { createLogger } from "../observability/logger.js";

const logger = createLogger("heartbeat");

type DatabaseType = BetterSqlite3.Database;

export interface HeartbeatDaemonOptions {
  identity: OpenFoxIdentity;
  config: OpenFoxConfig;
  heartbeatConfig: HeartbeatConfig;
  db: OpenFoxDatabase;
  rawDb: DatabaseType;
  runtime: RuntimeClient;
  social?: SocialClientInterface;
  onWakeRequest?: (reason: string) => void;
}

export interface HeartbeatDaemon {
  start(): void;
  stop(): void;
  isRunning(): boolean;
  forceRun(taskName: string): Promise<void>;
}

/**
 * Create and return the heartbeat daemon.
 *
 * Uses DurableScheduler backed by the DB instead of setInterval.
 * Tick interval comes from heartbeatConfig.defaultIntervalMs.
 */
export function createHeartbeatDaemon(
  options: HeartbeatDaemonOptions,
): HeartbeatDaemon {
  const { identity, config, heartbeatConfig, db, rawDb, runtime, social, onWakeRequest } = options;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  let running = false;

  const legacyContext: HeartbeatLegacyContext = {
    identity,
    config,
    db,
    runtime,
    social,
  };

  // Build task map from BUILTIN_TASKS
  const taskMap = new Map<string, HeartbeatTaskFn>();
  for (const [name, fn] of Object.entries(BUILTIN_TASKS)) {
    taskMap.set(name, fn);
  }

  // Keep schedule definitions in sync with heartbeat.yml while preserving runtime state.
  syncHeartbeatScheduleToDb(heartbeatConfig, rawDb);

  const scheduler = new DurableScheduler(
    rawDb,
    heartbeatConfig,
    taskMap,
    legacyContext,
    onWakeRequest,
  );

  // Tick interval from config (not log level)
  const tickMs = heartbeatConfig.defaultIntervalMs ?? 60_000;

  /**
   * Recursive setTimeout loop for overlap protection.
   * Each tick must complete before the next is scheduled.
   */
  function scheduleTick(): void {
    if (!running) return;
    timeoutId = setTimeout(async () => {
      try {
        await scheduler.tick();
      } catch (err: any) {
        logger.error("Tick failed", err instanceof Error ? err : undefined);
      }
      scheduleTick();
    }, tickMs);
  }

  // ─── Public API ──────────────────────────────────────────────

  const start = (): void => {
    if (running) return;
    running = true;

    // Run first tick immediately
    scheduler.tick().catch((err) => {
      logger.error("First tick failed", err instanceof Error ? err : undefined);
    });

    // Schedule subsequent ticks
    scheduleTick();

    logger.info(`Daemon started. Tick interval: ${tickMs / 1000}s (from config)`);
  };

  const stop = (): void => {
    if (!running) return;
    running = false;
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
    logger.info("Daemon stopped.");
  };

  const isRunning = (): boolean => running;

  const forceRun = async (taskName: string): Promise<void> => {
    const context = await import("./tick-context.js").then((m) =>
      m.buildTickContext(rawDb, runtime, heartbeatConfig, identity.address),
    );
    await scheduler.executeTask(taskName, context);
  };

  return { start, stop, isRunning, forceRun };
}
