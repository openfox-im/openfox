import {
  canonicalizeSettlementReceipt,
  keccak256,
  toHex,
  type Address,
  type Hex,
} from "@tosnetwork/tosdk";
import type {
  OpenFoxDatabase,
  SettlementCallbackConfig,
  SettlementCallbackRecord,
  SettlementCallbackStatus,
  SettlementCallbackTargetConfig,
  SettlementKind,
  SettlementRecord,
} from "../types.js";
import {
  ChainRpcClient,
  sendNativeTransfer,
} from "../chain/client.js";
import { normalizeAddress } from "../chain/address.js";

export interface SettlementCallbackDispatchResult {
  callback: SettlementCallbackRecord | null;
  action: "disabled" | "confirmed" | "pending" | "failed";
}

export interface SettlementCallbackRetryResult {
  processed: number;
  confirmed: number;
  pending: number;
  failed: number;
}

export interface SettlementCallbackDispatcher {
  dispatch(record: SettlementRecord): Promise<SettlementCallbackDispatchResult>;
  retryPending(limit?: number): Promise<SettlementCallbackRetryResult>;
}

function concatHex(prefix: Hex | undefined, payload: Hex): Hex {
  if (!prefix || prefix === "0x") return payload;
  return `0x${prefix.slice(2)}${payload.slice(2)}` as Hex;
}

function getTargetConfig(
  config: SettlementCallbackConfig,
  kind: SettlementKind,
): SettlementCallbackTargetConfig {
  switch (kind) {
    case "bounty":
      return config.bounty;
    case "observation":
      return config.observation;
    case "oracle":
      return config.oracle;
    default: {
      const exhaustive: never = kind;
      throw new Error(`Unsupported settlement kind: ${exhaustive}`);
    }
  }
}

function buildCallbackId(receiptId: string, contractAddress: Address): string {
  return `${receiptId}:${contractAddress.toLowerCase()}`;
}

function buildPayloadHex(
  record: SettlementRecord,
  target: SettlementCallbackTargetConfig,
): Hex {
  const payload =
    target.payloadMode === "receipt_hash"
      ? record.receiptHash
      : toHex(canonicalizeSettlementReceipt(record.receipt));
  return concatHex(target.prefixHex, payload as Hex);
}

function buildBaseCallbackRecord(params: {
  record: SettlementRecord;
  target: SettlementCallbackTargetConfig;
  contractAddress: Address;
  nowIso: string;
}): SettlementCallbackRecord {
  const payloadHex = buildPayloadHex(params.record, params.target);
  return {
    callbackId: buildCallbackId(params.record.receiptId, params.contractAddress),
    receiptId: params.record.receiptId,
    kind: params.record.kind,
    subjectId: params.record.subjectId,
    contractAddress: params.contractAddress,
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

export function createNativeSettlementCallbackDispatcher(params: {
  db: OpenFoxDatabase;
  rpcUrl: string;
  privateKey: `0x${string}`;
  config: SettlementCallbackConfig;
  now?: () => Date;
}): SettlementCallbackDispatcher {
  const now = params.now ?? (() => new Date());
  const rpcClient = new ChainRpcClient({ rpcUrl: params.rpcUrl });

  async function confirmPendingReceipt(
    callback: SettlementCallbackRecord,
  ): Promise<SettlementCallbackRecord | null> {
    if (!callback.callbackTxHash) return null;
    const receipt = await rpcClient.getTransactionReceipt(callback.callbackTxHash);
    if (!receipt) return null;
    const updated: SettlementCallbackRecord = {
      ...callback,
      status: "confirmed",
      callbackReceipt: receipt,
      lastError: null,
      nextAttemptAt: null,
      updatedAt: now().toISOString(),
    };
    params.db.upsertSettlementCallback(updated);
    return updated;
  }

  async function attemptSend(
    callback: SettlementCallbackRecord,
    target: SettlementCallbackTargetConfig,
  ): Promise<SettlementCallbackRecord> {
    const timestamp = now().toISOString();
    try {
      const transfer = await sendNativeTransfer({
        rpcUrl: params.rpcUrl,
        privateKey: params.privateKey,
        to: callback.contractAddress,
        amountTomi: BigInt(target.valueTomi),
        gas: BigInt(target.gas),
        data: callback.payloadHex,
        waitForReceipt: target.waitForReceipt,
        receiptTimeoutMs: target.receiptTimeoutMs,
      });
      const updated: SettlementCallbackRecord = {
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
      params.db.upsertSettlementCallback(updated);
      return updated;
    } catch (error) {
      const nextAttempts = callback.attemptCount + 1;
      const status: SettlementCallbackStatus =
        nextAttempts >= callback.maxAttempts ? "failed" : "pending";
      const updated: SettlementCallbackRecord = {
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
      params.db.upsertSettlementCallback(updated);
      return updated;
    }
  }

  async function dispatch(record: SettlementRecord): Promise<SettlementCallbackDispatchResult> {
    if (!params.config.enabled) {
      return { callback: null, action: "disabled" };
    }

    const target = getTargetConfig(params.config, record.kind);
    if (!target.enabled || !target.contractAddress) {
      return { callback: null, action: "disabled" };
    }

    const contractAddress = normalizeAddress(target.contractAddress);
    const existing =
      params.db.getSettlementCallbackByReceiptId(record.receiptId) ??
      buildBaseCallbackRecord({
        record,
        target,
        contractAddress,
        nowIso: now().toISOString(),
      });

    if (!params.db.getSettlementCallbackById(existing.callbackId)) {
      params.db.upsertSettlementCallback(existing);
    }

    if (existing.status === "confirmed") {
      return { callback: existing, action: "confirmed" };
    }

    const confirmed = await confirmPendingReceipt(existing);
    if (confirmed) {
      return { callback: confirmed, action: "confirmed" };
    }

    const due =
      !existing.nextAttemptAt ||
      new Date(existing.nextAttemptAt).getTime() <= now().getTime();
    if (!due) {
      return { callback: existing, action: "pending" };
    }

    const shouldSend = !existing.callbackTxHash && existing.attemptCount < existing.maxAttempts;
    if (!shouldSend) {
      const pending: SettlementCallbackRecord = {
        ...existing,
        nextAttemptAt: new Date(
          Date.now() + params.config.retryAfterSeconds * 1000,
        ).toISOString(),
        updatedAt: now().toISOString(),
      };
      params.db.upsertSettlementCallback(pending);
      return { callback: pending, action: pending.status };
    }

    const updated = await attemptSend(existing, target);
    return {
      callback: updated,
      action: updated.status,
    };
  }

  async function retryPending(limit = params.config.retryBatchSize): Promise<SettlementCallbackRetryResult> {
    const items = params.db.listPendingSettlementCallbacks(limit, now().toISOString());
    const result: SettlementCallbackRetryResult = {
      processed: items.length,
      confirmed: 0,
      pending: 0,
      failed: 0,
    };

    for (const item of items) {
      const receipt = params.db.getSettlementReceiptById(item.receiptId);
      if (!receipt) {
        const failed: SettlementCallbackRecord = {
          ...item,
          status: "failed",
          lastError: "settlement receipt not found",
          nextAttemptAt: null,
          updatedAt: now().toISOString(),
        };
        params.db.upsertSettlementCallback(failed);
        result.failed += 1;
        continue;
      }

      const dispatchResult = await dispatch(receipt);
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
  }

  return { dispatch, retryPending };
}
