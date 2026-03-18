/**
 * Dispute Inspection Tools
 *
 * GTOS 2046: Exposes replay-based dispute inspection, execution comparison,
 * and evidence export utilities. These tools build on the ReplayInspector
 * to provide structured dispute analysis for audit and compliance flows.
 */

import type { AuditJournal } from "./journal.js";
import type { IntentStore } from "../intent/store.js";
import type { ExecutionReceipt } from "../intent/types.js";
import { ReplayInspector, type ReplayTimeline, type ProofRef } from "./replay.js";

// ── Types ───────────────────────────────────────────────────────────

export interface DisputeInspection {
  intentId: string;
  receiptId: string;
  timeline: ReplayTimeline;
  proofs: ProofRef[];
  inconsistencies: string[];
  recommendation: "valid" | "suspicious" | "invalid";
  explanation: string;
}

export interface ExecutionComparison {
  consistent: boolean;
  differences: string[];
}

// ── Core functions ──────────────────────────────────────────────────

/**
 * Build a full dispute inspection for a given intent. Replays the
 * timeline, collects proofs, verifies the proof chain, and produces
 * a recommendation.
 */
export function inspectDispute(params: {
  journal: AuditJournal;
  intentStore: IntentStore;
  intentId: string;
}): DisputeInspection {
  const inspector = new ReplayInspector(params.journal, params.intentStore);
  const timeline = inspector.buildTimeline(params.intentId);
  const proofs = timeline.proofRefs;

  // Verify proof chain to find inconsistencies
  const verification = inspector.verifyProofChain(timeline);
  const inconsistencies = [...verification.issues];

  // Additional consistency checks
  if (timeline.receipt) {
    // Check that the receipt's intent ID matches
    if (timeline.receipt.intentId !== params.intentId) {
      inconsistencies.push(
        `Receipt intentId mismatch: expected ${params.intentId}, got ${timeline.receipt.intentId}`,
      );
    }

    // Check that the receipt references a known plan
    if (timeline.plans.length > 0) {
      const planIds = new Set(timeline.plans.map((p) => p.planId));
      if (!planIds.has(timeline.receipt.planId)) {
        inconsistencies.push(
          `Receipt references unknown plan ${timeline.receipt.planId}`,
        );
      }
    }

    // Check value consistency between plan and receipt
    for (const plan of timeline.plans) {
      if (
        plan.planId === timeline.receipt.planId &&
        plan.status === "completed"
      ) {
        if (BigInt(timeline.receipt.value) > BigInt(plan.estimatedValue) * 2n) {
          inconsistencies.push(
            `Receipt value (${timeline.receipt.value}) greatly exceeds plan estimate (${plan.estimatedValue})`,
          );
        }
      }
    }

    // Check gas consistency
    for (const plan of timeline.plans) {
      if (
        plan.planId === timeline.receipt.planId &&
        plan.status === "completed"
      ) {
        if (timeline.receipt.gasUsed > plan.estimatedGas * 5) {
          inconsistencies.push(
            `Gas used (${timeline.receipt.gasUsed}) greatly exceeds estimate (${plan.estimatedGas})`,
          );
        }
      }
    }
  }

  // Check audit entry ordering and completeness
  if (timeline.entries.length === 0 && timeline.intent) {
    inconsistencies.push("No audit entries found for an existing intent");
  }

  // Determine recommendation
  let recommendation: DisputeInspection["recommendation"];
  let explanation: string;

  if (inconsistencies.length === 0) {
    recommendation = "valid";
    explanation = "All proof chain checks passed. The execution appears consistent with the intent and plan records.";
  } else if (inconsistencies.length <= 2 && !inconsistencies.some((i) => i.includes("mismatch") || i.includes("unknown"))) {
    recommendation = "suspicious";
    explanation = `Found ${inconsistencies.length} minor inconsistency(ies) that may warrant further review: ${inconsistencies.join("; ")}`;
  } else {
    recommendation = "invalid";
    explanation = `Found ${inconsistencies.length} significant inconsistency(ies) indicating a potentially invalid execution: ${inconsistencies.join("; ")}`;
  }

  return {
    intentId: params.intentId,
    receiptId: timeline.receipt?.receiptId ?? "none",
    timeline,
    proofs,
    inconsistencies,
    recommendation,
    explanation,
  };
}

/**
 * Compare two execution receipts for consistency. Useful when replaying
 * or when a dispute claims a different outcome should have occurred.
 */
export function compareExecutions(
  a: ExecutionReceipt,
  b: ExecutionReceipt,
): ExecutionComparison {
  const differences: string[] = [];

  if (a.intentId !== b.intentId) {
    differences.push(`Intent ID: ${a.intentId} vs ${b.intentId}`);
  }
  if (a.planId !== b.planId) {
    differences.push(`Plan ID: ${a.planId} vs ${b.planId}`);
  }
  if (a.from !== b.from) {
    differences.push(`From address: ${a.from} vs ${b.from}`);
  }
  if (a.to !== b.to) {
    differences.push(`To address: ${a.to} vs ${b.to}`);
  }
  if (a.value !== b.value) {
    differences.push(`Value: ${a.value} vs ${b.value}`);
  }
  if (a.gasUsed !== b.gasUsed) {
    differences.push(`Gas used: ${a.gasUsed} vs ${b.gasUsed}`);
  }
  if (a.receiptStatus !== b.receiptStatus) {
    differences.push(`Status: ${a.receiptStatus} vs ${b.receiptStatus}`);
  }
  if (a.txHash !== b.txHash) {
    differences.push(`Tx hash: ${a.txHash} vs ${b.txHash}`);
  }
  if (a.blockNumber !== b.blockNumber) {
    differences.push(`Block number: ${a.blockNumber} vs ${b.blockNumber}`);
  }
  if (a.policyHash !== b.policyHash) {
    differences.push(`Policy hash: ${a.policyHash} vs ${b.policyHash}`);
  }
  if (a.effectsHash !== b.effectsHash && (a.effectsHash || b.effectsHash)) {
    differences.push(`Effects hash: ${a.effectsHash ?? "none"} vs ${b.effectsHash ?? "none"}`);
  }
  if (a.sponsor !== b.sponsor) {
    differences.push(`Sponsor: ${a.sponsor ?? "none"} vs ${b.sponsor ?? "none"}`);
  }

  return {
    consistent: differences.length === 0,
    differences,
  };
}

/**
 * Export a dispute inspection as a portable JSON string suitable for
 * sharing with external auditors or dispute resolution systems.
 */
export function exportDisputeEvidence(inspection: DisputeInspection): string {
  const evidence = {
    version: "1.0.0",
    exportedAt: new Date().toISOString(),
    intentId: inspection.intentId,
    receiptId: inspection.receiptId,
    recommendation: inspection.recommendation,
    explanation: inspection.explanation,
    inconsistencies: inspection.inconsistencies,
    proofCount: inspection.proofs.length,
    proofs: inspection.proofs.map((p) => ({
      type: p.type,
      hash: p.hash,
      blockNumber: p.blockNumber ?? null,
      uri: p.uri ?? null,
      description: p.description,
    })),
    intent: inspection.timeline.intent
      ? {
          intentId: inspection.timeline.intent.intentId,
          action: inspection.timeline.intent.action,
          requester: inspection.timeline.intent.requester,
          status: inspection.timeline.intent.status,
          terminalClass: inspection.timeline.intent.terminalClass,
          trustTier: inspection.timeline.intent.trustTier,
          createdAt: inspection.timeline.intent.createdAt,
        }
      : null,
    receipt: inspection.timeline.receipt
      ? {
          receiptId: inspection.timeline.receipt.receiptId,
          txHash: inspection.timeline.receipt.txHash,
          blockNumber: inspection.timeline.receipt.blockNumber,
          from: inspection.timeline.receipt.from,
          to: inspection.timeline.receipt.to,
          value: inspection.timeline.receipt.value,
          gasUsed: inspection.timeline.receipt.gasUsed,
          status: inspection.timeline.receipt.receiptStatus,
          settledAt: inspection.timeline.receipt.settledAt,
        }
      : null,
    plans: inspection.timeline.plans.map((p) => ({
      planId: p.planId,
      provider: p.provider,
      sponsor: p.sponsor ?? null,
      estimatedGas: p.estimatedGas,
      estimatedValue: p.estimatedValue,
      policyHash: p.policyHash,
      status: p.status,
    })),
    approvals: inspection.timeline.approvals.map((a) => ({
      approvalId: a.approvalId,
      approver: a.approver,
      approverRole: a.approverRole,
      status: a.status,
    })),
    disputes: inspection.timeline.disputes.map((d) => ({
      disputeId: d.disputeId,
      reason: d.reason,
      status: d.status,
      evidenceCount: d.evidence.length,
      createdAt: d.createdAt,
      resolvedAt: d.resolvedAt ?? null,
    })),
    auditEntryCount: inspection.timeline.entries.length,
  };

  return JSON.stringify(evidence, null, 2);
}
