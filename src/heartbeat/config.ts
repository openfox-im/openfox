/**
 * Heartbeat Configuration
 *
 * Parses and manages heartbeat.yml configuration.
 */

import fs from "fs";
import path from "path";
import YAML from "yaml";
import type { HeartbeatEntry, HeartbeatConfig, OpenFoxDatabase } from "../types.js";
import { getOpenFoxDir } from "../identity/wallet.js";
import { createLogger } from "../observability/logger.js";
import type BetterSqlite3 from "better-sqlite3";
import {
  deleteHeartbeatTask,
  getHeartbeatSchedule,
  getHeartbeatTask,
  upsertHeartbeatSchedule,
} from "../state/database.js";

const logger = createLogger("heartbeat.config");
type DatabaseType = BetterSqlite3.Database;

const DEFAULT_HEARTBEAT_CONFIG: HeartbeatConfig = {
  entries: [
    {
      name: "heartbeat_ping",
      schedule: "*/15 * * * *",
      task: "heartbeat_ping",
      enabled: true,
    },
    {
      name: "check_credits",
      schedule: "0 */6 * * *",
      task: "check_credits",
      enabled: true,
    },
    {
      name: "check_wallet_balance",
      schedule: "30 */6 * * *",
      task: "check_wallet_balance",
      enabled: true,
    },
    {
      name: "check_for_updates",
      schedule: "0 */4 * * *",
      task: "check_for_updates",
      enabled: true,
    },
    {
      name: "health_check",
      schedule: "*/30 * * * *",
      task: "health_check",
      enabled: true,
    },
    {
      name: "check_social_inbox",
      schedule: "*/2 * * * *",
      task: "check_social_inbox",
      enabled: true,
    },
    {
      name: "retry_settlement_callbacks",
      schedule: "*/2 * * * *",
      task: "retry_settlement_callbacks",
      enabled: true,
    },
    {
      name: "retry_market_contract_callbacks",
      schedule: "*/2 * * * *",
      task: "retry_market_contract_callbacks",
      enabled: true,
    },
    {
      name: "retry_x402_payments",
      schedule: "*/2 * * * *",
      task: "retry_x402_payments",
      enabled: true,
    },
    {
      name: "operator_autopilot",
      schedule: "*/10 * * * *",
      task: "operator_autopilot",
      enabled: true,
    },
    {
      name: "audit_storage_leases",
      schedule: "0 */6 * * *",
      task: "audit_storage_leases",
      enabled: true,
    },
    {
      name: "renew_storage_leases",
      schedule: "*/30 * * * *",
      task: "renew_storage_leases",
      enabled: true,
    },
    {
      name: "replicate_storage_leases",
      schedule: "15 */2 * * *",
      task: "replicate_storage_leases",
      enabled: true,
    },
    {
      name: "generate_owner_reports",
      schedule: "5 * * * *",
      task: "generate_owner_reports",
      enabled: true,
    },
    {
      name: "deliver_owner_reports",
      schedule: "10 * * * *",
      task: "deliver_owner_reports",
      enabled: true,
    },
  ],
  defaultIntervalMs: 60_000,
  lowComputeMultiplier: 4,
};

/**
 * Load heartbeat config from YAML file, falling back to defaults.
 */
export function loadHeartbeatConfig(configPath?: string): HeartbeatConfig {
  const filePath =
    configPath || path.join(getOpenFoxDir(), "heartbeat.yml");

  if (!fs.existsSync(filePath)) {
    return DEFAULT_HEARTBEAT_CONFIG;
  }

  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    const parsed = YAML.parse(raw) || {};

    const parsedEntries = (parsed.entries || []).map((e: any) => ({
      name: e.name,
      schedule: e.schedule,
      task: e.task,
      enabled: e.enabled !== false,
      params: e.params,
    })) as HeartbeatEntry[];

    const entries = mergeWithDefaults(parsedEntries);

    return {
      entries,
      defaultIntervalMs:
        parsed.defaultIntervalMs ?? DEFAULT_HEARTBEAT_CONFIG.defaultIntervalMs,
      lowComputeMultiplier:
        parsed.lowComputeMultiplier ??
        DEFAULT_HEARTBEAT_CONFIG.lowComputeMultiplier,
    };
  } catch (error: any) {
    logger.error("Failed to parse YAML config", error instanceof Error ? error : undefined);
    // Continue with defaults, but log the error
    return DEFAULT_HEARTBEAT_CONFIG;
  }
}

/**
 * Save heartbeat config to YAML file.
 */
export function saveHeartbeatConfig(
  config: HeartbeatConfig,
  configPath?: string,
): void {
  const filePath =
    configPath || path.join(getOpenFoxDir(), "heartbeat.yml");
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }

  fs.writeFileSync(filePath, YAML.stringify(config), { mode: 0o600 });
}

/**
 * Write the default heartbeat.yml file.
 */
export function writeDefaultHeartbeatConfig(configPath?: string): void {
  saveHeartbeatConfig(DEFAULT_HEARTBEAT_CONFIG, configPath);
}

/**
 * Sync heartbeat entries from YAML config into the database.
 */
export function syncHeartbeatToDb(
  config: HeartbeatConfig,
  db: OpenFoxDatabase,
): void {
  const expectedNames = new Set<string>();

  for (const entry of config.entries) {
    expectedNames.add(entry.name);
    db.upsertHeartbeatEntry(entry);
  }

  for (const existing of db.getHeartbeatEntries()) {
    if (!expectedNames.has(existing.name)) {
      db.deleteHeartbeatEntry(existing.name);
    }
  }
}

export function upsertHeartbeatConfigEntry(
  entry: HeartbeatEntry,
  configPath?: string,
): HeartbeatConfig {
  const config = loadHeartbeatConfig(configPath);
  const nextEntry: HeartbeatEntry = {
    name: entry.name.trim(),
    schedule: entry.schedule.trim(),
    task: (entry.task || entry.name).trim(),
    enabled: entry.enabled !== false,
    params: entry.params,
  };

  const existingIndex = config.entries.findIndex((current) => current.name === nextEntry.name);
  if (existingIndex >= 0) {
    config.entries[existingIndex] = {
      ...config.entries[existingIndex],
      ...nextEntry,
    };
  } else {
    config.entries.push(nextEntry);
  }

  saveHeartbeatConfig(config, configPath);
  return config;
}

export function removeHeartbeatConfigEntry(
  name: string,
  configPath?: string,
): HeartbeatConfig {
  const config = loadHeartbeatConfig(configPath);
  config.entries = config.entries.filter((entry) => entry.name !== name);
  saveHeartbeatConfig(config, configPath);
  return config;
}

export function setHeartbeatConfigEntryEnabled(
  name: string,
  enabled: boolean,
  configPath?: string,
): HeartbeatConfig {
  const config = loadHeartbeatConfig(configPath);
  config.entries = config.entries.map((entry) =>
    entry.name === name ? { ...entry, enabled } : entry,
  );
  saveHeartbeatConfig(config, configPath);
  return config;
}

export function syncHeartbeatScheduleToDb(
  config: HeartbeatConfig,
  db: DatabaseType,
): void {
  const desiredTasks = new Set<string>();

  for (const entry of config.entries) {
    const taskName = (entry.task || entry.name).trim();
    if (!taskName) continue;

    desiredTasks.add(taskName);
    const existing = getHeartbeatTask(db, taskName);
    upsertHeartbeatSchedule(db, {
      taskName,
      cronExpression: entry.schedule,
      intervalMs: existing?.intervalMs ?? null,
      enabled: entry.enabled ? 1 : 0,
      priority: existing?.priority ?? 0,
      timeoutMs: existing?.timeoutMs ?? 30_000,
      maxRetries: existing?.maxRetries ?? 1,
      tierMinimum: existing?.tierMinimum ?? "dead",
      lastRunAt: existing?.lastRunAt ?? entry.lastRun ?? null,
      nextRunAt: existing?.nextRunAt ?? entry.nextRun ?? null,
      lastResult: existing?.lastResult ?? null,
      lastError: existing?.lastError ?? null,
      runCount: existing?.runCount ?? 0,
      failCount: existing?.failCount ?? 0,
      leaseOwner: existing?.leaseOwner ?? null,
      leaseExpiresAt: existing?.leaseExpiresAt ?? null,
    });
  }

  for (const existing of getHeartbeatSchedule(db)) {
    if (!desiredTasks.has(existing.taskName)) {
      deleteHeartbeatTask(db, existing.taskName);
    }
  }
}

function mergeWithDefaults(entries: HeartbeatEntry[]): HeartbeatEntry[] {
  const defaults = DEFAULT_HEARTBEAT_CONFIG.entries.map((entry) => ({ ...entry }));
  const defaultsByName = new Map(defaults.map((entry) => [entry.name, entry]));
  const mergedByName = new Map(defaultsByName);

  for (const entry of entries) {
    if (!entry?.name) continue;
    const fallback = defaultsByName.get(entry.name);
    mergedByName.set(entry.name, {
      ...(fallback || {}),
      ...entry,
      enabled: entry.enabled !== false,
      task: entry.task || fallback?.task || "",
      schedule: entry.schedule || fallback?.schedule || "",
    });
  }

  const orderedDefaultEntries = defaults.map(
    (defaultEntry) => mergedByName.get(defaultEntry.name) || defaultEntry,
  );
  const knownNames = new Set(defaults.map((entry) => entry.name));
  const customEntries = [...mergedByName.values()].filter(
    (entry) => !knownNames.has(entry.name),
  );

  return [...orderedDefaultEntries, ...customEntries];
}
