import { createHash } from "crypto";
import type { Hex } from "tosdk";
import type {
  OpenFoxConfig,
  OpenFoxDatabase,
  SignerExecutionRecord,
} from "../types.js";
import { ChainRpcClient, sendNativeTransfer } from "../chain/client.js";
import { loadWalletPrivateKey } from "../identity/wallet.js";

export interface SignerExecutionRetryResult {
  processed: number;
  confirmed: number;
  pending: number;
  failed: number;
}

function buildReceiptHash(receipt: Record<string, unknown> | null | undefined): Hex | null {
  if (!receipt) return null;
  return createHash("sha256")
    .update(JSON.stringify(receipt))
    .digest("hex")
    .replace(/^/, "0x") as Hex;
}

function getRetryCandidates(
  db: OpenFoxDatabase,
  limit: number,
): SignerExecutionRecord[] {
  const failed = db.listSignerExecutions(limit, { status: "failed" });
  const submitted = db.listSignerExecutions(limit, { status: "submitted" });
  const pending = db.listSignerExecutions(limit, { status: "pending" });
  return [...failed, ...submitted, ...pending]
    .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))
    .slice(0, limit);
}

export function createSignerExecutionRetryManager(params: {
  config: OpenFoxConfig;
  db: OpenFoxDatabase;
  rpcUrl: string;
}): {
  retryPending(limit?: number): Promise<SignerExecutionRetryResult>;
} {
  const rpcClient = new ChainRpcClient({ rpcUrl: params.rpcUrl });

  async function confirm(
    record: SignerExecutionRecord,
  ): Promise<SignerExecutionRecord | null> {
    if (!record.submittedTxHash) return null;
    const receipt = await rpcClient.getTransactionReceipt(record.submittedTxHash);
    if (!receipt) return null;
    const updated: SignerExecutionRecord = {
      ...record,
      status: "confirmed",
      submittedReceipt: receipt,
      receiptHash: buildReceiptHash(receipt),
      lastError: null,
      updatedAt: new Date().toISOString(),
    };
    params.db.upsertSignerExecution(updated);
    return updated;
  }

  async function resend(
    record: SignerExecutionRecord,
  ): Promise<SignerExecutionRecord> {
    const privateKey = loadWalletPrivateKey();
    if (!privateKey) {
      const failed: SignerExecutionRecord = {
        ...record,
        status: "failed",
        lastError: "wallet private key is unavailable for signer retry",
        updatedAt: new Date().toISOString(),
      };
      params.db.upsertSignerExecution(failed);
      return failed;
    }
    try {
      const submitted = await sendNativeTransfer({
        rpcUrl: params.rpcUrl,
        privateKey,
        to: record.targetAddress,
        amountWei: BigInt(record.valueWei),
        gas: BigInt(record.gas),
        data: record.dataHex,
        waitForReceipt: params.config.x402Server?.confirmationPolicy === "receipt",
        receiptTimeoutMs: params.config.x402Server?.receiptTimeoutMs,
        pollIntervalMs: params.config.x402Server?.receiptPollIntervalMs,
      });
      const updated: SignerExecutionRecord = {
        ...record,
        submittedTxHash: submitted.txHash,
        submittedReceipt: submitted.receipt ?? null,
        receiptHash: buildReceiptHash(submitted.receipt),
        status: submitted.receipt ? "confirmed" : "submitted",
        lastError: null,
        updatedAt: new Date().toISOString(),
      };
      params.db.upsertSignerExecution(updated);
      return updated;
    } catch (error) {
      const failed: SignerExecutionRecord = {
        ...record,
        status: "failed",
        lastError: error instanceof Error ? error.message : String(error),
        updatedAt: new Date().toISOString(),
      };
      params.db.upsertSignerExecution(failed);
      return failed;
    }
  }

  return {
    async retryPending(limit = 25) {
      const items = getRetryCandidates(params.db, limit);
      const result: SignerExecutionRetryResult = {
        processed: items.length,
        confirmed: 0,
        pending: 0,
        failed: 0,
      };
      for (const item of items) {
        const confirmed = await confirm(item);
        if (confirmed) {
          result.confirmed += 1;
          continue;
        }
        const updated =
          item.status === "failed" || !item.submittedTxHash
            ? await resend(item)
            : item;
        if (updated.status === "confirmed") {
          result.confirmed += 1;
        } else if (updated.status === "submitted" || updated.status === "pending") {
          result.pending += 1;
        } else {
          result.failed += 1;
        }
      }
      return result;
    },
  };
}
