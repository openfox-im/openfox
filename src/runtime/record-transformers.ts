/**
 * Record transformation utilities for paymaster data.
 */
import { normalizeAddress } from "../chain/address.js";
import type {
  PaymasterQuoteRecord,
  PaymasterAuthorizationRecord,
} from "../types.js";

export function toPaymasterQuoteRecord(body: Record<string, unknown>): PaymasterQuoteRecord {
  const now = new Date().toISOString();
  return {
    quoteId: String(body.quote_id),
    chainId: String(body.chain_id ?? "0"),
    providerAddress: normalizeAddress(String(body.provider_address)),
    sponsorAddress: normalizeAddress(String(body.sponsor_address)),
    sponsorSignerType: String(body.sponsor_signer_type ?? "secp256k1"),
    walletAddress: normalizeAddress(String(body.wallet_address)),
    requesterAddress: normalizeAddress(String(body.requester_address)),
    requesterSignerType: String(body.requester_signer_type ?? "secp256k1"),
    targetAddress: normalizeAddress(String(body.target_address)),
    valueTomi: String(body.value_tomi ?? "0"),
    dataHex: String(body.data_hex ?? "0x") as `0x${string}`,
    gas: String(body.gas ?? "0"),
    policyId: String(body.policy_id ?? ""),
    policyHash: String(body.policy_hash ?? "0x") as `0x${string}`,
    scopeHash: String(body.scope_hash ?? "0x") as `0x${string}`,
    delegateIdentity:
      typeof body.delegate_identity === "string" ? body.delegate_identity : null,
    trustTier: String(body.trust_tier ?? "self_hosted") as PaymasterQuoteRecord["trustTier"],
    amountTomi: String(body.amount_tomi ?? "0"),
    sponsorNonce: String(body.sponsor_nonce ?? "0"),
    sponsorExpiry: Number(body.sponsor_expiry ?? 0),
    status: String(body.status === "quoted" ? "quoted" : "quoted") as PaymasterQuoteRecord["status"],
    expiresAt: typeof body.expires_at === "string" ? body.expires_at : now,
    createdAt: now,
    updatedAt: now,
  };
}

export function toPaymasterAuthorizationRecord(
  body: Record<string, unknown>,
  quote: PaymasterQuoteRecord,
): PaymasterAuthorizationRecord {
  const now = new Date().toISOString();
  return {
    authorizationId: String(body.authorization_id),
    quoteId: String(body.quote_id ?? quote.quoteId),
    chainId: String(body.chain_id ?? quote.chainId),
    requestKey: String(body.request_key ?? ""),
    requestHash: String(body.request_hash ?? "0x") as `0x${string}`,
    providerAddress: normalizeAddress(String(body.provider_address ?? quote.providerAddress)),
    sponsorAddress: normalizeAddress(String(body.sponsor_address ?? quote.sponsorAddress)),
    sponsorSignerType: String(
      body.sponsor_signer_type ?? quote.sponsorSignerType ?? "secp256k1",
    ),
    walletAddress: normalizeAddress(String(body.wallet_address ?? quote.walletAddress)),
    requesterAddress: normalizeAddress(
      String(body.requester_address ?? quote.requesterAddress),
    ),
    requesterSignerType: String(
      body.requester_signer_type ?? quote.requesterSignerType ?? "secp256k1",
    ),
    targetAddress: normalizeAddress(String(body.target_address ?? quote.targetAddress)),
    valueTomi: String(body.value_tomi ?? quote.valueTomi),
    dataHex: String(body.data_hex ?? quote.dataHex) as `0x${string}`,
    gas: String(body.gas ?? quote.gas),
    policyId: String(body.policy_id ?? quote.policyId),
    policyHash: String(body.policy_hash ?? quote.policyHash) as `0x${string}`,
    scopeHash: String(body.scope_hash ?? quote.scopeHash) as `0x${string}`,
    delegateIdentity:
      typeof body.delegate_identity === "string"
        ? body.delegate_identity
        : quote.delegateIdentity ?? null,
    trustTier: String(body.trust_tier ?? quote.trustTier) as PaymasterAuthorizationRecord["trustTier"],
    requestNonce: String(body.request_nonce ?? ""),
    requestExpiresAt: Number(body.request_expires_at ?? 0),
    executionNonce: String(body.execution_nonce ?? "0"),
    sponsorNonce: String(body.sponsor_nonce ?? quote.sponsorNonce),
    sponsorExpiry: Number(body.sponsor_expiry ?? quote.sponsorExpiry),
    reason: typeof body.reason === "string" ? body.reason : null,
    paymentId:
      typeof body.payment_id === "string" ? (body.payment_id as `0x${string}`) : null,
    executionSignature: null,
    sponsorSignature: null,
    submittedTxHash:
      typeof body.tx_hash === "string" ? (body.tx_hash as `0x${string}`) : null,
    submittedReceipt:
      body.receipt && typeof body.receipt === "object"
        ? (body.receipt as Record<string, unknown>)
        : null,
    receiptHash:
      typeof body.receipt_hash === "string" ? (body.receipt_hash as `0x${string}`) : null,
    status:
      body.status === "pending"
        ? "submitted"
        : body.status === "ok"
          ? "confirmed"
          : body.status === "expired"
            ? "expired"
            : "rejected",
    lastError:
      typeof body.last_error === "string"
        ? body.last_error
        : typeof body.reason === "string"
          ? body.reason
          : null,
    createdAt: now,
    updatedAt: now,
  };
}
