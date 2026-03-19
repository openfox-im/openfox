import type { OpenFoxConfig, OpenFoxDatabase } from "../types.js";
import { buildWalletStatusSnapshot } from "../wallet/operator.js";

const WEI_PER_TOS = 10n ** 18n;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface OperatorWalletSnapshot {
  kind: "wallet";
  generatedAt: string;
  address: string;
  rpcUrl: string | null;
  chainId: string | null;
  signerType: string | null;
  signerValue: string | null;
  signerDefaulted: boolean | null;
  rpcReachable: boolean;
  rpcError: string | null;
  balanceTomi: string | null;
  nonce: string | null;
  openCommitmentsTomi: string;
  approvedUnpaidTomi: string;
  reservedBalanceTomi: string;
  availableBalanceTomi: string | null;
  pendingReceivablesTomi: string;
  pendingPayablesTomi: string;
  retryableFailedItems: number;
  pendingOnchainTransactions: number;
  failedOnchainTransactions: number;
  averageDailyNativeCostTomi30d: string;
  runwayDays: number | null;
  summary: string;
}

export interface OperatorFinancePeriodSnapshot {
  label: "today" | "7d" | "30d";
  revenueTomi: string;
  costTomi: string;
  netTomi: string;
  revenueEvents: number;
  costEvents: number;
  inferenceCostCents: number;
  spendCostCents: number;
  operatingCostCents: number;
}

export interface OperatorFinanceSnapshot {
  kind: "finance";
  generatedAt: string;
  address: string;
  periods: {
    today: OperatorFinancePeriodSnapshot;
    trailing7d: OperatorFinancePeriodSnapshot;
    trailing30d: OperatorFinancePeriodSnapshot;
  };
  pendingReceivablesTomi: string;
  pendingPayablesTomi: string;
  retryableFailedItems: number;
  pendingOnchainTransactions: number;
  failedOnchainTransactions: number;
  revenueSources: {
    x402ConfirmedTomi30d: string;
    bountySolverRewardsTomi30d: string;
  };
  costSources: {
    x402ConfirmedTomi30d: string;
    bountyHostPayoutsTomi30d: string;
  };
  summary: string;
}

interface FinancialContext {
  nowMs: number;
  address: string;
  x402Payments: Array<Record<string, unknown>>;
  bounties: ReturnType<OpenFoxDatabase["listBounties"]>;
  pendingSettlementCallbacks: number;
  retryableSettlementFailures: number;
  pendingMarketCallbacks: number;
  retryableMarketFailures: number;
  pendingOnchainTransactions: number;
  failedOnchainTransactions: number;
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

function formatUsdCents(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}$${(abs / 100).toFixed(2)}`;
}

function startOfTodayUtcMs(nowMs: number): number {
  const now = new Date(nowMs);
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
}

function queryRows(
  db: OpenFoxDatabase,
  sql: string,
  params: unknown[] = [],
): Array<Record<string, unknown>> {
  return db.raw.prepare(sql).all(...params) as Array<Record<string, unknown>>;
}

function queryNumber(
  db: OpenFoxDatabase,
  sql: string,
  params: unknown[] = [],
): number {
  const row = db.raw.prepare(sql).get(...params) as { total?: number } | undefined;
  return row?.total ?? 0;
}

function listAllX402Payments(db: OpenFoxDatabase): Array<Record<string, unknown>> {
  return queryRows(
    db,
    "SELECT * FROM x402_payments ORDER BY created_at DESC",
  );
}

function getRetryableFailedCount(
  db: OpenFoxDatabase,
  table: "settlement_callbacks" | "market_contract_callbacks" | "x402_payments",
): number {
  return queryNumber(
    db,
    `SELECT COUNT(*) as total
       FROM ${table}
      WHERE status = 'failed' AND next_attempt_at IS NOT NULL`,
  );
}

function getPendingOnchainCount(db: OpenFoxDatabase): number {
  return queryNumber(
    db,
    "SELECT COUNT(*) as total FROM onchain_transactions WHERE status IN ('submitted', 'pending')",
  );
}

function getFailedOnchainCount(db: OpenFoxDatabase): number {
  return queryNumber(
    db,
    "SELECT COUNT(*) as total FROM onchain_transactions WHERE status = 'failed'",
  );
}

function getInferenceCostSince(db: OpenFoxDatabase, sinceMs: number): number {
  return queryNumber(
    db,
    `SELECT COALESCE(SUM(cost_cents), 0) as total
       FROM inference_costs
      WHERE created_at >= ?`,
    [new Date(sinceMs).toISOString().replace("T", " ").replace(/\.\d{3}Z$/, "")],
  );
}

function getSpendCostSince(db: OpenFoxDatabase, sinceMs: number): number {
  return queryNumber(
    db,
    `SELECT COALESCE(SUM(amount_cents), 0) as total
       FROM spend_tracking
      WHERE created_at >= ?`,
    [new Date(sinceMs).toISOString().replace("T", " ").replace(/\.\d{3}Z$/, "")],
  );
}

function buildFinancialContext(
  config: OpenFoxConfig,
  db: OpenFoxDatabase,
  nowMs: number,
): FinancialContext {
  return {
    nowMs,
    address: config.walletAddress.toLowerCase(),
    x402Payments: listAllX402Payments(db),
    bounties: db.listBounties(),
    pendingSettlementCallbacks: db.listSettlementCallbacks(1000, {
      status: "pending",
    }).length,
    retryableSettlementFailures: getRetryableFailedCount(db, "settlement_callbacks"),
    pendingMarketCallbacks: db.listMarketContractCallbacks(1000, {
      status: "pending",
    }).length,
    retryableMarketFailures: getRetryableFailedCount(db, "market_contract_callbacks"),
    pendingOnchainTransactions: getPendingOnchainCount(db),
    failedOnchainTransactions: getFailedOnchainCount(db),
  };
}

function collectBountyWalletFlows(context: FinancialContext, db: OpenFoxDatabase): {
  openCommitmentsTomi: bigint;
  approvedUnpaidTomi: bigint;
  pendingReceivableRewardsTomi: bigint;
  pendingPayableRewardsTomi: bigint;
} {
  let openCommitmentsTomi = 0n;
  let approvedUnpaidTomi = 0n;
  let pendingReceivableRewardsTomi = 0n;
  let pendingPayableRewardsTomi = 0n;

  for (const bounty of context.bounties) {
    const rewardTomi = toBigInt(bounty.rewardTomi);
    const hostOwnsBounty = bounty.hostAddress.toLowerCase() === context.address;
    if (
      hostOwnsBounty &&
      (bounty.status === "open" ||
        bounty.status === "submitted" ||
        bounty.status === "under_review")
    ) {
      openCommitmentsTomi += rewardTomi;
    }

    if (hostOwnsBounty && bounty.status === "approved") {
      approvedUnpaidTomi += rewardTomi;
      pendingPayableRewardsTomi += rewardTomi;
    }

    const result = db.getBountyResult(bounty.bountyId);
    if (!result || !result.winningSubmissionId) continue;
    const winningSubmission = db.getBountySubmission(result.winningSubmissionId);
    if (!winningSubmission) continue;
    const solverWon = winningSubmission.solverAddress.toLowerCase() === context.address;
    if (solverWon && !result.payoutTxHash) {
      pendingReceivableRewardsTomi += rewardTomi;
    }
  }

  return {
    openCommitmentsTomi,
    approvedUnpaidTomi,
    pendingReceivableRewardsTomi,
    pendingPayableRewardsTomi,
  };
}

function collectPendingX402Flows(context: FinancialContext): {
  pendingIncomingTomi: bigint;
  pendingOutgoingTomi: bigint;
} {
  let pendingIncomingTomi = 0n;
  let pendingOutgoingTomi = 0n;
  for (const row of context.x402Payments) {
    const status = String(row.status || "");
    if (status !== "verified" && status !== "submitted") continue;
    const amountTomi = toBigInt(String(row.amount_tomi ?? row.amountTomi ?? "0"));
    const payer = String(row.payer_address ?? row.payerAddress ?? "").toLowerCase();
    const provider = String(
      row.provider_address ?? row.providerAddress ?? "",
    ).toLowerCase();
    if (provider === context.address) pendingIncomingTomi += amountTomi;
    if (payer === context.address) pendingOutgoingTomi += amountTomi;
  }
  return { pendingIncomingTomi, pendingOutgoingTomi };
}

function computeRunwayDays(balanceTomi: bigint, avgDailyCostTomi: bigint): number | null {
  if (avgDailyCostTomi <= 0n) return null;
  return Number(balanceTomi) / Number(avgDailyCostTomi);
}

function buildPeriodSnapshot(params: {
  label: "today" | "7d" | "30d";
  sinceMs: number;
  context: FinancialContext;
  db: OpenFoxDatabase;
}): {
  period: OperatorFinancePeriodSnapshot;
  x402RevenueTomi: bigint;
  x402CostTomi: bigint;
  bountyRevenueTomi: bigint;
  bountyCostTomi: bigint;
} {
  let x402RevenueTomi = 0n;
  let x402CostTomi = 0n;
  for (const row of params.context.x402Payments) {
    const updatedAt = toMs(String(row.updated_at ?? row.updatedAt ?? ""));
    if (updatedAt < params.sinceMs) continue;
    if (String(row.status || "") !== "confirmed") continue;
    const amountTomi = toBigInt(String(row.amount_tomi ?? row.amountTomi ?? "0"));
    const payer = String(row.payer_address ?? row.payerAddress ?? "").toLowerCase();
    const provider = String(
      row.provider_address ?? row.providerAddress ?? "",
    ).toLowerCase();
    if (provider === params.context.address) x402RevenueTomi += amountTomi;
    if (payer === params.context.address) x402CostTomi += amountTomi;
  }

  let bountyRevenueTomi = 0n;
  let bountyCostTomi = 0n;
  let revenueEvents = 0;
  let costEvents = 0;
  for (const bounty of params.context.bounties) {
    const rewardTomi = toBigInt(bounty.rewardTomi);
    const result = params.db.getBountyResult(bounty.bountyId);
    if (!result || !result.payoutTxHash) continue;
    const updatedAt = toMs(result.updatedAt);
    if (updatedAt < params.sinceMs) continue;
    const winningSubmission = result.winningSubmissionId
      ? params.db.getBountySubmission(result.winningSubmissionId)
      : undefined;
    if (
      winningSubmission &&
      winningSubmission.solverAddress.toLowerCase() === params.context.address
    ) {
      bountyRevenueTomi += rewardTomi;
      revenueEvents += 1;
    }
    if (bounty.hostAddress.toLowerCase() === params.context.address) {
      bountyCostTomi += rewardTomi;
      costEvents += 1;
    }
  }

  const revenueTomi = x402RevenueTomi + bountyRevenueTomi;
  const costTomi = x402CostTomi + bountyCostTomi;
  const inferenceCostCents = getInferenceCostSince(params.db, params.sinceMs);
  const spendCostCents = getSpendCostSince(params.db, params.sinceMs);
  return {
    period: {
      label: params.label,
      revenueTomi: revenueTomi.toString(),
      costTomi: costTomi.toString(),
      netTomi: (revenueTomi - costTomi).toString(),
      revenueEvents:
        revenueEvents +
        params.context.x402Payments.filter((row) => {
          const updatedAt = toMs(String(row.updated_at ?? row.updatedAt ?? ""));
          if (updatedAt < params.sinceMs) return false;
          return (
            String(row.status || "") === "confirmed" &&
            String(row.provider_address ?? row.providerAddress ?? "").toLowerCase() ===
              params.context.address
          );
        }).length,
      costEvents:
        costEvents +
        params.context.x402Payments.filter((row) => {
          const updatedAt = toMs(String(row.updated_at ?? row.updatedAt ?? ""));
          if (updatedAt < params.sinceMs) return false;
          return (
            String(row.status || "") === "confirmed" &&
            String(row.payer_address ?? row.payerAddress ?? "").toLowerCase() ===
              params.context.address
          );
        }).length,
      inferenceCostCents,
      spendCostCents,
      operatingCostCents: inferenceCostCents + spendCostCents,
    },
    x402RevenueTomi,
    x402CostTomi,
    bountyRevenueTomi,
    bountyCostTomi,
  };
}

export async function buildOperatorWalletSnapshot(
  config: OpenFoxConfig,
  db: OpenFoxDatabase,
  nowMs: number = Date.now(),
): Promise<OperatorWalletSnapshot> {
  const context = buildFinancialContext(config, db, nowMs);
  const bountyFlows = collectBountyWalletFlows(context, db);
  const x402Flows = collectPendingX402Flows(context);

  let balanceTomi: bigint | null = null;
  let nonce: bigint | null = null;
  let chainId: bigint | null = null;
  let signerType: string | null = null;
  let signerValue: string | null = null;
  let signerDefaulted: boolean | null = null;
  let rpcReachable = false;
  let rpcError: string | null = null;
  try {
    const snapshot = await buildWalletStatusSnapshot(config);
    balanceTomi = snapshot.balanceTomi ?? null;
    nonce = snapshot.nonce ?? null;
    chainId = snapshot.chainId ?? null;
    signerType = snapshot.signer?.type ?? null;
    signerValue = snapshot.signer?.value ?? null;
    signerDefaulted = snapshot.signer?.defaulted ?? null;
    rpcReachable = Boolean(snapshot.rpcUrl && snapshot.balanceTomi !== undefined);
  } catch (error) {
    rpcError = error instanceof Error ? error.message : String(error);
  }

  const pendingReceivablesTomi =
    bountyFlows.pendingReceivableRewardsTomi + x402Flows.pendingIncomingTomi;
  const pendingPayablesTomi =
    bountyFlows.pendingPayableRewardsTomi + x402Flows.pendingOutgoingTomi;
  const reservedBalanceTomi =
    bountyFlows.openCommitmentsTomi + bountyFlows.approvedUnpaidTomi;
  const availableBalanceTomi =
    balanceTomi === null ? null : balanceTomi > reservedBalanceTomi ? balanceTomi - reservedBalanceTomi : 0n;
  const period30 = buildPeriodSnapshot({
    label: "30d",
    sinceMs: nowMs - 30 * MS_PER_DAY,
    context,
    db,
  }).period;
  const averageDailyNativeCostTomi30d = toBigInt(period30.costTomi) / 30n;
  const runwayDays =
    availableBalanceTomi === null
      ? null
      : computeRunwayDays(availableBalanceTomi, averageDailyNativeCostTomi30d);
  const retryableFailedItems =
    getRetryableFailedCount(db, "x402_payments") +
    context.retryableSettlementFailures +
    context.retryableMarketFailures;

  const summaryBalance =
    balanceTomi === null
      ? "rpc unavailable"
      : `balance=${formatTOS(balanceTomi)} reserved=${formatTOS(reservedBalanceTomi)} available=${formatTOS(availableBalanceTomi ?? 0n)}`;
  const runwaySummary =
    runwayDays === null
      ? "runway=infinite"
      : `runway=${runwayDays.toFixed(1)}d`;

  return {
    kind: "wallet",
    generatedAt: new Date(nowMs).toISOString(),
    address: config.walletAddress,
    rpcUrl: config.rpcUrl || null,
    chainId: chainId?.toString() ?? null,
    signerType,
    signerValue,
    signerDefaulted,
    rpcReachable,
    rpcError,
    balanceTomi: balanceTomi?.toString() ?? null,
    nonce: nonce?.toString() ?? null,
    openCommitmentsTomi: bountyFlows.openCommitmentsTomi.toString(),
    approvedUnpaidTomi: bountyFlows.approvedUnpaidTomi.toString(),
    reservedBalanceTomi: reservedBalanceTomi.toString(),
    availableBalanceTomi: availableBalanceTomi?.toString() ?? null,
    pendingReceivablesTomi: pendingReceivablesTomi.toString(),
    pendingPayablesTomi: pendingPayablesTomi.toString(),
    retryableFailedItems,
    pendingOnchainTransactions: context.pendingOnchainTransactions,
    failedOnchainTransactions: context.failedOnchainTransactions,
    averageDailyNativeCostTomi30d: averageDailyNativeCostTomi30d.toString(),
    runwayDays,
    summary: `${summaryBalance}, receivable=${formatTOS(
      pendingReceivablesTomi,
    )}, payable=${formatTOS(pendingPayablesTomi)}, ${runwaySummary}`,
  };
}

export async function buildOperatorFinanceSnapshot(
  config: OpenFoxConfig,
  db: OpenFoxDatabase,
  nowMs: number = Date.now(),
): Promise<OperatorFinanceSnapshot> {
  const context = buildFinancialContext(config, db, nowMs);
  const bountyFlows = collectBountyWalletFlows(context, db);
  const x402Flows = collectPendingX402Flows(context);
  const today = buildPeriodSnapshot({
    label: "today",
    sinceMs: startOfTodayUtcMs(nowMs),
    context,
    db,
  });
  const trailing7d = buildPeriodSnapshot({
    label: "7d",
    sinceMs: nowMs - 7 * MS_PER_DAY,
    context,
    db,
  });
  const trailing30d = buildPeriodSnapshot({
    label: "30d",
    sinceMs: nowMs - 30 * MS_PER_DAY,
    context,
    db,
  });
  const pendingReceivablesTomi =
    bountyFlows.pendingReceivableRewardsTomi + x402Flows.pendingIncomingTomi;
  const pendingPayablesTomi =
    bountyFlows.pendingPayableRewardsTomi + x402Flows.pendingOutgoingTomi;
  const retryableFailedItems =
    getRetryableFailedCount(db, "x402_payments") +
    context.retryableSettlementFailures +
    context.retryableMarketFailures;

  return {
    kind: "finance",
    generatedAt: new Date(nowMs).toISOString(),
    address: config.walletAddress,
    periods: {
      today: today.period,
      trailing7d: trailing7d.period,
      trailing30d: trailing30d.period,
    },
    pendingReceivablesTomi: pendingReceivablesTomi.toString(),
    pendingPayablesTomi: pendingPayablesTomi.toString(),
    retryableFailedItems,
    pendingOnchainTransactions: context.pendingOnchainTransactions,
    failedOnchainTransactions: context.failedOnchainTransactions,
    revenueSources: {
      x402ConfirmedTomi30d: trailing30d.x402RevenueTomi.toString(),
      bountySolverRewardsTomi30d: trailing30d.bountyRevenueTomi.toString(),
    },
    costSources: {
      x402ConfirmedTomi30d: trailing30d.x402CostTomi.toString(),
      bountyHostPayoutsTomi30d: trailing30d.bountyCostTomi.toString(),
    },
    summary: `30d revenue=${formatTOS(
      toBigInt(trailing30d.period.revenueTomi),
    )}, cost=${formatTOS(toBigInt(trailing30d.period.costTomi))}, net=${formatTOS(
      toBigInt(trailing30d.period.netTomi),
    )}, operating=${formatUsdCents(trailing30d.period.operatingCostCents)}`,
  };
}

export function buildOperatorWalletReport(snapshot: OperatorWalletSnapshot): string {
  return [
    "=== OPENFOX WALLET REPORT ===",
    `Address: ${snapshot.address}`,
    `RPC: ${snapshot.rpcUrl || "(unset)"}`,
    `Chain: ${snapshot.chainId || "(unknown)"}`,
    `Signer: ${snapshot.signerType || "(unknown)"} ${snapshot.signerValue || ""}`.trim(),
    `Signer defaulted: ${
      snapshot.signerDefaulted === null ? "(unknown)" : snapshot.signerDefaulted ? "yes" : "no"
    }`,
    `Balance: ${
      snapshot.balanceTomi !== null
        ? formatTOS(toBigInt(snapshot.balanceTomi))
        : "(unknown)"
    }`,
    `Reserved: ${formatTOS(toBigInt(snapshot.reservedBalanceTomi))}`,
    `Available: ${
      snapshot.availableBalanceTomi !== null
        ? formatTOS(toBigInt(snapshot.availableBalanceTomi))
        : "(unknown)"
    }`,
    `Pending receivables: ${formatTOS(toBigInt(snapshot.pendingReceivablesTomi))}`,
    `Pending payables: ${formatTOS(toBigInt(snapshot.pendingPayablesTomi))}`,
    `Open commitments: ${formatTOS(toBigInt(snapshot.openCommitmentsTomi))}`,
    `Approved unpaid: ${formatTOS(toBigInt(snapshot.approvedUnpaidTomi))}`,
    `Pending on-chain tx: ${snapshot.pendingOnchainTransactions}`,
    `Failed on-chain tx: ${snapshot.failedOnchainTransactions}`,
    `Retryable failed items: ${snapshot.retryableFailedItems}`,
    `Average daily native cost (30d): ${formatTOS(
      toBigInt(snapshot.averageDailyNativeCostTomi30d),
    )}`,
    `Runway: ${snapshot.runwayDays === null ? "infinite/unknown" : `${snapshot.runwayDays.toFixed(1)} days`}`,
    `Summary: ${snapshot.summary}`,
    ...(snapshot.rpcError ? [`RPC error: ${snapshot.rpcError}`] : []),
  ].join("\n");
}

function buildFinancePeriodLine(
  label: string,
  period: OperatorFinancePeriodSnapshot,
): string[] {
  return [
    `${label}:`,
    `  Revenue: ${formatTOS(toBigInt(period.revenueTomi))} (${period.revenueEvents} event${period.revenueEvents === 1 ? "" : "s"})`,
    `  Cost: ${formatTOS(toBigInt(period.costTomi))} (${period.costEvents} event${period.costEvents === 1 ? "" : "s"})`,
    `  Net: ${formatTOS(toBigInt(period.netTomi))}`,
    `  Operating cost: ${formatUsdCents(period.operatingCostCents)} (inference=${formatUsdCents(period.inferenceCostCents)}, spend=${formatUsdCents(period.spendCostCents)})`,
  ];
}

export function buildOperatorFinanceReport(snapshot: OperatorFinanceSnapshot): string {
  return [
    "=== OPENFOX FINANCE REPORT ===",
    `Address: ${snapshot.address}`,
    ...buildFinancePeriodLine("Today", snapshot.periods.today),
    ...buildFinancePeriodLine("Trailing 7d", snapshot.periods.trailing7d),
    ...buildFinancePeriodLine("Trailing 30d", snapshot.periods.trailing30d),
    `Pending receivables: ${formatTOS(toBigInt(snapshot.pendingReceivablesTomi))}`,
    `Pending payables: ${formatTOS(toBigInt(snapshot.pendingPayablesTomi))}`,
    `Retryable failed items: ${snapshot.retryableFailedItems}`,
    `Pending on-chain tx: ${snapshot.pendingOnchainTransactions}`,
    `Failed on-chain tx: ${snapshot.failedOnchainTransactions}`,
    `30d revenue sources: x402=${formatTOS(
      toBigInt(snapshot.revenueSources.x402ConfirmedTomi30d),
    )}, bounty_solver_rewards=${formatTOS(
      toBigInt(snapshot.revenueSources.bountySolverRewardsTomi30d),
    )}`,
    `30d cost sources: x402=${formatTOS(
      toBigInt(snapshot.costSources.x402ConfirmedTomi30d),
    )}, bounty_host_payouts=${formatTOS(
      toBigInt(snapshot.costSources.bountyHostPayoutsTomi30d),
    )}`,
    `Summary: ${snapshot.summary}`,
  ].join("\n");
}
