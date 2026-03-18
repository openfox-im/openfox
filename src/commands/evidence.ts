import { loadConfig, resolvePath } from "../config.js";
import { createDatabase } from "../state/database.js";
import { createLogger } from "../observability/logger.js";
import { getWallet } from "../identity/wallet.js";
import { loadApiKeyFromConfig } from "../identity/provision.js";
import {
  deriveAddressFromPrivateKey,
} from "../chain/address.js";
import { createEvidenceWorkflowCoordinator } from "../evidence-workflow/coordinator.js";
import {
  buildEvidenceWorkflowSummary,
  buildEvidenceWorkflowSummaryReport,
} from "../evidence-workflow/summary.js";
import type { OpenFoxIdentity } from "../types.js";

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

function collectRepeatedOption(args: string[], flag: string): string[] {
  const values: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === flag) {
      const value = args[index + 1]?.trim();
      if (value) values.push(value);
    }
  }
  return values;
}

export async function handleEvidenceCommand(args: string[]): Promise<void> {
  const command = args[0] || "list";
  const asJson = args.includes("--json");
  if (args.includes("--help") || args.includes("-h") || command === "help") {
    logger.info(`
OpenFox evidence

Usage:
  openfox evidence list [--limit N] [--json]
  openfox evidence get --run-id <id> [--json]
  openfox evidence summary [--limit N] [--json]
  openfox evidence run --title "<text>" --question "<text>" --source-url <url>... --news-fetch-url <base-url> --proof-verify-url <base-url> --quorum-m N [--quorum-n N] [--storage-url <base-url>] [--ttl-seconds N] [--json]
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
      const limit = readNumberOption(args, "--limit", 20);
      const coordinator = createEvidenceWorkflowCoordinator({
        identity: {
          name: config.name,
          address: config.walletAddress,
          account: ({} as OpenFoxIdentity["account"]),
          creatorAddress: config.creatorAddress,
          sandboxId: config.sandboxId,
          apiKey: config.runtimeApiKey || loadApiKeyFromConfig() || "",
          createdAt: db.getIdentity("createdAt") || new Date().toISOString(),
        },
        config,
        db,
      });
      const items = coordinator.list(limit);
      if (asJson) {
        logger.info(JSON.stringify({ items }, null, 2));
        return;
      }
      if (items.length === 0) {
        logger.info("No evidence workflow runs found.");
        return;
      }
      logger.info("=== OPENFOX EVIDENCE WORKFLOWS ===");
      for (const item of items) {
        logger.info(
          `${item.runId}  status=${item.status}  quorum=${item.validCount}/${item.quorumN}  title=${item.title}`,
        );
        if (item.aggregateResultUrl) {
          logger.info(`  aggregate: ${item.aggregateResultUrl}`);
        }
        if (item.aggregateError) {
          logger.info(`  aggregate_error: ${item.aggregateError}`);
        }
      }
      return;
    }

    if (command === "get") {
      const runId = readOption(args, "--run-id");
      if (!runId) throw new Error("Usage: openfox evidence get --run-id <id> [--json]");
      const coordinator = createEvidenceWorkflowCoordinator({
        identity: {
          name: config.name,
          address: config.walletAddress,
          account: ({} as OpenFoxIdentity["account"]),
          creatorAddress: config.creatorAddress,
          sandboxId: config.sandboxId,
          apiKey: config.runtimeApiKey || loadApiKeyFromConfig() || "",
          createdAt: db.getIdentity("createdAt") || new Date().toISOString(),
        },
        config,
        db,
      });
      const item = coordinator.get(runId);
      if (!item) throw new Error(`Evidence workflow run not found: ${runId}`);
      logger.info(JSON.stringify(item, null, 2));
      return;
    }

    if (command === "summary") {
      const snapshot = buildEvidenceWorkflowSummary({
        db,
        limit: readNumberOption(args, "--limit", 20),
      });
      if (asJson) {
        logger.info(JSON.stringify(snapshot, null, 2));
        return;
      }
      logger.info(buildEvidenceWorkflowSummaryReport(snapshot));
      return;
    }

    if (command === "run") {
      const title = readOption(args, "--title");
      const question = readOption(args, "--question");
      const sourceUrls = collectRepeatedOption(args, "--source-url");
      const newsFetchBaseUrl = readOption(args, "--news-fetch-url");
      const proofVerifyBaseUrl = readOption(args, "--proof-verify-url");
      const storageBaseUrl = readOption(args, "--storage-url");
      if (!title || !question || sourceUrls.length === 0 || !newsFetchBaseUrl || !proofVerifyBaseUrl) {
        throw new Error(
          'Usage: openfox evidence run --title "<text>" --question "<text>" --source-url <url>... --news-fetch-url <base-url> --proof-verify-url <base-url> --quorum-m N [--quorum-n N] [--storage-url <base-url>] [--ttl-seconds N] [--json]',
        );
      }
      const quorumM = readNumberOption(args, "--quorum-m", 0);
      const quorumNRaw = readOption(args, "--quorum-n");
      const quorumN = quorumNRaw ? Number.parseInt(quorumNRaw, 10) : undefined;
      if (quorumNRaw && (!Number.isFinite(quorumN) || !quorumN || quorumN <= 0)) {
        throw new Error(`Invalid numeric value for --quorum-n: ${quorumNRaw}`);
      }
      const ttlRaw = readOption(args, "--ttl-seconds");
      const ttlSeconds = ttlRaw ? Number.parseInt(ttlRaw, 10) : undefined;
      if (ttlRaw && (!Number.isFinite(ttlSeconds) || !ttlSeconds || ttlSeconds <= 0)) {
        throw new Error(`Invalid numeric value for --ttl-seconds: ${ttlRaw}`);
      }
      const { account, privateKey } = await getWallet();
      const coordinator = createEvidenceWorkflowCoordinator({
        identity: {
          name: config.name,
          address: config.walletAddress || deriveAddressFromPrivateKey(privateKey),
          account,
          creatorAddress: config.creatorAddress,
          sandboxId: config.sandboxId,
          apiKey: config.runtimeApiKey || loadApiKeyFromConfig() || "",
          createdAt: db.getIdentity("createdAt") || new Date().toISOString(),
        },
        config,
        db,
        account,
      });
      const record = await coordinator.run({
        title,
        question,
        sourceUrls,
        newsFetchBaseUrl,
        proofVerifyBaseUrl,
        storageBaseUrl,
        quorumM,
        quorumN,
        ttlSeconds,
      });
      logger.info(JSON.stringify(record, null, 2));
      return;
    }

    throw new Error(`Unknown evidence command: ${command}`);
  } finally {
    db.close();
  }
}
