import { getPublicKey } from "@noble/secp256k1";
import { keccak256, toHex } from "tosdk";

export type TOSAddress = `0x${string}`;
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

export function normalizeTOSAddress(value: string): TOSAddress {
  const normalized = strip0x(value).toLowerCase();
  if (!/^[0-9a-f]*$/.test(normalized)) {
    throw new Error(`Invalid TOS address: ${value}`);
  }
  if (normalized.length > 64) {
    return `0x${normalized.slice(-64)}` as TOSAddress;
  }
  return `0x${normalized.padStart(64, "0")}` as TOSAddress;
}

export function deriveTOSAddressFromPrivateKey(privateKey: HexString): TOSAddress {
  const pubkey = getPublicKey(strip0x(privateKey), false);
  return deriveTOSAddressFromPublicKey(pubkey);
}

export function deriveTOSAddressFromPublicKey(publicKey: Uint8Array): TOSAddress {
  const uncompressed =
    publicKey.length === 65 && publicKey[0] === 0x04 ? publicKey.slice(1) : publicKey;
  const digest = keccak256(bytesToHex(uncompressed));
  return normalizeTOSAddress(digest);
}

export function isTOSAddress(value: string): value is TOSAddress {
  return /^0x[0-9a-fA-F]{64}$/.test(value);
}

export function tosAddressBytes(address: TOSAddress): Uint8Array {
  return hexToBytes(address);
}
