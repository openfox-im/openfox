/**
 * Execution Receipt Creation
 *
 * Creates ExecutionReceipt records from settled intent pipeline data.
 */

import { ulid } from "ulid";
import { BOUNDARY_SCHEMA_VERSION, type ApprovalRecord, type ExecutionReceipt, type IntentEnvelope, type PlanRecord, type ReceiptStatus } from "./types.js";

export interface ChainReceiptData {
  txHash: string;
  blockNumber: number;
  blockHash: string;
  from: string;
  to: string;
  gasUsed: number;
  value: string;
  status: ReceiptStatus;
}

export function createReceipt(params: {
  intent: IntentEnvelope;
  plan: PlanRecord;
  approval: ApprovalRecord;
  chainReceipt: ChainReceiptData;
  proofRef?: string;
  receiptRef?: string;
}): ExecutionReceipt {
  const now = Math.floor(Date.now() / 1000);
  return {
    receiptId: ulid(),
    intentId: params.intent.intentId,
    planId: params.plan.planId,
    approvalId: params.approval.approvalId,
    schemaVersion: BOUNDARY_SCHEMA_VERSION,
    txHash: params.chainReceipt.txHash,
    blockNumber: params.chainReceipt.blockNumber,
    blockHash: params.chainReceipt.blockHash,
    from: params.chainReceipt.from,
    to: params.chainReceipt.to,
    sponsor: params.plan.sponsor,
    actorAgentId: params.intent.actorAgentId,
    terminalClass: params.intent.terminalClass,
    trustTier: params.intent.trustTier,
    policyHash: params.plan.policyHash,
    sponsorPolicyHash: params.plan.sponsorPolicyHash,
    artifactRef: params.plan.artifactRef,
    effectsHash: params.plan.effectsHash,
    gasUsed: params.chainReceipt.gasUsed,
    value: params.chainReceipt.value,
    receiptStatus: params.chainReceipt.status,
    proofRef: params.proofRef,
    receiptRef: params.receiptRef,
    settledAt: now,
  };
}
