import { loadConfig, resolvePath } from "../config.js";
import { createDatabase } from "../state/database.js";
import { createLogger } from "../observability/logger.js";

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

export async function handleSettlementCommand(args: string[]): Promise<void> {
  const command = args[0] || "list";
  const asJson = args.includes("--json");
  if (args.includes("--help") || args.includes("-h") || command === "help") {
    logger.info(`
OpenFox settlement

Usage:
  openfox settlement list [--kind <bounty|observation|oracle>] [--limit N] [--json]
  openfox settlement callbacks [--kind <bounty|observation|oracle>] [--status <pending|confirmed|failed>] [--limit N] [--json]
  openfox settlement get --receipt-id <id> [--json]
  openfox settlement get --kind <bounty|observation|oracle> --subject-id <id> [--json]
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
      const kind = readOption(args, "--kind") as "bounty" | "observation" | "oracle" | undefined;
      const limit = readNumberOption(args, "--limit", 20);
      const items = db.listSettlementReceipts(limit, kind);
      if (asJson) {
        logger.info(JSON.stringify({ items }, null, 2));
        return;
      }
      if (items.length === 0) {
        logger.info("No settlement receipts found.");
        return;
      }
      logger.info("=== OPENFOX SETTLEMENT RECEIPTS ===");
      for (const item of items) {
        logger.info(
          `${item.receiptId}  [${item.kind}]  subject=${item.subjectId}  tx=${item.settlementTxHash || "(pending)"}`,
        );
        if (item.artifactUrl) {
          logger.info(`  artifact: ${item.artifactUrl}`);
        }
      }
      return;
    }

    if (command === "callbacks") {
      const kind = readOption(args, "--kind") as "bounty" | "observation" | "oracle" | undefined;
      const status = readOption(args, "--status") as "pending" | "confirmed" | "failed" | undefined;
      const limit = readNumberOption(args, "--limit", 20);
      const items = db.listSettlementCallbacks(limit, { kind, status });
      if (asJson) {
        logger.info(JSON.stringify({ items }, null, 2));
        return;
      }
      if (items.length === 0) {
        logger.info("No settlement callbacks found.");
        return;
      }
      logger.info("=== OPENFOX SETTLEMENT CALLBACKS ===");
      for (const item of items) {
        logger.info(
          `${item.callbackId}  [${item.kind}]  status=${item.status}  attempts=${item.attemptCount}/${item.maxAttempts}  tx=${item.callbackTxHash || "(none)"}`,
        );
        logger.info(`  receipt=${item.receiptId}  contract=${item.contractAddress}`);
        if (item.lastError) {
          logger.info(`  error=${item.lastError}`);
        }
      }
      return;
    }

    if (command === "get") {
      const receiptId = readOption(args, "--receipt-id");
      const kind = readOption(args, "--kind") as "bounty" | "observation" | "oracle" | undefined;
      const subjectId = readOption(args, "--subject-id");
      const record = receiptId
        ? db.getSettlementReceiptById(receiptId)
        : kind && subjectId
          ? db.getSettlementReceipt(kind, subjectId)
          : undefined;
      if (!record) {
        throw new Error(
          receiptId
            ? `Settlement receipt not found: ${receiptId}`
            : "Usage: openfox settlement get --receipt-id <id> | --kind <kind> --subject-id <id>",
        );
      }
      if (asJson) {
        logger.info(
          JSON.stringify(
            {
              ...record,
              callback: db.getSettlementCallbackByReceiptId(record.receiptId) ?? null,
            },
            null,
            2,
          ),
        );
        return;
      }
      const callback = db.getSettlementCallbackByReceiptId(record.receiptId);
      logger.info(`
=== OPENFOX SETTLEMENT RECEIPT ===
Receipt:     ${record.receiptId}
Kind:        ${record.kind}
Subject:     ${record.subjectId}
Receipt hash:${record.receiptHash}
Artifact:    ${record.artifactUrl || "(none)"}
Payment tx:  ${record.paymentTxHash || "(none)"}
Payout tx:   ${record.payoutTxHash || "(none)"}
Anchor tx:   ${record.settlementTxHash || "(pending)"}
Callback:    ${callback ? `${callback.status} -> ${callback.contractAddress}` : "(none)"}
Callback tx: ${callback?.callbackTxHash || "(none)"}
Created:     ${record.createdAt}
Updated:     ${record.updatedAt}
=================================
`);
      return;
    }

    throw new Error(`Unknown settlement command: ${command}`);
  } finally {
    db.close();
  }
}
