import type { OpenFoxDatabase, SettlementRecord } from "../types.js";
import {
  escapeHtml,
  renderMetaWorldPageFrame,
} from "./render.js";

export interface ArtifactPageSnapshot {
  generatedAt: string;
  summary: string;
  artifact: NonNullable<ReturnType<OpenFoxDatabase["getArtifact"]>>;
  verification: ReturnType<OpenFoxDatabase["getArtifactVerificationByArtifactId"]> | null;
  anchor: ReturnType<OpenFoxDatabase["getArtifactAnchorByArtifactId"]> | null;
  executionTrails: ReturnType<OpenFoxDatabase["listExecutionTrailsForSubject"]>;
  verificationExecutionTrails: ReturnType<OpenFoxDatabase["listExecutionTrailsForSubject"]>;
  anchorExecutionTrails: ReturnType<OpenFoxDatabase["listExecutionTrailsForSubject"]>;
  relatedSettlements: SettlementRecord[];
}

function findRelatedSettlements(
  db: OpenFoxDatabase,
  subjectId: string | null | undefined,
  limit: number,
): SettlementRecord[] {
  if (!subjectId) return [];
  return db
    .listSettlementReceipts(Math.max(limit * 4, 20))
    .filter((item) => item.subjectId === subjectId)
    .slice(0, limit);
}

export function buildArtifactPageSnapshot(
  db: OpenFoxDatabase,
  options: {
    artifactId: string;
    settlementLimit?: number;
  },
): ArtifactPageSnapshot {
  const artifact = db.getArtifact(options.artifactId);
  if (!artifact) {
    throw new Error(`artifact not found: ${options.artifactId}`);
  }
  const verification = db.getArtifactVerificationByArtifactId(artifact.artifactId) ?? null;
  const anchor = db.getArtifactAnchorByArtifactId(artifact.artifactId) ?? null;
  const executionTrails = db.listExecutionTrailsForSubject("artifact", artifact.artifactId);
  const verificationExecutionTrails = verification
    ? db.listExecutionTrailsForSubject("artifact_verification", verification.verificationId)
    : [];
  const anchorExecutionTrails = anchor
    ? db.listExecutionTrailsForSubject("artifact_anchor", anchor.anchorId)
    : [];
  const relatedSettlements = findRelatedSettlements(
    db,
    artifact.subjectId,
    Math.max(1, options.settlementLimit ?? 8),
  );

  return {
    generatedAt: new Date().toISOString(),
    summary: `${artifact.kind} artifact ${artifact.status} with ${executionTrails.length + verificationExecutionTrails.length + anchorExecutionTrails.length} execution trail(s) and ${relatedSettlements.length} related settlement(s).`,
    artifact,
    verification,
    anchor,
    executionTrails,
    verificationExecutionTrails,
    anchorExecutionTrails,
    relatedSettlements,
  };
}

export function buildArtifactPageHtml(
  snapshot: ArtifactPageSnapshot,
  options?: {
    homeHref?: string;
    foxDirectoryHref?: string;
    groupDirectoryHref?: string;
    searchHref?: string;
  },
): string {
  const trailItems = [
    ...snapshot.executionTrails,
    ...snapshot.verificationExecutionTrails,
    ...snapshot.anchorExecutionTrails,
  ]
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .slice(0, 16)
    .map(
      (trail) => `<li><strong>${escapeHtml(trail.subjectKind)}</strong><span>${escapeHtml(trail.executionKind)} · ${escapeHtml(trail.executionRecordId)} · ${escapeHtml(trail.linkMode)}</span></li>`,
    )
    .join("");
  const settlementItems = snapshot.relatedSettlements
    .map(
      (settlement) => `<li><strong>${escapeHtml(settlement.kind)}</strong><span>${escapeHtml(settlement.receiptId)} · ${escapeHtml(settlement.subjectId)} · ${escapeHtml(settlement.createdAt)}</span></li>`,
    )
    .join("");

  return renderMetaWorldPageFrame({
    title: `${snapshot.artifact.title} · Artifact · OpenFox metaWorld`,
    eyebrow: "OpenFox Artifact Page",
    heading: snapshot.artifact.title,
    lede: snapshot.summary,
    generatedAt: snapshot.generatedAt,
    navLinks: [
      { label: "World Shell", href: options?.homeHref ?? "/" },
      { label: "Fox Directory", href: options?.foxDirectoryHref ?? "/directory/foxes" },
      { label: "Group Directory", href: options?.groupDirectoryHref ?? "/directory/groups" },
      { label: "Search", href: options?.searchHref ?? "/search" },
    ],
    metrics: [
      { label: "Status", value: snapshot.artifact.status },
      { label: "Kind", value: snapshot.artifact.kind },
      { label: "Trails", value: snapshot.executionTrails.length + snapshot.verificationExecutionTrails.length + snapshot.anchorExecutionTrails.length },
      { label: "Settlements", value: snapshot.relatedSettlements.length },
    ],
    sections: [
      `<section class="grid">
        <section class="panel">
          <div class="section-head">
            <h3>Artifact Overview</h3>
            <span>${escapeHtml(snapshot.artifact.artifactId)}</span>
          </div>
          <div class="list-grid">
            <article class="list-card">
              <div class="meta-row"><span>CID</span><span>${escapeHtml(snapshot.artifact.cid)}</span></div>
              <div class="meta-row"><span>Requester</span><span>${escapeHtml(snapshot.artifact.requesterAddress)}</span></div>
              <div class="meta-row"><span>Provider</span><span>${escapeHtml(snapshot.artifact.providerAddress)}</span></div>
            </article>
            <article class="list-card">
              <div class="meta-row"><span>Lease</span><span>${escapeHtml(snapshot.artifact.leaseId)}</span></div>
              <div class="meta-row"><span>Subject</span><span>${escapeHtml(snapshot.artifact.subjectId || "none")}</span></div>
              <div class="meta-row"><span>Created</span><span>${escapeHtml(snapshot.artifact.createdAt)}</span></div>
            </article>
          </div>
          <p class="lede">${escapeHtml(snapshot.artifact.summaryText || "No artifact summary available.")}</p>
        </section>
        <section class="panel">
          <div class="section-head">
            <h3>Verification &amp; Anchor</h3>
            <span>${snapshot.verification || snapshot.anchor ? "present" : "pending"}</span>
          </div>
          <ul class="directory-list">
            <li><strong>Verification</strong><span>${snapshot.verification ? escapeHtml(snapshot.verification.verificationId) : "not recorded"}</span></li>
            <li><strong>Verification hash</strong><span>${snapshot.verification ? escapeHtml(snapshot.verification.receiptHash) : "—"}</span></li>
            <li><strong>Anchor</strong><span>${snapshot.anchor ? escapeHtml(snapshot.anchor.anchorId) : "not recorded"}</span></li>
            <li><strong>Anchor tx</strong><span>${snapshot.anchor?.anchorTxHash ? escapeHtml(snapshot.anchor.anchorTxHash) : "—"}</span></li>
          </ul>
        </section>
      </section>`,
      `<section class="grid">
        <section class="panel">
          <div class="section-head">
            <h3>Execution Trails</h3>
            <span>${snapshot.executionTrails.length + snapshot.verificationExecutionTrails.length + snapshot.anchorExecutionTrails.length}</span>
          </div>
          <ul class="directory-list">${trailItems || '<li class="empty">No execution trails recorded.</li>'}</ul>
        </section>
        <section class="panel">
          <div class="section-head">
            <h3>Related Settlements</h3>
            <span>${snapshot.relatedSettlements.length}</span>
          </div>
          <ul class="directory-list">${settlementItems || '<li class="empty">No related settlements.</li>'}</ul>
        </section>
      </section>`,
    ],
  });
}
