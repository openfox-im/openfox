import { loadConfig, resolvePath } from "../config.js";
import { createDatabase } from "../state/database.js";
import { createLogger } from "../observability/logger.js";
import {
  buildOracleSummary,
  buildOracleSummaryReport,
  getStoredOracleJob,
  listStoredOracleJobs,
} from "../agent-discovery/oracle-summary.js";

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

export async function handleOracleCommand(args: string[]): Promise<void> {
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
