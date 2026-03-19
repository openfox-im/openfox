import { createHash } from "crypto";
import {
  createPublicClient,
  http as httpTransport,
  serializeTransaction,
  type Hex,
  type Signature,
  type TransactionSerializableNative,
} from "tosdk";
import type {
  OpenFoxConfig,
  OpenFoxDatabase,
  PaymasterAuthorizationRecord,
} from "../types.js";
import { getWallet } from "../identity/wallet.js";
import { ChainRpcClient } from "../chain/client.js";

export interface PaymasterAuthorizationRetryResult {
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
): PaymasterAuthorizationRecord[] {
  const authorized = db.listPaymasterAuthorizations(limit, { status: "authorized" });
  const failed = db.listPaymasterAuthorizations(limit, { status: "failed" });
  const submitted = db.listPaymasterAuthorizations(limit, { status: "submitted" });
  return [...authorized, ...failed, ...submitted]
    .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))
    .slice(0, limit);
}

export function createPaymasterAuthorizationRetryManager(params: {
  config: OpenFoxConfig;
  db: OpenFoxDatabase;
  rpcUrl: string;
}): {
  retryPending(limit?: number): Promise<PaymasterAuthorizationRetryResult>;
} {
  const rpcClient = new ChainRpcClient({ rpcUrl: params.rpcUrl });
  const publicClient = createPublicClient({
    transport: httpTransport(params.rpcUrl),
  });

  async function confirm(
    record: PaymasterAuthorizationRecord,
  ): Promise<PaymasterAuthorizationRecord | null> {
    if (!record.submittedTxHash) return null;
    const receipt = await rpcClient.getTransactionReceipt(record.submittedTxHash);
    if (!receipt) return null;
    const updated: PaymasterAuthorizationRecord = {
      ...record,
      status: "confirmed",
      submittedReceipt: receipt,
      receiptHash: buildReceiptHash(receipt),
      lastError: null,
      updatedAt: new Date().toISOString(),
    };
    params.db.upsertPaymasterAuthorization(updated);
    return updated;
  }

  async function resend(
    record: PaymasterAuthorizationRecord,
  ): Promise<PaymasterAuthorizationRecord> {
    if (!record.executionSignature) {
      const failed: PaymasterAuthorizationRecord = {
        ...record,
        status: "failed",
        lastError: "execution signature is unavailable for paymaster retry",
        updatedAt: new Date().toISOString(),
      };
      params.db.upsertPaymasterAuthorization(failed);
      return failed;
    }

    try {
      const { account } = await getWallet();
      const transaction: TransactionSerializableNative = {
        chainId: BigInt(record.chainId),
        nonce: BigInt(record.executionNonce),
        gas: BigInt(record.gas),
        to: record.targetAddress,
        value: BigInt(record.valueTomi),
        data: record.dataHex,
        from: record.walletAddress,
        signerType: record.requesterSignerType,
        sponsor: record.sponsorAddress,
        sponsorSignerType: record.sponsorSignerType,
        sponsorNonce: BigInt(record.sponsorNonce),
        sponsorExpiry: BigInt(record.sponsorExpiry),
        sponsorPolicyHash: record.policyHash,
      };
      const sponsorSignature = (await account.signAuthorization(
        transaction,
      )) as Signature;
      const rawTransaction = serializeTransaction(transaction, {
        execution: record.executionSignature as Signature,
        sponsor: sponsorSignature,
      });
      const txHash = await publicClient.request<Hex>("tos_sendRawTransaction", [
        rawTransaction,
      ]);
      let receipt: Record<string, unknown> | null = null;
      try {
        receipt = (await publicClient.waitForTransactionReceipt({
          hash: txHash,
          timeoutMs: params.config.paymasterProvider?.requestTimeoutMs ?? 15_000,
          pollIntervalMs: 1_000,
        })) as Record<string, unknown>;
      } catch {
        receipt = null;
      }
      const updated: PaymasterAuthorizationRecord = {
        ...record,
        sponsorSignature,
        submittedTxHash: txHash,
        submittedReceipt: receipt,
        receiptHash: buildReceiptHash(receipt),
        status: receipt ? "confirmed" : "submitted",
        lastError: null,
        updatedAt: new Date().toISOString(),
      };
      params.db.upsertPaymasterAuthorization(updated);
      return updated;
    } catch (error) {
      const failed: PaymasterAuthorizationRecord = {
        ...record,
        status: "failed",
        lastError: error instanceof Error ? error.message : String(error),
        updatedAt: new Date().toISOString(),
      };
      params.db.upsertPaymasterAuthorization(failed);
      return failed;
    }
  }

  return {
    async retryPending(limit = 25) {
      const items = getRetryCandidates(params.db, limit);
      const result: PaymasterAuthorizationRetryResult = {
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
          item.status === "failed" || item.status === "authorized" || !item.submittedTxHash
            ? await resend(item)
            : item;
        if (updated.status === "confirmed") {
          result.confirmed += 1;
        } else if (updated.status === "submitted" || updated.status === "authorized") {
          result.pending += 1;
        } else {
          result.failed += 1;
        }
      }
      return result;
    },
  };
}
