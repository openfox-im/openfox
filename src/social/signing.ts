/**
 * Social Signing Module
 *
 * THE SINGLE canonical signing implementation for both runtime + CLI.
 * Uses ECDSA secp256k1 via viem's account.signMessage().
 *
 * Phase 3.2: Social & Registry Hardening (S-P0-1)
 */

import {
  type PrivateKeyAccount,
  keccak256,
  toBytes,
} from "tosdk";
import type { SignedMessagePayload } from "../types.js";

export const MESSAGE_LIMITS = {
  maxContentLength: 64_000, // 64KB
  maxTotalSize: 128_000, // 128KB
  replayWindowMs: 300_000, // 5 minutes
  maxOutboundPerHour: 100,
} as const;

/**
 * Sign a send message payload.
 *
 * Canonical format: OpenFox:send:{to_lowercase}:{keccak256(toBytes(content))}:{signed_at_iso}
 */
export async function signSendPayload(
  account: PrivateKeyAccount,
  to: string,
  content: string,
  replyTo?: string,
): Promise<SignedMessagePayload> {
  if (content.length > MESSAGE_LIMITS.maxContentLength) {
    throw new Error(
      `Message content too long: ${content.length} bytes (max ${MESSAGE_LIMITS.maxContentLength})`,
    );
  }

  const signedAt = new Date().toISOString();
  const contentHash = keccak256(toBytes(content));
  const canonical = `OpenFox:send:${to.toLowerCase()}:${contentHash}:${signedAt}`;
  const signature = await account.signMessage({ message: canonical });

  return {
    from: account.address.toLowerCase(),
    to: to.toLowerCase(),
    content,
    signed_at: signedAt,
    signature,
    reply_to: replyTo,
  };
}

/**
 * Sign a poll payload.
 *
 * Canonical format: OpenFox:poll:{address_lowercase}:{timestamp_iso}
 */
export async function signPollPayload(
  account: PrivateKeyAccount,
): Promise<{ address: string; signature: string; timestamp: string }> {
  const timestamp = new Date().toISOString();
  const canonical = `OpenFox:poll:${account.address.toLowerCase()}:${timestamp}`;
  const signature = await account.signMessage({ message: canonical });

  return {
    address: account.address.toLowerCase(),
    signature,
    timestamp,
  };
}
