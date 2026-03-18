import {
  getGroup,
  listGroupMembers,
} from "../group/store.js";
import type { OpenFoxDatabase } from "../types.js";
import {
  escapeHtml,
  renderMetaWorldPageFrame,
} from "./render.js";

const WEI_PER_TOS = 10n ** 18n;

type GroupTreasuryAttributionRole = "host" | "solver";

export interface GroupTreasuryCampaignSummary {
  campaignId: string;
  title: string;
  status: string;
  budgetWei: string;
  allocatedWei: string;
  remainingWei: string;
  bountyCount: number;
  openBountyCount: number;
  paidBountyCount: number;
  submissionCount: number;
  updatedAt: string;
}

export interface GroupTreasuryBountySummary {
  bountyId: string;
  campaignId: string | null;
  title: string;
  status: string;
  rewardWei: string;
  relation: string;
  payoutTxHash: string | null;
  updatedAt: string;
}

export interface GroupTreasurySettlementSummary {
  receiptId: string;
  kind: string;
  subjectId: string;
  relation: string;
  payoutTxHash: string | null;
  paymentTxHash: string | null;
  settlementTxHash: string | null;
  createdAt: string;
}

export interface GroupTreasurySnapshot {
  generatedAt: string;
  groupId: string;
  groupName: string;
  attributionSummary: string;
  summary: string;
  counts: {
    activeMemberCount: number;
    campaignCount: number;
    openCampaignCount: number;
    attributedBountyCount: number;
    openHostedBountyCount: number;
    approvedUnpaidBountyCount: number;
    settlementCount: number;
  };
  totals: {
    totalBudgetWei: string;
    allocatedBudgetWei: string;
    remainingBudgetWei: string;
    openCommitmentsWei: string;
    approvedUnpaidWei: string;
    pendingPayablesWei: string;
    pendingReceivablesWei: string;
    realizedHostPayoutsWei: string;
    realizedSolverEarningsWei: string;
  };
  campaigns: GroupTreasuryCampaignSummary[];
  recentBounties: GroupTreasuryBountySummary[];
  recentSettlements: GroupTreasurySettlementSummary[];
}

function toBigInt(value: string | bigint | null | undefined): bigint {
  if (typeof value === "bigint") return value;
  if (!value) return 0n;
  return BigInt(value);
}

function formatTOS(value: string | bigint): string {
  const bigintValue = toBigInt(value);
  const sign = bigintValue < 0n ? "-" : "";
  const abs = bigintValue < 0n ? -bigintValue : bigintValue;
  const whole = abs / WEI_PER_TOS;
  const fraction = abs % WEI_PER_TOS;
  if (fraction === 0n) {
    return `${sign}${whole.toString()} TOS`;
  }
  const decimals = fraction.toString().padStart(18, "0").replace(/0+$/, "");
  return `${sign}${whole.toString()}.${decimals.slice(0, 6)} TOS`;
}

function compareDescByUpdatedAt(
  left: { updatedAt: string },
  right: { updatedAt: string },
): number {
  const byTime = right.updatedAt.localeCompare(left.updatedAt);
  if (byTime !== 0) return byTime;
  return 0;
}

function collectCampaignProgress(
  db: OpenFoxDatabase,
  campaignId: string,
): {
  allocatedWei: bigint;
  remainingWei: bigint;
  bountyCount: number;
  openBountyCount: number;
  paidBountyCount: number;
  submissionCount: number;
} {
  const campaign = db.getCampaignById(campaignId);
  if (!campaign) {
    return {
      allocatedWei: 0n,
      remainingWei: 0n,
      bountyCount: 0,
      openBountyCount: 0,
      paidBountyCount: 0,
      submissionCount: 0,
    };
  }
  const bounties = db.listBountiesByCampaign(campaignId);
  const allocatedWei = bounties.reduce(
    (sum, bounty) => sum + toBigInt(bounty.rewardWei),
    0n,
  );
  const submissionCount = bounties.reduce(
    (sum, bounty) => sum + db.listBountySubmissions(bounty.bountyId).length,
    0,
  );
  const totalBudgetWei = toBigInt(campaign.budgetWei);
  return {
    allocatedWei,
    remainingWei: totalBudgetWei > allocatedWei ? totalBudgetWei - allocatedWei : 0n,
    bountyCount: bounties.length,
    openBountyCount: bounties.filter((item) => item.status === "open").length,
    paidBountyCount: bounties.filter((item) => item.status === "paid").length,
    submissionCount,
  };
}

export function buildGroupTreasurySnapshot(
  db: OpenFoxDatabase,
  options: {
    groupId: string;
    campaignLimit?: number;
    bountyLimit?: number;
    settlementLimit?: number;
  },
): GroupTreasurySnapshot {
  const group = getGroup(db, options.groupId);
  if (!group) {
    throw new Error(`group not found: ${options.groupId}`);
  }

  const campaignLimit = Math.max(1, options.campaignLimit ?? 12);
  const bountyLimit = Math.max(1, options.bountyLimit ?? 12);
  const settlementLimit = Math.max(1, options.settlementLimit ?? 12);

  const activeMembers = listGroupMembers(db, options.groupId).filter(
    (member) => member.membershipState === "active",
  );
  const activeMemberAddresses = new Set(
    activeMembers.map((member) => member.memberAddress.toLowerCase()),
  );

  const campaigns = db
    .listCampaigns()
    .filter((campaign) => activeMemberAddresses.has(campaign.hostAddress.toLowerCase()));

  let totalBudgetWei = 0n;
  let allocatedBudgetWei = 0n;
  let remainingBudgetWei = 0n;
  const campaignSummaries = campaigns
    .map((campaign) => {
      const progress = collectCampaignProgress(db, campaign.campaignId);
      totalBudgetWei += toBigInt(campaign.budgetWei);
      allocatedBudgetWei += progress.allocatedWei;
      remainingBudgetWei += progress.remainingWei;
      return {
        campaignId: campaign.campaignId,
        title: campaign.title,
        status: campaign.status,
        budgetWei: campaign.budgetWei,
        allocatedWei: progress.allocatedWei.toString(),
        remainingWei: progress.remainingWei.toString(),
        bountyCount: progress.bountyCount,
        openBountyCount: progress.openBountyCount,
        paidBountyCount: progress.paidBountyCount,
        submissionCount: progress.submissionCount,
        updatedAt: campaign.updatedAt,
      };
    })
    .sort(compareDescByUpdatedAt)
    .slice(0, campaignLimit);

  let openCommitmentsWei = 0n;
  let approvedUnpaidWei = 0n;
  let pendingPayablesWei = 0n;
  let pendingReceivablesWei = 0n;
  let realizedHostPayoutsWei = 0n;
  let realizedSolverEarningsWei = 0n;
  let openHostedBountyCount = 0;
  let approvedUnpaidBountyCount = 0;

  const bountyRelationMap = new Map<
    string,
    {
      bountyId: string;
      campaignId: string | null;
      title: string;
      status: string;
      rewardWei: string;
      roles: Set<GroupTreasuryAttributionRole>;
      payoutTxHash: string | null;
      updatedAt: string;
    }
  >();

  for (const bounty of db.listBounties()) {
    const bountyId = bounty.bountyId;
    const relation =
      bountyRelationMap.get(bountyId) ??
      {
        bountyId,
        campaignId: bounty.campaignId ?? null,
        title: bounty.title,
        status: bounty.status,
        rewardWei: bounty.rewardWei,
        roles: new Set<GroupTreasuryAttributionRole>(),
        payoutTxHash: null,
        updatedAt: bounty.updatedAt,
      };

    const rewardWei = toBigInt(bounty.rewardWei);
    if (activeMemberAddresses.has(bounty.hostAddress.toLowerCase())) {
      relation.roles.add("host");
      if (
        bounty.status === "open" ||
        bounty.status === "submitted" ||
        bounty.status === "under_review"
      ) {
        openCommitmentsWei += rewardWei;
        openHostedBountyCount += 1;
      }
      if (bounty.status === "approved") {
        approvedUnpaidWei += rewardWei;
        pendingPayablesWei += rewardWei;
        approvedUnpaidBountyCount += 1;
      }
    }

    const result = db.getBountyResult(bountyId);
    if (result?.winningSubmissionId) {
      const submission = db.getBountySubmission(result.winningSubmissionId);
      if (
        submission &&
        activeMemberAddresses.has(submission.solverAddress.toLowerCase())
      ) {
        relation.roles.add("solver");
        if (result.payoutTxHash) {
          realizedSolverEarningsWei += rewardWei;
        } else if (result.decision === "accepted") {
          pendingReceivablesWei += rewardWei;
        }
      }
      if (result.payoutTxHash && activeMemberAddresses.has(bounty.hostAddress.toLowerCase())) {
        realizedHostPayoutsWei += rewardWei;
      }
      relation.payoutTxHash = result.payoutTxHash ?? null;
      if (result.updatedAt) {
        relation.updatedAt = result.updatedAt;
      }
    }

    if (relation.roles.size > 0) {
      bountyRelationMap.set(bountyId, relation);
    }
  }

  const recentBounties = Array.from(bountyRelationMap.values())
    .sort(compareDescByUpdatedAt)
    .slice(0, bountyLimit)
    .map((item) => ({
      bountyId: item.bountyId,
      campaignId: item.campaignId,
      title: item.title,
      status: item.status,
      rewardWei: item.rewardWei,
      relation: Array.from(item.roles).sort().join("+"),
      payoutTxHash: item.payoutTxHash,
      updatedAt: item.updatedAt,
    }));

  const recentSettlements = db
    .listSettlementReceipts(Math.max(50, settlementLimit * 4))
    .flatMap((settlement) => {
      if (settlement.kind !== "bounty") {
        return [];
      }
      const relation = bountyRelationMap.get(settlement.subjectId);
      if (!relation) {
        return [];
      }
      return [
        {
          receiptId: settlement.receiptId,
          kind: settlement.kind,
          subjectId: settlement.subjectId,
          relation: Array.from(relation.roles).sort().join("+"),
          payoutTxHash: settlement.payoutTxHash ?? null,
          paymentTxHash: settlement.paymentTxHash ?? null,
          settlementTxHash: settlement.settlementTxHash ?? null,
          createdAt: settlement.createdAt,
        },
      ];
    })
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .slice(0, settlementLimit);

  const openCampaignCount = campaigns.filter((campaign) => campaign.status === "open").length;

  return {
    generatedAt: new Date().toISOString(),
    groupId: options.groupId,
    groupName: group.name,
    attributionSummary: `Derived from ${activeMembers.length} active member(s) and their hosted campaigns, bounty commitments, solver wins, and attributed bounty settlement receipts.`,
    summary: `${campaigns.length} campaign(s), ${formatTOS(totalBudgetWei)} total budget, ${formatTOS(remainingBudgetWei)} remaining, ${formatTOS(pendingPayablesWei)} pending payables, ${formatTOS(pendingReceivablesWei)} pending receivables.`,
    counts: {
      activeMemberCount: activeMembers.length,
      campaignCount: campaigns.length,
      openCampaignCount,
      attributedBountyCount: bountyRelationMap.size,
      openHostedBountyCount,
      approvedUnpaidBountyCount,
      settlementCount: recentSettlements.length,
    },
    totals: {
      totalBudgetWei: totalBudgetWei.toString(),
      allocatedBudgetWei: allocatedBudgetWei.toString(),
      remainingBudgetWei: remainingBudgetWei.toString(),
      openCommitmentsWei: openCommitmentsWei.toString(),
      approvedUnpaidWei: approvedUnpaidWei.toString(),
      pendingPayablesWei: pendingPayablesWei.toString(),
      pendingReceivablesWei: pendingReceivablesWei.toString(),
      realizedHostPayoutsWei: realizedHostPayoutsWei.toString(),
      realizedSolverEarningsWei: realizedSolverEarningsWei.toString(),
    },
    campaigns: campaignSummaries,
    recentBounties,
    recentSettlements,
  };
}

export function buildGroupTreasuryHtml(
  snapshot: GroupTreasurySnapshot,
  options?: {
    homeHref?: string;
    groupPageHref?: string;
    foxDirectoryHref?: string;
    groupDirectoryHref?: string;
    searchHref?: string;
  },
): string {
  const campaignItems = snapshot.campaigns
    .map(
      (campaign) => `<li><strong>${escapeHtml(campaign.title)}</strong><span>${escapeHtml(campaign.status)} · budget ${escapeHtml(formatTOS(campaign.budgetWei))} · remaining ${escapeHtml(formatTOS(campaign.remainingWei))}</span></li>`,
    )
    .join("");
  const bountyItems = snapshot.recentBounties
    .map(
      (bounty) => `<li><strong>${escapeHtml(bounty.title)}</strong><span>${escapeHtml(bounty.relation)} · ${escapeHtml(bounty.status)} · reward ${escapeHtml(formatTOS(bounty.rewardWei))}</span></li>`,
    )
    .join("");
  const settlementItems = snapshot.recentSettlements
    .map(
      (settlement) => `<li><strong>${escapeHtml(settlement.kind)}</strong><span>${escapeHtml(settlement.relation)} · ${escapeHtml(settlement.subjectId)} · ${escapeHtml(settlement.createdAt)}</span></li>`,
    )
    .join("");

  return renderMetaWorldPageFrame({
    title: `Treasury & Budget · ${snapshot.groupName} · OpenFox metaWorld`,
    eyebrow: "OpenFox Group Treasury",
    heading: snapshot.groupName,
    lede: `${snapshot.summary} ${snapshot.attributionSummary}`,
    generatedAt: snapshot.generatedAt,
    metrics: [
      { label: "Campaigns", value: snapshot.counts.campaignCount },
      { label: "Total budget", value: formatTOS(snapshot.totals.totalBudgetWei) },
      { label: "Remaining", value: formatTOS(snapshot.totals.remainingBudgetWei) },
      { label: "Pending payables", value: formatTOS(snapshot.totals.pendingPayablesWei) },
    ],
    navLinks: [
      { label: "World Shell", href: options?.homeHref ?? "/" },
      { label: "Group Page", href: options?.groupPageHref ?? "#" },
      { label: "Fox Directory", href: options?.foxDirectoryHref ?? "/directory/foxes" },
      { label: "Group Directory", href: options?.groupDirectoryHref ?? "/directory/groups" },
      { label: "Search", href: options?.searchHref ?? "/search" },
    ],
    sections: [
      `<section class="grid">
        <section class="panel">
          <div class="section-head">
            <h3>Budget State</h3>
            <span>${snapshot.counts.activeMemberCount} active member(s)</span>
          </div>
          <div class="list-grid">
            <article class="list-card">
              <div class="meta-row"><span>Total budget</span><span>${escapeHtml(formatTOS(snapshot.totals.totalBudgetWei))}</span></div>
              <div class="meta-row"><span>Allocated</span><span>${escapeHtml(formatTOS(snapshot.totals.allocatedBudgetWei))}</span></div>
              <div class="meta-row"><span>Remaining</span><span>${escapeHtml(formatTOS(snapshot.totals.remainingBudgetWei))}</span></div>
            </article>
            <article class="list-card">
              <div class="meta-row"><span>Open commitments</span><span>${escapeHtml(formatTOS(snapshot.totals.openCommitmentsWei))}</span></div>
              <div class="meta-row"><span>Approved unpaid</span><span>${escapeHtml(formatTOS(snapshot.totals.approvedUnpaidWei))}</span></div>
              <div class="meta-row"><span>Pending payables</span><span>${escapeHtml(formatTOS(snapshot.totals.pendingPayablesWei))}</span></div>
            </article>
            <article class="list-card">
              <div class="meta-row"><span>Pending receivables</span><span>${escapeHtml(formatTOS(snapshot.totals.pendingReceivablesWei))}</span></div>
              <div class="meta-row"><span>Realized host payouts</span><span>${escapeHtml(formatTOS(snapshot.totals.realizedHostPayoutsWei))}</span></div>
              <div class="meta-row"><span>Realized solver earnings</span><span>${escapeHtml(formatTOS(snapshot.totals.realizedSolverEarningsWei))}</span></div>
            </article>
          </div>
        </section>
        <section class="panel">
          <div class="section-head">
            <h3>Attribution Scope</h3>
            <span>${snapshot.counts.attributedBountyCount} attributed bounty item(s)</span>
          </div>
          <p class="lede">${escapeHtml(snapshot.attributionSummary)}</p>
          <ul class="directory-list">
            <li><strong>Open campaigns</strong><span>${snapshot.counts.openCampaignCount}</span></li>
            <li><strong>Open hosted bounties</strong><span>${snapshot.counts.openHostedBountyCount}</span></li>
            <li><strong>Approved unpaid bounties</strong><span>${snapshot.counts.approvedUnpaidBountyCount}</span></li>
            <li><strong>Attributed settlements</strong><span>${snapshot.counts.settlementCount}</span></li>
          </ul>
        </section>
      </section>`,
      `<section class="grid">
        <section class="panel">
          <div class="section-head">
            <h3>Campaign Budgets</h3>
            <span>${snapshot.campaigns.length}</span>
          </div>
          <ul class="directory-list">${campaignItems || '<li class="empty">No attributed campaigns.</li>'}</ul>
        </section>
        <section class="panel">
          <div class="section-head">
            <h3>Recent Bounty Activity</h3>
            <span>${snapshot.recentBounties.length}</span>
          </div>
          <ul class="directory-list">${bountyItems || '<li class="empty">No attributed bounty activity.</li>'}</ul>
        </section>
      </section>`,
      `<section class="panel">
        <div class="section-head">
          <h3>Settlement Trails</h3>
          <span>${snapshot.recentSettlements.length}</span>
        </div>
        <ul class="directory-list">${settlementItems || '<li class="empty">No attributed settlement receipts.</li>'}</ul>
      </section>`,
    ],
  });
}
