import { loadConfig, resolvePath } from "../config.js";
import { createDatabase } from "../state/database.js";
import { createLogger } from "../observability/logger.js";
import {
  buildZkTlsBundleSummary,
  buildZkTlsBundleSummaryReport,
  getZkTlsBundleRecord,
  listZkTlsBundleRecords,
} from "../proof-market/records.js";

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

export async function handleNewsCommand(args: string[]): Promise<void> {
  const command = args[0] || "list";
  const asJson = args.includes("--json");
  if (args.includes("--help") || args.includes("-h") || command === "help") {
    logger.info(`
OpenFox news

Usage:
  openfox news list [--limit N] [--json]
  openfox news get --record-id <id> [--json]
  openfox news summary [--limit N] [--json]
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
      const items = listZkTlsBundleRecords(db, readNumberOption(args, "--limit", 20));
      if (asJson) {
        logger.info(JSON.stringify({ items }, null, 2));
        return;
      }
      if (!items.length) {
        logger.info("No zkTLS bundle records found.");
        return;
      }
      logger.info("=== OPENFOX NEWS CAPTURE BUNDLES ===");
      for (const item of items) {
        logger.info(
          `${item.recordId}  policy=${item.originClaims.sourcePolicyId || "(unspecified)"}  host=${item.originClaims.sourcePolicyHost || new URL(item.originClaims.canonicalUrl).hostname}  bundle=${item.bundleFormat}`,
        );
      }
      return;
    }

    if (command === "get") {
      const recordId = readOption(args, "--record-id");
      if (!recordId) throw new Error("Usage: openfox news get --record-id <id> [--json]");
      const item = getZkTlsBundleRecord(db, recordId);
      if (!item) throw new Error(`zkTLS bundle record not found: ${recordId}`);
      logger.info(JSON.stringify(item, null, 2));
      return;
    }

    if (command === "summary") {
      const snapshot = buildZkTlsBundleSummary(db, readNumberOption(args, "--limit", 20));
      if (asJson) {
        logger.info(JSON.stringify(snapshot, null, 2));
        return;
      }
      logger.info(buildZkTlsBundleSummaryReport(snapshot));
      return;
    }

    throw new Error(`Unknown news command: ${command}`);
  } finally {
    db.close();
  }
}
