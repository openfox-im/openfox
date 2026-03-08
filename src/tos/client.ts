import { createHmac } from "node:crypto";
import { etc, sign as signSecp256k1 } from "@noble/secp256k1";
import type { PrivateKeyAccount } from "viem";
import { keccak256, parseUnits, toHex } from "viem";
import {
  deriveTOSAddressFromPrivateKey,
  normalizeTOSAddress,
  type TOSAddress,
  type HexString,
} from "./address.js";
import {
  bigintToMinimalBytes,
  encodeRlpAddress,
  encodeRlpHex,
  encodeRlpList,
  encodeRlpString,
  encodeRlpUint,
  hexToBytes,
} from "./rlp.js";

export const TOS_SYSTEM_ACTION_ADDRESS = normalizeTOSAddress("0x1");

if (!etc.hmacSha256Sync) {
  etc.hmacSha256Sync = (key, ...messages) => {
    const mac = createHmac("sha256", Buffer.from(key));
    for (const message of messages) {
      mac.update(Buffer.from(message));
    }
    return new Uint8Array(mac.digest());
  };
}

export interface TOSRpcClientOptions {
  rpcUrl: string;
}

export interface TOSUnsignedTransaction {
  chainId: bigint;
  nonce: bigint;
  gas: bigint;
  to: TOSAddress;
  value: bigint;
  data?: HexString;
  from: TOSAddress;
  signerType?: "secp256k1";
}

export interface TOSSystemAction {
  action: string;
  payload?: Record<string, unknown>;
}

export interface TOSSignedTransaction extends TOSUnsignedTransaction {
  signHash: HexString;
  rawTransaction: HexString;
  transactionHash: HexString;
  v: bigint;
  r: bigint;
  s: bigint;
}

export interface TOSPaymentEnvelope {
  x402Version: number;
  scheme: "exact";
  network: string;
  payload: {
    rawTransaction: HexString;
  };
}

export interface TOSX402Requirement {
  scheme: "exact";
  network: string;
  maxAmountRequired: string;
  payToAddress: TOSAddress;
  asset?: string;
  requiredDeadlineSeconds?: number;
}

type JsonRpcSuccess<T> = { jsonrpc: "2.0"; id: number; result: T };
type JsonRpcFailure = {
  jsonrpc: "2.0";
  id: number;
  error: { code: number; message: string };
};

function bytesToHex(bytes: Uint8Array): HexString {
  return toHex(bytes) as HexString;
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function parseHexQuantity(value: string): bigint {
  if (!value || typeof value !== "string") {
    throw new Error(`Expected hex quantity, got: ${String(value)}`);
  }
  return BigInt(value);
}

function parseChainIdFromNetwork(network: string): bigint {
  const normalized = network.trim().toLowerCase();
  if (normalized.startsWith("tos:")) {
    return BigInt(normalized.slice("tos:".length));
  }
  throw new Error(`Unsupported TOS network identifier: ${network}`);
}

function utf8ToHex(value: string): HexString {
  return bytesToHex(new TextEncoder().encode(value));
}

function bigIntFromSignatureBytes(bytes: Uint8Array): bigint {
  let hex = "";
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, "0");
  }
  return BigInt(`0x${hex || "0"}`);
}

function encodeUnsignedPayload(tx: TOSUnsignedTransaction): Uint8Array {
  return encodeRlpList([
    encodeRlpUint(tx.chainId),
    encodeRlpUint(tx.nonce),
    encodeRlpUint(tx.gas),
    encodeRlpAddress(tx.to),
    encodeRlpUint(tx.value),
    encodeRlpHex(tx.data),
    encodeRlpList([]),
    encodeRlpAddress(tx.from),
    encodeRlpString(tx.signerType ?? "secp256k1"),
  ]);
}

function encodeSignedPayload(tx: TOSSignedTransaction): Uint8Array {
  return encodeRlpList([
    encodeRlpUint(tx.chainId),
    encodeRlpUint(tx.nonce),
    encodeRlpUint(tx.gas),
    encodeRlpAddress(tx.to),
    encodeRlpUint(tx.value),
    encodeRlpHex(tx.data),
    encodeRlpList([]),
    encodeRlpAddress(tx.from),
    encodeRlpString(tx.signerType ?? "secp256k1"),
    encodeRlpUint(tx.v),
    encodeRlpUint(tx.r),
    encodeRlpUint(tx.s),
  ]);
}

export function formatTOSNetwork(chainId: bigint | number): string {
  const value = typeof chainId === "number" ? BigInt(chainId) : chainId;
  return `tos:${value.toString()}`;
}

export function parseTOSAmount(amount: string): bigint {
  return parseUnits(amount, 18);
}

export class TOSRpcClient {
  private readonly rpcUrl: string;
  private nextId = 1;

  constructor(options: TOSRpcClientOptions) {
    this.rpcUrl = options.rpcUrl;
  }

  private async request<T>(method: string, params: unknown[]): Promise<T> {
    const id = this.nextId++;
    const response = await fetch(this.rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id,
        method,
        params,
      }),
    });
    if (!response.ok) {
      throw new Error(
        `TOS RPC ${method} failed: ${response.status} ${await response.text()}`,
      );
    }
    const body = (await response.json()) as JsonRpcSuccess<T> | JsonRpcFailure;
    if ("error" in body) {
      throw new Error(
        `TOS RPC ${method} error ${body.error.code}: ${body.error.message}`,
      );
    }
    return body.result;
  }

  async getChainId(): Promise<bigint> {
    return parseHexQuantity(await this.request<string>("tos_chainId", []));
  }

  async getBalance(
    address: TOSAddress,
    blockTag: string = "latest",
  ): Promise<bigint> {
    return parseHexQuantity(
      await this.request<string>("tos_getBalance", [
        normalizeTOSAddress(address),
        blockTag,
      ]),
    );
  }

  async getTransactionCount(
    address: TOSAddress,
    blockTag: string = "pending",
  ): Promise<bigint> {
    return parseHexQuantity(
      await this.request<string>("tos_getTransactionCount", [
        normalizeTOSAddress(address),
        blockTag,
      ]),
    );
  }

  async sendRawTransaction(rawTransaction: HexString): Promise<HexString> {
    return await this.request<HexString>("tos_sendRawTransaction", [
      rawTransaction,
    ]);
  }

  async getTransactionReceipt(
    txHash: HexString,
  ): Promise<Record<string, unknown> | null> {
    return await this.request<Record<string, unknown> | null>(
      "tos_getTransactionReceipt",
      [txHash],
    );
  }
}

export async function signTOSNativeTransfer(
  privateKey: HexString,
  tx: Omit<TOSUnsignedTransaction, "from" | "signerType"> & {
    from?: TOSAddress;
    signerType?: "secp256k1";
  },
): Promise<TOSSignedTransaction> {
  const from = tx.from ?? deriveTOSAddressFromPrivateKey(privateKey);
  const normalizedTx: TOSUnsignedTransaction = {
    ...tx,
    to: normalizeTOSAddress(tx.to),
    from,
    data: tx.data ?? "0x",
    signerType: tx.signerType ?? "secp256k1",
  };

  const signingPayload = encodeUnsignedPayload(normalizedTx);
  const toSign = concatBytes([Uint8Array.from([0x00]), signingPayload]);
  const signHash = keccak256(bytesToHex(toSign));

  const signature = signSecp256k1(hexToBytes(signHash), privateKey.slice(2), {
    lowS: true,
  });

  const compactSignature = signature.toCompactRawBytes();
  const r = bigIntFromSignatureBytes(compactSignature.slice(0, 32));
  const s = bigIntFromSignatureBytes(compactSignature.slice(32, 64));
  const v = BigInt(signature.recovery);

  const signed: TOSSignedTransaction = {
    ...normalizedTx,
    signHash,
    v,
    r,
    s,
    rawTransaction: "0x",
    transactionHash: "0x",
  };

  const signedPayload = encodeSignedPayload(signed);
  const rawBytes = concatBytes([Uint8Array.from([0x00]), signedPayload]);
  signed.rawTransaction = bytesToHex(rawBytes);
  signed.transactionHash = keccak256(signed.rawTransaction) as HexString;

  return signed;
}

export async function sendTOSNativeTransfer(params: {
  rpcUrl: string;
  privateKey: HexString;
  to: TOSAddress | string;
  amountWei: bigint;
  gas?: bigint;
  data?: HexString;
  waitForReceipt?: boolean;
  receiptTimeoutMs?: number;
  pollIntervalMs?: number;
}): Promise<{
  signed: TOSSignedTransaction;
  txHash: HexString;
  receipt?: Record<string, unknown> | null;
}> {
  const client = new TOSRpcClient({ rpcUrl: params.rpcUrl });
  const from = deriveTOSAddressFromPrivateKey(params.privateKey);
  const [chainId, nonce] = await Promise.all([
    client.getChainId(),
    client.getTransactionCount(from, "pending"),
  ]);

  const signed = await signTOSNativeTransfer(params.privateKey, {
    chainId,
    nonce,
    gas: params.gas ?? 21_000n,
    to: normalizeTOSAddress(params.to),
    value: params.amountWei,
    data: params.data ?? "0x",
    from,
  });

  const txHash = await client.sendRawTransaction(signed.rawTransaction);

  if (!params.waitForReceipt) {
    return { signed, txHash };
  }

  const timeoutMs = params.receiptTimeoutMs ?? 60_000;
  const pollIntervalMs = params.pollIntervalMs ?? 2_000;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const receipt = await client.getTransactionReceipt(txHash);
    if (receipt) {
      return { signed, txHash, receipt };
    }
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  return { signed, txHash, receipt: null };
}

export async function sendTOSSystemAction(params: {
  rpcUrl: string;
  privateKey: HexString;
  action: string;
  payload?: Record<string, unknown>;
  gas?: bigint;
  waitForReceipt?: boolean;
  receiptTimeoutMs?: number;
  pollIntervalMs?: number;
}): Promise<{
  signed: TOSSignedTransaction;
  txHash: HexString;
  receipt?: Record<string, unknown> | null;
}> {
  const body: TOSSystemAction = {
    action: params.action,
    ...(params.payload ? { payload: params.payload } : {}),
  };
  return sendTOSNativeTransfer({
    rpcUrl: params.rpcUrl,
    privateKey: params.privateKey,
    to: TOS_SYSTEM_ACTION_ADDRESS,
    amountWei: 0n,
    gas: params.gas ?? 120_000n,
    data: utf8ToHex(JSON.stringify(body)),
    waitForReceipt: params.waitForReceipt,
    receiptTimeoutMs: params.receiptTimeoutMs,
    pollIntervalMs: params.pollIntervalMs,
  });
}

export async function recordTOSReputationScore(params: {
  rpcUrl: string;
  privateKey: HexString;
  who: TOSAddress | string;
  delta: string;
  reason: string;
  refId: string;
  gas?: bigint;
  waitForReceipt?: boolean;
  receiptTimeoutMs?: number;
  pollIntervalMs?: number;
}): Promise<{
  signed: TOSSignedTransaction;
  txHash: HexString;
  receipt?: Record<string, unknown> | null;
}> {
  return sendTOSSystemAction({
    rpcUrl: params.rpcUrl,
    privateKey: params.privateKey,
    action: "REPUTATION_RECORD_SCORE",
    payload: {
      who: normalizeTOSAddress(params.who),
      delta: params.delta,
      reason: params.reason,
      ref_id: params.refId,
    },
    gas: params.gas,
    waitForReceipt: params.waitForReceipt,
    receiptTimeoutMs: params.receiptTimeoutMs,
    pollIntervalMs: params.pollIntervalMs,
  });
}

export async function buildTOSX402Payment(params: {
  privateKey: HexString;
  requirement: TOSX402Requirement;
  rpcUrl: string;
  gas?: bigint;
}): Promise<TOSPaymentEnvelope> {
  const value = BigInt(params.requirement.maxAmountRequired);
  const client = new TOSRpcClient({ rpcUrl: params.rpcUrl });
  const from = deriveTOSAddressFromPrivateKey(params.privateKey);
  const [chainId, nonce] = await Promise.all([
    client.getChainId(),
    client.getTransactionCount(from, "pending"),
  ]);
  const requiredChainId = parseChainIdFromNetwork(params.requirement.network);
  if (chainId !== requiredChainId) {
    throw new Error(
      `TOS x402 network mismatch: wallet RPC is ${formatTOSNetwork(chainId)} but requirement expects ${params.requirement.network}`,
    );
  }

  const signed = await signTOSNativeTransfer(params.privateKey, {
    chainId,
    nonce,
    gas: params.gas ?? 21_000n,
    to: params.requirement.payToAddress,
    value,
    data: "0x",
    from,
  });

  return {
    x402Version: 1,
    scheme: "exact",
    network: params.requirement.network,
    payload: {
      rawTransaction: signed.rawTransaction,
    },
  };
}

export function encodeTOSX402PaymentHeader(
  envelope: TOSPaymentEnvelope,
): string {
  return Buffer.from(JSON.stringify(envelope)).toString("base64");
}

export function getTOSAddressFromAccount(
  _account: PrivateKeyAccount,
  privateKey: HexString,
): TOSAddress {
  return deriveTOSAddressFromPrivateKey(privateKey);
}
