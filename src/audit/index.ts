/**
 * Audit Module
 *
 * GTOS 2046 Phase 6: Audit, Proof, and Receipt Convergence
 * Exports the append-only audit journal, report generator,
 * types, and execution trail utilities.
 */

export type {
  AuditEntryKind,
  AuditEntry,
  AuditQuery,
  AuditReport,
  AuditReportSummary,
} from "./types.js";

export { AuditJournal } from "./journal.js";
export { AuditReportGenerator } from "./report-generator.js";

export {
  resolveExecutionReferences,
  bindExecutionTrailsByTransaction,
  propagateExecutionTrailsForSubject,
} from "./execution-trails.js";

export type {
  ProofRef,
  DisputeRecord,
  ReplayTimeline,
} from "./replay.js";
export { ReplayInspector } from "./replay.js";

export type { ProofDisplay } from "./proof-display.js";
export {
  formatProofRef,
  formatExecutionProofs,
  generateProofSummary,
} from "./proof-display.js";

export type { DisputeInspection, ExecutionComparison } from "./dispute-tools.js";
export {
  inspectDispute,
  compareExecutions,
  exportDisputeEvidence,
} from "./dispute-tools.js";
