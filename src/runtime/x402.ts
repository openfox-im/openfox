/**
 * x402 Payment Protocol
 *
 * Enables the openfox to make USDC micropayments via HTTP 402.
 * Adapted from runtime-mcp/src/x402/index.ts
 */

import {
  createPublicClient,
  http,
  parseUnits,
  type Address,
  type PrivateKeyAccount,
} from "tosdk";
import { base, baseSepolia } from "tosdk/chains";
import { loadConfig } from "../config.js";
import { buildTOSX402Payment as buildNativePayment } from "../tos/client.js";
import { normalizeTOSAddress as normalizeAddress } from "../tos/address.js";
import { loadWalletPrivateKey } from "../identity/wallet.js";
import { ResilientHttpClient } from "./http-client.js";

const x402HttpClient = new ResilientHttpClient();

// USDC contract addresses
const USDC_ADDRESSES: Record<string, Address> = {
  "eip155:8453": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", // Base mainnet
  "eip155:84532": "0x036CbD53842c5426634e7929541eC2318f3dCF7e", // Base Sepolia
};

const CHAINS: Record<string, any> = {
  "eip155:8453": base,
  "eip155:84532": baseSepolia,
};
type NetworkId = keyof typeof USDC_ADDRESSES;
type PaymentNetworkId = NetworkId | `tos:${string}`;

const BALANCE_OF_ABI = [
  {
    inputs: [{ name: "account", type: "address" }],
    name: "balanceOf",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

interface PaymentRequirement {
  scheme: string;
  network: PaymentNetworkId;
  maxAmountRequired: string;
  payToAddress: string;
  requiredDeadlineSeconds: number;
  usdcAddress?: Address;
  asset?: string;
}

interface PaymentRequiredResponse {
  x402Version: number;
  accepts: PaymentRequirement[];
}

interface ParsedPaymentRequirement {
  x402Version: number;
  requirement: PaymentRequirement;
}

interface X402PaymentResult {
  success: boolean;
  response?: any;
  error?: string;
  status?: number;
}

export interface UsdcBalanceResult {
  balance: number;
  network: string;
  ok: boolean;
  error?: string;
}

function safeJsonParse(value: string): unknown | null {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function parsePositiveInt(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.floor(value);
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) {
      return Math.floor(parsed);
    }
  }
  return null;
}

function normalizeNetwork(raw: unknown): PaymentNetworkId | null {
  if (typeof raw !== "string") return null;
  const normalized = raw.trim().toLowerCase();
  if (normalized === "base") return "eip155:8453";
  if (normalized === "base-sepolia") return "eip155:84532";
  if (normalized === "eip155:8453" || normalized === "eip155:84532") {
    return normalized;
  }
  if (/^tos:\d+$/.test(normalized)) {
    return normalized as PaymentNetworkId;
  }
  return null;
}

function isUSDCNetwork(network: PaymentNetworkId): network is NetworkId {
  return network === "eip155:8453" || network === "eip155:84532";
}

function isTOSNetwork(network: PaymentNetworkId): network is `tos:${string}` {
  return network.startsWith("tos:");
}

function getChainRpcUrl(): string | undefined {
  const config = loadConfig();
  return process.env.TOS_RPC_URL || config?.rpcUrl;
}

function hasNativePaymentSupport(): boolean {
  return !!(loadWalletPrivateKey() && getChainRpcUrl());
}

function normalizePaymentRequirement(raw: unknown): PaymentRequirement | null {
  if (typeof raw !== "object" || raw === null) return null;
  const value = raw as Record<string, unknown>;
  const network = normalizeNetwork(value.network);
  if (!network) return null;

  const scheme = typeof value.scheme === "string" ? value.scheme : null;
  const maxAmountRequired = typeof value.maxAmountRequired === "string"
    ? value.maxAmountRequired
    : typeof value.maxAmountRequired === "number" &&
        Number.isFinite(value.maxAmountRequired)
      ? String(value.maxAmountRequired)
      : null;
  const payToAddress = typeof value.payToAddress === "string"
    ? value.payToAddress
    : typeof value.payTo === "string"
      ? value.payTo
      : null;
  const usdcAddress = typeof value.usdcAddress === "string"
    ? value.usdcAddress
    : typeof value.asset === "string" && value.asset.startsWith("0x")
      ? value.asset
      : isUSDCNetwork(network)
        ? USDC_ADDRESSES[network]
        : undefined;
  const requiredDeadlineSeconds =
    parsePositiveInt(value.requiredDeadlineSeconds) ??
    parsePositiveInt(value.maxTimeoutSeconds) ??
    300;

  if (!scheme || !maxAmountRequired || !payToAddress) {
    return null;
  }
  if (isUSDCNetwork(network) && !usdcAddress) {
    return null;
  }

  return {
    scheme,
    network,
    maxAmountRequired,
    payToAddress,
    requiredDeadlineSeconds,
    usdcAddress: usdcAddress as Address | undefined,
    asset: typeof value.asset === "string" ? value.asset : undefined,
  };
}

function normalizePaymentRequired(raw: unknown): PaymentRequiredResponse | null {
  if (typeof raw !== "object" || raw === null) return null;
  const value = raw as Record<string, unknown>;
  if (!Array.isArray(value.accepts)) return null;

  const accepts = value.accepts
    .map(normalizePaymentRequirement)
    .filter((v): v is PaymentRequirement => v !== null);
  if (!accepts.length) return null;

  const x402Version = parsePositiveInt(value.x402Version) ?? 1;
  return { x402Version, accepts };
}

function parseMaxAmountRequired(maxAmountRequired: string, x402Version: number): bigint {
  const amount = maxAmountRequired.trim();
  if (!/^\d+(\.\d+)?$/.test(amount)) {
    throw new Error(`Invalid maxAmountRequired: ${maxAmountRequired}`);
  }

  if (amount.includes(".")) {
    return parseUnits(amount, 6);
  }
  if (x402Version >= 2 || amount.length > 6) {
    return BigInt(amount);
  }
  return parseUnits(amount, 6);
}

function selectRequirement(parsed: PaymentRequiredResponse): PaymentRequirement {
  const nativeSupported = hasNativePaymentSupport();
  if (nativeSupported) {
    const exactNative = parsed.accepts.find(
      (r) => r.scheme === "exact" && isTOSNetwork(r.network),
    );
    if (exactNative) return exactNative;
  }
  const exactUSDC = parsed.accepts.find(
    (r) => r.scheme === "exact" && isUSDCNetwork(r.network),
  );
  if (exactUSDC) return exactUSDC;
  return parsed.accepts[0];
}

/**
 * Get the USDC balance for the openfox's wallet on a given network.
 */
export async function getUsdcBalance(
  address: Address,
  network: string = "eip155:8453",
): Promise<number> {
  const result = await getUsdcBalanceDetailed(address, network);
  return result.balance;
}

/**
 * Get the USDC balance and read status details for diagnostics.
 */
export async function getUsdcBalanceDetailed(
  address: Address,
  network: string = "eip155:8453",
): Promise<UsdcBalanceResult> {
  const chain = CHAINS[network];
  const usdcAddress = USDC_ADDRESSES[network];
  if (!chain || !usdcAddress) {
    return {
      balance: 0,
      network,
      ok: false,
      error: `Unsupported USDC network: ${network}`,
    };
  }

  try {
    const rpcUrl = process.env.OPENFOX_RPC_URL || undefined;
    const client = createPublicClient({
      chain,
      transport: http(rpcUrl, { timeout: 10_000 }),
    });

    const balance = await client.readContract({
      address: usdcAddress,
      abi: BALANCE_OF_ABI,
      functionName: "balanceOf",
      args: [address],
    });

    // USDC has 6 decimals
    return {
      balance: Number(balance) / 1_000_000,
      network,
      ok: true,
    };
  } catch (err: any) {
    return {
      balance: 0,
      network,
      ok: false,
      error: err?.message || String(err),
    };
  }
}

/**
 * Check if a URL requires x402 payment.
 */
export async function checkX402(
  url: string,
): Promise<PaymentRequirement | null> {
  try {
    const resp = await x402HttpClient.request(url, { method: "HEAD" });
    if (resp.status !== 402) {
      return null;
    }
    const parsed = await parsePaymentRequired(resp);
    return parsed?.requirement ?? null;
  } catch {
    return null;
  }
}

/**
 * Fetch a URL with automatic x402 payment.
 * If the endpoint returns 402, sign and pay, then retry.
 */
export async function x402Fetch(
  url: string,
  account: PrivateKeyAccount,
  method: string = "GET",
  body?: string,
  headers?: Record<string, string>,
  maxPaymentCents?: number,
): Promise<X402PaymentResult> {
  try {
    // Initial request (non-mutating probe, uses resilient client)
    const initialResp = await x402HttpClient.request(url, {
      method,
      headers: { ...headers, "Content-Type": "application/json" },
      body,
    });

    if (initialResp.status !== 402) {
      const data = await initialResp
        .json()
        .catch(() => initialResp.text());
      return { success: initialResp.ok, response: data, status: initialResp.status };
    }

    // Parse payment requirements
    const parsed = await parsePaymentRequired(initialResp);
    if (!parsed) {
      return {
        success: false,
        error: "Could not parse payment requirements",
        status: initialResp.status,
      };
    }

    // Check amount against maxPaymentCents BEFORE signing
    if (maxPaymentCents !== undefined && isUSDCNetwork(parsed.requirement.network)) {
      const amountAtomic = parseMaxAmountRequired(
        parsed.requirement.maxAmountRequired,
        parsed.x402Version,
      );
      // Convert atomic units (6 decimals) to cents (2 decimals)
      const amountCents = Number(amountAtomic) / 10_000;
      if (amountCents > maxPaymentCents) {
        return {
          success: false,
          error: `Payment of ${amountCents.toFixed(2)} cents exceeds max allowed ${maxPaymentCents} cents`,
          status: 402,
        };
      }
    }

    // Sign payment
    let payment: any;
    try {
      payment = await signPayment(
        account,
        parsed.requirement,
        parsed.x402Version,
      );
    } catch (err: any) {
      return {
        success: false,
        error: `Failed to sign payment: ${err?.message || String(err)}`,
        status: initialResp.status,
      };
    }

    // Retry with payment
    const paymentHeader = Buffer.from(
      JSON.stringify(payment),
    ).toString("base64");

    const paidResp = await x402HttpClient.request(url, {
      method,
      headers: {
        ...headers,
        "Content-Type": "application/json",
        "Payment-Signature": paymentHeader,
        "X-Payment": paymentHeader,
      },
      body,
      retries: 0, // Paid request: do not auto-retry (payment already signed)
    });

    const data = await paidResp.json().catch(() => paidResp.text());
    return { success: paidResp.ok, response: data, status: paidResp.status };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

async function parsePaymentRequired(
  resp: Response,
): Promise<ParsedPaymentRequirement | null> {
  const header =
    resp.headers.get("Payment-Required") ||
    resp.headers.get("X-Payment-Required");
  if (header) {
    const rawHeader = safeJsonParse(header);
    const normalizedRaw = normalizePaymentRequired(rawHeader);
    if (normalizedRaw) {
      return {
        x402Version: normalizedRaw.x402Version,
        requirement: selectRequirement(normalizedRaw),
      };
    }

    try {
      const decoded = Buffer.from(header, "base64").toString("utf-8");
      const parsedDecoded = normalizePaymentRequired(safeJsonParse(decoded));
      if (parsedDecoded) {
        return {
          x402Version: parsedDecoded.x402Version,
          requirement: selectRequirement(parsedDecoded),
        };
      }
    } catch {
      // Ignore header decode errors and continue with body parsing.
    }
  }

  try {
    const body = await resp.json();
    const parsedBody = normalizePaymentRequired(body);
    if (!parsedBody) return null;
    return {
      x402Version: parsedBody.x402Version,
      requirement: selectRequirement(parsedBody),
    };
  } catch {
    return null;
  }
}

async function signPayment(
  account: PrivateKeyAccount,
  requirement: PaymentRequirement,
  x402Version: number,
): Promise<any> {
  if (isTOSNetwork(requirement.network)) {
    const privateKey = loadWalletPrivateKey();
    if (!privateKey) {
      throw new Error("native payment requested but no local wallet private key was found");
    }
    const rpcUrl = getChainRpcUrl();
    if (!rpcUrl) {
      throw new Error("native payment requested but TOS_RPC_URL is not configured");
    }
    return await buildNativePayment({
      privateKey,
      rpcUrl,
      requirement: {
        scheme: "exact",
        network: requirement.network,
        maxAmountRequired: requirement.maxAmountRequired,
        payToAddress: normalizeAddress(requirement.payToAddress),
        asset: requirement.asset,
        requiredDeadlineSeconds: requirement.requiredDeadlineSeconds,
      },
    });
  }

  const chain = CHAINS[requirement.network];
  if (!chain) {
    throw new Error(`Unsupported network: ${requirement.network}`);
  }
  if (!requirement.usdcAddress) {
    throw new Error(`Missing USDC address for network: ${requirement.network}`);
  }

  const nonce = `0x${Buffer.from(
    crypto.getRandomValues(new Uint8Array(32)),
  ).toString("hex")}`;

  const now = Math.floor(Date.now() / 1000);
  const validAfter = now - 60;
  const validBefore = now + requirement.requiredDeadlineSeconds;
  const amount = parseMaxAmountRequired(
    requirement.maxAmountRequired,
    x402Version,
  );

  // EIP-712 typed data for TransferWithAuthorization
  const domain = {
    name: "USD Coin",
    version: "2",
    chainId: chain.id,
    verifyingContract: requirement.usdcAddress,
  } as const;

  const types = {
    TransferWithAuthorization: [
      { name: "from", type: "address" },
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
      { name: "validAfter", type: "uint256" },
      { name: "validBefore", type: "uint256" },
      { name: "nonce", type: "bytes32" },
    ],
  } as const;

  const message = {
    from: account.address,
    to: requirement.payToAddress as Address,
    value: amount,
    validAfter: BigInt(validAfter),
    validBefore: BigInt(validBefore),
    nonce: nonce as `0x${string}`,
  };

  const signature = await account.signTypedData({
    domain,
    types,
    primaryType: "TransferWithAuthorization",
    message,
  });

  return {
    x402Version,
    scheme: requirement.scheme,
    network: requirement.network,
    payload: {
      signature,
      authorization: {
        from: account.address,
        to: requirement.payToAddress,
        value: amount.toString(),
        validAfter: validAfter.toString(),
        validBefore: validBefore.toString(),
        nonce,
      },
    },
  };
}
