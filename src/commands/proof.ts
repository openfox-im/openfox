import { loadConfig, resolvePath } from "../config.js";
import { createDatabase } from "../state/database.js";
import { createLogger } from "../observability/logger.js";
import {
  buildProofVerificationSummary,
  buildProofVerificationSummaryReport,
  getProofVerificationRecord,
  listProofVerificationRecords,
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

export async function handleProofCommand(args: string[]): Promise<void> {
  const command = args[0] || "list";
  const asJson = args.includes("--json");
  if (args.includes("--help") || args.includes("-h") || command === "help") {
    logger.info(`
OpenFox proof

Usage:
  openfox proof list [--limit N] [--json]
  openfox proof get --record-id <id> [--json]
  openfox proof summary [--limit N] [--json]
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
      const items = listProofVerificationRecords(db, readNumberOption(args, "--limit", 20));
      if (asJson) {
        logger.info(JSON.stringify({ items }, null, 2));
        return;
      }
      if (!items.length) {
        logger.info("No proof verification records found.");
        return;
      }
      logger.info("=== OPENFOX PROOF VERIFICATIONS ===");
      for (const item of items) {
        logger.info(
          `${item.recordId}  class=${item.verifierClass}  mode=${item.verificationMode}  verdict=${item.verdict}  reason=${item.verdictReason}`,
        );
      }
      return;
    }

    if (command === "get") {
      const recordId = readOption(args, "--record-id");
      if (!recordId) throw new Error("Usage: openfox proof get --record-id <id> [--json]");
      const item = getProofVerificationRecord(db, recordId);
      if (!item) throw new Error(`Proof verification record not found: ${recordId}`);
      logger.info(JSON.stringify(item, null, 2));
      return;
    }

    if (command === "summary") {
      const snapshot = buildProofVerificationSummary(db, readNumberOption(args, "--limit", 20));
      if (asJson) {
        logger.info(JSON.stringify(snapshot, null, 2));
        return;
      }
      logger.info(buildProofVerificationSummaryReport(snapshot));
      return;
    }

    throw new Error(`Unknown proof command: ${command}`);
  } finally {
    db.close();
  }
}
