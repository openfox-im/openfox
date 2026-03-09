import cronParser from "cron-parser";
import type BetterSqlite3 from "better-sqlite3";
import type { HeartbeatConfig, OpenFoxDatabase } from "../types.js";
import {
  deleteHeartbeatTask,
  getHeartbeatHistory,
  getHeartbeatSchedule,
  getHeartbeatTask,
  getRecentHeartbeatHistory,
  getRecentWakeEvents,
  getUnconsumedWakeEvents,
  insertWakeEvent,
  isHeartbeatPaused,
  setHeartbeatPaused,
} from "../state/database.js";
import {
  loadHeartbeatConfig,
  removeHeartbeatConfigEntry,
  setHeartbeatConfigEntryEnabled,
  syncHeartbeatScheduleToDb,
  syncHeartbeatToDb,
  upsertHeartbeatConfigEntry,
} from "./config.js";
import { BUILTIN_TASKS } from "./tasks.js";

type DatabaseType = BetterSqlite3.Database;

export interface HeartbeatRunSummary {
  taskName: string;
  result: string;
  startedAt: string | null;
  error?: string | null;
}

export interface WakeEventSummary {
  source: string;
  reason: string;
  createdAt: string | null;
  consumedAt: string | null;
}

export interface HeartbeatStatusSnapshot {
  enabled: boolean;
  configuredTasks: number;
  scheduledTasks: number;
  pendingWakes: number;
  lastRun: HeartbeatRunSummary | null;
  recentRuns: HeartbeatRunSummary[];
  recentWakeEvents: WakeEventSummary[];
}

export interface CronTaskSnapshot {
  taskName: string;
  enabled: boolean;
  cronExpression: string | null;
  intervalMs: number | null;
  priority: number;
  timeoutMs: number;
  maxRetries: number;
  tierMinimum: string;
  lastRunAt: string | null;
  nextRunAt: string | null;
  lastResult: string | null;
  runCount: number;
  failCount: number;
  recentRuns: HeartbeatRunSummary[];
}

const TASK_DESCRIPTIONS: Record<string, string> = {
  heartbeat_ping: "Persist local liveness state and emit distress when the runtime is unhealthy.",
  check_credits: "Track credit balance changes and wake the agent on survival-tier drops.",
  check_wallet_balance: "Check native wallet balance and wake when spendable funds become available.",
  retry_settlement_callbacks: "Retry or confirm pending settlement callback transactions for contract-bound results.",
  retry_market_contract_callbacks: "Retry or confirm pending contract-native market binding callbacks for task and query creation events.",
  retry_x402_payments: "Retry or confirm pending server-side x402 payments for paid provider requests.",
  check_social_inbox: "Poll the social inbox and wake the agent for new inbound messages.",
  check_for_updates: "Check for upstream/runtime updates.",
  health_check: "Run local health checks and wake on degraded status.",
  check_social_inbox_backlog: "Inspect backlog depth for social inbox processing.",
  report_metrics: "Persist runtime metrics snapshots.",
  colony_health_check: "Inspect child/colony runtime health.",
  colony_financial_report: "Build a financial summary for the current colony.",
  agent_pool_optimize: "Review the local agent pool and optimize idle workers.",
  knowledge_store_prune: "Prune stale knowledge entries.",
  dead_agent_cleanup: "Prune dead child agents and lifecycle leftovers.",
};

function formatIso(value: string | null | undefined): string {
  return value || "(never)";
}

function formatBool(value: boolean): string {
  return value ? "yes" : "no";
}

function ensureCronExpression(schedule: string): void {
  cronParser.parseExpression(schedule, { currentDate: new Date() });
}

export function getBuiltinHeartbeatTasks(): { name: string; description: string }[] {
  return Object.keys(BUILTIN_TASKS)
    .sort()
    .map((name) => ({
      name,
      description: TASK_DESCRIPTIONS[name] || "Built-in heartbeat task.",
    }));
}

export function isBuiltinHeartbeatTask(taskName: string): boolean {
  return Object.prototype.hasOwnProperty.call(BUILTIN_TASKS, taskName);
}

export function enableHeartbeat(rawDb: DatabaseType): void {
  setHeartbeatPaused(rawDb, false);
}

export function disableHeartbeat(rawDb: DatabaseType): void {
  setHeartbeatPaused(rawDb, true);
}

export function queueManualWake(
  rawDb: DatabaseType,
  reason: string,
  source = "manual",
): void {
  insertWakeEvent(rawDb, source, reason, { source, reason });
}

export function buildHeartbeatStatusReport(
  rawDb: DatabaseType,
  heartbeatConfig: HeartbeatConfig,
): string {
  const snapshot = buildHeartbeatStatusSnapshot(rawDb, heartbeatConfig);

  const lines = [
    "=== OPENFOX HEARTBEAT ===",
    `Enabled: ${formatBool(snapshot.enabled)}`,
    `Configured tasks: ${snapshot.configuredTasks}`,
    `Scheduled tasks: ${snapshot.scheduledTasks}`,
    `Pending wakes: ${snapshot.pendingWakes}`,
  ];

  if (snapshot.lastRun) {
    lines.push(
      `Last run: ${snapshot.lastRun.taskName} @ ${formatIso(snapshot.lastRun.startedAt)} (${snapshot.lastRun.result})`,
    );
  } else {
    lines.push("Last run: (none)");
  }

  lines.push("", "Recent runs:");
  if (snapshot.recentRuns.length === 0) {
    lines.push("  (none)");
  } else {
    for (const row of snapshot.recentRuns) {
      lines.push(
        `  - ${row.taskName}: ${row.result} @ ${formatIso(row.startedAt)}${row.error ? ` (${row.error})` : ""}`,
      );
    }
  }

  lines.push("", "Recent wake reasons:");
  if (snapshot.recentWakeEvents.length === 0) {
    lines.push("  (none)");
  } else {
    for (const row of snapshot.recentWakeEvents) {
      lines.push(
        `  - [${row.source}] ${row.reason} @ ${formatIso(row.createdAt)}${row.consumedAt ? " (consumed)" : " (pending)"}`,
      );
    }
  }

  lines.push("=========================");
  return lines.join("\n");
}

export function buildHeartbeatStatusSnapshot(
  rawDb: DatabaseType,
  heartbeatConfig: HeartbeatConfig,
): HeartbeatStatusSnapshot {
  const paused = isHeartbeatPaused(rawDb);
  const schedule = getHeartbeatSchedule(rawDb);
  const recentRuns = getRecentHeartbeatHistory(rawDb, 5);
  const pendingWakes = getUnconsumedWakeEvents(rawDb);
  const recentWakeEvents = getRecentWakeEvents(rawDb, 5);

  return {
    enabled: !paused,
    configuredTasks: heartbeatConfig.entries.length,
    scheduledTasks: schedule.length,
    pendingWakes: pendingWakes.length,
    lastRun: recentRuns[0]
      ? {
          taskName: recentRuns[0].taskName,
          result: recentRuns[0].result,
          startedAt: recentRuns[0].startedAt,
          error: recentRuns[0].error,
        }
      : null,
    recentRuns: recentRuns.map((row) => ({
      taskName: row.taskName,
      result: row.result,
      startedAt: row.startedAt,
      error: row.error,
    })),
    recentWakeEvents: recentWakeEvents.map((row) => ({
      source: row.source,
      reason: row.reason,
      createdAt: row.createdAt,
      consumedAt: row.consumedAt,
    })),
  };
}

export function buildCronListReport(rawDb: DatabaseType): string {
  const schedule = buildCronListSnapshot(rawDb);
  const lines = ["=== OPENFOX CRON ==="];

  if (schedule.length === 0) {
    lines.push("(no scheduled tasks)", "====================");
    return lines.join("\n");
  }

  for (const row of schedule) {
    lines.push(
      `${row.taskName}  [${row.enabled ? "enabled" : "disabled"}]  cron=${row.cronExpression || "(none)"}  last=${formatIso(row.lastRunAt)}  next=${formatIso(row.nextRunAt)}`,
    );
  }
  lines.push("====================");
  return lines.join("\n");
}

export function buildCronListSnapshot(rawDb: DatabaseType): CronTaskSnapshot[] {
  const schedule = getHeartbeatSchedule(rawDb);
  return schedule.map((row) => ({
    taskName: row.taskName,
    enabled: row.enabled === 1,
    cronExpression: row.cronExpression,
    intervalMs: row.intervalMs,
    priority: row.priority,
    timeoutMs: row.timeoutMs,
    maxRetries: row.maxRetries,
    tierMinimum: row.tierMinimum,
    lastRunAt:
      row.lastRunAt || getHeartbeatHistory(rawDb, row.taskName, 1)[0]?.startedAt || null,
    nextRunAt: row.nextRunAt,
    lastResult: row.lastResult,
    runCount: row.runCount,
    failCount: row.failCount,
    recentRuns: getHeartbeatHistory(rawDb, row.taskName, 5).map((run) => ({
      taskName: run.taskName,
      result: run.result,
      startedAt: run.startedAt,
      error: run.error,
    })),
  }));
}

export function buildCronTaskReport(rawDb: DatabaseType, taskName: string): string {
  const task = buildCronTaskSnapshot(rawDb, taskName);
  const runs = getHeartbeatHistory(rawDb, taskName, 10);
  const lines = [
    "=== OPENFOX CRON TASK ===",
    `Task: ${task.taskName}`,
    `Enabled: ${formatBool(task.enabled)}`,
    `Cron: ${task.cronExpression || "(none)"}`,
    `Interval ms: ${task.intervalMs ?? "(none)"}`,
    `Priority: ${task.priority}`,
    `Timeout ms: ${task.timeoutMs}`,
    `Max retries: ${task.maxRetries}`,
    `Tier minimum: ${task.tierMinimum}`,
    `Last run: ${formatIso(task.lastRunAt)}`,
    `Next run: ${formatIso(task.nextRunAt)}`,
    `Last result: ${task.lastResult || "(none)"}`,
    `Run count: ${task.runCount}`,
    `Fail count: ${task.failCount}`,
    "",
    "Recent runs:",
  ];

  if (runs.length === 0) {
    lines.push("  (none)");
  } else {
    for (const run of runs) {
      lines.push(
        `  - ${run.result} @ ${formatIso(run.startedAt)}${run.error ? ` (${run.error})` : ""}`,
      );
    }
  }

  lines.push("========================");
  return lines.join("\n");
}

export function buildCronTaskSnapshot(rawDb: DatabaseType, taskName: string): CronTaskSnapshot {
  const row = getHeartbeatTask(rawDb, taskName);
  if (!row) {
    throw new Error(`Scheduled task not found: ${taskName}`);
  }
  const runs = getHeartbeatHistory(rawDb, taskName, 10);
  return {
    taskName: row.taskName,
    enabled: row.enabled === 1,
    cronExpression: row.cronExpression,
    intervalMs: row.intervalMs,
    priority: row.priority,
    timeoutMs: row.timeoutMs,
    maxRetries: row.maxRetries,
    tierMinimum: row.tierMinimum,
    lastRunAt: row.lastRunAt || runs[0]?.startedAt || null,
    nextRunAt: row.nextRunAt,
    lastResult: row.lastResult,
    runCount: row.runCount,
    failCount: row.failCount,
    recentRuns: runs.map((run) => ({
      taskName: run.taskName,
      result: run.result,
      startedAt: run.startedAt,
      error: run.error,
    })),
  };
}

export function buildCronRunsReport(
  rawDb: DatabaseType,
  taskName: string | undefined,
  limit = 20,
): string {
  const runs = buildCronRunsSnapshot(rawDb, taskName, limit);
  const lines = ["=== OPENFOX CRON RUNS ==="];

  if (runs.length === 0) {
    lines.push("(none)", "========================");
    return lines.join("\n");
  }

  for (const run of runs) {
    lines.push(
      `${run.taskName}  ${run.result}  started=${formatIso(run.startedAt)}${run.error ? `  error=${run.error}` : ""}`,
    );
  }
  lines.push("========================");
  return lines.join("\n");
}

export function buildCronRunsSnapshot(
  rawDb: DatabaseType,
  taskName: string | undefined,
  limit = 20,
): HeartbeatRunSummary[] {
  const runs = taskName
    ? getHeartbeatHistory(rawDb, taskName, limit)
    : getRecentHeartbeatHistory(rawDb, limit);
  return runs.map((run) => ({
    taskName: run.taskName,
    result: run.result,
    startedAt: run.startedAt,
    error: run.error,
  }));
}

function syncConfigToStores(
  heartbeatConfigPath: string,
  db: OpenFoxDatabase,
  rawDb: DatabaseType,
): HeartbeatConfig {
  const config = loadHeartbeatConfig(heartbeatConfigPath);
  syncHeartbeatToDb(config, db);
  syncHeartbeatScheduleToDb(config, rawDb);
  return config;
}

export function addCronTask(params: {
  heartbeatConfigPath: string;
  db: OpenFoxDatabase;
  rawDb: DatabaseType;
  taskName: string;
  schedule: string;
  enabled?: boolean;
}): HeartbeatConfig {
  if (!isBuiltinHeartbeatTask(params.taskName)) {
    throw new Error(`Unknown built-in task: ${params.taskName}`);
  }
  ensureCronExpression(params.schedule);
  const current = loadHeartbeatConfig(params.heartbeatConfigPath);
  const exists = current.entries.some(
    (entry) => (entry.task || entry.name) === params.taskName || entry.name === params.taskName,
  );
  if (exists) {
    throw new Error(`Task already exists in heartbeat config: ${params.taskName}`);
  }
  upsertHeartbeatConfigEntry(
    {
      name: params.taskName,
      task: params.taskName,
      schedule: params.schedule,
      enabled: params.enabled !== false,
    },
    params.heartbeatConfigPath,
  );
  return syncConfigToStores(params.heartbeatConfigPath, params.db, params.rawDb);
}

export function editCronTask(params: {
  heartbeatConfigPath: string;
  db: OpenFoxDatabase;
  rawDb: DatabaseType;
  taskName: string;
  schedule?: string;
  enabled?: boolean;
}): HeartbeatConfig {
  if (!isBuiltinHeartbeatTask(params.taskName)) {
    throw new Error(`Unknown built-in task: ${params.taskName}`);
  }
  const current = loadHeartbeatConfig(params.heartbeatConfigPath);
  const existing = current.entries.find(
    (entry) => (entry.task || entry.name) === params.taskName || entry.name === params.taskName,
  );
  if (!existing) {
    throw new Error(`Task is not configured: ${params.taskName}`);
  }
  const nextSchedule = params.schedule || existing.schedule;
  ensureCronExpression(nextSchedule);
  upsertHeartbeatConfigEntry(
    {
      ...existing,
      name: existing.name || params.taskName,
      task: params.taskName,
      schedule: nextSchedule,
      enabled: params.enabled ?? existing.enabled,
    },
    params.heartbeatConfigPath,
  );
  return syncConfigToStores(params.heartbeatConfigPath, params.db, params.rawDb);
}

export function removeCronTask(params: {
  heartbeatConfigPath: string;
  db: OpenFoxDatabase;
  rawDb: DatabaseType;
  taskName: string;
}): HeartbeatConfig {
  removeHeartbeatConfigEntry(params.taskName, params.heartbeatConfigPath);
  params.db.deleteHeartbeatEntry(params.taskName);
  deleteHeartbeatTask(params.rawDb, params.taskName);
  return syncConfigToStores(params.heartbeatConfigPath, params.db, params.rawDb);
}

export function setCronTaskEnabled(params: {
  heartbeatConfigPath: string;
  db: OpenFoxDatabase;
  rawDb: DatabaseType;
  taskName: string;
  enabled: boolean;
}): HeartbeatConfig {
  const current = loadHeartbeatConfig(params.heartbeatConfigPath);
  const existing = current.entries.find(
    (entry) => (entry.task || entry.name) === params.taskName || entry.name === params.taskName,
  );
  if (!existing) {
    throw new Error(`Task is not configured: ${params.taskName}`);
  }
  setHeartbeatConfigEntryEnabled(existing.name, params.enabled, params.heartbeatConfigPath);
  return syncConfigToStores(params.heartbeatConfigPath, params.db, params.rawDb);
}
