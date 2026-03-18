/**
 * Envelope Emitter
 *
 * GTOS 2046: Wraps signer, paymaster, discovery, and wallet flows to emit
 * IntentEnvelope / PlanRecord / ApprovalRecord / ExecutionReceipt at key
 * lifecycle points. The default implementation writes every event to the
 * audit journal and optionally forwards to an external sink.
 */

import type {
  IntentEnvelope,
  PlanRecord,
  ApprovalRecord,
  ExecutionReceipt,
} from "./types.js";
import type { AuditJournal } from "../audit/journal.js";
import type { AuditEntryKind } from "../audit/types.js";

// ── Emitter interface ────────────────────────────────────────────────

/** Callback sink that receives envelope lifecycle events. */
export interface EnvelopeEmitter {
  onIntentCreated(intent: IntentEnvelope): void;
  onPlanCreated(plan: PlanRecord): void;
  onApprovalGranted(
    approval: ApprovalRecord,
    auditContext?: {
      actorAddress?: string;
      summary?: string;
      details?: Record<string, unknown>;
    },
  ): void;
  onReceiptSettled(receipt: ExecutionReceipt): void;
}

/** Optional external sink for forwarding envelope events. */
export interface ExternalEnvelopeSink {
  send(event: EnvelopeEvent): void;
}

export interface EnvelopeEvent {
  kind: "intent_created" | "plan_created" | "approval_granted" | "receipt_settled";
  timestamp: number;
  payload: IntentEnvelope | PlanRecord | ApprovalRecord | ExecutionReceipt;
}

// ── Default audit-backed emitter ────────────────────────────────────

/**
 * Writes every envelope lifecycle event to the audit journal.
 * Optionally forwards events to an external sink (webhook, message bus, etc.).
 */
export class AuditEnvelopeEmitter implements EnvelopeEmitter {
  private journal: AuditJournal | null;
  private sink: ExternalEnvelopeSink | null;

  constructor(params: { journal?: AuditJournal; sink?: ExternalEnvelopeSink }) {
    this.journal = params.journal ?? null;
    this.sink = params.sink ?? null;
  }

  onIntentCreated(intent: IntentEnvelope): void {
    this.appendAudit("intent_created", {
      intentId: intent.intentId,
      actorAddress: intent.requester,
      terminalClass: intent.terminalClass,
      trustTier: intent.trustTier,
      summary: `Envelope emitted: intent ${intent.intentId} (${intent.action})`,
    });
    this.forward("intent_created", intent);
  }

  onPlanCreated(plan: PlanRecord): void {
    this.appendAudit("plan_created", {
      intentId: plan.intentId,
      planId: plan.planId,
      summary: `Envelope emitted: plan ${plan.planId} for intent ${plan.intentId}`,
    });
    this.forward("plan_created", plan);
  }

  onApprovalGranted(
    approval: ApprovalRecord,
    auditContext?: {
      actorAddress?: string;
      summary?: string;
      details?: Record<string, unknown>;
    },
  ): void {
    this.appendAudit("approval_granted", {
      intentId: approval.intentId,
      planId: approval.planId,
      approvalId: approval.approvalId,
      actorAddress: auditContext?.actorAddress ?? approval.approver,
      summary: auditContext?.summary ?? `Envelope emitted: approval ${approval.approvalId} granted`,
      details: auditContext?.details,
    });
    this.forward("approval_granted", approval);
  }

  onReceiptSettled(receipt: ExecutionReceipt): void {
    this.appendAudit("execution_settled", {
      intentId: receipt.intentId,
      planId: receipt.planId,
      receiptId: receipt.receiptId,
      txHash: receipt.txHash,
      value: receipt.value,
      summary: `Envelope emitted: receipt ${receipt.receiptId} settled`,
    });
    this.forward("receipt_settled", receipt);
  }

  // ── Internals ──────────────────────────────────────────────────────

  private appendAudit(
    kind: AuditEntryKind,
    fields: {
      intentId?: string;
      planId?: string;
      approvalId?: string;
      receiptId?: string;
      actorAddress?: string;
      terminalClass?: string;
      trustTier?: number;
      txHash?: string;
      value?: string;
      summary: string;
      details?: Record<string, unknown>;
    },
  ): void {
    if (!this.journal) return;
    this.journal.append({
      kind,
      timestamp: Math.floor(Date.now() / 1000),
      ...fields,
    });
  }

  private forward(
    kind: EnvelopeEvent["kind"],
    payload: EnvelopeEvent["payload"],
  ): void {
    if (!this.sink) return;
    this.sink.send({ kind, timestamp: Math.floor(Date.now() / 1000), payload });
  }
}

// ── Flow wrappers ───────────────────────────────────────────────────

/**
 * Hook into a signer client so that every execution emits an envelope event.
 * The signer client is expected to expose an `onExecution` callback or
 * `execute` method — we wrap whichever is available.
 */
export function wrapSignerWithEnvelope(
  signerClient: { execute?: (...args: unknown[]) => Promise<unknown>; onExecution?: (cb: (receipt: ExecutionReceipt) => void) => void },
  emitter: EnvelopeEmitter,
): void {
  if (typeof signerClient.onExecution === "function") {
    signerClient.onExecution((receipt: ExecutionReceipt) => {
      emitter.onReceiptSettled(receipt);
    });
    return;
  }

  if (typeof signerClient.execute === "function") {
    const original = signerClient.execute.bind(signerClient);
    signerClient.execute = async (...args: unknown[]): Promise<unknown> => {
      const result = await original(...args);
      // If the result looks like an ExecutionReceipt, emit it
      if (result && typeof result === "object" && "receiptId" in (result as Record<string, unknown>)) {
        emitter.onReceiptSettled(result as ExecutionReceipt);
      }
      return result;
    };
  }
}

/**
 * Hook into a paymaster client so that every authorization emits an envelope
 * event. Wraps the `authorize` or `sponsor` method.
 */
export function wrapPaymasterWithEnvelope(
  paymasterClient: { authorize?: (...args: unknown[]) => Promise<unknown>; sponsor?: (...args: unknown[]) => Promise<unknown> },
  emitter: EnvelopeEmitter,
): void {
  const methodName = typeof paymasterClient.authorize === "function"
    ? "authorize" as const
    : typeof paymasterClient.sponsor === "function"
      ? "sponsor" as const
      : null;

  if (!methodName) return;

  const original = (paymasterClient[methodName] as (...args: unknown[]) => Promise<unknown>).bind(paymasterClient);
  (paymasterClient as Record<string, unknown>)[methodName] = async (...args: unknown[]): Promise<unknown> => {
    const result = await original(...args);
    // If the result carries an approval record, emit it
    if (result && typeof result === "object" && "approvalId" in (result as Record<string, unknown>)) {
      emitter.onApprovalGranted(result as ApprovalRecord);
    }
    return result;
  };
}

/**
 * Hook into a discovery client so that every discovered intent or plan
 * emits an envelope event. Wraps the `discover` or `resolve` method.
 */
export function wrapDiscoveryWithEnvelope(
  discoveryClient: { discover?: (...args: unknown[]) => Promise<unknown>; resolve?: (...args: unknown[]) => Promise<unknown> },
  emitter: EnvelopeEmitter,
): void {
  const methodName = typeof discoveryClient.discover === "function"
    ? "discover" as const
    : typeof discoveryClient.resolve === "function"
      ? "resolve" as const
      : null;

  if (!methodName) return;

  const original = (discoveryClient[methodName] as (...args: unknown[]) => Promise<unknown>).bind(discoveryClient);
  (discoveryClient as Record<string, unknown>)[methodName] = async (...args: unknown[]): Promise<unknown> => {
    const result = await original(...args);
    // If the result carries a plan record, emit it
    if (result && typeof result === "object") {
      const rec = result as Record<string, unknown>;
      if ("planId" in rec) {
        emitter.onPlanCreated(result as PlanRecord);
      } else if ("intentId" in rec && "action" in rec) {
        emitter.onIntentCreated(result as IntentEnvelope);
      }
    }
    return result;
  };
}
