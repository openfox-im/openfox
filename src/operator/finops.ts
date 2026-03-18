import type {
  MarketBindingKind,
  OpenFoxConfig,
  OpenFoxDatabase,
  SettlementKind,
  X402PaymentServiceKind,
} from "../types.js";

const WEI_PER_TOS = 10n ** 18n;

function toBigInt(value: string | bigint | null | undefined): bigint {
  if (typeof value === "bigint") return value;
  if (!value) return 0n;
  return BigInt(value);
}

function formatTOS(value: bigint): string {
  const sign = value < 0n ? "-" : "";
  const abs = value < 0n ? -value : value;
  const whole = abs / WEI_PER_TOS;
  const fraction = abs % WEI_PER_TOS;
  if (fraction === 0n) return `${sign}${whole.toString()} TOS`;
  const decimals = fraction.toString().padStart(18, "0").replace(/0+$/, "");
  return `${sign}${whole.toString()}.${decimals.slice(0, 6)} TOS`;
}

function byBigIntDesc<T>(getValue: (item: T) => bigint) {
  return (a: T, b: T): number => {
    const av = getValue(a);
    const bv = getValue(b);
    if (av === bv) return 0;
    return bv > av ? 1 : -1;
  };
}

export interface OperatorPaymentsCounterpartyEntry {
  address: string;
  kind: "customer" | "provider";
  confirmedRevenueWei: string;
  confirmedCostWei: string;
  pendingRevenueWei: string;
  pendingCostWei: string;
  confirmedCount: number;
  pendingCount: number;
}

export interface OperatorPaymentsCapabilityEntry {
  capability: X402PaymentServiceKind;
  confirmedRevenueWei: string;
  confirmedCostWei: string;
  pendingRevenueWei: string;
  pendingCostWei: string;
  confirmedCount: number;
  pendingCount: number;
  failedCount: number;
  replacedCount: number;
}

export interface OperatorPaymentsRequestEntry {
  requestKey: string;
  capability: X402PaymentServiceKind;
  direction: "inbound" | "outbound";
  status: string;
  amountWei: string;
  counterpartyAddress: string;
  boundKind: string | null;
  boundSubjectId: string | null;
}

export interface OperatorPaymentsSnapshot {
  kind: "payments";
  generatedAt: string;
  address: string;
  totals: {
    confirmedRevenueWei: string;
    confirmedCostWei: string;
    pendingRevenueWei: string;
    pendingCostWei: string;
    confirmedCount: number;
    pendingCount: number;
    failedCount: number;
    replacedCount: number;
  };
  capabilities: OperatorPaymentsCapabilityEntry[];
  counterparties: OperatorPaymentsCounterpartyEntry[];
  topRequests: OperatorPaymentsRequestEntry[];
  summary: string;
}

export interface OperatorSettlementKindEntry {
  kind: SettlementKind;
  receipts: number;
  callbackConfirmed: number;
  callbackPending: number;
  callbackFailed: number;
  payoutCount: number;
}

export interface OperatorDelayedSettlementEntry {
  kind: SettlementKind;
  subjectId: string;
  status: "pending" | "failed";
  attemptCount: number;
  maxAttempts: number;
  updatedAt: string;
}

export interface OperatorSettlementSnapshot {
  kind: "settlement";
  generatedAt: string;
  address: string;
  receiptsTotal: number;
  callbackConfirmed: number;
  callbackPending: number;
  callbackFailed: number;
  kinds: OperatorSettlementKindEntry[];
  delayedSubjects: OperatorDelayedSettlementEntry[];
  summary: string;
}

export interface OperatorMarketKindEntry {
  kind: MarketBindingKind;
  bindings: number;
  callbackConfirmed: number;
  callbackPending: number;
  callbackFailed: number;
}

export interface OperatorDelayedMarketEntry {
  kind: MarketBindingKind;
  subjectId: string;
  status: "pending" | "failed";
  attemptCount: number;
  maxAttempts: number;
  updatedAt: string;
}

export interface OperatorMarketSnapshot {
  kind: "market";
  generatedAt: string;
  address: string;
  bindingsTotal: number;
  callbackConfirmed: number;
  callbackPending: number;
  callbackFailed: number;
  kinds: OperatorMarketKindEntry[];
  delayedSubjects: OperatorDelayedMarketEntry[];
  summary: string;
}

export async function buildOperatorPaymentsSnapshot(
  config: OpenFoxConfig,
  db: OpenFoxDatabase,
): Promise<OperatorPaymentsSnapshot> {
  const address = config.walletAddress.toLowerCase();
  const payments = db.listX402Payments(2000);

  let confirmedRevenueWei = 0n;
  let confirmedCostWei = 0n;
  let pendingRevenueWei = 0n;
  let pendingCostWei = 0n;
  let confirmedCount = 0;
  let pendingCount = 0;
  let failedCount = 0;
  let replacedCount = 0;

  const capabilityMap = new Map<
    X402PaymentServiceKind,
    {
      confirmedRevenueWei: bigint;
      confirmedCostWei: bigint;
      pendingRevenueWei: bigint;
      pendingCostWei: bigint;
      confirmedCount: number;
      pendingCount: number;
      failedCount: number;
      replacedCount: number;
    }
  >();
  const counterpartyMap = new Map<
    string,
    {
      address: string;
      kind: "customer" | "provider";
      confirmedRevenueWei: bigint;
      confirmedCostWei: bigint;
      pendingRevenueWei: bigint;
      pendingCostWei: bigint;
      confirmedCount: number;
      pendingCount: number;
    }
  >();
  const topRequests: OperatorPaymentsRequestEntry[] = [];

  for (const payment of payments) {
    const provider = payment.providerAddress.toLowerCase();
    const payer = payment.payerAddress.toLowerCase();
    const inbound = provider === address;
    const outbound = payer === address;
    if (!inbound && !outbound) continue;

    const amountWei = toBigInt(payment.amountWei);
    const capability =
      (payment.serviceKind as X402PaymentServiceKind) || "gateway_request";
    const capabilityEntry =
      capabilityMap.get(capability) ?? {
        confirmedRevenueWei: 0n,
        confirmedCostWei: 0n,
        pendingRevenueWei: 0n,
        pendingCostWei: 0n,
        confirmedCount: 0,
        pendingCount: 0,
        failedCount: 0,
        replacedCount: 0,
      };

    const counterpartyAddress = inbound ? payer : provider;
    const counterpartyKind = inbound ? "customer" : "provider";
    const counterpartyKey = `${counterpartyKind}:${counterpartyAddress}`;
    const counterparty =
      counterpartyMap.get(counterpartyKey) ?? {
        address: counterpartyAddress,
        kind: counterpartyKind,
        confirmedRevenueWei: 0n,
        confirmedCostWei: 0n,
        pendingRevenueWei: 0n,
        pendingCostWei: 0n,
        confirmedCount: 0,
        pendingCount: 0,
      };

    if (payment.status === "confirmed") {
      confirmedCount += 1;
      capabilityEntry.confirmedCount += 1;
      counterparty.confirmedCount += 1;
      if (inbound) {
        confirmedRevenueWei += amountWei;
        capabilityEntry.confirmedRevenueWei += amountWei;
        counterparty.confirmedRevenueWei += amountWei;
      }
      if (outbound) {
        confirmedCostWei += amountWei;
        capabilityEntry.confirmedCostWei += amountWei;
        counterparty.confirmedCostWei += amountWei;
      }
    } else if (payment.status === "verified" || payment.status === "submitted") {
      pendingCount += 1;
      capabilityEntry.pendingCount += 1;
      counterparty.pendingCount += 1;
      if (inbound) {
        pendingRevenueWei += amountWei;
        capabilityEntry.pendingRevenueWei += amountWei;
        counterparty.pendingRevenueWei += amountWei;
      }
      if (outbound) {
        pendingCostWei += amountWei;
        capabilityEntry.pendingCostWei += amountWei;
        counterparty.pendingCostWei += amountWei;
      }
    } else if (payment.status === "failed") {
      failedCount += 1;
      capabilityEntry.failedCount += 1;
    } else if (payment.status === "replaced") {
      replacedCount += 1;
      capabilityEntry.replacedCount += 1;
    }

    capabilityMap.set(capability, capabilityEntry);
    counterpartyMap.set(counterpartyKey, counterparty);

    topRequests.push({
      requestKey: payment.requestKey,
      capability,
      direction: inbound ? "inbound" : "outbound",
      status: payment.status,
      amountWei: payment.amountWei,
      counterpartyAddress,
      boundKind: payment.boundKind ?? null,
      boundSubjectId: payment.boundSubjectId ?? null,
    });
  }

  const capabilities = Array.from(capabilityMap.entries())
    .map(([capability, entry]) => ({
      capability,
      confirmedRevenueWei: entry.confirmedRevenueWei.toString(),
      confirmedCostWei: entry.confirmedCostWei.toString(),
      pendingRevenueWei: entry.pendingRevenueWei.toString(),
      pendingCostWei: entry.pendingCostWei.toString(),
      confirmedCount: entry.confirmedCount,
      pendingCount: entry.pendingCount,
      failedCount: entry.failedCount,
      replacedCount: entry.replacedCount,
    }))
    .sort((a, b) =>
      byBigIntDesc<OperatorPaymentsCapabilityEntry>(
        (item) =>
          toBigInt(item.confirmedRevenueWei) +
          toBigInt(item.pendingRevenueWei) +
          toBigInt(item.confirmedCostWei) +
          toBigInt(item.pendingCostWei),
      )(a, b),
    );

  const counterparties = Array.from(counterpartyMap.values())
    .map((entry) => ({
      address: entry.address,
      kind: entry.kind,
      confirmedRevenueWei: entry.confirmedRevenueWei.toString(),
      confirmedCostWei: entry.confirmedCostWei.toString(),
      pendingRevenueWei: entry.pendingRevenueWei.toString(),
      pendingCostWei: entry.pendingCostWei.toString(),
      confirmedCount: entry.confirmedCount,
      pendingCount: entry.pendingCount,
    }))
    .sort((a, b) =>
      byBigIntDesc<OperatorPaymentsCounterpartyEntry>(
        (item) =>
          toBigInt(item.confirmedRevenueWei) +
          toBigInt(item.pendingRevenueWei) +
          toBigInt(item.confirmedCostWei) +
          toBigInt(item.pendingCostWei),
      )(a, b),
    )
    .slice(0, 10);

  topRequests.sort((a, b) => byBigIntDesc<OperatorPaymentsRequestEntry>((item) => toBigInt(item.amountWei))(a, b));

  const summary = [
    `confirmed revenue=${formatTOS(confirmedRevenueWei)}`,
    `confirmed cost=${formatTOS(confirmedCostWei)}`,
    `pending receivables=${formatTOS(pendingRevenueWei)}`,
    `pending liabilities=${formatTOS(pendingCostWei)}`,
    `failed=${failedCount}`,
  ].join(", ");

  return {
    kind: "payments",
    generatedAt: new Date().toISOString(),
    address: config.walletAddress,
    totals: {
      confirmedRevenueWei: confirmedRevenueWei.toString(),
      confirmedCostWei: confirmedCostWei.toString(),
      pendingRevenueWei: pendingRevenueWei.toString(),
      pendingCostWei: pendingCostWei.toString(),
      confirmedCount,
      pendingCount,
      failedCount,
      replacedCount,
    },
    capabilities,
    counterparties,
    topRequests: topRequests.slice(0, 10),
    summary,
  };
}

export async function buildOperatorSettlementSnapshot(
  config: OpenFoxConfig,
  db: OpenFoxDatabase,
): Promise<OperatorSettlementSnapshot> {
  const receipts = db.listSettlementReceipts(2000);
  const callbacks = db.listSettlementCallbacks(2000);
  const kindMap = new Map<
    SettlementKind,
    {
      receipts: number;
      callbackConfirmed: number;
      callbackPending: number;
      callbackFailed: number;
      payoutCount: number;
    }
  >();

  for (const receipt of receipts) {
    const kindEntry =
      kindMap.get(receipt.kind) ?? {
        receipts: 0,
        callbackConfirmed: 0,
        callbackPending: 0,
        callbackFailed: 0,
        payoutCount: 0,
      };
    kindEntry.receipts += 1;
    if (receipt.payoutTxHash) {
      kindEntry.payoutCount += 1;
    }
    kindMap.set(receipt.kind, kindEntry);
  }

  let callbackConfirmed = 0;
  let callbackPending = 0;
  let callbackFailed = 0;
  const delayedSubjects: OperatorDelayedSettlementEntry[] = [];
  for (const callback of callbacks) {
    const kindEntry =
      kindMap.get(callback.kind) ?? {
        receipts: 0,
        callbackConfirmed: 0,
        callbackPending: 0,
        callbackFailed: 0,
        payoutCount: 0,
      };
    if (callback.status === "confirmed") {
      callbackConfirmed += 1;
      kindEntry.callbackConfirmed += 1;
    } else if (callback.status === "pending") {
      callbackPending += 1;
      kindEntry.callbackPending += 1;
      delayedSubjects.push({
        kind: callback.kind,
        subjectId: callback.subjectId,
        status: "pending",
        attemptCount: callback.attemptCount,
        maxAttempts: callback.maxAttempts,
        updatedAt: callback.updatedAt,
      });
    } else {
      callbackFailed += 1;
      kindEntry.callbackFailed += 1;
      delayedSubjects.push({
        kind: callback.kind,
        subjectId: callback.subjectId,
        status: "failed",
        attemptCount: callback.attemptCount,
        maxAttempts: callback.maxAttempts,
        updatedAt: callback.updatedAt,
      });
    }
    kindMap.set(callback.kind, kindEntry);
  }

  const kinds = Array.from(kindMap.entries())
    .map(([kind, entry]) => ({
      kind,
      receipts: entry.receipts,
      callbackConfirmed: entry.callbackConfirmed,
      callbackPending: entry.callbackPending,
      callbackFailed: entry.callbackFailed,
      payoutCount: entry.payoutCount,
    }))
    .sort((a, b) => b.receipts - a.receipts);

  delayedSubjects.sort((a, b) => b.attemptCount - a.attemptCount);

  return {
    kind: "settlement",
    generatedAt: new Date().toISOString(),
    address: config.walletAddress,
    receiptsTotal: receipts.length,
    callbackConfirmed,
    callbackPending,
    callbackFailed,
    kinds,
    delayedSubjects: delayedSubjects.slice(0, 10),
    summary: `${receipts.length} receipts, callbacks pending=${callbackPending}, failed=${callbackFailed}`,
  };
}

export async function buildOperatorMarketSnapshot(
  config: OpenFoxConfig,
  db: OpenFoxDatabase,
): Promise<OperatorMarketSnapshot> {
  const bindings = db.listMarketBindings(2000);
  const callbacks = db.listMarketContractCallbacks(2000);
  const kindMap = new Map<
    MarketBindingKind,
    {
      bindings: number;
      callbackConfirmed: number;
      callbackPending: number;
      callbackFailed: number;
    }
  >();

  for (const binding of bindings) {
    const kindEntry =
      kindMap.get(binding.kind) ?? {
        bindings: 0,
        callbackConfirmed: 0,
        callbackPending: 0,
        callbackFailed: 0,
      };
    kindEntry.bindings += 1;
    kindMap.set(binding.kind, kindEntry);
  }

  let callbackConfirmed = 0;
  let callbackPending = 0;
  let callbackFailed = 0;
  const delayedSubjects: OperatorDelayedMarketEntry[] = [];
  for (const callback of callbacks) {
    const kindEntry =
      kindMap.get(callback.kind) ?? {
        bindings: 0,
        callbackConfirmed: 0,
        callbackPending: 0,
        callbackFailed: 0,
      };
    if (callback.status === "confirmed") {
      callbackConfirmed += 1;
      kindEntry.callbackConfirmed += 1;
    } else if (callback.status === "pending") {
      callbackPending += 1;
      kindEntry.callbackPending += 1;
      delayedSubjects.push({
        kind: callback.kind,
        subjectId: callback.subjectId,
        status: "pending",
        attemptCount: callback.attemptCount,
        maxAttempts: callback.maxAttempts,
        updatedAt: callback.updatedAt,
      });
    } else {
      callbackFailed += 1;
      kindEntry.callbackFailed += 1;
      delayedSubjects.push({
        kind: callback.kind,
        subjectId: callback.subjectId,
        status: "failed",
        attemptCount: callback.attemptCount,
        maxAttempts: callback.maxAttempts,
        updatedAt: callback.updatedAt,
      });
    }
    kindMap.set(callback.kind, kindEntry);
  }

  const kinds = Array.from(kindMap.entries())
    .map(([kind, entry]) => ({
      kind,
      bindings: entry.bindings,
      callbackConfirmed: entry.callbackConfirmed,
      callbackPending: entry.callbackPending,
      callbackFailed: entry.callbackFailed,
    }))
    .sort((a, b) => b.bindings - a.bindings);

  delayedSubjects.sort((a, b) => b.attemptCount - a.attemptCount);

  return {
    kind: "market",
    generatedAt: new Date().toISOString(),
    address: config.walletAddress,
    bindingsTotal: bindings.length,
    callbackConfirmed,
    callbackPending,
    callbackFailed,
    kinds,
    delayedSubjects: delayedSubjects.slice(0, 10),
    summary: `${bindings.length} bindings, callbacks pending=${callbackPending}, failed=${callbackFailed}`,
  };
}
