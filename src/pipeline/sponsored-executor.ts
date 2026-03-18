/**
 * Sponsored Chain Executor
 *
 * GTOS 2046: Specialized executor for sponsored (gasless) transactions.
 * Wraps the RPCChainExecutor to automatically request sponsor authorization
 * from a paymaster provider and attach sponsor fields to the transaction.
 */

import type { ChainExecutor } from "./executor.js";
import type { ChainReceiptData } from "../intent/receipt.js";
import { RPCChainExecutor } from "./chain-executor.js";
import { sanitizeRPCUrl } from "./validation.js";

export interface SponsorConfig {
  /** Address of the sponsor paying gas fees. */
  sponsorAddress: string;
  /** Policy hash the sponsor operates under. */
  sponsorPolicyHash: string;
  /** Paymaster provider URL for authorization requests. */
  paymasterUrl: string;
}

/**
 * Request sponsor authorization from the paymaster service.
 * Returns a sponsor signature/token if approved, or throws on denial.
 */
async function requestSponsorAuthorization(
  paymasterUrl: string,
  params: {
    from: string;
    to: string;
    value: string;
    data?: string;
    gasLimit?: number;
    sponsorAddress: string;
    policyHash: string;
    intentMetadata?: Record<string, string>;
  },
  fetchImpl: typeof globalThis.fetch = globalThis.fetch,
): Promise<{
  approved: boolean;
  sponsorSignature?: string;
  sponsorNonce?: string;
  expiresAt?: number;
}> {
  // Safely join URL path to prevent path traversal
  const baseUrl = new URL(paymasterUrl);
  baseUrl.pathname = baseUrl.pathname.replace(/\/+$/, "") + "/authorize";
  const response = await fetchImpl(baseUrl.toString(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sponsor: params.sponsorAddress,
      policyHash: params.policyHash,
      transaction: {
        from: params.from,
        to: params.to,
        value: params.value,
        data: params.data,
        gasLimit: params.gasLimit,
      },
      metadata: params.intentMetadata,
    }),
  });

  if (!response.ok) {
    throw new Error(
      `Paymaster authorization failed: ${response.status} ${response.statusText}`,
    );
  }

  return (await response.json()) as {
    approved: boolean;
    sponsorSignature?: string;
    sponsorNonce?: string;
    expiresAt?: number;
  };
}

export class SponsoredChainExecutor {
  private baseExecutor: RPCChainExecutor;
  private sponsorConfig: SponsorConfig;
  private fetchImpl: typeof globalThis.fetch;

  constructor(
    baseExecutor: RPCChainExecutor,
    sponsorConfig: SponsorConfig,
    fetchImpl?: typeof globalThis.fetch,
  ) {
    // Validate paymaster URL to prevent SSRF
    sponsorConfig.paymasterUrl = sanitizeRPCUrl(sponsorConfig.paymasterUrl);
    this.baseExecutor = baseExecutor;
    this.sponsorConfig = sponsorConfig;
    this.fetchImpl = fetchImpl ?? globalThis.fetch;
  }

  /**
   * Create a ChainExecutor function compatible with the IntentPipeline.
   */
  toChainExecutor(): ChainExecutor {
    return async (params) => {
      return this.execute({
        from: params.requester,
        to: params.target,
        value: params.value,
        data: params.data,
        sponsorAddress: params.sponsor?.sponsorAddress,
        sponsorPolicyHash: params.sponsor?.policyHash,
        intentMetadata: params.metadata,
      });
    };
  }

  /**
   * Execute a sponsored transaction.
   *
   * Steps:
   *   1. Request sponsor authorization from paymaster
   *   2. Build sponsored tx with sponsor signature
   *   3. Submit via base executor
   *   4. Return result with sponsor attribution
   */
  async execute(params: {
    from: string;
    to: string;
    value: string;
    data?: string;
    gasLimit?: number;
    sponsorAddress?: string;
    sponsorPolicyHash?: string;
    intentMetadata?: Record<string, string>;
  }): Promise<ChainReceiptData> {
    const sponsorAddress = params.sponsorAddress ?? this.sponsorConfig.sponsorAddress;
    const sponsorPolicyHash = params.sponsorPolicyHash ?? this.sponsorConfig.sponsorPolicyHash;

    // 1. Request sponsor authorization
    const authorization = await requestSponsorAuthorization(
      this.sponsorConfig.paymasterUrl,
      {
        from: params.from,
        to: params.to,
        value: params.value,
        data: params.data,
        gasLimit: params.gasLimit,
        sponsorAddress,
        policyHash: sponsorPolicyHash,
        intentMetadata: params.intentMetadata,
      },
      this.fetchImpl,
    );

    if (!authorization.approved) {
      return {
        txHash: "0x" + "0".repeat(64),
        blockNumber: 0,
        blockHash: "0x" + "0".repeat(64),
        from: params.from,
        to: params.to,
        gasUsed: 0,
        value: params.value,
        status: "failed",
      };
    }

    // 2-3. Submit via base executor with sponsor fields and authorization data.
    // The sponsor authorization fields (signature, nonce, expiry) are passed as
    // intent metadata so they flow through to the tos_sendTransaction call's
    // transaction object, where the node can verify the sponsor's authorization.
    const result = await this.baseExecutor.execute({
      from: params.from,
      to: params.to,
      value: params.value,
      data: params.data,
      gasLimit: params.gasLimit,
      sponsor: sponsorAddress,
      policyHash: sponsorPolicyHash,
      intentMetadata: {
        ...params.intentMetadata,
        "x-sponsor-address": sponsorAddress,
        "x-sponsor-policy": sponsorPolicyHash,
        ...(authorization.sponsorSignature
          ? { "x-sponsor-signature": authorization.sponsorSignature }
          : {}),
        ...(authorization.sponsorNonce
          ? { "x-sponsor-nonce": authorization.sponsorNonce }
          : {}),
        ...(authorization.expiresAt
          ? { "x-sponsor-expiry": String(authorization.expiresAt) }
          : {}),
      },
    });

    return result;
  }
}
