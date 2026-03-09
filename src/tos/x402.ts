import { Signature } from "@noble/secp256k1";
import { keccak256, toHex } from "tosdk";
import type { IncomingMessage, ServerResponse } from "http";
import {
  deriveTOSAddressFromPublicKey,
  hexToBytes,
  isTOSAddress,
  normalizeTOSAddress,
  type HexString,
  type TOSAddress,
} from "./address.js";
import {
  decodeRlpItem,
  encodeRlpAddress,
  encodeRlpHex,
  encodeRlpList,
  encodeRlpString,
  encodeRlpUint,
  hexToBytes as rlpHexToBytes,
} from "./rlp.js";
import { TOSRpcClient } from "./client.js";

export interface TOSPaymentRequirement {
  scheme: "exact";
  network: string;
  maxAmountRequired: string;
  payToAddress: TOSAddress;
  asset?: string;
  requiredDeadlineSeconds?: number;
  description?: string;
}

export interface TOSPaymentRequiredResponse {
  x402Version: number;
  accepts: TOSPaymentRequirement[];
}

export interface TOSPaymentEnvelope {
  x402Version: number;
  scheme: "exact";
  network: string;
  payload: {
    rawTransaction: HexString;
  };
}

export interface VerifiedTOSPayment {
  envelope: TOSPaymentEnvelope;
  rawTransaction: HexString;
  txHash: HexString;
  chainId: bigint;
  from: TOSAddress;
  to: TOSAddress;
  value: bigint;
}

interface DecodedSignerTransaction {
  chainId: bigint;
  nonce: bigint;
  gas: bigint;
  to: TOSAddress;
  value: bigint;
  data: HexString;
  from: TOSAddress;
  signerType: string;
  v: bigint;
  r: bigint;
  s: bigint;
}

function bytesToBigInt(bytes: Uint8Array | undefined): bigint {
  if (!bytes || bytes.length === 0) return 0n;
  return BigInt(`0x${Buffer.from(bytes).toString("hex")}`);
}

function bytesToHex(bytes: Uint8Array): HexString {
  return toHex(bytes) as HexString;
}

function bytesToText(bytes: Uint8Array | undefined): string {
  return bytes ? new TextDecoder().decode(bytes) : "";
}

function parseNetworkChainId(network: string): bigint {
  const normalized = network.trim().toLowerCase();
  if (!normalized.startsWith("tos:")) {
    throw new Error(`unsupported payment network ${network}`);
  }
  return BigInt(normalized.slice("tos:".length));
}

function encodeUnsignedPayload(tx: Omit<DecodedSignerTransaction, "v" | "r" | "s">): Uint8Array {
  return encodeRlpList([
    encodeRlpUint(tx.chainId),
    encodeRlpUint(tx.nonce),
    encodeRlpUint(tx.gas),
    encodeRlpAddress(tx.to),
    encodeRlpUint(tx.value),
    encodeRlpHex(tx.data),
    encodeRlpList([]),
    encodeRlpAddress(tx.from),
    encodeRlpString(tx.signerType),
  ]);
}

function decodeSignerTransaction(rawTransaction: HexString): DecodedSignerTransaction {
  const bytes = rlpHexToBytes(rawTransaction);
  if (!bytes.length || bytes[0] !== 0x00) {
    throw new Error("expected TOS signer transaction with 0x00 type prefix");
  }
  const decoded = decodeRlpItem(bytes, 1);
  if (decoded.kind !== "list" || !decoded.items || decoded.items.length !== 12) {
    throw new Error("invalid signer transaction payload");
  }
  const items = decoded.items;
  const toBytes = items[3]?.data;
  const fromBytes = items[7]?.data;
  const signerType = bytesToText(items[8]?.data);
  const to = normalizeTOSAddress(bytesToHex(toBytes ?? new Uint8Array()));
  const from = normalizeTOSAddress(bytesToHex(fromBytes ?? new Uint8Array()));

  return {
    chainId: bytesToBigInt(items[0]?.data),
    nonce: bytesToBigInt(items[1]?.data),
    gas: bytesToBigInt(items[2]?.data),
    to,
    value: bytesToBigInt(items[4]?.data),
    data: bytesToHex(items[5]?.data ?? new Uint8Array()),
    from,
    signerType,
    v: bytesToBigInt(items[9]?.data),
    r: bytesToBigInt(items[10]?.data),
    s: bytesToBigInt(items[11]?.data),
  };
}

function verifySignerTransaction(rawTransaction: HexString, tx: DecodedSignerTransaction): void {
  if (tx.signerType !== "secp256k1") {
    throw new Error(`unsupported signer type ${tx.signerType}`);
  }
  const unsignedPayload = encodeUnsignedPayload({
    chainId: tx.chainId,
    nonce: tx.nonce,
    gas: tx.gas,
    to: tx.to,
    value: tx.value,
    data: tx.data,
    from: tx.from,
    signerType: tx.signerType,
  });
  const signingPayload = new Uint8Array(1 + unsignedPayload.length);
  signingPayload[0] = 0x00;
  signingPayload.set(unsignedPayload, 1);
  const signHash = keccak256(bytesToHex(signingPayload));
  const compact = new Uint8Array(64);
  compact.set(hexToBytes(`0x${tx.r.toString(16).padStart(64, "0")}`), 0);
  compact.set(hexToBytes(`0x${tx.s.toString(16).padStart(64, "0")}`), 32);
  const recovery = Number(tx.v);
  if (!Number.isInteger(recovery) || recovery < 0 || recovery > 3) {
    throw new Error(`invalid recovery id ${tx.v.toString()}`);
  }
  const publicKey = Signature.fromCompact(compact)
    .addRecoveryBit(recovery)
    .recoverPublicKey(hexToBytes(signHash))
    .toRawBytes(false);
  const derived = deriveTOSAddressFromPublicKey(publicKey);
  if (derived !== tx.from) {
    throw new Error("signature does not match sender");
  }
  const computedHash = keccak256(rawTransaction);
  if (!computedHash || !computedHash.startsWith("0x")) {
    throw new Error("failed to compute transaction hash");
  }
}

export function encodeTOSPaymentRequiredHeader(response: TOSPaymentRequiredResponse): string {
  return Buffer.from(JSON.stringify(response)).toString("base64");
}

export function writeTOSPaymentRequired(
  res: ServerResponse,
  requirement: TOSPaymentRequirement,
): void {
  const payload: TOSPaymentRequiredResponse = {
    x402Version: 1,
    accepts: [requirement],
  };
  const encoded = encodeTOSPaymentRequiredHeader(payload);
  res.statusCode = 402;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Payment-Required", encoded);
  res.setHeader("X-Payment-Required", encoded);
  res.end(JSON.stringify(payload));
}

export function readTOSPaymentEnvelope(req: IncomingMessage): TOSPaymentEnvelope | null {
  const header = req.headers["payment-signature"] || req.headers["x-payment"];
  const value = Array.isArray(header) ? header[0] : header;
  if (!value || typeof value !== "string") {
    return null;
  }
  const decoded = Buffer.from(value, "base64").toString("utf8");
  return JSON.parse(decoded) as TOSPaymentEnvelope;
}

export function verifyTOSPayment(
  requirement: TOSPaymentRequirement,
  envelope: TOSPaymentEnvelope,
): VerifiedTOSPayment {
  if (envelope.scheme !== "exact") {
    throw new Error(`unsupported payment scheme ${envelope.scheme}`);
  }
  const requiredChainId = parseNetworkChainId(requirement.network);
  const envelopeChainId = parseNetworkChainId(envelope.network);
  if (requiredChainId !== envelopeChainId) {
    throw new Error("payment network mismatch");
  }
  const rawTransaction = envelope.payload?.rawTransaction;
  if (!rawTransaction || !rawTransaction.startsWith("0x")) {
    throw new Error("missing rawTransaction");
  }
  const tx = decodeSignerTransaction(rawTransaction);
  verifySignerTransaction(rawTransaction, tx);
  if (tx.chainId !== requiredChainId) {
    throw new Error("payment chainId mismatch");
  }
  if (!isTOSAddress(tx.to) || normalizeTOSAddress(tx.to) !== normalizeTOSAddress(requirement.payToAddress)) {
    throw new Error("payment recipient mismatch");
  }
  const requiredValue = BigInt(requirement.maxAmountRequired);
  if (tx.value < requiredValue) {
    throw new Error("payment amount is insufficient");
  }
  return {
    envelope,
    rawTransaction,
    txHash: keccak256(rawTransaction) as HexString,
    chainId: tx.chainId,
    from: tx.from,
    to: tx.to,
    value: tx.value,
  };
}

export async function submitTOSPayment(
  rpcUrl: string,
  payment: VerifiedTOSPayment,
): Promise<HexString> {
  const client = new TOSRpcClient({ rpcUrl });
  return client.sendRawTransaction(payment.rawTransaction);
}
