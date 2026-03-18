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

export async function handleMarketCommand(args: string[]): Promise<void> {
  const command = args[0] || "list";
  const asJson = args.includes("--json");
  if (args.includes("--help") || args.includes("-h") || command === "help") {
    logger.info(`
OpenFox market

Usage:
  openfox market list [--kind <bounty|observation|oracle>] [--limit N] [--json]
  openfox market callbacks [--kind <bounty|observation|oracle>] [--status <pending|confirmed|failed>] [--limit N] [--json]
  openfox market get --binding-id <id> [--json]
  openfox market get --kind <bounty|observation|oracle> --subject-id <id> [--json]
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
      const items = db.listMarketBindings(limit, kind);
      if (asJson) {
        logger.info(JSON.stringify({ items }, null, 2));
        return;
      }
      if (items.length === 0) {
        logger.info("No market bindings found.");
        return;
      }
      logger.info("=== OPENFOX MARKET BINDINGS ===");
      for (const item of items) {
        logger.info(
          `${item.bindingId}  [${item.kind}]  subject=${item.subjectId}  callback=${item.callbackTxHash || "(pending)"}`,
        );
        if (item.receipt.artifactUrl) {
          logger.info(`  artifact: ${item.receipt.artifactUrl}`);
        }
      }
      return;
    }

    if (command === "callbacks") {
      const kind = readOption(args, "--kind") as "bounty" | "observation" | "oracle" | undefined;
      const status = readOption(args, "--status") as "pending" | "confirmed" | "failed" | undefined;
      const limit = readNumberOption(args, "--limit", 20);
      const items = db.listMarketContractCallbacks(limit, { kind, status });
      if (asJson) {
        logger.info(JSON.stringify({ items }, null, 2));
        return;
      }
      if (items.length === 0) {
        logger.info("No market callbacks found.");
        return;
      }
      logger.info("=== OPENFOX MARKET CALLBACKS ===");
      for (const item of items) {
        logger.info(
          `${item.callbackId}  [${item.kind}]  status=${item.status}  attempts=${item.attemptCount}/${item.maxAttempts}  tx=${item.callbackTxHash || "(none)"}`,
        );
        logger.info(
          `  binding=${item.bindingId}  contract=${item.contractAddress}  call=${item.packageName}:${item.functionSignature}`,
        );
        if (item.lastError) {
          logger.info(`  error=${item.lastError}`);
        }
      }
      return;
    }

    if (command === "get") {
      const bindingId = readOption(args, "--binding-id");
      const kind = readOption(args, "--kind") as "bounty" | "observation" | "oracle" | undefined;
      const subjectId = readOption(args, "--subject-id");
      const record = bindingId
        ? db.getMarketBindingById(bindingId)
        : kind && subjectId
          ? db.getMarketBinding(kind, subjectId)
          : undefined;
      if (!record) {
        throw new Error(
          bindingId
            ? `Market binding not found: ${bindingId}`
            : "Usage: openfox market get --binding-id <id> | --kind <kind> --subject-id <id>",
        );
      }
      if (asJson) {
        logger.info(
          JSON.stringify(
            {
              ...record,
              callback: db.getMarketContractCallbackByBindingId(record.bindingId) ?? null,
            },
            null,
            2,
          ),
        );
        return;
      }
      const callback = db.getMarketContractCallbackByBindingId(record.bindingId);
      logger.info(`
=== OPENFOX MARKET BINDING ===
Binding:     ${record.bindingId}
Kind:        ${record.kind}
Subject:     ${record.subjectId}
Binding hash:${record.receiptHash}
Artifact:    ${record.receipt.artifactUrl || "(none)"}
Payment tx:  ${record.receipt.paymentTxHash || "(none)"}
Callback:    ${callback ? `${callback.status} -> ${callback.contractAddress}` : "(none)"}
Callback tx: ${callback?.callbackTxHash || "(none)"}
Package:     ${callback ? `${callback.packageName}:${callback.functionSignature}` : "(none)"}
Created:     ${record.createdAt}
Updated:     ${record.updatedAt}
==============================
`);
      return;
    }

    throw new Error(`Unknown market command: ${command}`);
  } finally {
    db.close();
  }
}
