import {
  buildPaymasterAuthorizationRequest,
  createPaymasterProviderClient,
  createPublicClient,
  createWalletClient,
  http,
  type Address,
  type Hex,
  type Signature,
} from "@tosnetwork/tosdk";
import type { LocalAccount } from "@tosnetwork/tosdk/accounts";
import { x402Fetch } from "../runtime/x402.js";
import type { PaymasterQuoteRecord } from "../types.js";

export interface RemotePaymasterQuoteInput {
  providerBaseUrl: string;
  requesterAddress: Address;
  walletAddress?: Address;
  target: Address;
  valueTomi?: string;
  data?: `0x${string}`;
  gas?: string;
  reason?: string;
}

function buildX402ResponseAdapter(params: {
  account: LocalAccount;
  rpcUrl: string;
}) {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const headerMap: Record<string, string> = {};
    new Headers(init?.headers).forEach((value, key) => {
      headerMap[key] = value;
    });
    const response = await x402Fetch(
      String(input),
      params.account,
      init?.method || "GET",
      typeof init?.body === "string" ? init.body : undefined,
      {
        ...headerMap,
        "x-openfox-rpc-url": params.rpcUrl,
      },
      undefined,
    );
    return new Response(JSON.stringify(response.response ?? {}), {
      status: response.status ?? (response.success ? 200 : 500),
      headers: { "content-type": "application/json" },
    });
  };
}

export async function fetchPaymasterQuote(
  input: RemotePaymasterQuoteInput,
): Promise<Record<string, unknown>> {
  const client = createPaymasterProviderClient({
    baseUrl: input.providerBaseUrl,
  });
  return (await client.quote({
    requester: {
      identity: {
        kind: "tos",
        value: input.requesterAddress,
      },
    },
    wallet_address: input.walletAddress ?? input.requesterAddress,
    target: input.target,
    value_tomi: input.valueTomi ?? "0",
    ...(input.data ? { data: input.data } : {}),
    ...(input.gas ? { gas: input.gas } : {}),
    ...(input.reason ? { reason: input.reason } : {}),
  })) as unknown as Record<string, unknown>;
}

export async function authorizePaymasterExecution(
  input: RemotePaymasterAuthorizeInput,
): Promise<{
  status?: number;
  body: Record<string, unknown>;
}> {
  const sdkQuote = {
    ...input.quote,
    valueTomi: input.quote.valueTomi,
    amountTomi: input.quote.amountTomi,
  } as any;
  const authorizeRequest = await buildPaymasterAuthorizationRequest({
    rpcUrl: input.rpcUrl,
    account: input.account,
    requesterAddress: input.requesterAddress,
    quote: sdkQuote,
    requestNonce: input.requestNonce,
    requestExpiresAt: input.requestExpiresAt,
    reason: input.reason,
    publicClient: createPublicClient({
      transport: http(input.rpcUrl),
    }),
    walletClient: createWalletClient({
      account: input.account,
      transport: http(input.rpcUrl),
    }),
  });

  const client = createPaymasterProviderClient({
    baseUrl: input.providerBaseUrl,
    fetchFn: buildX402ResponseAdapter({
      account: input.account,
      rpcUrl: input.rpcUrl,
    }),
  });
  const body = await client.authorize(authorizeRequest);
  return {
    status: 200,
    body: body as unknown as Record<string, unknown>,
  };
}

export interface RemotePaymasterAuthorizeInput {
  providerBaseUrl: string;
  rpcUrl: string;
  account: LocalAccount;
  requesterAddress: Address;
  quote: PaymasterQuoteRecord;
  requestNonce: string;
  requestExpiresAt: number;
  reason?: string;
}

export async function fetchPaymasterAuthorizationStatus(
  providerBaseUrl: string,
  authorizationId: string,
): Promise<Record<string, unknown>> {
  const client = createPaymasterProviderClient({
    baseUrl: providerBaseUrl,
  });
  return (await client.status({ authorizationId })) as unknown as Record<string, unknown>;
}

export async function fetchPaymasterAuthorizationReceipt(
  providerBaseUrl: string,
  authorizationId: string,
): Promise<Record<string, unknown>> {
  const client = createPaymasterProviderClient({
    baseUrl: providerBaseUrl,
  });
  return (await client.receipt({ authorizationId })) as unknown as Record<string, unknown>;
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
