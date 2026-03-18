import { loadConfig, resolvePath } from "../config.js";
import { createDatabase } from "../state/database.js";
import { createLogger } from "../observability/logger.js";
import { createX402PaymentManager } from "../chain/x402-server.js";

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

export async function handlePaymentsCommand(args: string[]): Promise<void> {
  const command = args[0] || "list";
  const asJson = args.includes("--json");
  if (args.includes("--help") || args.includes("-h") || command === "help") {
    logger.info(`
OpenFox payments

Usage:
  openfox payments list [--service <observation|oracle|gateway_request|gateway_session>] [--status <verified|submitted|confirmed|failed|replaced>] [--bound <true|false>] [--limit N] [--json]
  openfox payments get --payment-id <id> [--json]
  openfox payments get --service <observation|oracle|gateway_request|gateway_session> --request-key <key> [--json]
  openfox payments retry [--limit N] [--json]
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
      const serviceKind = readOption(args, "--service") as
        | "observation"
        | "oracle"
        | "gateway_request"
        | "gateway_session"
        | undefined;
      const status = readOption(args, "--status") as
        | "verified"
        | "submitted"
        | "confirmed"
        | "failed"
        | "replaced"
        | undefined;
      const boundRaw = readOption(args, "--bound");
      const bound =
        boundRaw === "true" ? true : boundRaw === "false" ? false : undefined;
      const limit = readNumberOption(args, "--limit", 20);
      const items = db.listX402Payments(limit, { serviceKind, status, bound });
      if (asJson) {
        logger.info(JSON.stringify({ items }, null, 2));
        return;
      }
      if (items.length === 0) {
        logger.info("No x402 payments found.");
        return;
      }
      logger.info("=== OPENFOX X402 PAYMENTS ===");
      for (const item of items) {
        logger.info(
          `${item.paymentId}  [${item.serviceKind}]  status=${item.status}  amount=${item.amountWei}  tx=${item.txHash}`,
        );
        logger.info(
          `  request=${item.requestKey}  payer=${item.payerAddress}  bound=${item.boundSubjectId ? `${item.boundKind}:${item.boundSubjectId}` : "(none)"}`,
        );
        if (item.lastError) {
          logger.info(`  error=${item.lastError}`);
        }
      }
      return;
    }

    if (command === "get") {
      const paymentId = readOption(args, "--payment-id");
      const serviceKind = readOption(args, "--service") as
        | "observation"
        | "oracle"
        | "gateway_request"
        | "gateway_session"
        | undefined;
      const requestKey = readOption(args, "--request-key");
      const record = paymentId
        ? db.getX402Payment(paymentId as `0x${string}`)
        : serviceKind && requestKey
          ? db.getLatestX402PaymentByRequestKey(serviceKind, requestKey)
          : undefined;
      if (!record) {
        throw new Error(
          paymentId
            ? `x402 payment not found: ${paymentId}`
            : "Usage: openfox payments get --payment-id <id> | --service <service> --request-key <key>",
        );
      }
      if (asJson) {
        logger.info(JSON.stringify(record, null, 2));
        return;
      }
      logger.info(`
=== OPENFOX X402 PAYMENT ===
Payment:     ${record.paymentId}
Service:     ${record.serviceKind}
Request key: ${record.requestKey}
Request hash:${record.requestHash}
Payer:       ${record.payerAddress}
Provider:    ${record.providerAddress}
Nonce:       ${record.txNonce}
Amount:      ${record.amountWei}
Status:      ${record.status}
Policy:      ${record.confirmationPolicy}
Attempts:    ${record.attemptCount}/${record.maxAttempts}
Tx hash:     ${record.txHash}
Bound:       ${record.boundSubjectId ? `${record.boundKind}:${record.boundSubjectId}` : "(none)"}
Artifact:    ${record.artifactUrl || "(none)"}
Last error:  ${record.lastError || "(none)"}
Updated:     ${record.updatedAt}
============================
`);
      return;
    }

    if (command === "retry") {
      if (!config.rpcUrl) {
        throw new Error("x402 payment retries require rpcUrl to be configured.");
      }
      if (!config.x402Server?.enabled) {
        throw new Error("x402 server-side payment handling is disabled in config.");
      }
      const limit = readNumberOption(args, "--limit", config.x402Server.retryBatchSize);
      const result = await createX402PaymentManager({
        db,
        rpcUrl: config.rpcUrl,
        config: config.x402Server,
      }).retryPending(limit);
      if (asJson) {
        logger.info(JSON.stringify(result, null, 2));
        return;
      }
      logger.info(`
=== OPENFOX X402 RETRY ===
Processed: ${result.processed}
Confirmed: ${result.confirmed}
Pending:   ${result.pending}
Failed:    ${result.failed}
==========================
`);
      return;
    }

    throw new Error(`Unknown payments command: ${command}`);
  } finally {
    db.close();
  }
}
