import { loadConfig, resolvePath } from "../config.js";
import { createDatabase } from "../state/database.js";
import { createLogger } from "../observability/logger.js";
import {
  getCurrentStrategyProfile,
  upsertStrategyProfile,
  validateStrategyProfile,
} from "../opportunity/strategy.js";

const logger = createLogger("main");

function readOption(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index === -1) return undefined;
  return args[index + 1]?.trim() || undefined;
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

export async function handleStrategyCommand(args: string[]): Promise<void> {
  const command = args[0] || "show";
  const asJson = args.includes("--json");
  if (args.includes("--help") || args.includes("-h") || command === "help") {
    logger.info(`
OpenFox strategy

Usage:
  openfox strategy show [--json]
  openfox strategy validate [--json]
  openfox strategy set [--name <text>] [--revenue-target-tomi <tomi>] [--max-spend-tomi <tomi>] [--min-margin-bps <n>] [--opportunity-kinds <csv>] [--provider-classes <csv>] [--trust-tiers <csv>] [--automation-level <manual|assisted|bounded_auto>] [--report-cadence <on_demand|daily|weekly>] [--max-deadline-hours <n>] [--json]
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
      revenueTargetTomi: readOption(args, "--revenue-target-tomi"),
      maxSpendPerOpportunityTomi: readOption(args, "--max-spend-tomi"),
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
