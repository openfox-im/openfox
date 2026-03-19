import { createHmac } from "node:crypto";
import { etc, sign as signSecp256k1 } from "@noble/secp256k1";
import type { PrivateKeyAccount } from "@tosnetwork/tosdk";
import { keccak256, parseUnits, toHex } from "@tosnetwork/tosdk";
import { ChainRpcError } from "./errors.js";
import {
  deriveAddressFromPrivateKey,
  normalizeAddress,
  type ChainAddress,
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

export const SYSTEM_ACTION_ADDRESS = normalizeAddress("0x1");

if (!etc.hmacSha256Sync) {
  etc.hmacSha256Sync = (key, ...messages) => {
    const mac = createHmac("sha256", Buffer.from(key));
    for (const message of messages) {
      mac.update(Buffer.from(message));
    }
    return new Uint8Array(mac.digest());
  };
}

export interface ChainRpcClientOptions {
  rpcUrl: string;
}

export interface SignerDescriptor {
  type: string;
  value: string;
  defaulted: boolean;
}

export interface AccountProfile {
  address: ChainAddress;
  nonce: bigint;
  balance: bigint;
  signer: SignerDescriptor;
  blockNumber: bigint;
}

export interface SignerProfile {
  address: ChainAddress;
  signer: SignerDescriptor;
  blockNumber: bigint;
}

export interface UnsignedTransaction {
  chainId: bigint;
  nonce: bigint;
  gas: bigint;
  to: ChainAddress;
  value: bigint;
  data?: HexString;
  from: ChainAddress;
  signerType?: "secp256k1";
}

export interface SystemAction {
  action: string;
  payload?: Record<string, unknown>;
}

export interface SignedTransaction extends UnsignedTransaction {
  signHash: HexString;
  rawTransaction: HexString;
  transactionHash: HexString;
  v: bigint;
  r: bigint;
  s: bigint;
}

export interface PaymentEnvelope {
  x402Version: number;
  scheme: "exact";
  network: string;
  payload: {
    rawTransaction: HexString;
  };
}

export interface X402Requirement {
  scheme: "exact";
  network: string;
  maxAmountRequired: string;
  payToAddress: ChainAddress;
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

function encodeUnsignedPayload(tx: UnsignedTransaction): Uint8Array {
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

function encodeSignedPayload(tx: SignedTransaction): Uint8Array {
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

export function formatNetwork(chainId: bigint | number): string {
  const value = typeof chainId === "number" ? BigInt(chainId) : chainId;
  return `tos:${value.toString()}`;
}

export function parseAmount(amount: string): bigint {
  return parseUnits(amount, 18);
}

export class ChainRpcClient {
  private readonly rpcUrl: string;
  private nextId = 1;

  constructor(options: ChainRpcClientOptions) {
    this.rpcUrl = options.rpcUrl;
  }

  async call<T>(method: string, params: unknown[] = []): Promise<T> {
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
      throw new ChainRpcError(
        `TOS RPC ${method} error ${body.error.code}: ${body.error.message}`,
        body.error.code,
      );
    }
    return body.result;
  }

  async getChainId(): Promise<bigint> {
    return parseHexQuantity(await this.call<string>("tos_chainId", []));
  }

  async getBalance(
    address: ChainAddress,
    blockTag: string = "latest",
  ): Promise<bigint> {
    return parseHexQuantity(
      await this.call<string>("tos_getBalance", [
        normalizeAddress(address),
        blockTag,
      ]),
    );
  }

  async getTransactionCount(
    address: ChainAddress,
    blockTag: string = "pending",
  ): Promise<bigint> {
    return parseHexQuantity(
      await this.call<string>("tos_getTransactionCount", [
        normalizeAddress(address),
        blockTag,
      ]),
    );
  }

  async sendRawTransaction(rawTransaction: HexString): Promise<HexString> {
    return await this.call<HexString>("tos_sendRawTransaction", [
      rawTransaction,
    ]);
  }

  async getTransactionReceipt(
    txHash: HexString,
  ): Promise<Record<string, unknown> | null> {
    return await this.call<Record<string, unknown> | null>(
      "tos_getTransactionReceipt",
      [txHash],
    );
  }

  async getTransactionByHash(
    txHash: HexString,
  ): Promise<Record<string, unknown> | null> {
    return await this.call<Record<string, unknown> | null>(
      "tos_getTransactionByHash",
      [txHash],
    );
  }

  async getAccount(
    address: ChainAddress,
    blockTag: string = "latest",
  ): Promise<AccountProfile> {
    const raw = await this.call<{
      address: ChainAddress;
      nonce: string;
      balance: string;
      signer: SignerDescriptor;
      blockNumber: string;
    }>("tos_getAccount", [normalizeAddress(address), blockTag]);
    return {
      address: normalizeAddress(raw.address),
      nonce: parseHexQuantity(raw.nonce),
      balance: parseHexQuantity(raw.balance),
      signer: raw.signer,
      blockNumber: parseHexQuantity(raw.blockNumber),
    };
  }

  async getSigner(
    address: ChainAddress,
    blockTag: string = "latest",
  ): Promise<SignerProfile> {
    const raw = await this.call<{
      address: ChainAddress;
      signer: SignerDescriptor;
      blockNumber: string;
    }>("tos_getSigner", [normalizeAddress(address), blockTag]);
    return {
      address: normalizeAddress(raw.address),
      signer: raw.signer,
      blockNumber: parseHexQuantity(raw.blockNumber),
    };
  }

  async listPersonalAccounts(): Promise<ChainAddress[]> {
    const accounts = await this.call<string[]>("personal_listAccounts", []);
    return accounts.map((entry) => normalizeAddress(entry));
  }

  async listAccounts(): Promise<ChainAddress[]> {
    const accounts = await this.call<string[]>("tos_accounts", []);
    return accounts.map((entry) => normalizeAddress(entry));
  }

  async sendManagedTransaction(params: {
    from: ChainAddress;
    to: ChainAddress;
    value: bigint;
    gas?: bigint;
    data?: HexString;
    signerType?: string;
  }): Promise<HexString> {
    return this.call<HexString>("tos_sendTransaction", [
      {
        from: normalizeAddress(params.from),
        to: normalizeAddress(params.to),
        value: `0x${params.value.toString(16)}`,
        gas: `0x${(params.gas ?? 21_000n).toString(16)}`,
        ...(params.data ? { data: params.data } : {}),
        ...(params.signerType ? { signerType: params.signerType } : {}),
      },
    ]);
  }

  async sendPersonalTransaction(params: {
    from: ChainAddress;
    to: ChainAddress;
    value: bigint;
    gas?: bigint;
    data?: HexString;
    password?: string;
    signerType?: string;
  }): Promise<HexString> {
    return this.call<HexString>("personal_sendTransaction", [
      {
        from: normalizeAddress(params.from),
        to: normalizeAddress(params.to),
        value: `0x${params.value.toString(16)}`,
        gas: `0x${(params.gas ?? 21_000n).toString(16)}`,
        ...(params.data ? { data: params.data } : {}),
        ...(params.signerType ? { signerType: params.signerType } : {}),
      },
      params.password ?? "",
    ]);
  }
}

export async function signNativeTransfer(
  privateKey: HexString,
  tx: Omit<UnsignedTransaction, "from" | "signerType"> & {
    from?: ChainAddress;
    signerType?: "secp256k1";
  },
): Promise<SignedTransaction> {
  const from = tx.from ?? deriveAddressFromPrivateKey(privateKey);
  const normalizedTx: UnsignedTransaction = {
    ...tx,
    to: normalizeAddress(tx.to),
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

  const signed: SignedTransaction = {
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

export async function sendNativeTransfer(params: {
  rpcUrl: string;
  privateKey: HexString;
  to: ChainAddress | string;
  amountTomi: bigint;
  gas?: bigint;
  data?: HexString;
  waitForReceipt?: boolean;
  receiptTimeoutMs?: number;
  pollIntervalMs?: number;
}): Promise<{
  signed: SignedTransaction;
  txHash: HexString;
  receipt?: Record<string, unknown> | null;
}> {
  const client = new ChainRpcClient({ rpcUrl: params.rpcUrl });
  const from = deriveAddressFromPrivateKey(params.privateKey);
  const [chainId, nonce] = await Promise.all([
    client.getChainId(),
    client.getTransactionCount(from, "pending"),
  ]);

  const signed = await signNativeTransfer(params.privateKey, {
    chainId,
    nonce,
    gas: params.gas ?? 21_000n,
    to: normalizeAddress(params.to),
    value: params.amountTomi,
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

export async function sendSystemAction(params: {
  rpcUrl: string;
  privateKey: HexString;
  action: string;
  payload?: Record<string, unknown>;
  gas?: bigint;
  waitForReceipt?: boolean;
  receiptTimeoutMs?: number;
  pollIntervalMs?: number;
}): Promise<{
  signed: SignedTransaction;
  txHash: HexString;
  receipt?: Record<string, unknown> | null;
}> {
  const body: SystemAction = {
    action: params.action,
    ...(params.payload ? { payload: params.payload } : {}),
  };
  return sendNativeTransfer({
    rpcUrl: params.rpcUrl,
    privateKey: params.privateKey,
    to: SYSTEM_ACTION_ADDRESS,
    amountTomi: 0n,
    gas: params.gas ?? 120_000n,
    data: utf8ToHex(JSON.stringify(body)),
    waitForReceipt: params.waitForReceipt,
    receiptTimeoutMs: params.receiptTimeoutMs,
    pollIntervalMs: params.pollIntervalMs,
  });
}

export async function recordReputationScore(params: {
  rpcUrl: string;
  privateKey: HexString;
  who: ChainAddress | string;
  delta: string;
  reason: string;
  refId: string;
  gas?: bigint;
  waitForReceipt?: boolean;
  receiptTimeoutMs?: number;
  pollIntervalMs?: number;
}): Promise<{
  signed: SignedTransaction;
  txHash: HexString;
  receipt?: Record<string, unknown> | null;
}> {
  return sendSystemAction({
    rpcUrl: params.rpcUrl,
    privateKey: params.privateKey,
    action: "REPUTATION_RECORD_SCORE",
    payload: {
      who: normalizeAddress(params.who),
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

export async function setSignerMetadata(params: {
  rpcUrl: string;
  privateKey: HexString;
  signerType: string;
  signerValue: string;
  gas?: bigint;
  waitForReceipt?: boolean;
  receiptTimeoutMs?: number;
  pollIntervalMs?: number;
}): Promise<{
  signed: SignedTransaction;
  txHash: HexString;
  receipt?: Record<string, unknown> | null;
}> {
  return sendSystemAction({
    rpcUrl: params.rpcUrl,
    privateKey: params.privateKey,
    action: "ACCOUNT_SET_SIGNER",
    payload: {
      signerType: params.signerType,
      signerValue: params.signerValue,
    },
    gas: params.gas,
    waitForReceipt: params.waitForReceipt,
    receiptTimeoutMs: params.receiptTimeoutMs,
    pollIntervalMs: params.pollIntervalMs,
  });
}

export async function registerCapabilityName(params: {
  rpcUrl: string;
  privateKey: HexString;
  name: string;
  gas?: bigint;
  waitForReceipt?: boolean;
  receiptTimeoutMs?: number;
  pollIntervalMs?: number;
}): Promise<{
  signed: SignedTransaction;
  txHash: HexString;
  receipt?: Record<string, unknown> | null;
}> {
  return sendSystemAction({
    rpcUrl: params.rpcUrl,
    privateKey: params.privateKey,
    action: "CAPABILITY_REGISTER",
    payload: {
      name: params.name.trim().toLowerCase(),
    },
    gas: params.gas,
    waitForReceipt: params.waitForReceipt,
    receiptTimeoutMs: params.receiptTimeoutMs,
    pollIntervalMs: params.pollIntervalMs,
  });
}

export async function grantCapability(params: {
  rpcUrl: string;
  privateKey: HexString;
  target: ChainAddress | string;
  bit: number;
  gas?: bigint;
  waitForReceipt?: boolean;
  receiptTimeoutMs?: number;
  pollIntervalMs?: number;
}): Promise<{
  signed: SignedTransaction;
  txHash: HexString;
  receipt?: Record<string, unknown> | null;
}> {
  return sendSystemAction({
    rpcUrl: params.rpcUrl,
    privateKey: params.privateKey,
    action: "CAPABILITY_GRANT",
    payload: {
      target: normalizeAddress(params.target),
      bit: params.bit,
    },
    gas: params.gas,
    waitForReceipt: params.waitForReceipt,
    receiptTimeoutMs: params.receiptTimeoutMs,
    pollIntervalMs: params.pollIntervalMs,
  });
}

export async function buildX402Payment(params: {
  privateKey: HexString;
  requirement: X402Requirement;
  rpcUrl: string;
  gas?: bigint;
}): Promise<PaymentEnvelope> {
  const value = BigInt(params.requirement.maxAmountRequired);
  const client = new ChainRpcClient({ rpcUrl: params.rpcUrl });
  const from = deriveAddressFromPrivateKey(params.privateKey);
  const [chainId, nonce] = await Promise.all([
    client.getChainId(),
    client.getTransactionCount(from, "pending"),
  ]);
  const requiredChainId = parseChainIdFromNetwork(params.requirement.network);
  if (chainId !== requiredChainId) {
    throw new Error(
      `TOS x402 network mismatch: wallet RPC is ${formatNetwork(chainId)} but requirement expects ${params.requirement.network}`,
    );
  }

  const signed = await signNativeTransfer(params.privateKey, {
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

export function encodeX402PaymentHeader(
  envelope: PaymentEnvelope,
): string {
  return Buffer.from(JSON.stringify(envelope)).toString("base64");
}

export function getAddressFromAccount(
  _account: PrivateKeyAccount,
  privateKey: HexString,
): ChainAddress {
  return deriveAddressFromPrivateKey(privateKey);
}
