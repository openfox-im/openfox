/**
 * Replay and Dispute Inspection
 *
 * GTOS 2046: Build full replay timelines for intents, collect proof
 * references for every externalized action, and manage dispute records.
 */

import { ulid } from "ulid";
import type { AuditJournal } from "./journal.js";
import type { AuditEntry } from "./types.js";
import type {
  IntentEnvelope,
  PlanRecord,
  ApprovalRecord,
  ExecutionReceipt,
} from "../intent/types.js";
import type { IntentStore } from "../intent/store.js";

// ── Types ────────────────────────────────────────────────────────

export interface ProofRef {
  type: "tx_receipt" | "policy_decision" | "sponsor_auth" | "settlement" | "session";
  hash: string;
  blockNumber?: number;
  uri?: string;
  description: string;
}

export interface DisputeRecord {
  disputeId: string;
  intentId: string;
  receiptId: string;
  reason: string;
  evidence: ProofRef[];
  status: "open" | "resolved" | "rejected";
  createdAt: number;
  resolvedAt?: number;
}

export interface ReplayTimeline {
  intentId: string;
  entries: AuditEntry[];
  intent?: IntentEnvelope;
  plans: PlanRecord[];
  approvals: ApprovalRecord[];
  receipt?: ExecutionReceipt;
  proofRefs: ProofRef[];
  disputes: DisputeRecord[];
}

// ── ReplayInspector ──────────────────────────────────────────────

export class ReplayInspector {
  private disputes: Map<string, DisputeRecord> = new Map();

  constructor(
    private journal: AuditJournal,
    private intentStore: IntentStore,
  ) {}

  /** Build a full timeline for an intent, combining audit entries with intent-store records. */
  buildTimeline(intentId: string): ReplayTimeline {
    const entries = this.journal.getIntentTimeline(intentId);
    const intent = this.intentStore.getIntent(intentId);
    const plans = this.intentStore.listPlansForIntent(intentId);

    // Collect approvals referenced in audit entries
    const approvals: ApprovalRecord[] = [];
    const seenApprovals = new Set<string>();
    for (const entry of entries) {
      if (entry.approvalId && !seenApprovals.has(entry.approvalId)) {
        seenApprovals.add(entry.approvalId);
        const approval = this.intentStore.getApproval(entry.approvalId);
        if (approval) approvals.push(approval);
      }
    }

    const receipt = this.intentStore.getReceiptByIntent(intentId);
    const proofRefs = this.collectProofs(intentId);

    // Collect disputes for this intent
    const disputes: DisputeRecord[] = [];
    for (const d of this.disputes.values()) {
      if (d.intentId === intentId) disputes.push(d);
    }

    return {
      intentId,
      entries,
      intent,
      plans,
      approvals,
      receipt,
      proofRefs,
      disputes,
    };
  }

  /** Collect all proof references for an intent by scanning audit entries and store records. */
  collectProofs(intentId: string): ProofRef[] {
    const proofs: ProofRef[] = [];
    const entries = this.journal.getIntentTimeline(intentId);

    for (const entry of entries) {
      // Transaction receipt proofs
      if (entry.txHash) {
        proofs.push({
          type: "tx_receipt",
          hash: entry.txHash,
          description: `Transaction for ${entry.kind}: ${entry.summary}`,
        });
      }

      // Policy decision proofs
      if (entry.policyHash && entry.policyDecision) {
        proofs.push({
          type: "policy_decision",
          hash: entry.policyHash,
          description: `Policy ${entry.policyDecision} for ${entry.kind}`,
        });
      }

      // Sponsor authorization proofs
      if (entry.sponsorAddress && entry.kind === "sponsor_selected") {
        proofs.push({
          type: "sponsor_auth",
          hash: entry.policyHash ?? entry.entryId,
          description: `Sponsor ${truncateAddress(entry.sponsorAddress)} authorized`,
        });
      }

      // Session proofs
      if (
        entry.kind === "terminal_session_created" ||
        entry.kind === "terminal_session_revoked"
      ) {
        proofs.push({
          type: "session",
          hash: entry.entryId,
          description: `Terminal session ${entry.kind.replace("terminal_session_", "")} (${entry.terminalClass ?? "unknown"})`,
        });
      }
    }

    // Settlement proof from execution receipt
    const receipt = this.intentStore.getReceiptByIntent(intentId);
    if (receipt) {
      proofs.push({
        type: "settlement",
        hash: receipt.txHash,
        blockNumber: receipt.blockNumber,
        uri: receipt.proofRef,
        description: `Settlement ${receipt.receiptStatus} at block ${receipt.blockNumber}`,
      });

      if (receipt.sponsorPolicyHash) {
        proofs.push({
          type: "sponsor_auth",
          hash: receipt.sponsorPolicyHash,
          description: `Sponsor policy for execution ${receipt.receiptId}`,
        });
      }
    }

    return proofs;
  }

  /** Create a dispute record for an intent execution. */
  createDispute(params: {
    intentId: string;
    receiptId: string;
    reason: string;
    evidence: ProofRef[];
  }): DisputeRecord {
    const dispute: DisputeRecord = {
      disputeId: ulid(),
      intentId: params.intentId,
      receiptId: params.receiptId,
      reason: params.reason,
      evidence: params.evidence,
      status: "open",
      createdAt: Math.floor(Date.now() / 1000),
    };
    this.disputes.set(dispute.disputeId, dispute);
    return dispute;
  }

  /** Verify proof chain integrity for a timeline. */
  verifyProofChain(timeline: ReplayTimeline): { valid: boolean; issues: string[] } {
    const issues: string[] = [];

    // 1. An intent must exist
    if (!timeline.intent) {
      issues.push("Intent record not found in store");
    }

    // 2. At least one plan should exist for non-pending intents
    if (
      timeline.intent &&
      timeline.intent.status !== "pending" &&
      timeline.plans.length === 0
    ) {
      issues.push("No plans found for a non-pending intent");
    }

    // 3. Settled intents must have a receipt
    if (timeline.intent?.status === "settled" && !timeline.receipt) {
      issues.push("Settled intent missing execution receipt");
    }

    // 4. Receipt must have a transaction hash proof
    if (timeline.receipt) {
      const hasTxProof = timeline.proofRefs.some(
        (p) => p.type === "tx_receipt" && p.hash === timeline.receipt!.txHash,
      );
      if (!hasTxProof) {
        issues.push("Execution receipt transaction hash not found in proof references");
      }

      const hasSettlementProof = timeline.proofRefs.some(
        (p) => p.type === "settlement" && p.hash === timeline.receipt!.txHash,
      );
      if (!hasSettlementProof) {
        issues.push("Settlement proof missing for execution receipt");
      }
    }

    // 5. Approved intents should have at least one approval
    if (
      timeline.intent &&
      ["approved", "executing", "settled"].includes(timeline.intent.status) &&
      timeline.approvals.length === 0
    ) {
      issues.push("No approval records found for approved/executing/settled intent");
    }

    // 6. Audit entries should be in chronological order
    for (let i = 1; i < timeline.entries.length; i++) {
      if (timeline.entries[i].timestamp < timeline.entries[i - 1].timestamp) {
        issues.push(
          `Audit entries out of order at index ${i}: ${timeline.entries[i].entryId}`,
        );
      }
    }

    // 7. Policy decision proofs for plans
    for (const plan of timeline.plans) {
      const hasPolicyProof = timeline.proofRefs.some(
        (p) => p.type === "policy_decision" && p.hash === plan.policyHash,
      );
      if (!hasPolicyProof) {
        issues.push(`Plan ${plan.planId} missing policy decision proof`);
      }
    }

    return {
      valid: issues.length === 0,
      issues,
    };
  }

  /** Format a timeline as human-readable text. */
  formatTimeline(timeline: ReplayTimeline): string {
    const lines: string[] = [];

    lines.push(`=== Replay Timeline: ${timeline.intentId} ===`);
    lines.push("");

    // Intent summary
    if (timeline.intent) {
      const i = timeline.intent;
      lines.push("--- Intent ---");
      lines.push(`  Action: ${i.action}`);
      lines.push(`  Requester: ${i.requester}`);
      lines.push(`  Terminal: ${i.terminalClass} (trust tier ${i.trustTier})`);
      lines.push(`  Status: ${i.status}`);
      lines.push(`  Created: ${formatTimestamp(i.createdAt)}`);
      lines.push(`  Expires: ${formatTimestamp(i.expiresAt)}`);
      lines.push("");
    }

    // Plans
    if (timeline.plans.length > 0) {
      lines.push(`--- Plans (${timeline.plans.length}) ---`);
      for (const plan of timeline.plans) {
        lines.push(`  [${plan.planId}] provider:${truncateAddress(plan.provider)} status:${plan.status} gas:${plan.estimatedGas} value:${plan.estimatedValue}`);
      }
      lines.push("");
    }

    // Approvals
    if (timeline.approvals.length > 0) {
      lines.push(`--- Approvals (${timeline.approvals.length}) ---`);
      for (const a of timeline.approvals) {
        lines.push(`  [${a.approvalId}] ${a.approverRole}:${truncateAddress(a.approver)} status:${a.status}`);
      }
      lines.push("");
    }

    // Receipt
    if (timeline.receipt) {
      const r = timeline.receipt;
      lines.push("--- Execution Receipt ---");
      lines.push(`  Receipt: ${r.receiptId}`);
      lines.push(`  Tx: ${r.txHash}`);
      lines.push(`  Block: ${r.blockNumber}`);
      lines.push(`  Status: ${r.receiptStatus}`);
      lines.push(`  Value: ${r.value} tomi`);
      lines.push(`  Gas used: ${r.gasUsed}`);
      lines.push(`  Settled: ${formatTimestamp(r.settledAt)}`);
      lines.push("");
    }

    // Proof references
    if (timeline.proofRefs.length > 0) {
      lines.push(`--- Proof References (${timeline.proofRefs.length}) ---`);
      for (const p of timeline.proofRefs) {
        const block = p.blockNumber != null ? ` block:${p.blockNumber}` : "";
        const uri = p.uri ? ` uri:${p.uri}` : "";
        lines.push(`  [${p.type}] ${truncateHash(p.hash)}${block}${uri} - ${p.description}`);
      }
      lines.push("");
    }

    // Disputes
    if (timeline.disputes.length > 0) {
      lines.push(`--- Disputes (${timeline.disputes.length}) ---`);
      for (const d of timeline.disputes) {
        lines.push(`  [${d.disputeId}] status:${d.status} reason:${d.reason}`);
        lines.push(`    Evidence: ${d.evidence.length} proof ref(s)`);
        if (d.resolvedAt) {
          lines.push(`    Resolved: ${formatTimestamp(d.resolvedAt)}`);
        }
      }
      lines.push("");
    }

    // Audit entries
    if (timeline.entries.length > 0) {
      lines.push(`--- Audit Entries (${timeline.entries.length}) ---`);
      for (const entry of timeline.entries) {
        const ts = formatTimestamp(entry.timestamp);
        const actor = entry.actorAddress
          ? ` [${entry.actorRole ?? "unknown"}:${truncateAddress(entry.actorAddress)}]`
          : "";
        lines.push(`  ${ts} ${entry.kind}${actor} - ${entry.summary}`);
      }
    }

    return lines.join("\n");
  }
}

// ── Utility functions ──────────────────────────────────────────────

function formatTimestamp(ts: number): string {
  return new Date(ts * 1000).toISOString().replace("T", " ").replace(/\.\d+Z$/, "Z");
}

function truncateAddress(address: string): string {
  if (address.length <= 10) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function truncateHash(hash: string): string {
  if (hash.length <= 14) return hash;
  return `${hash.slice(0, 10)}...${hash.slice(-4)}`;
}
