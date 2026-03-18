import type { OpenFoxDatabase } from "../types.js";

export const MAX_REQUEST_TTL_SECONDS = 900;

export function replayKey(
  scope: string,
  requesterIdentity: string,
  capability: string,
  nonce: string,
): string {
  return `agent_discovery:${scope}:nonce:${requesterIdentity.toLowerCase()}:${capability.toLowerCase()}:${nonce}`;
}

export function normalizeNonce(value: string): string {
  const nonce = value.trim().toLowerCase();
  if (!/^[a-z0-9:_-]{8,128}$/.test(nonce)) {
    throw new Error("request_nonce must be 8-128 chars of [a-z0-9:_-]");
  }
  return nonce;
}

export function validateRequestExpiry(requestExpiresAt: number, now = Math.floor(Date.now() / 1000)): void {
  if (!Number.isInteger(requestExpiresAt) || requestExpiresAt <= now) {
    throw new Error("request_expires_at must be a future unix timestamp");
  }
  if (requestExpiresAt > now + MAX_REQUEST_TTL_SECONDS) {
    throw new Error(`request_expires_at exceeds max ttl of ${MAX_REQUEST_TTL_SECONDS}s`);
  }
}

export function ensureRequestNotReplayed(params: {
  db: OpenFoxDatabase;
  scope: string;
  requesterIdentity: string;
  capability: string;
  nonce: string;
}): void {
  const key = replayKey(params.scope, params.requesterIdentity, params.capability, params.nonce);
  if (params.db.getKV(key)) {
    throw new Error("duplicate request nonce");
  }
}

export function recordRequestNonce(params: {
  db: OpenFoxDatabase;
  scope: string;
  requesterIdentity: string;
  capability: string;
  nonce: string;
  expiresAt: number;
}): void {
  const key = replayKey(params.scope, params.requesterIdentity, params.capability, params.nonce);
  params.db.setKV(key, JSON.stringify({ expiresAt: params.expiresAt }));
}
