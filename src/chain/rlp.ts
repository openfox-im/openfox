import type { ChainAddress, HexString } from "./address.js";
import { addressBytes } from "./address.js";

function strip0x(value: string): string {
  return value.startsWith("0x") || value.startsWith("0X") ? value.slice(2) : value;
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

export function bigintToMinimalBytes(value: bigint): Uint8Array {
  if (value < 0n) {
    throw new Error(`Negative bigint not supported in RLP: ${value}`);
  }
  if (value === 0n) {
    return new Uint8Array();
  }
  let hex = value.toString(16);
  if (hex.length % 2 !== 0) {
    hex = `0${hex}`;
  }
  return hexToBytes(`0x${hex}`);
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

function bytesToNumber(bytes: Uint8Array): number {
  let value = 0;
  for (const byte of bytes) {
    value = (value << 8) | byte;
  }
  return value;
}

function encodeLength(len: number): Uint8Array {
  if (len === 0) {
    return new Uint8Array([0]);
  }
  const bytes: number[] = [];
  let current = len;
  while (current > 0) {
    bytes.unshift(current & 0xff);
    current >>= 8;
  }
  return Uint8Array.from(bytes);
}

export function encodeRlpBytes(value: Uint8Array): Uint8Array {
  if (value.length === 1 && value[0] < 0x80) {
    return value;
  }
  if (value.length <= 55) {
    return concatBytes([Uint8Array.from([0x80 + value.length]), value]);
  }
  const lenBytes = encodeLength(value.length);
  return concatBytes([Uint8Array.from([0xb7 + lenBytes.length]), lenBytes, value]);
}

export function encodeRlpList(values: Uint8Array[]): Uint8Array {
  const payload = concatBytes(values);
  if (payload.length <= 55) {
    return concatBytes([Uint8Array.from([0xc0 + payload.length]), payload]);
  }
  const lenBytes = encodeLength(payload.length);
  return concatBytes([Uint8Array.from([0xf7 + lenBytes.length]), lenBytes, payload]);
}

export function encodeRlpAddress(address?: ChainAddress | null): Uint8Array {
  if (!address) {
    return encodeRlpBytes(new Uint8Array());
  }
  return encodeRlpBytes(addressBytes(address));
}

export function encodeRlpUint(value: bigint | number): Uint8Array {
  const bigintValue = typeof value === "number" ? BigInt(value) : value;
  return encodeRlpBytes(bigintToMinimalBytes(bigintValue));
}

export function encodeRlpHex(value?: HexString): Uint8Array {
  return encodeRlpBytes(value ? hexToBytes(value) : new Uint8Array());
}

export function encodeRlpString(value: string): Uint8Array {
  return encodeRlpBytes(new TextEncoder().encode(value));
}

export interface DecodedRlpItem {
  kind: "bytes" | "list";
  data?: Uint8Array;
  items?: DecodedRlpItem[];
  consumed: number;
}

export function decodeRlpItem(input: Uint8Array, offset = 0): DecodedRlpItem {
  if (offset >= input.length) {
    throw new Error("RLP decode overflow");
  }
  const prefix = input[offset]!;
  if (prefix <= 0x7f) {
    return {
      kind: "bytes",
      data: input.slice(offset, offset + 1),
      consumed: 1,
    };
  }
  if (prefix <= 0xb7) {
    const len = prefix - 0x80;
    const start = offset + 1;
    const end = start + len;
    if (end > input.length) {
      throw new Error("RLP short bytes overflow");
    }
    return {
      kind: "bytes",
      data: input.slice(start, end),
      consumed: 1 + len,
    };
  }
  if (prefix <= 0xbf) {
    const lenOfLen = prefix - 0xb7;
    const lenStart = offset + 1;
    const lenEnd = lenStart + lenOfLen;
    if (lenEnd > input.length) {
      throw new Error("RLP long bytes length overflow");
    }
    const len = bytesToNumber(input.slice(lenStart, lenEnd));
    const start = lenEnd;
    const end = start + len;
    if (end > input.length) {
      throw new Error("RLP long bytes overflow");
    }
    return {
      kind: "bytes",
      data: input.slice(start, end),
      consumed: 1 + lenOfLen + len,
    };
  }
  if (prefix <= 0xf7) {
    const len = prefix - 0xc0;
    const start = offset + 1;
    const end = start + len;
    if (end > input.length) {
      throw new Error("RLP short list overflow");
    }
    const items: DecodedRlpItem[] = [];
    let cursor = start;
    while (cursor < end) {
      const item = decodeRlpItem(input, cursor);
      items.push(item);
      cursor += item.consumed;
    }
    if (cursor !== end) {
      throw new Error("RLP short list trailing bytes");
    }
    return {
      kind: "list",
      items,
      consumed: 1 + len,
    };
  }
  const lenOfLen = prefix - 0xf7;
  const lenStart = offset + 1;
  const lenEnd = lenStart + lenOfLen;
  if (lenEnd > input.length) {
    throw new Error("RLP long list length overflow");
  }
  const len = bytesToNumber(input.slice(lenStart, lenEnd));
  const start = lenEnd;
  const end = start + len;
  if (end > input.length) {
    throw new Error("RLP long list overflow");
  }
  const items: DecodedRlpItem[] = [];
  let cursor = start;
  while (cursor < end) {
    const item = decodeRlpItem(input, cursor);
    items.push(item);
    cursor += item.consumed;
  }
  if (cursor !== end) {
    throw new Error("RLP long list trailing bytes");
  }
  return {
    kind: "list",
    items,
    consumed: 1 + lenOfLen + len,
  };
}
