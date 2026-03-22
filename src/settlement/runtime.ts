import type { Hex } from "@tosnetwork/tosdk";
import type { SettlementRecord } from "../types.js";
import { ChainRpcClient } from "../chain/client.js";

export interface OpenFoxRuntimeReceipt {
  receiptRef: string;
  kind?: number;
  kindName?: string;
  status?: number;
  statusName?: string;
  mode?: number;
  modeName?: string;
  sender?: string;
  recipient?: string;
  sponsor?: string;
  amountRef?: string;
  settlementRef?: string;
  proofRef?: string;
  failureRef?: string;
  policyRef?: string;
  artifactRef?: string;
  openedAt?: number;
  finalizedAt?: number;
}

export interface OpenFoxSettlementEffect {
  settlementRef: string;
  receiptRef?: string;
  mode?: number;
  modeName?: string;
  sender?: string;
  recipient?: string;
  sponsor?: string;
  amountRef?: string;
  proofRef?: string;
  failureRef?: string;
  policyRef?: string;
  artifactRef?: string;
  createdAt?: number;
}

export interface OpenFoxRuntimeSettlementSurface {
  receipt?: OpenFoxRuntimeReceipt;
  effect?: OpenFoxSettlementEffect;
}

export interface OpenFoxSettlementRecordRuntimeBridge
  extends OpenFoxRuntimeSettlementSurface {
  runtimeReceiptRef?: Hex | null;
  runtimeSettlementRef?: Hex | null;
}

export interface InspectOpenFoxRuntimeReceiptInput {
  rpcUrl: string;
  receiptRef: `0x${string}`;
}

export interface InspectOpenFoxSettlementEffectInput {
  rpcUrl: string;
  settlementRef: `0x${string}`;
}

function buildClient(rpcUrl: string): ChainRpcClient {
  const normalized = rpcUrl.trim();
  if (!normalized) {
    throw new Error("RPC URL is required for runtime settlement inspection");
  }
  return new ChainRpcClient({ rpcUrl: normalized });
}

function normalizeRuntimeRef(label: string, value: string): `0x${string}` {
  const normalized = value.trim();
  if (!/^0x[0-9a-fA-F]+$/.test(normalized)) {
    throw new Error(`Invalid ${label}: ${value}`);
  }
  return normalized as `0x${string}`;
}

function readRuntimeRefCandidate(value: unknown): Hex | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  if (!/^0x[0-9a-fA-F]+$/.test(normalized)) {
    return null;
  }
  return normalized as Hex;
}

export function resolveOpenFoxSettlementRuntimeRefs(
  record: SettlementRecord,
): { runtimeReceiptRef?: Hex | null; runtimeSettlementRef?: Hex | null } {
  const receiptMetadata =
    record.receipt && typeof record.receipt.metadata === "object" && record.receipt.metadata
      ? (record.receipt.metadata as Record<string, unknown>)
      : null;
  const settlementReceipt =
    record.settlementReceipt && typeof record.settlementReceipt === "object"
      ? (record.settlementReceipt as Record<string, unknown>)
      : null;

  const runtimeReceiptRef =
    record.runtimeReceiptRef ??
    readRuntimeRefCandidate(receiptMetadata?.runtimeReceiptRef) ??
    readRuntimeRefCandidate(receiptMetadata?.runtime_receipt_ref) ??
    readRuntimeRefCandidate(settlementReceipt?.receiptRef) ??
    readRuntimeRefCandidate(settlementReceipt?.receipt_ref) ??
    null;

  const runtimeSettlementRef =
    record.runtimeSettlementRef ??
    readRuntimeRefCandidate(receiptMetadata?.runtimeSettlementRef) ??
    readRuntimeRefCandidate(receiptMetadata?.runtime_settlement_ref) ??
    readRuntimeRefCandidate(settlementReceipt?.settlementRef) ??
    readRuntimeRefCandidate(settlementReceipt?.settlement_ref) ??
    null;

  return { runtimeReceiptRef, runtimeSettlementRef };
}

export async function inspectOpenFoxRuntimeReceipt(
  input: InspectOpenFoxRuntimeReceiptInput,
): Promise<OpenFoxRuntimeSettlementSurface> {
  const client = buildClient(input.rpcUrl);
  const receipt = await client.call<OpenFoxRuntimeReceipt>(
    "settlement_getRuntimeReceipt",
    [normalizeRuntimeRef("receipt_ref", input.receiptRef)],
  );
  const effect =
    receipt.settlementRef && receipt.settlementRef !== "0x"
      ? await client.call<OpenFoxSettlementEffect>(
          "settlement_getSettlementEffect",
          [normalizeRuntimeRef("settlement_ref", receipt.settlementRef)],
        )
      : undefined;
  return { receipt, effect };
}

export async function inspectOpenFoxSettlementEffect(
  input: InspectOpenFoxSettlementEffectInput,
): Promise<OpenFoxRuntimeSettlementSurface> {
  const client = buildClient(input.rpcUrl);
  const effect = await client.call<OpenFoxSettlementEffect>(
    "settlement_getSettlementEffect",
    [normalizeRuntimeRef("settlement_ref", input.settlementRef)],
  );
  const receipt =
    effect.receiptRef && effect.receiptRef !== "0x"
      ? await client.call<OpenFoxRuntimeReceipt>(
          "settlement_getRuntimeReceipt",
          [normalizeRuntimeRef("receipt_ref", effect.receiptRef)],
        )
      : undefined;
  return { receipt, effect };
}

export async function inspectOpenFoxSettlementRecordRuntimeBridge(input: {
  rpcUrl: string;
  record: SettlementRecord;
}): Promise<OpenFoxSettlementRecordRuntimeBridge> {
  const refs = resolveOpenFoxSettlementRuntimeRefs(input.record);
  if (refs.runtimeReceiptRef) {
    return {
      ...refs,
      ...(await inspectOpenFoxRuntimeReceipt({
        rpcUrl: input.rpcUrl,
        receiptRef: refs.runtimeReceiptRef,
      })),
    };
  }
  if (refs.runtimeSettlementRef) {
    return {
      ...refs,
      ...(await inspectOpenFoxSettlementEffect({
        rpcUrl: input.rpcUrl,
        settlementRef: refs.runtimeSettlementRef,
      })),
    };
  }
  return refs;
}
