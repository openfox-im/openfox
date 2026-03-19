import { getPublicKey } from "@noble/secp256k1";
import { keccak256, toHex } from "@tosnetwork/tosdk";

export type ChainAddress = `0x${string}`;
export type HexString = `0x${string}`;

function strip0x(value: string): string {
  return value.startsWith("0x") || value.startsWith("0X") ? value.slice(2) : value;
}

function bytesToHex(bytes: Uint8Array): HexString {
  return toHex(bytes) as HexString;
}

export function hexToBytes(value: HexString): Uint8Array {
  const hex = strip0x(value);
  if (hex.length % 2 !== 0) {
    throw new Error(`Invalid hex string length: ${value}`);
  }
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

export function normalizeAddress(value: string): ChainAddress {
  const normalized = strip0x(value).toLowerCase();
  if (!/^[0-9a-f]*$/.test(normalized)) {
    throw new Error(`Invalid TOS address: ${value}`);
  }
  if (normalized.length > 64) {
    return `0x${normalized.slice(-64)}` as ChainAddress;
  }
  return `0x${normalized.padStart(64, "0")}` as ChainAddress;
}

export function deriveAddressFromPrivateKey(privateKey: HexString): ChainAddress {
  const pubkey = getPublicKey(strip0x(privateKey), false);
  return deriveAddressFromPublicKey(pubkey);
}

export function deriveAddressFromPublicKey(publicKey: Uint8Array): ChainAddress {
  const uncompressed =
    publicKey.length === 65 && publicKey[0] === 0x04 ? publicKey.slice(1) : publicKey;
  const digest = keccak256(bytesToHex(uncompressed));
  return normalizeAddress(digest);
}

export function isChainAddress(value: string): value is ChainAddress {
  return /^0x[0-9a-fA-F]{64}$/.test(value);
}

export function addressBytes(address: ChainAddress): Uint8Array {
  return hexToBytes(address);
}
