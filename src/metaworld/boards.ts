import type {
  ArtifactRecord,
  BountyRecord,
  OpenFoxDatabase,
  OwnerOpportunityAlertRecord,
  SettlementRecord,
} from "../types.js";

export type WorldBoardKind = "work" | "opportunity" | "artifact" | "settlement";

export interface WorldBoardItem {
  itemId: string;
  boardKind: WorldBoardKind;
  occurredAt: string;
  actorAddress?: string | null;
  title: string;
  summary: string;
  status: string;
  refs: Record<string, string>;
}

export interface WorldBoardSnapshot {
  generatedAt: string;
  boardKind: WorldBoardKind;
  items: WorldBoardItem[];
  summary: string;
}

function trimSummary(value: string, limit = 220): string {
  const trimmed = value.trim();
  if (trimmed.length <= limit) return trimmed;
  return `${trimmed.slice(0, Math.max(0, limit - 1))}...`;
}

function sortItems(items: WorldBoardItem[], limit: number): WorldBoardItem[] {
  return items
    .sort((a, b) => {
      const byTime = b.occurredAt.localeCompare(a.occurredAt);
      if (byTime !== 0) return byTime;
      return a.itemId.localeCompare(b.itemId);
    })
    .slice(0, Math.max(1, limit));
}

function mapWorkItem(bounty: BountyRecord): WorldBoardItem {
  return {
    itemId: `board:work:${bounty.bountyId}`,
    boardKind: "work",
    occurredAt: bounty.createdAt,
    actorAddress: bounty.hostAddress,
    title: bounty.title,
    summary: trimSummary(
      `${bounty.kind} bounty · reward ${bounty.rewardWei} wei · deadline ${bounty.submissionDeadline}`,
    ),
    status: bounty.status,
    refs: {
      bountyId: bounty.bountyId,
      kind: bounty.kind,
    },
  };
}

function mapOpportunityItem(alert: OwnerOpportunityAlertRecord): WorldBoardItem {
  return {
    itemId: `board:opportunity:${alert.alertId}`,
    boardKind: "opportunity",
    occurredAt: alert.createdAt,
    title: alert.title,
    summary: trimSummary(
      `${alert.summary} Margin ${alert.marginWei} wei (${alert.marginBps} bps).`,
    ),
    status: alert.status,
    refs: {
      alertId: alert.alertId,
      kind: alert.kind,
      providerClass: alert.providerClass,
    },
  };
}

function mapArtifactItem(artifact: ArtifactRecord): WorldBoardItem {
  return {
    itemId: `board:artifact:${artifact.artifactId}`,
    boardKind: "artifact",
    occurredAt: artifact.createdAt,
    actorAddress: artifact.requesterAddress,
    title: artifact.title,
    summary: trimSummary(
      artifact.summaryText ||
        `${artifact.kind} artifact ${artifact.status} stored at ${artifact.cid}.`,
    ),
    status: artifact.status,
    refs: {
      artifactId: artifact.artifactId,
      cid: artifact.cid,
      kind: artifact.kind,
    },
  };
}

function mapSettlementItem(settlement: SettlementRecord): WorldBoardItem {
  return {
    itemId: `board:settlement:${settlement.receiptId}`,
    boardKind: "settlement",
    occurredAt: settlement.createdAt,
    title: `Settlement: ${settlement.kind}`,
    summary: trimSummary(
      `${settlement.kind} settlement recorded for ${settlement.subjectId}.`,
    ),
    status: "recorded",
    refs: {
      receiptId: settlement.receiptId,
      subjectId: settlement.subjectId,
      kind: settlement.kind,
    },
  };
}

export function listWorldBoardItems(
  db: OpenFoxDatabase,
  options: {
    boardKind: WorldBoardKind;
    limit?: number;
  },
): WorldBoardItem[] {
  const limit = Math.max(1, options.limit ?? 25);
  if (options.boardKind === "work") {
    return sortItems(db.listBounties().map(mapWorkItem), limit);
  }
  if (options.boardKind === "opportunity") {
    const items = db
      .listOwnerOpportunityAlerts(Math.max(limit * 2, 100))
      .filter((alert) => alert.status !== "dismissed")
      .map(mapOpportunityItem);
    return sortItems(items, limit);
  }
  if (options.boardKind === "artifact") {
    return sortItems(db.listArtifacts(limit).map(mapArtifactItem), limit);
  }
  return sortItems(db.listSettlementReceipts(limit).map(mapSettlementItem), limit);
}

export function buildWorldBoardSnapshot(
  db: OpenFoxDatabase,
  options: {
    boardKind: WorldBoardKind;
    limit?: number;
  },
): WorldBoardSnapshot {
  const items = listWorldBoardItems(db, options);
  return {
    generatedAt: new Date().toISOString(),
    boardKind: options.boardKind,
    items,
    summary: items.length
      ? `${options.boardKind} board contains ${items.length} item(s).`
      : `${options.boardKind} board is currently empty.`,
  };
}
