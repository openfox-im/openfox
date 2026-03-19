import type {
  OpenFoxConfig,
  OpenFoxDatabase,
  OwnerFinanceAttributionEntry,
  OwnerFinanceSnapshotData,
  OwnerFinanceSnapshotRecord,
  OwnerReportPeriodKind,
  X402PaymentRecord,
} from "../types.js";
import {
  buildOperatorFinanceSnapshot,
  type OperatorFinanceSnapshot,
} from "../operator/wallet-finance.js";

const WEI_PER_TOS = 10n ** 18n;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MS_PER_WEEK = 7 * MS_PER_DAY;

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function periodBounds(periodKind: OwnerReportPeriodKind, nowMs: number): {
  periodStart: string;
  periodEnd: string;
  sinceMs: number;
  untilMs: number;
} {
  const now = new Date(nowMs);
  const start =
    periodKind === "daily"
      ? startOfUtcDay(now)
      : new Date(nowMs - MS_PER_WEEK);
  const end = periodKind === "daily" ? new Date(start.getTime() + MS_PER_DAY) : now;
  return {
    periodStart: start.toISOString(),
    periodEnd: end.toISOString(),
    sinceMs: start.getTime(),
    untilMs: end.getTime(),
  };
}

function toBigInt(value: string | bigint | null | undefined): bigint {
  if (typeof value === "bigint") return value;
  if (!value) return 0n;
  return BigInt(value);
}

function toMs(value: string | null | undefined): number {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
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

function buildSnapshotId(periodKind: OwnerReportPeriodKind, periodStart: string): string {
  return `owner-finance:${periodKind}:${periodStart}`;
}

function listAllX402Payments(db: OpenFoxDatabase): X402PaymentRecord[] {
  return db.listX402Payments(10_000);
}

function collectAttributionEntries(params: {
  config: OpenFoxConfig;
  db: OpenFoxDatabase;
  periodKind: OwnerReportPeriodKind;
  financeSnapshot: OperatorFinanceSnapshot;
  sinceMs: number;
  untilMs: number;
}): {
  topGains: OwnerFinanceAttributionEntry[];
  topLosses: OwnerFinanceAttributionEntry[];
  anomalies: string[];
} {
  const address = params.config.walletAddress.toLowerCase();
  const gains: OwnerFinanceAttributionEntry[] = [];
  const losses: OwnerFinanceAttributionEntry[] = [];
  const anomalies: string[] = [];

  for (const payment of listAllX402Payments(params.db)) {
    if (payment.status !== "confirmed") continue;
    const updatedMs = toMs(payment.updatedAt);
    if (updatedMs < params.sinceMs || updatedMs >= params.untilMs) continue;
    const amountTomi = toBigInt(payment.amountTomi);
    if (payment.providerAddress.toLowerCase() === address) {
      gains.push({
        attributionId: payment.paymentId,
        kind: "x402_revenue",
        title: `x402 ${payment.serviceKind} payment`,
        amountTomi: amountTomi.toString(),
        sourceId: payment.paymentId,
        sourceKind: payment.serviceKind,
        counterparty: payment.payerAddress,
        metadata: {
          requestKey: payment.requestKey,
          boundKind: payment.boundKind,
          boundSubjectId: payment.boundSubjectId,
        },
      });
    }
    if (payment.payerAddress.toLowerCase() === address) {
      losses.push({
        attributionId: payment.paymentId,
        kind: "x402_cost",
        title: `x402 ${payment.serviceKind} payment`,
        amountTomi: amountTomi.toString(),
        sourceId: payment.paymentId,
        sourceKind: payment.serviceKind,
        counterparty: payment.providerAddress,
        metadata: {
          requestKey: payment.requestKey,
          boundKind: payment.boundKind,
          boundSubjectId: payment.boundSubjectId,
        },
      });
    }
  }

  for (const bounty of params.db.listBounties()) {
    const result = params.db.getBountyResult(bounty.bountyId);
    if (!result?.payoutTxHash) continue;
    const updatedMs = toMs(result.updatedAt);
    if (updatedMs < params.sinceMs || updatedMs >= params.untilMs) continue;
    const rewardTomi = toBigInt(bounty.rewardTomi);
    const winningSubmission = result.winningSubmissionId
      ? params.db.getBountySubmission(result.winningSubmissionId)
      : undefined;
    if (
      winningSubmission &&
      winningSubmission.solverAddress.toLowerCase() === address
    ) {
      gains.push({
        attributionId: `bounty-reward:${bounty.bountyId}`,
        kind: "bounty_reward",
        title: bounty.title,
        amountTomi: rewardTomi.toString(),
        sourceId: bounty.bountyId,
        sourceKind: "bounty",
        counterparty: bounty.hostAddress,
        metadata: {
          kind: bounty.kind,
          payoutTxHash: result.payoutTxHash,
        },
      });
    }
    if (bounty.hostAddress.toLowerCase() === address) {
      losses.push({
        attributionId: `bounty-payout:${bounty.bountyId}`,
        kind: "bounty_payout",
        title: bounty.title,
        amountTomi: rewardTomi.toString(),
        sourceId: bounty.bountyId,
        sourceKind: "bounty",
        counterparty: winningSubmission?.solverAddress ?? null,
        metadata: {
          kind: bounty.kind,
          payoutTxHash: result.payoutTxHash,
        },
      });
    }
  }

  const period =
    params.periodKind === "daily"
      ? params.financeSnapshot.periods.today
      : params.financeSnapshot.periods.trailing7d;
  const operatingCostCents = period.operatingCostCents;
  if (operatingCostCents > 0) {
    losses.push({
      attributionId: `${params.periodKind}:operating-cost`,
      kind: "operating_cost",
      title:
        params.periodKind === "daily"
          ? "Operating cost for today"
          : "Operating cost for trailing 7d",
      amountTomi: "0",
      amountCents: operatingCostCents,
      sourceKind: "operating_cost",
      metadata: {
        inferenceCostCents: period.inferenceCostCents,
        spendCostCents: period.spendCostCents,
      },
    });
  }

  if (params.financeSnapshot.failedOnchainTransactions > 0) {
    anomalies.push(
      `${params.financeSnapshot.failedOnchainTransactions} failed on-chain transaction(s) require review.`,
    );
  }
  if (params.financeSnapshot.retryableFailedItems > 0) {
    anomalies.push(
      `${params.financeSnapshot.retryableFailedItems} retryable failed item(s) are still pending reconciliation.`,
    );
  }
  if (toBigInt(params.financeSnapshot.pendingPayablesTomi) > 0n) {
    anomalies.push(
      `Pending payables remain open: ${formatTOS(
        toBigInt(params.financeSnapshot.pendingPayablesTomi),
      )}.`,
    );
  }
  if (toBigInt(period.netTomi) < 0n) {
    anomalies.push(
      `${params.periodKind} realized net is negative: ${formatTOS(
        toBigInt(period.netTomi),
      )}.`,
    );
  }

  gains.sort((left, right) =>
    Number(toBigInt(right.amountTomi) - toBigInt(left.amountTomi)),
  );
  losses.sort((left, right) => {
    const rightValue =
      toBigInt(right.amountTomi) || BigInt(right.amountCents ?? 0);
    const leftValue = toBigInt(left.amountTomi) || BigInt(left.amountCents ?? 0);
    return Number(rightValue - leftValue);
  });

  return {
    topGains: gains.slice(0, 5),
    topLosses: losses.slice(0, 5),
    anomalies,
  };
}

export async function buildOwnerFinanceSnapshot(params: {
  config: OpenFoxConfig;
  db: OpenFoxDatabase;
  periodKind: OwnerReportPeriodKind;
  nowMs?: number;
}): Promise<OwnerFinanceSnapshotData> {
  const nowMs = params.nowMs ?? Date.now();
  const financeSnapshot = await buildOperatorFinanceSnapshot(
    params.config,
    params.db,
    nowMs,
  );
  const { periodKind } = params;
  const { periodStart, periodEnd, sinceMs, untilMs } = periodBounds(
    periodKind,
    nowMs,
  );
  const period =
    periodKind === "daily"
      ? financeSnapshot.periods.today
      : financeSnapshot.periods.trailing7d;
  const attribution = collectAttributionEntries({
    config: params.config,
    db: params.db,
    periodKind,
    financeSnapshot,
    sinceMs,
    untilMs,
  });

  return {
    snapshotId: buildSnapshotId(periodKind, periodStart),
    periodKind,
    periodStart,
    periodEnd,
    generatedAt: new Date(nowMs).toISOString(),
    address: params.config.walletAddress,
    realizedRevenueTomi: period.revenueTomi,
    realizedCostTomi: period.costTomi,
    realizedNetTomi: period.netTomi,
    pendingReceivablesTomi: financeSnapshot.pendingReceivablesTomi,
    pendingPayablesTomi: financeSnapshot.pendingPayablesTomi,
    pendingNetTomi: (
      toBigInt(financeSnapshot.pendingReceivablesTomi) -
      toBigInt(financeSnapshot.pendingPayablesTomi)
    ).toString(),
    revenueEvents: period.revenueEvents,
    costEvents: period.costEvents,
    inferenceCostCents: period.inferenceCostCents,
    spendCostCents: period.spendCostCents,
    operatingCostCents: period.operatingCostCents,
    retryableFailedItems: financeSnapshot.retryableFailedItems,
    pendingOnchainTransactions: financeSnapshot.pendingOnchainTransactions,
    failedOnchainTransactions: financeSnapshot.failedOnchainTransactions,
    majorCategories: {
      x402RevenueTomi: financeSnapshot.revenueSources.x402ConfirmedTomi30d,
      bountySolverRewardsTomi: financeSnapshot.revenueSources.bountySolverRewardsTomi30d,
      x402CostTomi: financeSnapshot.costSources.x402ConfirmedTomi30d,
      bountyHostPayoutsTomi: financeSnapshot.costSources.bountyHostPayoutsTomi30d,
    },
    topGains: attribution.topGains,
    topLosses: attribution.topLosses,
    anomalies: attribution.anomalies,
    summary: `${periodKind} realized revenue=${formatTOS(
      toBigInt(period.revenueTomi),
    )}, cost=${formatTOS(toBigInt(period.costTomi))}, net=${formatTOS(
      toBigInt(period.netTomi),
    )}, pending=${formatTOS(
      toBigInt(financeSnapshot.pendingReceivablesTomi) -
        toBigInt(financeSnapshot.pendingPayablesTomi),
    )}`,
  };
}

export async function persistOwnerFinanceSnapshot(params: {
  config: OpenFoxConfig;
  db: OpenFoxDatabase;
  periodKind: OwnerReportPeriodKind;
  nowMs?: number;
}): Promise<OwnerFinanceSnapshotRecord> {
  const payload = await buildOwnerFinanceSnapshot(params);
  const record: OwnerFinanceSnapshotRecord = {
    snapshotId: payload.snapshotId,
    periodKind: payload.periodKind,
    periodStart: payload.periodStart,
    periodEnd: payload.periodEnd,
    payload,
    createdAt: payload.generatedAt,
    updatedAt: payload.generatedAt,
  };
  params.db.upsertOwnerFinanceSnapshot(record);
  return record;
}

export function buildOwnerFinanceSnapshotReport(
  snapshot: OwnerFinanceSnapshotData,
): string {
  return [
    "=== OPENFOX OWNER FINANCE SNAPSHOT ===",
    `Period:    ${snapshot.periodKind}`,
    `Range:     ${snapshot.periodStart} -> ${snapshot.periodEnd}`,
    `Revenue:   ${formatTOS(toBigInt(snapshot.realizedRevenueTomi))}`,
    `Cost:      ${formatTOS(toBigInt(snapshot.realizedCostTomi))}`,
    `Net:       ${formatTOS(toBigInt(snapshot.realizedNetTomi))}`,
    `Pending:   ${formatTOS(toBigInt(snapshot.pendingNetTomi))}`,
    `Events:    revenue=${snapshot.revenueEvents}, cost=${snapshot.costEvents}`,
    `Ops cost:  $${(snapshot.operatingCostCents / 100).toFixed(2)} (inference=$${(
      snapshot.inferenceCostCents / 100
    ).toFixed(2)}, spend=$${(snapshot.spendCostCents / 100).toFixed(2)})`,
    "",
    "Top gains:",
    ...(snapshot.topGains.length
      ? snapshot.topGains.map(
          (entry) =>
            `  - ${entry.title}: ${formatTOS(toBigInt(entry.amountTomi))}`,
        )
      : ["  (none)"]),
    "",
    "Top losses:",
    ...(snapshot.topLosses.length
      ? snapshot.topLosses.map((entry) => {
          const lineValue =
            entry.amountTomi !== "0"
              ? formatTOS(toBigInt(entry.amountTomi))
              : `$${((entry.amountCents ?? 0) / 100).toFixed(2)}`;
          return `  - ${entry.title}: ${lineValue}`;
        })
      : ["  (none)"]),
    "",
    "Anomalies:",
    ...(snapshot.anomalies.length
      ? snapshot.anomalies.map((item) => `  - ${item}`)
      : ["  (none)"]),
    "======================================",
  ].join("\n");
}
