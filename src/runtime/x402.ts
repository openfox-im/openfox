/**
 * x402 Payment Protocol
 *
 * Enables the openfox to make native TOS payments via HTTP 402.
 */

import type { LocalAccount } from "tosdk/accounts";
import { ChainRpcClient, buildX402Payment, parseAmount } from "../chain/client.js";
import { normalizeAddress, type ChainAddress } from "../chain/address.js";
import { loadConfig } from "../config.js";
import { loadWalletPrivateKey } from "../identity/wallet.js";
import { ResilientHttpClient } from "./http-client.js";

const x402HttpClient = new ResilientHttpClient();

type PaymentNetworkId = `tos:${string}`;

interface PaymentRequirement {
  scheme: string;
  network: PaymentNetworkId;
  maxAmountRequired: string;
  payToAddress: string;
  requiredDeadlineSeconds: number;
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
  response?: unknown;
  error?: string;
  status?: number;
}

export interface WalletBalanceResult {
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
  if (!/^tos:\d+$/.test(normalized)) return null;
  return normalized as PaymentNetworkId;
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
  const requiredDeadlineSeconds =
    parsePositiveInt(value.requiredDeadlineSeconds) ??
    parsePositiveInt(value.maxTimeoutSeconds) ??
    300;

  if (!scheme || !maxAmountRequired || !payToAddress) {
    return null;
  }

  return {
    scheme,
    network,
    maxAmountRequired,
    payToAddress,
    requiredDeadlineSeconds,
    asset: typeof value.asset === "string" ? value.asset : undefined,
  };
}

function normalizePaymentRequired(raw: unknown): PaymentRequiredResponse | null {
  if (typeof raw !== "object" || raw === null) return null;
  const value = raw as Record<string, unknown>;
  if (!Array.isArray(value.accepts)) return null;

  const accepts = value.accepts
    .map(normalizePaymentRequirement)
    .filter((item): item is PaymentRequirement => item !== null);
  if (!accepts.length) return null;

  const x402Version = parsePositiveInt(value.x402Version) ?? 1;
  return { x402Version, accepts };
}

function selectRequirement(parsed: PaymentRequiredResponse): PaymentRequirement {
  const native = parsed.accepts.find((item) => item.scheme === "exact");
  if (!native) {
    throw new Error("No supported TOS payment requirement was offered");
  }
  return native;
}

export async function getWalletBalance(
  address: ChainAddress,
  network?: PaymentNetworkId,
): Promise<number> {
  const result = await getWalletBalanceDetailed(address, network);
  return result.balance;
}

export async function getWalletBalanceDetailed(
  address: ChainAddress,
  network?: PaymentNetworkId,
): Promise<WalletBalanceResult> {
  const rpcUrl = getChainRpcUrl();
  if (!rpcUrl) {
    return {
      balance: 0,
      network: network || "tos:unknown",
      ok: false,
      error: "TOS RPC URL is not configured",
    };
  }

  try {
    const client = new ChainRpcClient({ rpcUrl });
    const chainId = await client.getChainId();
    const resolvedNetwork = network || (`tos:${chainId.toString()}` as PaymentNetworkId);
    const balance = await client.getBalance(normalizeAddress(address));
    return {
      balance: Number(balance) / 1e18,
      network: resolvedNetwork,
      ok: true,
    };
  } catch (err: any) {
    return {
      balance: 0,
      network: network || "tos:unknown",
      ok: false,
      error: err?.message || String(err),
    };
  }
}

export async function checkX402(
  url: string,
): Promise<PaymentRequirement | null> {
  try {
    const resp = await x402HttpClient.request(url, { method: "HEAD" });
    if (resp.status !== 402) return null;
    const parsed = await parsePaymentRequired(resp);
    return parsed?.requirement ?? null;
  } catch {
    return null;
  }
}

export async function x402Fetch(
  url: string,
  account: LocalAccount,
  method: string = "GET",
  body?: string,
  headers?: Record<string, string>,
  _maxPaymentCents?: number,
): Promise<X402PaymentResult> {
  try {
    const initialResp = await x402HttpClient.request(url, {
      method,
      headers: { ...headers, "Content-Type": "application/json" },
      body,
    });

    if (initialResp.status !== 402) {
      const data = await initialResp.json().catch(() => initialResp.text());
      return { success: initialResp.ok, response: data, status: initialResp.status };
    }

    const parsed = await parsePaymentRequired(initialResp);
    if (!parsed) {
      return {
        success: false,
        error: "Could not parse payment requirements",
        status: initialResp.status,
      };
    }

    let payment;
    try {
      payment = await signPayment(account, parsed.requirement);
    } catch (err: any) {
      return {
        success: false,
        error: `Failed to sign payment: ${err?.message || String(err)}`,
        status: initialResp.status,
      };
    }

    const paymentHeader = Buffer.from(JSON.stringify(payment)).toString("base64");
    const paidResp = await x402HttpClient.request(url, {
      method,
      headers: {
        ...headers,
        "Content-Type": "application/json",
        "Payment-Signature": paymentHeader,
        "X-Payment": paymentHeader,
      },
      body,
      retries: 0,
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
    const normalizedRaw = normalizePaymentRequired(safeJsonParse(header));
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
  _account: LocalAccount,
  requirement: PaymentRequirement,
): Promise<unknown> {
  if (!hasNativePaymentSupport()) {
    throw new Error("native payment requested but wallet private key or rpcUrl is missing");
  }

  const privateKey = loadWalletPrivateKey();
  const rpcUrl = getChainRpcUrl();
  if (!privateKey || !rpcUrl) {
    throw new Error("native payment requested but wallet private key or rpcUrl is missing");
  }

  return await buildX402Payment({
    privateKey,
    rpcUrl,
    requirement: {
      scheme: "exact",
      network: requirement.network,
      maxAmountRequired: normalizeAmount(requirement.maxAmountRequired),
      payToAddress: normalizeAddress(requirement.payToAddress),
      asset: requirement.asset,
      requiredDeadlineSeconds: requirement.requiredDeadlineSeconds,
    },
  });
}

function normalizeAmount(value: string): string {
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) {
    return trimmed;
  }
  return parseAmount(trimmed).toString();
}
