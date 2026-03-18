import type { OpenFoxDatabase } from "../types.js";
import {
  escapeHtml,
  renderMetaWorldPageFrame,
} from "./render.js";

type BountyRecord = NonNullable<ReturnType<OpenFoxDatabase["getBountyById"]>>;
type ArtifactRecord = NonNullable<ReturnType<OpenFoxDatabase["getArtifact"]>>;

function findArtifactsBySubjectId(
  db: OpenFoxDatabase,
  subjectId: string,
  limit: number,
): ArtifactRecord[] {
  const rows = db.raw
    .prepare(
      `SELECT artifact_id
         FROM artifacts
        WHERE subject_id = ?
        ORDER BY created_at DESC
        LIMIT ?`,
    )
    .all(subjectId, Math.max(1, limit)) as Array<{ artifact_id: string }>;
  const items: ArtifactRecord[] = [];
  for (const row of rows) {
    const artifact = db.getArtifact(row.artifact_id);
    if (artifact) {
      items.push(artifact);
    }
  }
  return items;
}

export interface SettlementPageSnapshot {
  generatedAt: string;
  summary: string;
  settlement: NonNullable<ReturnType<OpenFoxDatabase["getSettlementReceiptById"]>>;
  callback: ReturnType<OpenFoxDatabase["getSettlementCallbackByReceiptId"]> | null;
  bounty: BountyRecord | null;
  relatedArtifacts: ArtifactRecord[];
}

export function buildSettlementPageSnapshot(
  db: OpenFoxDatabase,
  options: {
    receiptId: string;
    artifactLimit?: number;
  },
): SettlementPageSnapshot {
  const settlement = db.getSettlementReceiptById(options.receiptId);
  if (!settlement) {
    throw new Error(`settlement not found: ${options.receiptId}`);
  }
  const callback = db.getSettlementCallbackByReceiptId(settlement.receiptId) ?? null;
  const bounty =
    settlement.kind === "bounty"
      ? db.getBountyById(settlement.subjectId) ?? null
      : null;
  const relatedArtifacts = findArtifactsBySubjectId(
    db,
    settlement.subjectId,
    Math.max(1, options.artifactLimit ?? 8),
  );

  return {
    generatedAt: new Date().toISOString(),
    summary: `${settlement.kind} settlement for ${settlement.subjectId} with ${relatedArtifacts.length} related artifact(s)${callback ? " and callback state" : ""}.`,
    settlement,
    callback,
    bounty,
    relatedArtifacts,
  };
}

export function buildSettlementPageHtml(
  snapshot: SettlementPageSnapshot,
  options?: {
    homeHref?: string;
    foxDirectoryHref?: string;
    groupDirectoryHref?: string;
    searchHref?: string;
  },
): string {
  const artifactItems = snapshot.relatedArtifacts
    .map(
      (artifact) => `<li><strong>${escapeHtml(artifact.title)}</strong><span>${escapeHtml(artifact.artifactId)} · ${escapeHtml(artifact.status)} · ${escapeHtml(artifact.cid)}</span></li>`,
    )
    .join("");

  return renderMetaWorldPageFrame({
    title: `${snapshot.settlement.receiptId} · Settlement · OpenFox metaWorld`,
    eyebrow: "OpenFox Settlement Page",
    heading: `Settlement ${snapshot.settlement.kind}`,
    lede: snapshot.summary,
    generatedAt: snapshot.generatedAt,
    navLinks: [
      { label: "World Shell", href: options?.homeHref ?? "/" },
      { label: "Fox Directory", href: options?.foxDirectoryHref ?? "/directory/foxes" },
      { label: "Group Directory", href: options?.groupDirectoryHref ?? "/directory/groups" },
      { label: "Search", href: options?.searchHref ?? "/search" },
    ],
    metrics: [
      { label: "Kind", value: snapshot.settlement.kind },
      { label: "Receipt", value: snapshot.settlement.receiptId },
      { label: "Artifacts", value: snapshot.relatedArtifacts.length },
      { label: "Callback", value: snapshot.callback?.status ?? "none" },
    ],
    sections: [
      `<section class="grid">
        <section class="panel">
          <div class="section-head">
            <h3>Settlement Overview</h3>
            <span>${escapeHtml(snapshot.settlement.subjectId)}</span>
          </div>
          <div class="list-grid">
            <article class="list-card">
              <div class="meta-row"><span>Receipt hash</span><span>${escapeHtml(snapshot.settlement.receiptHash)}</span></div>
              <div class="meta-row"><span>Created</span><span>${escapeHtml(snapshot.settlement.createdAt)}</span></div>
              <div class="meta-row"><span>Updated</span><span>${escapeHtml(snapshot.settlement.updatedAt)}</span></div>
            </article>
            <article class="list-card">
              <div class="meta-row"><span>Payment tx</span><span>${snapshot.settlement.paymentTxHash ? escapeHtml(snapshot.settlement.paymentTxHash) : "—"}</span></div>
              <div class="meta-row"><span>Payout tx</span><span>${snapshot.settlement.payoutTxHash ? escapeHtml(snapshot.settlement.payoutTxHash) : "—"}</span></div>
              <div class="meta-row"><span>Settlement tx</span><span>${snapshot.settlement.settlementTxHash ? escapeHtml(snapshot.settlement.settlementTxHash) : "—"}</span></div>
            </article>
          </div>
          <p class="lede">${snapshot.bounty ? escapeHtml(`Linked bounty: ${snapshot.bounty.title} (${snapshot.bounty.status}).`) : "No linked bounty metadata available."}</p>
        </section>
        <section class="panel">
          <div class="section-head">
            <h3>Callback State</h3>
            <span>${snapshot.callback?.status ?? "none"}</span>
          </div>
          <ul class="directory-list">
            <li><strong>Callback id</strong><span>${snapshot.callback ? escapeHtml(snapshot.callback.callbackId) : "not recorded"}</span></li>
            <li><strong>Contract</strong><span>${snapshot.callback ? escapeHtml(snapshot.callback.contractAddress) : "—"}</span></li>
            <li><strong>Attempts</strong><span>${snapshot.callback ? `${snapshot.callback.attemptCount}/${snapshot.callback.maxAttempts}` : "—"}</span></li>
            <li><strong>Callback tx</strong><span>${snapshot.callback?.callbackTxHash ? escapeHtml(snapshot.callback.callbackTxHash) : "—"}</span></li>
          </ul>
        </section>
      </section>`,
      `<section class="panel">
        <div class="section-head">
          <h3>Related Artifacts</h3>
          <span>${snapshot.relatedArtifacts.length}</span>
        </div>
        <ul class="directory-list">${artifactItems || '<li class="empty">No related artifacts.</li>'}</ul>
      </section>`,
    ],
  });
}
