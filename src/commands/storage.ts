import { loadConfig, resolvePath } from "../config.js";
import { createDatabase } from "../state/database.js";
import { createLogger } from "../observability/logger.js";
import { getWallet } from "../identity/wallet.js";
import {
  readOption,
  readNumberOption,
} from "../cli/parse.js";
import {
  auditStoredBundle,
  getStorageHead,
  getStoredBundle,
  renewStoredLease,
  requestStorageQuote,
  storeBundleWithProvider,
} from "../storage/client.js";
import {
  createTrackedStorageLeaseRecord,
  createTrackedStorageRenewalRecord,
  replicateTrackedLease,
} from "../storage/lifecycle.js";
import { runStorageMaintenance } from "../operator/maintenance.js";
import { buildStorageLeaseHealthSnapshot } from "../operator/storage-health.js";

const logger = createLogger("main");

export async function handleStorageCommand(args: string[]): Promise<void> {
  const command = args[0] || "list";
  const asJson = args.includes("--json");
  if (args.includes("--help") || args.includes("-h") || command === "help") {
    logger.info(`
OpenFox storage

Usage:
  openfox storage list [--status <quoted|active|expired|released>] [--cid <cid>] [--json]
  openfox storage quote --provider <base-url> --input <path> [--kind <kind>] [--ttl-seconds N] [--json]
  openfox storage put --provider <base-url> --input <path> [--kind <kind>] [--ttl-seconds N] [--quote-id <id>] [--json]
  openfox storage renew --provider <base-url> --lease <lease-id> [--ttl-seconds N] [--json]
  openfox storage replicate --provider <base-url> --lease <lease-id> [--ttl-seconds N] [--json]
  openfox storage head --provider <base-url> --cid <cid> [--json]
  openfox storage get --provider <base-url> --cid <cid> [--output <path>] [--json]
  openfox storage audit --provider <base-url> --lease <lease-id> [--json]
  openfox storage lease-health [--limit N] [--json]
  openfox storage maintain [--limit N] [--json]
`);
    return;
  }

  const config = loadConfig();
  if (!config) {
    throw new Error("OpenFox is not configured. Run openfox --setup first.");
  }
  const db = createDatabase(resolvePath(config.dbPath));
  try {
    if (command === "maintain") {
      const result = await runStorageMaintenance({
        config,
        db,
        limit: readNumberOption(args, "--limit", 10),
      });
      logger.info(JSON.stringify(result, null, 2));
      return;
    }

    if (command === "lease-health") {
      const result = buildStorageLeaseHealthSnapshot({
        config,
        db,
        limit: readNumberOption(args, "--limit", 25),
      });
      logger.info(JSON.stringify(result, null, 2));
      return;
    }

    if (command === "list") {
      const status = readOption(args, "--status") as
        | "quoted"
        | "active"
        | "expired"
        | "released"
        | undefined;
      const cid = readOption(args, "--cid") || undefined;
      const leases = db.listStorageLeases(50, { status, cid });
      const renewals = db.listStorageRenewals(20, cid ? { cid } : undefined);
      const audits = db.listStorageAudits(20);
      const anchors = db.listStorageAnchors(20);
      if (asJson) {
        logger.info(JSON.stringify({ leases, renewals, audits, anchors }, null, 2));
        return;
      }
      logger.info(`
=== OPENFOX STORAGE LEASES ===
Leases: ${leases.length}
Renewals: ${renewals.length}
Audits: ${audits.length}
Anchors: ${anchors.length}
${leases
  .map(
    (item) =>
      `${item.leaseId}  status=${item.status}  cid=${item.cid}  kind=${item.bundleKind}  expires=${item.receipt.expiresAt}${item.providerBaseUrl ? `  provider=${item.providerBaseUrl}` : ""}`,
  )
  .join("\n")}
==============================
`);
      return;
    }

    const providerBaseUrl = readOption(args, "--provider");
    if (!providerBaseUrl) {
      throw new Error("Missing --provider <base-url>.");
    }

    if (command === "quote") {
      const inputPath = readOption(args, "--input");
      if (!inputPath) throw new Error("Missing --input <path>.");
      const ttlSeconds = readNumberOption(
        args,
        "--ttl-seconds",
        config.storage?.defaultTtlSeconds ?? 86400,
      );
      const result = await requestStorageQuote({
        providerBaseUrl,
        inputPath: resolvePath(inputPath),
        bundleKind: readOption(args, "--kind") || "artifact.bundle",
        requesterAddress: config.walletAddress,
        ttlSeconds,
      });
      logger.info(asJson ? JSON.stringify(result, null, 2) : JSON.stringify(result, null, 2));
      return;
    }

    if (command === "put") {
      const inputPath = readOption(args, "--input");
      if (!inputPath) throw new Error("Missing --input <path>.");
      const ttlSeconds = readNumberOption(
        args,
        "--ttl-seconds",
        config.storage?.defaultTtlSeconds ?? 86400,
      );
      const { account } = await getWallet();
      const result = await storeBundleWithProvider({
        providerBaseUrl,
        inputPath: resolvePath(inputPath),
        bundleKind: readOption(args, "--kind") || "artifact.bundle",
        requesterAccount: account,
        requesterAddress: config.walletAddress,
        ttlSeconds,
        quoteId: readOption(args, "--quote-id"),
      });
      db.upsertStorageLease(
        createTrackedStorageLeaseRecord({
          response: result,
          requesterAddress: config.walletAddress,
          providerBaseUrl,
          requestKey: `storage:cli-put:${result.lease_id}:${Date.now()}`,
        }),
      );
      logger.info(asJson ? JSON.stringify(result, null, 2) : JSON.stringify(result, null, 2));
      return;
    }

    if (command === "renew") {
      const leaseId = readOption(args, "--lease");
      if (!leaseId) throw new Error("Missing --lease <lease-id>.");
      const { account } = await getWallet();
      const ttlValue = readOption(args, "--ttl-seconds");
      const ttlSeconds = ttlValue ? Number(ttlValue) : undefined;
      if (
        ttlValue &&
        (ttlSeconds === undefined ||
          !Number.isFinite(ttlSeconds) ||
          ttlSeconds <= 0)
      ) {
        throw new Error("Invalid --ttl-seconds value.");
      }
      const result = await renewStoredLease({
        providerBaseUrl,
        leaseId,
        requesterAccount: account,
        requesterAddress: config.walletAddress,
        ttlSeconds,
      });
      db.upsertStorageLease(
        createTrackedStorageLeaseRecord({
          response: result,
          requesterAddress: config.walletAddress,
          providerBaseUrl,
          requestKey: `storage:cli-renew:${leaseId}:${Date.now()}`,
          createdAt:
            db.getStorageLease(leaseId)?.createdAt || new Date().toISOString(),
        }),
      );
      db.upsertStorageRenewal(
        createTrackedStorageRenewalRecord({
          response: result,
          requesterAddress: config.walletAddress,
          providerBaseUrl,
        }),
      );
      logger.info(asJson ? JSON.stringify(result, null, 2) : JSON.stringify(result, null, 2));
      return;
    }

    if (command === "replicate") {
      const leaseId = readOption(args, "--lease");
      if (!leaseId) throw new Error("Missing --lease <lease-id>.");
      const sourceLease = db.getStorageLease(leaseId);
      if (!sourceLease) {
        throw new Error(`Storage lease not found: ${leaseId}`);
      }
      const { account } = await getWallet();
      const ttlSeconds = readNumberOption(
        args,
        "--ttl-seconds",
        sourceLease.ttlSeconds,
      );
      const result = await replicateTrackedLease({
        sourceLease,
        targetProviderBaseUrl: providerBaseUrl,
        requesterAccount: account as any,
        requesterAddress: config.walletAddress,
        ttlSeconds,
        db,
      });
      logger.info(asJson ? JSON.stringify(result, null, 2) : JSON.stringify(result, null, 2));
      return;
    }

    if (command === "head") {
      const cid = readOption(args, "--cid");
      if (!cid) throw new Error("Missing --cid <cid>.");
      const result = await getStorageHead({ providerBaseUrl, cid });
      logger.info(asJson ? JSON.stringify(result, null, 2) : JSON.stringify(result, null, 2));
      return;
    }

    if (command === "get") {
      const cid = readOption(args, "--cid");
      if (!cid) throw new Error("Missing --cid <cid>.");
      const result = await getStoredBundle({
        providerBaseUrl,
        cid,
        outputPath: readOption(args, "--output")
          ? resolvePath(readOption(args, "--output")!)
          : undefined,
      });
      logger.info(asJson ? JSON.stringify(result, null, 2) : JSON.stringify(result, null, 2));
      return;
    }

    if (command === "audit") {
      const leaseId = readOption(args, "--lease");
      if (!leaseId) throw new Error("Missing --lease <lease-id>.");
      const result = await auditStoredBundle({ providerBaseUrl, leaseId });
      logger.info(asJson ? JSON.stringify(result, null, 2) : JSON.stringify(result, null, 2));
      return;
    }

    throw new Error(`Unknown storage command: ${command}`);
  } finally {
    db.close();
  }
}
