import { keccak256, toHex, type Hex } from "tosdk";
import type { IncomingMessage } from "http";
import type {
  OpenFoxDatabase,
  X402ConfirmationPolicy,
  X402PaymentRecord,
  X402PaymentServiceKind,
  X402PaymentStatus,
  X402ServerConfig,
} from "../types.js";
import { normalizeAddress, type ChainAddress } from "./address.js";
import { ChainRpcClient } from "./client.js";
import {
  readPaymentEnvelope,
  verifyPayment,
  writePaymentRequired,
  type PaymentRequirement,
} from "./x402.js";

export interface X402ServerRequirementInput {
  rpcUrl: string;
  chainId?: bigint | number;
  providerAddress: string;
  amountTomi: string;
  description: string;
  requiredDeadlineSeconds?: number;
}

export interface X402ServerPaymentContext {
  req: IncomingMessage;
  db: OpenFoxDatabase;
  rpcUrl: string;
  config: X402ServerConfig;
  serviceKind: X402PaymentServiceKind;
  providerAddress: string;
  requestKey: string;
  requestHash: Hex;
  amountTomi: string;
  description: string;
  requiredDeadlineSeconds?: number;
}

export interface X402ServerPaymentBinding {
  paymentId: Hex;
  boundKind: string;
  boundSubjectId: string;
  artifactUrl?: string;
}

export interface X402PaymentRetryResult {
  processed: number;
  confirmed: number;
  pending: number;
  failed: number;
}

export type X402ServerPaymentResult =
  | {
      state: "required";
      requirement: PaymentRequirement;
    }
  | {
      state: "pending";
      payment: X402PaymentRecord;
      reason: string;
    }
  | {
      state: "ready";
      payment: X402PaymentRecord;
    };

export class X402ServerPaymentRejectedError extends Error {
  readonly statusCode: number;

  constructor(message: string, statusCode = 409) {
    super(message);
    this.name = "X402ServerPaymentRejectedError";
    this.statusCode = statusCode;
  }
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([a], [b]) => a.localeCompare(b));
  return `{${entries
    .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
    .join(",")}}`;
}

function isKnownTransactionError(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("already known") ||
    normalized.includes("known transaction") ||
    normalized.includes("already imported") ||
    normalized.includes("nonce too low")
  );
}

function nextRetryIso(config: X402ServerConfig): string {
  return new Date(Date.now() + config.retryAfterSeconds * 1000).toISOString();
}

function isPaymentReady(
  payment: X402PaymentRecord,
  policy: X402ConfirmationPolicy,
): boolean {
  return (
    payment.status === "confirmed" ||
    (policy === "broadcast" && payment.status === "submitted")
  );
}

export async function buildX402ServerRequirement(
  params: X402ServerRequirementInput,
): Promise<PaymentRequirement> {
  const client = new ChainRpcClient({ rpcUrl: params.rpcUrl });
  const chainId =
    params.chainId !== undefined
      ? typeof params.chainId === "number"
        ? BigInt(params.chainId)
        : params.chainId
      : await client.getChainId();
  return {
    scheme: "exact",
    network: `tos:${chainId.toString()}`,
    maxAmountRequired: params.amountTomi,
    payToAddress: normalizeAddress(params.providerAddress),
    asset: "native",
    requiredDeadlineSeconds: params.requiredDeadlineSeconds ?? 300,
    description: params.description,
  };
}

async function waitForReceipt(params: {
  client: ChainRpcClient;
  txHash: Hex;
  timeoutMs: number;
  pollIntervalMs: number;
}): Promise<Record<string, unknown> | null> {
  const deadline = Date.now() + params.timeoutMs;
  while (Date.now() <= deadline) {
    const receipt = await params.client.getTransactionReceipt(params.txHash);
    if (receipt) return receipt;
    await new Promise<void>((resolve) => {
      setTimeout(resolve, params.pollIntervalMs);
    });
  }
  return null;
}

function createPaymentRecord(params: {
  serviceKind: X402PaymentServiceKind;
  requestKey: string;
  requestHash: Hex;
  providerAddress: ChainAddress;
  amountTomi: string;
  config: X402ServerConfig;
  verified: ReturnType<typeof verifyPayment>;
  nowIso: string;
}): X402PaymentRecord {
  return {
    paymentId: params.verified.txHash as Hex,
    serviceKind: params.serviceKind,
    requestKey: params.requestKey,
    requestHash: params.requestHash,
    payerAddress: params.verified.from,
    providerAddress: params.providerAddress,
    chainId: params.verified.chainId.toString(),
    txNonce: params.verified.nonce.toString(),
    txHash: params.verified.txHash as Hex,
    rawTransaction: params.verified.rawTransaction as Hex,
    amountTomi: params.amountTomi,
    confirmationPolicy: params.config.confirmationPolicy,
    status: "verified",
    attemptCount: 0,
    maxAttempts: params.config.maxAttempts,
    receipt: null,
    lastError: null,
    nextAttemptAt: params.nowIso,
    boundKind: null,
    boundSubjectId: null,
    artifactUrl: null,
    createdAt: params.nowIso,
    updatedAt: params.nowIso,
  };
}

function updatePaymentRecord(
  db: OpenFoxDatabase,
  payment: X402PaymentRecord,
): X402PaymentRecord {
  db.upsertX402Payment(payment);
  return payment;
}

async function recoverKnownPayment(params: {
  client: ChainRpcClient;
  db: OpenFoxDatabase;
  payment: X402PaymentRecord;
  config: X402ServerConfig;
}): Promise<X402PaymentRecord | null> {
  const receipt = await params.client.getTransactionReceipt(params.payment.txHash);
  if (receipt) {
    return updatePaymentRecord(params.db, {
      ...params.payment,
      status: "confirmed",
      receipt,
      lastError: null,
      nextAttemptAt: null,
      updatedAt: new Date().toISOString(),
    });
  }

  try {
    const transaction = await params.client.getTransactionByHash(params.payment.txHash);
    if (transaction) {
      return updatePaymentRecord(params.db, {
        ...params.payment,
        status: "submitted",
        lastError: null,
        nextAttemptAt: nextRetryIso(params.config),
        updatedAt: new Date().toISOString(),
      });
    }
  } catch {
    // Some RPCs may not support the method yet. Receipt polling still covers the
    // confirmed path, so this failure is non-fatal.
  }

  return null;
}

async function drivePaymentRecord(params: {
  db: OpenFoxDatabase;
  rpcUrl: string;
  payment: X402PaymentRecord;
  config: X402ServerConfig;
}): Promise<X402PaymentRecord> {
  const client = new ChainRpcClient({ rpcUrl: params.rpcUrl });
  const current = params.payment;
  const nowIso = new Date().toISOString();

  if (current.status === "confirmed" || current.status === "replaced") {
    return current;
  }

  const recovered = await recoverKnownPayment({
    client,
    db: params.db,
    payment: current,
    config: params.config,
  });
  if (recovered?.status === "confirmed") {
    return recovered;
  }
  if (
    recovered &&
    current.confirmationPolicy === "broadcast" &&
    recovered.status === "submitted"
  ) {
    return recovered;
  }

  if (
    current.status === "submitted" &&
    current.attemptCount >= current.maxAttempts
  ) {
    return updatePaymentRecord(params.db, {
      ...current,
      status: "failed",
      lastError: current.lastError ?? "receipt confirmation timed out",
      nextAttemptAt: null,
      updatedAt: nowIso,
    });
  }

  if (
    current.status !== "verified" &&
    current.status !== "failed" &&
    current.status !== "submitted"
  ) {
    return current;
  }

  try {
    await client.sendRawTransaction(current.rawTransaction);
    let submitted = updatePaymentRecord(params.db, {
      ...current,
      status: "submitted",
      attemptCount: current.attemptCount + 1,
      lastError: null,
      nextAttemptAt: nextRetryIso(params.config),
      updatedAt: nowIso,
    });

    if (current.confirmationPolicy === "receipt") {
      const receipt = await waitForReceipt({
        client,
        txHash: current.txHash,
        timeoutMs: params.config.receiptTimeoutMs,
        pollIntervalMs: params.config.receiptPollIntervalMs,
      });
      if (receipt) {
        submitted = updatePaymentRecord(params.db, {
          ...submitted,
          status: "confirmed",
          receipt,
          nextAttemptAt: null,
          updatedAt: new Date().toISOString(),
        });
      }
    }
    return submitted;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const known = await recoverKnownPayment({
      client,
      db: params.db,
      payment: current,
      config: params.config,
    });
    if (known) return known;
    if (isKnownTransactionError(message)) {
      return updatePaymentRecord(params.db, {
        ...current,
        status: "submitted",
        attemptCount: current.attemptCount + 1,
        lastError: null,
        nextAttemptAt: nextRetryIso(params.config),
        updatedAt: nowIso,
      });
    }
    const attemptCount = current.attemptCount + 1;
    const terminal = attemptCount >= current.maxAttempts;
    return updatePaymentRecord(params.db, {
      ...current,
      status: "failed",
      attemptCount,
      lastError: message,
      nextAttemptAt: terminal ? null : nextRetryIso(params.config),
      updatedAt: nowIso,
    });
  }
}

export function hashX402RequestPayload(payload: unknown): Hex {
  return keccak256(toHex(new TextEncoder().encode(stableStringify(payload)))) as Hex;
}

export function writeX402RequirementResponse(params: {
  requirement: PaymentRequirement;
  res: import("http").ServerResponse;
}): void {
  writePaymentRequired(params.res, params.requirement);
}

export function bindX402Payment(params: {
  db: OpenFoxDatabase;
  paymentId: Hex;
  boundKind: string;
  boundSubjectId: string;
  artifactUrl?: string;
}): X402PaymentRecord {
  const existing = params.db.getX402Payment(params.paymentId);
  if (!existing) {
    throw new X402ServerPaymentRejectedError(
      `payment ${params.paymentId} was not found in the ledger`,
      500,
    );
  }
  if (
    existing.boundSubjectId &&
    (existing.boundKind !== params.boundKind ||
      existing.boundSubjectId !== params.boundSubjectId)
  ) {
    throw new X402ServerPaymentRejectedError(
      `payment ${params.paymentId} is already bound to ${existing.boundKind}:${existing.boundSubjectId}`,
      409,
    );
  }
  const updated: X402PaymentRecord = {
    ...existing,
    boundKind: params.boundKind,
    boundSubjectId: params.boundSubjectId,
    artifactUrl: params.artifactUrl ?? existing.artifactUrl ?? null,
    updatedAt: new Date().toISOString(),
  };
  params.db.upsertX402Payment(updated);
  return updated;
}

export async function requireX402ServerPayment(
  params: X402ServerPaymentContext,
): Promise<X402ServerPaymentResult> {
  const providerAddress = normalizeAddress(params.providerAddress);
  const requirement = await buildX402ServerRequirement({
    rpcUrl: params.rpcUrl,
    providerAddress,
    amountTomi: params.amountTomi,
    description: params.description,
    requiredDeadlineSeconds: params.requiredDeadlineSeconds,
  });

  const envelope = readPaymentEnvelope(params.req);
  const existingForRequest = params.db.getLatestX402PaymentByRequestKey(
    params.serviceKind,
    params.requestKey,
  );

  if (existingForRequest) {
    if (existingForRequest.requestHash !== params.requestHash) {
      throw new X402ServerPaymentRejectedError(
        "request key is already bound to a different paid payload",
      );
    }

    if (!envelope) {
      const recovered = await drivePaymentRecord({
        db: params.db,
        rpcUrl: params.rpcUrl,
        payment: existingForRequest,
        config: params.config,
      });
      return isPaymentReady(recovered, recovered.confirmationPolicy)
        ? { state: "ready", payment: recovered }
        : {
            state: "pending",
            payment: recovered,
            reason:
              recovered.status === "failed"
                ? recovered.lastError || "payment broadcast failed"
                : "payment is pending confirmation",
          };
    }
  }

  if (!envelope) {
    return { state: "required", requirement };
  }

  const verified = verifyPayment(requirement, envelope);
  const txHash = verified.txHash as Hex;
  const existingByPayment = params.db.getX402Payment(txHash);
  if (existingByPayment) {
    if (
      existingByPayment.serviceKind !== params.serviceKind ||
      existingByPayment.requestKey !== params.requestKey ||
      existingByPayment.requestHash !== params.requestHash
    ) {
      throw new X402ServerPaymentRejectedError(
        "payment envelope has already been consumed by a different request",
      );
    }
    const recovered = await drivePaymentRecord({
      db: params.db,
      rpcUrl: params.rpcUrl,
      payment: existingByPayment,
      config: params.config,
    });
    return isPaymentReady(recovered, recovered.confirmationPolicy)
      ? { state: "ready", payment: recovered }
      : {
          state: "pending",
          payment: recovered,
          reason:
            recovered.status === "failed"
              ? recovered.lastError || "payment broadcast failed"
              : "payment is pending confirmation",
        };
  }

  if (existingForRequest && existingForRequest.txHash !== txHash) {
    if (
      existingForRequest.payerAddress === verified.from &&
      existingForRequest.txNonce === verified.nonce.toString() &&
      existingForRequest.status !== "confirmed"
    ) {
      updatePaymentRecord(params.db, {
        ...existingForRequest,
        status: "replaced",
        nextAttemptAt: null,
        lastError: "replaced by a newer payment envelope for the same request",
        updatedAt: new Date().toISOString(),
      });
    } else {
      throw new X402ServerPaymentRejectedError(
        "request is already bound to a different payment transaction",
      );
    }
  }

  const record = createPaymentRecord({
    serviceKind: params.serviceKind,
    requestKey: params.requestKey,
    requestHash: params.requestHash,
    providerAddress,
    amountTomi: params.amountTomi,
    config: params.config,
    verified,
    nowIso: new Date().toISOString(),
  });
  params.db.upsertX402Payment(record);
  const processed = await drivePaymentRecord({
    db: params.db,
    rpcUrl: params.rpcUrl,
    payment: record,
    config: params.config,
  });
  return isPaymentReady(processed, processed.confirmationPolicy)
    ? { state: "ready", payment: processed }
    : {
        state: "pending",
        payment: processed,
        reason:
          processed.status === "failed"
            ? processed.lastError || "payment broadcast failed"
            : "payment is pending confirmation",
      };
}

export function createX402PaymentManager(params: {
  db: OpenFoxDatabase;
  rpcUrl: string;
  config: X402ServerConfig;
}): {
  requirePayment(
    context: Omit<X402ServerPaymentContext, "db" | "rpcUrl" | "config">,
  ): Promise<X402ServerPaymentResult>;
  bindPayment(binding: X402ServerPaymentBinding): X402PaymentRecord;
  retryPending(limit?: number): Promise<X402PaymentRetryResult>;
} {
  return {
    async requirePayment(context) {
      return requireX402ServerPayment({
        ...context,
        db: params.db,
        rpcUrl: params.rpcUrl,
        config: params.config,
      });
    },

    bindPayment(binding) {
      return bindX402Payment({
        db: params.db,
        paymentId: binding.paymentId,
        boundKind: binding.boundKind,
        boundSubjectId: binding.boundSubjectId,
        artifactUrl: binding.artifactUrl,
      });
    },

    async retryPending(limit = params.config.retryBatchSize) {
      const items = params.db.listPendingX402Payments(limit, new Date().toISOString());
      const result: X402PaymentRetryResult = {
        processed: items.length,
        confirmed: 0,
        pending: 0,
        failed: 0,
      };
      for (const item of items) {
        const updated = await drivePaymentRecord({
          db: params.db,
          rpcUrl: params.rpcUrl,
          payment: item,
          config: params.config,
        });
        if (updated.status === "confirmed") {
          result.confirmed += 1;
        } else if (updated.status === "failed") {
          result.failed += 1;
        } else {
          result.pending += 1;
        }
      }
      return result;
    },
  };
}
