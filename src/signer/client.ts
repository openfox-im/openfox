import {
  createSignerProviderClient,
  type Address,
  type PrivateKeyAccount,
} from "@tosnetwork/tosdk";
import { x402Fetch } from "../runtime/x402.js";

export interface RemoteSignerQuoteInput {
  providerBaseUrl: string;
  requesterAddress: Address;
  target: Address;
  valueTomi?: string;
  data?: `0x${string}`;
  gas?: string;
  reason?: string;
}

function buildX402ResponseAdapter(params: {
  account: PrivateKeyAccount;
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

export async function fetchSignerQuote(
  input: RemoteSignerQuoteInput,
): Promise<Record<string, unknown>> {
  const client = createSignerProviderClient({
    baseUrl: input.providerBaseUrl,
  });
  return (await client.quote({
    requester: {
      identity: {
        kind: "tos",
        value: input.requesterAddress,
      },
    },
    target: input.target,
    value_tomi: input.valueTomi ?? "0",
    ...(input.data ? { data: input.data } : {}),
    ...(input.gas ? { gas: input.gas } : {}),
    ...(input.reason ? { reason: input.reason } : {}),
  })) as unknown as Record<string, unknown>;
}

export async function submitSignerExecution(params: {
  providerBaseUrl: string;
  account: PrivateKeyAccount;
  rpcUrl: string;
  requesterAddress: Address;
  quoteId: string;
  target: Address;
  valueTomi?: string;
  data?: `0x${string}`;
  gas?: string;
  requestNonce: string;
  requestExpiresAt: number;
  reason?: string;
}): Promise<{
  status?: number;
  body: Record<string, unknown>;
}> {
  const client = createSignerProviderClient({
    baseUrl: params.providerBaseUrl,
    fetchFn: buildX402ResponseAdapter({
      account: params.account,
      rpcUrl: params.rpcUrl,
    }),
  });
  const body = await client.submit({
    quote_id: params.quoteId,
    requester: {
      identity: {
        kind: "tos",
        value: params.requesterAddress,
      },
    },
    request_nonce: params.requestNonce,
    request_expires_at: params.requestExpiresAt,
    target: params.target,
    value_tomi: params.valueTomi ?? "0",
    ...(params.data ? { data: params.data } : {}),
    ...(params.gas ? { gas: params.gas } : {}),
    ...(params.reason ? { reason: params.reason } : {}),
  });
  return {
    status: 200,
    body: body as unknown as Record<string, unknown>,
  };
}

export async function fetchSignerExecutionStatus(
  providerBaseUrl: string,
  executionId: string,
): Promise<Record<string, unknown>> {
  const client = createSignerProviderClient({
    baseUrl: providerBaseUrl,
  });
  return (await client.status({ executionId })) as unknown as Record<string, unknown>;
}

export async function fetchSignerExecutionReceipt(
  providerBaseUrl: string,
  executionId: string,
): Promise<Record<string, unknown>> {
  const client = createSignerProviderClient({
    baseUrl: providerBaseUrl,
  });
  return (await client.receipt({ executionId })) as unknown as Record<string, unknown>;
}
