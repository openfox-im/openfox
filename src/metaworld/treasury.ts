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
  budgetTomi: string;
  allocatedTomi: string;
  remainingTomi: string;
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
  rewardTomi: string;
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
    totalBudgetTomi: string;
    allocatedBudgetTomi: string;
    remainingBudgetTomi: string;
    openCommitmentsTomi: string;
    approvedUnpaidTomi: string;
    pendingPayablesTomi: string;
    pendingReceivablesTomi: string;
    realizedHostPayoutsTomi: string;
    realizedSolverEarningsTomi: string;
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
  allocatedTomi: bigint;
  remainingTomi: bigint;
  bountyCount: number;
  openBountyCount: number;
  paidBountyCount: number;
  submissionCount: number;
} {
  const campaign = db.getCampaignById(campaignId);
  if (!campaign) {
    return {
      allocatedTomi: 0n,
      remainingTomi: 0n,
      bountyCount: 0,
      openBountyCount: 0,
      paidBountyCount: 0,
      submissionCount: 0,
    };
  }
  const bounties = db.listBountiesByCampaign(campaignId);
  const allocatedTomi = bounties.reduce(
    (sum, bounty) => sum + toBigInt(bounty.rewardTomi),
    0n,
  );
  const submissionCount = bounties.reduce(
    (sum, bounty) => sum + db.listBountySubmissions(bounty.bountyId).length,
    0,
  );
  const totalBudgetTomi = toBigInt(campaign.budgetTomi);
  return {
    allocatedTomi,
    remainingTomi: totalBudgetTomi > allocatedTomi ? totalBudgetTomi - allocatedTomi : 0n,
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

  let totalBudgetTomi = 0n;
  let allocatedBudgetTomi = 0n;
  let remainingBudgetTomi = 0n;
  const campaignSummaries = campaigns
    .map((campaign) => {
      const progress = collectCampaignProgress(db, campaign.campaignId);
      totalBudgetTomi += toBigInt(campaign.budgetTomi);
      allocatedBudgetTomi += progress.allocatedTomi;
      remainingBudgetTomi += progress.remainingTomi;
      return {
        campaignId: campaign.campaignId,
        title: campaign.title,
        status: campaign.status,
        budgetTomi: campaign.budgetTomi,
        allocatedTomi: progress.allocatedTomi.toString(),
        remainingTomi: progress.remainingTomi.toString(),
        bountyCount: progress.bountyCount,
        openBountyCount: progress.openBountyCount,
        paidBountyCount: progress.paidBountyCount,
        submissionCount: progress.submissionCount,
        updatedAt: campaign.updatedAt,
      };
    })
    .sort(compareDescByUpdatedAt)
    .slice(0, campaignLimit);

  let openCommitmentsTomi = 0n;
  let approvedUnpaidTomi = 0n;
  let pendingPayablesTomi = 0n;
  let pendingReceivablesTomi = 0n;
  let realizedHostPayoutsTomi = 0n;
  let realizedSolverEarningsTomi = 0n;
  let openHostedBountyCount = 0;
  let approvedUnpaidBountyCount = 0;

  const bountyRelationMap = new Map<
    string,
    {
      bountyId: string;
      campaignId: string | null;
      title: string;
      status: string;
      rewardTomi: string;
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
        rewardTomi: bounty.rewardTomi,
        roles: new Set<GroupTreasuryAttributionRole>(),
        payoutTxHash: null,
        updatedAt: bounty.updatedAt,
      };

    const rewardTomi = toBigInt(bounty.rewardTomi);
    if (activeMemberAddresses.has(bounty.hostAddress.toLowerCase())) {
      relation.roles.add("host");
      if (
        bounty.status === "open" ||
        bounty.status === "submitted" ||
        bounty.status === "under_review"
      ) {
        openCommitmentsTomi += rewardTomi;
        openHostedBountyCount += 1;
      }
      if (bounty.status === "approved") {
        approvedUnpaidTomi += rewardTomi;
        pendingPayablesTomi += rewardTomi;
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
          realizedSolverEarningsTomi += rewardTomi;
        } else if (result.decision === "accepted") {
          pendingReceivablesTomi += rewardTomi;
        }
      }
      if (result.payoutTxHash && activeMemberAddresses.has(bounty.hostAddress.toLowerCase())) {
        realizedHostPayoutsTomi += rewardTomi;
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
      rewardTomi: item.rewardTomi,
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
    summary: `${campaigns.length} campaign(s), ${formatTOS(totalBudgetTomi)} total budget, ${formatTOS(remainingBudgetTomi)} remaining, ${formatTOS(pendingPayablesTomi)} pending payables, ${formatTOS(pendingReceivablesTomi)} pending receivables.`,
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
      totalBudgetTomi: totalBudgetTomi.toString(),
      allocatedBudgetTomi: allocatedBudgetTomi.toString(),
      remainingBudgetTomi: remainingBudgetTomi.toString(),
      openCommitmentsTomi: openCommitmentsTomi.toString(),
      approvedUnpaidTomi: approvedUnpaidTomi.toString(),
      pendingPayablesTomi: pendingPayablesTomi.toString(),
      pendingReceivablesTomi: pendingReceivablesTomi.toString(),
      realizedHostPayoutsTomi: realizedHostPayoutsTomi.toString(),
      realizedSolverEarningsTomi: realizedSolverEarningsTomi.toString(),
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
      (campaign) => `<li><strong>${escapeHtml(campaign.title)}</strong><span>${escapeHtml(campaign.status)} · budget ${escapeHtml(formatTOS(campaign.budgetTomi))} · remaining ${escapeHtml(formatTOS(campaign.remainingTomi))}</span></li>`,
    )
    .join("");
  const bountyItems = snapshot.recentBounties
    .map(
      (bounty) => `<li><strong>${escapeHtml(bounty.title)}</strong><span>${escapeHtml(bounty.relation)} · ${escapeHtml(bounty.status)} · reward ${escapeHtml(formatTOS(bounty.rewardTomi))}</span></li>`,
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
      { label: "Total budget", value: formatTOS(snapshot.totals.totalBudgetTomi) },
      { label: "Remaining", value: formatTOS(snapshot.totals.remainingBudgetTomi) },
      { label: "Pending payables", value: formatTOS(snapshot.totals.pendingPayablesTomi) },
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
              <div class="meta-row"><span>Total budget</span><span>${escapeHtml(formatTOS(snapshot.totals.totalBudgetTomi))}</span></div>
              <div class="meta-row"><span>Allocated</span><span>${escapeHtml(formatTOS(snapshot.totals.allocatedBudgetTomi))}</span></div>
              <div class="meta-row"><span>Remaining</span><span>${escapeHtml(formatTOS(snapshot.totals.remainingBudgetTomi))}</span></div>
            </article>
            <article class="list-card">
              <div class="meta-row"><span>Open commitments</span><span>${escapeHtml(formatTOS(snapshot.totals.openCommitmentsTomi))}</span></div>
              <div class="meta-row"><span>Approved unpaid</span><span>${escapeHtml(formatTOS(snapshot.totals.approvedUnpaidTomi))}</span></div>
              <div class="meta-row"><span>Pending payables</span><span>${escapeHtml(formatTOS(snapshot.totals.pendingPayablesTomi))}</span></div>
            </article>
            <article class="list-card">
              <div class="meta-row"><span>Pending receivables</span><span>${escapeHtml(formatTOS(snapshot.totals.pendingReceivablesTomi))}</span></div>
              <div class="meta-row"><span>Realized host payouts</span><span>${escapeHtml(formatTOS(snapshot.totals.realizedHostPayoutsTomi))}</span></div>
              <div class="meta-row"><span>Realized solver earnings</span><span>${escapeHtml(formatTOS(snapshot.totals.realizedSolverEarningsTomi))}</span></div>
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
