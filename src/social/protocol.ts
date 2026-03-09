/**
 * Unified Signed Message Protocol
 *
 * Defines the signed message interface and utilities for message creation
 * and verification using ECDSA secp256k1.
 *
 * Phase 3.2: Social & Registry Hardening
 */

import crypto from "crypto";
import { ulid } from "ulid";
import {
  keccak256,
  toBytes,
  verifyMessage,
} from "tosdk";

/**
 * A fully signed social message.
 */
export interface SignedMessage {
  id: string;
  from: string;
  to: string;
  content: string;
  timestamp: string;
  nonce: string;
  signature: string;
}

/**
 * Create a unique message ID using ULID.
 */
export function createMessageId(): string {
  return ulid();
}

/**
 * Create a cryptographically random nonce for replay protection.
 */
export function createNonce(): string {
  return crypto.randomBytes(16).toString("hex");
}

/**
 * Verify an ECDSA secp256k1 message signature.
 *
 * Reconstructs the canonical string used during signing and verifies
 * the signature against the expected sender address.
 */
export async function verifyMessageSignature(
  message: { to: string; content: string; signed_at: string; signature: string },
  expectedFrom: string,
): Promise<boolean> {
  try {
    const contentHash = keccak256(toBytes(message.content));
    const canonical = `OpenFox:send:${message.to.toLowerCase()}:${contentHash}:${message.signed_at}`;

    const valid = await verifyMessage({
      address: expectedFrom as `0x${string}`,
      message: canonical,
      signature: message.signature as `0x${string}`,
    });

    return valid;
  } catch {
    return false;
  }
}
