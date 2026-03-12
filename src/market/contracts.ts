import {
  canonicalizeMarketBindingReceipt,
  encodePackageCallData,
  keccak256,
  toHex,
  type Address,
  type Hex,
} from "tosdk";
import type {
  MarketBindingKind,
  MarketBindingRecord,
  MarketContractCallbackRecord,
  MarketContractConfig,
  MarketContractStatus,
  MarketContractTargetConfig,
  OpenFoxDatabase,
} from "../types.js";
import { ChainRpcClient, sendNativeTransfer } from "../chain/client.js";
import { normalizeAddress } from "../chain/address.js";

export interface MarketContractDispatchResult {
  callback: MarketContractCallbackRecord | null;
  action: "disabled" | "confirmed" | "pending" | "failed";
}

export interface MarketContractRetryResult {
  processed: number;
  confirmed: number;
  pending: number;
  failed: number;
}

export interface MarketContractDispatcher {
  dispatch(record: MarketBindingRecord): Promise<MarketContractDispatchResult>;
  retryPending(limit?: number): Promise<MarketContractRetryResult>;
}

function getTargetConfig(
  config: MarketContractConfig,
  kind: MarketBindingKind,
): MarketContractTargetConfig {
  switch (kind) {
    case "bounty":
      return config.bounty;
    case "observation":
      return config.observation;
    case "oracle":
      return config.oracle;
    default: {
      const exhaustive: never = kind;
      throw new Error(`Unsupported market binding kind: ${exhaustive}`);
    }
  }
}

function buildCallbackId(bindingId: string, contractAddress: Address): string {
  return `${bindingId}:${contractAddress.toLowerCase()}`;
}

function buildPayloadHex(
  record: MarketBindingRecord,
  target: MarketContractTargetConfig,
): Hex {
  const payload =
    target.payloadMode === "binding_hash"
      ? record.receiptHash
      : toHex(canonicalizeMarketBindingReceipt(record.receipt));
  return encodePackageCallData({
    packageName: target.packageName!,
    functionSignature: target.functionSignature!,
    args: [
      {
        type: target.payloadMode === "binding_hash" ? "bytes32" : "bytes",
        value: payload,
      },
    ],
  });
}

function syncBindingCallbackState(
  db: OpenFoxDatabase,
  binding: MarketBindingRecord,
  callback: MarketContractCallbackRecord,
): void {
  db.upsertMarketBinding({
    ...binding,
    callbackTarget: callback.contractAddress,
    callbackTxHash: callback.callbackTxHash ?? null,
    callbackReceipt: callback.callbackReceipt ?? null,
    updatedAt: callback.updatedAt,
  });
}

function buildBaseCallbackRecord(params: {
  record: MarketBindingRecord;
  target: MarketContractTargetConfig;
  contractAddress: Address;
  nowIso: string;
}): MarketContractCallbackRecord {
  const payloadHex = buildPayloadHex(params.record, params.target);
  return {
    callbackId: buildCallbackId(params.record.bindingId, params.contractAddress),
    bindingId: params.record.bindingId,
    kind: params.record.kind,
    subjectId: params.record.subjectId,
    contractAddress: params.contractAddress,
    packageName: params.target.packageName!,
    functionSignature: params.target.functionSignature!,
    payloadMode: params.target.payloadMode,
    payloadHex,
    payloadHash: keccak256(payloadHex),
    status: "pending",
    attemptCount: 0,
    maxAttempts: params.target.maxAttempts,
    callbackTxHash: null,
    callbackReceipt: null,
    lastError: null,
    nextAttemptAt: params.nowIso,
    createdAt: params.nowIso,
    updatedAt: params.nowIso,
  };
}

export function createMarketContractDispatcher(params: {
  db: OpenFoxDatabase;
  rpcUrl: string;
  privateKey: `0x${string}`;
  config: MarketContractConfig;
  now?: () => Date;
}): MarketContractDispatcher {
  const now = params.now ?? (() => new Date());
  const rpcClient = new ChainRpcClient({ rpcUrl: params.rpcUrl });

  async function confirmPendingReceipt(
    binding: MarketBindingRecord,
    callback: MarketContractCallbackRecord,
  ): Promise<MarketContractCallbackRecord | null> {
    if (!callback.callbackTxHash) return null;
    const receipt = await rpcClient.getTransactionReceipt(callback.callbackTxHash);
    if (!receipt) return null;
    const updated: MarketContractCallbackRecord = {
      ...callback,
      status: "confirmed",
      callbackReceipt: receipt,
      lastError: null,
      nextAttemptAt: null,
      updatedAt: now().toISOString(),
    };
    params.db.upsertMarketContractCallback(updated);
    syncBindingCallbackState(params.db, binding, updated);
    return updated;
  }

  async function attemptSend(
    binding: MarketBindingRecord,
    callback: MarketContractCallbackRecord,
    target: MarketContractTargetConfig,
  ): Promise<MarketContractCallbackRecord> {
    const timestamp = now().toISOString();
    try {
      const transfer = await sendNativeTransfer({
        rpcUrl: params.rpcUrl,
        privateKey: params.privateKey,
        to: callback.contractAddress,
        amountWei: BigInt(target.valueWei),
        gas: BigInt(target.gas),
        data: callback.payloadHex,
        waitForReceipt: target.waitForReceipt,
        receiptTimeoutMs: target.receiptTimeoutMs,
      });
      const updated: MarketContractCallbackRecord = {
        ...callback,
        status: transfer.receipt ? "confirmed" : "pending",
        attemptCount: callback.attemptCount + 1,
        callbackTxHash: transfer.txHash,
        callbackReceipt: transfer.receipt ?? null,
        lastError: null,
        nextAttemptAt: transfer.receipt
          ? null
          : new Date(
              Date.now() + params.config.retryAfterSeconds * 1000,
            ).toISOString(),
        updatedAt: timestamp,
      };
      params.db.upsertMarketContractCallback(updated);
      syncBindingCallbackState(params.db, binding, updated);
      return updated;
    } catch (error) {
      const nextAttempts = callback.attemptCount + 1;
      const status: MarketContractStatus =
        nextAttempts >= callback.maxAttempts ? "failed" : "pending";
      const updated: MarketContractCallbackRecord = {
        ...callback,
        status,
        attemptCount: nextAttempts,
        lastError: error instanceof Error ? error.message : String(error),
        nextAttemptAt:
          status === "pending"
            ? new Date(
                Date.now() + params.config.retryAfterSeconds * 1000,
              ).toISOString()
            : null,
        updatedAt: timestamp,
      };
      params.db.upsertMarketContractCallback(updated);
      syncBindingCallbackState(params.db, binding, updated);
      return updated;
    }
  }

  return {
    async dispatch(record) {
      if (!params.config.enabled) {
        return { callback: null, action: "disabled" };
      }

      const target = getTargetConfig(params.config, record.kind);
      if (
        !target.enabled ||
        !target.contractAddress ||
        !target.packageName ||
        !target.functionSignature
      ) {
        return { callback: null, action: "disabled" };
      }

      const contractAddress = normalizeAddress(target.contractAddress);
      const existing =
        params.db.getMarketContractCallbackByBindingId(record.bindingId) ??
        buildBaseCallbackRecord({
          record,
          target,
          contractAddress,
          nowIso: now().toISOString(),
        });

      if (!params.db.getMarketContractCallbackById(existing.callbackId)) {
        params.db.upsertMarketContractCallback(existing);
      }

      if (existing.status === "confirmed") {
        return { callback: existing, action: "confirmed" };
      }

      const confirmed = await confirmPendingReceipt(record, existing);
      if (confirmed) {
        return { callback: confirmed, action: "confirmed" };
      }

      const due =
        !existing.nextAttemptAt ||
        new Date(existing.nextAttemptAt).getTime() <= now().getTime();
      if (!due) {
        return { callback: existing, action: "pending" };
      }

      const shouldSend =
        !existing.callbackTxHash && existing.attemptCount < existing.maxAttempts;
      if (!shouldSend) {
        const pending: MarketContractCallbackRecord = {
          ...existing,
          nextAttemptAt: new Date(
            Date.now() + params.config.retryAfterSeconds * 1000,
          ).toISOString(),
          updatedAt: now().toISOString(),
        };
        params.db.upsertMarketContractCallback(pending);
        syncBindingCallbackState(params.db, record, pending);
        return { callback: pending, action: pending.status };
      }

      const updated = await attemptSend(record, existing, target);
      return {
        callback: updated,
        action: updated.status,
      };
    },

    async retryPending(limit = params.config.retryBatchSize) {
      const items = params.db.listPendingMarketContractCallbacks(
        limit,
        now().toISOString(),
      );
      const result: MarketContractRetryResult = {
        processed: items.length,
        confirmed: 0,
        pending: 0,
        failed: 0,
      };

      for (const item of items) {
        const binding = params.db.getMarketBindingById(item.bindingId);
        if (!binding) {
          const failed: MarketContractCallbackRecord = {
            ...item,
            status: "failed",
            lastError: "market binding not found",
            nextAttemptAt: null,
            updatedAt: now().toISOString(),
          };
          params.db.upsertMarketContractCallback(failed);
          result.failed += 1;
          continue;
        }

        const dispatchResult = await this.dispatch(binding);
        if (!dispatchResult.callback) continue;
        if (dispatchResult.callback.status === "confirmed") {
          result.confirmed += 1;
        } else if (dispatchResult.callback.status === "failed") {
          result.failed += 1;
        } else {
          result.pending += 1;
        }
      }

      return result;
    },
  };
}
