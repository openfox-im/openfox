import {
  createPublicClient,
  createWalletClient,
  http,
  type Hex,
  type PrivateKeyAccount,
  type Signature,
} from "tosdk";
import type { Address } from "tosdk";
import { x402Fetch } from "../runtime/x402.js";
import type { PaymasterQuoteRecord } from "../types.js";

export interface RemotePaymasterQuoteInput {
  providerBaseUrl: string;
  requesterAddress: Address;
  walletAddress?: Address;
  target: Address;
  valueWei?: string;
  data?: `0x${string}`;
  gas?: string;
  reason?: string;
}

export interface RemotePaymasterAuthorizeInput {
  providerBaseUrl: string;
  rpcUrl: string;
  account: PrivateKeyAccount;
  requesterAddress: Address;
  quote: PaymasterQuoteRecord;
  requestNonce: string;
  requestExpiresAt: number;
  reason?: string;
}

function buildBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

export async function fetchPaymasterQuote(
  input: RemotePaymasterQuoteInput,
): Promise<Record<string, unknown>> {
  const response = await fetch(`${buildBaseUrl(input.providerBaseUrl)}/quote`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      requester: {
        identity: {
          kind: "tos",
          value: input.requesterAddress,
        },
      },
      wallet_address: input.walletAddress ?? input.requesterAddress,
      target: input.target,
      value_wei: input.valueWei ?? "0",
      ...(input.data ? { data: input.data } : {}),
      ...(input.gas ? { gas: input.gas } : {}),
      ...(input.reason ? { reason: input.reason } : {}),
    }),
  });
  const body = (await response.json()) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(`paymaster quote failed: ${response.status} ${JSON.stringify(body)}`);
  }
  return body;
}

export async function authorizePaymasterExecution(
  input: RemotePaymasterAuthorizeInput,
): Promise<{
  status?: number;
  body: Record<string, unknown>;
}> {
  const publicClient = createPublicClient({
    transport: http(input.rpcUrl),
  });
  const walletClient = createWalletClient({
    account: input.account,
    transport: http(input.rpcUrl),
  });
  const executionNonce = await publicClient.getTransactionCount({
    address: input.quote.walletAddress,
    blockTag: "pending",
  });
  const chainId = await publicClient.getChainId();
  const executionSignature = await walletClient.signSponsoredExecution({
    account: input.account,
    chainId,
    nonce: executionNonce,
    gas: BigInt(input.quote.gas),
    to: input.quote.targetAddress,
    value: BigInt(input.quote.valueWei),
    data: input.quote.dataHex,
    from: input.quote.walletAddress,
    sponsor: input.quote.sponsorAddress,
    sponsorNonce: BigInt(input.quote.sponsorNonce),
    sponsorExpiry: BigInt(input.quote.sponsorExpiry),
    sponsorPolicyHash: input.quote.policyHash,
  });

  const response = await x402Fetch(
    `${buildBaseUrl(input.providerBaseUrl)}/authorize`,
    input.account,
    "POST",
    JSON.stringify({
      quote_id: input.quote.quoteId,
      requester: {
        identity: {
          kind: "tos",
          value: input.requesterAddress,
        },
      },
      wallet_address: input.quote.walletAddress,
      request_nonce: input.requestNonce,
      request_expires_at: input.requestExpiresAt,
      execution_nonce: executionNonce.toString(),
      target: input.quote.targetAddress,
      value_wei: input.quote.valueWei,
      data: input.quote.dataHex,
      gas: input.quote.gas,
      execution_signature: executionSignature,
      ...(input.reason ? { reason: input.reason } : {}),
    }),
    { "x-openfox-rpc-url": input.rpcUrl },
  );

  return {
    status: response.status,
    body: (response.response ?? {}) as Record<string, unknown>,
  };
}

export async function fetchPaymasterAuthorizationStatus(
  providerBaseUrl: string,
  authorizationId: string,
): Promise<Record<string, unknown>> {
  const response = await fetch(
    `${buildBaseUrl(providerBaseUrl)}/status/${encodeURIComponent(authorizationId)}`,
  );
  const body = (await response.json()) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(`paymaster status failed: ${response.status} ${JSON.stringify(body)}`);
  }
  return body;
}

export async function fetchPaymasterAuthorizationReceipt(
  providerBaseUrl: string,
  authorizationId: string,
): Promise<Record<string, unknown>> {
  const response = await fetch(
    `${buildBaseUrl(providerBaseUrl)}/receipt/${encodeURIComponent(authorizationId)}`,
  );
  const body = (await response.json()) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(`paymaster receipt failed: ${response.status} ${JSON.stringify(body)}`);
  }
  return body;
}

export function normalizeExecutionSignature(
  value: unknown,
): Signature {
  if (!value || typeof value !== "object") {
    throw new Error("execution signature must be an object");
  }
  const signature = value as Record<string, unknown>;
  const r = signature.r;
  const s = signature.s;
  const yParity = signature.yParity;
  const v = signature.v;
  if (typeof r !== "string" || typeof s !== "string") {
    throw new Error("execution signature must include r and s");
  }
  if (typeof yParity !== "number" && typeof v !== "bigint" && typeof v !== "number") {
    throw new Error("execution signature must include yParity or v");
  }
  const normalizedYParity =
    typeof yParity === "number"
      ? yParity
      : Number((typeof v === "bigint" ? v : BigInt(v as number)) & 1n);
  return {
    r: r as Hex,
    s: s as Hex,
    yParity: normalizedYParity,
    ...(typeof v === "bigint" ? { v } : typeof v === "number" ? { v: BigInt(v) } : {}),
  };
}
