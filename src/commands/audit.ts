/**
 * Audit CLI Commands
 *
 * GTOS 2046: Query and inspect the append-only audit journal.
 *
 * Usage:
 *   openfox audit journal [--intent <id>] [--kind <kind>] [--limit <n>]
 *   openfox audit report [--from <timestamp>] [--to <timestamp>] [--terminal <class>]
 *   openfox audit proofs <intentId>
 */

import { loadConfig, resolvePath } from "../config.js";
import { createDatabase } from "../state/database.js";
import { createLogger } from "../observability/logger.js";
import { createAuditJournal } from "../pipeline/factory.js";
import type { AuditEntryKind, AuditEntry, AuditQuery, AuditReportSummary } from "../audit/types.js";

const logger = createLogger("audit");

export async function handleAuditCommand(args: string[]): Promise<void> {
  const subcommand = args[0];

  if (!subcommand || subcommand === "--help" || subcommand === "-h" || subcommand === "help") {
    printUsage();
    return;
  }

  switch (subcommand) {
    case "journal":
      return handleJournal(args.slice(1));
    case "report":
      return handleReport(args.slice(1));
    case "proofs":
      return handleProofs(args.slice(1));
    default:
      logger.error(`Unknown audit subcommand: ${subcommand}`);
      printUsage();
  }
}

// ── journal ─────────────────────────────────────────────────────

async function handleJournal(args: string[]): Promise<void> {
  const intentId = parseFlag(args, "--intent", "");
  const kindStr = parseFlag(args, "--kind", "");
  const limit = parseInt(parseFlag(args, "--limit", "50"), 10);

  const config = requireConfig();
  if (!config) return;
  const db = createDatabase(resolvePath(config.dbPath));

  try {
    const audit = createAuditJournal(db);
    if (!audit) {
      logger.error("Could not open audit journal.");
      return;
    }

    const query: AuditQuery = { limit };
    if (intentId) query.intentId = intentId;
    if (kindStr) query.kind = kindStr as AuditEntryKind;

    const entries = audit.query(query);

    if (entries.length === 0) {
      logger.info("No audit entries found matching the given filters.");
      return;
    }

    logger.info(`Audit Journal (${entries.length} entries):\n`);

    for (const entry of entries) {
      const ts = new Date(entry.timestamp * 1000).toISOString();
      const intentRef = entry.intentId ? ` intent=${entry.intentId}` : "";
      logger.info(`  [${ts}] ${entry.kind}${intentRef}`);
      logger.info(`    ${entry.summary}`);
      if (entry.txHash) logger.info(`    tx=${entry.txHash}`);
      if (entry.sponsorAddress) logger.info(`    sponsor=${entry.sponsorAddress}`);
      if (entry.value) logger.info(`    value=${entry.value} tomi`);
    }
  } finally {
    db.close();
  }
}

// ── report ──────────────────────────────────────────────────────

async function handleReport(args: string[]): Promise<void> {
  const fromStr = parseFlag(args, "--from", "");
  const toStr = parseFlag(args, "--to", "");
  const terminalClass = parseFlag(args, "--terminal", "");

  const config = requireConfig();
  if (!config) return;
  const db = createDatabase(resolvePath(config.dbPath));

  try {
    const audit = createAuditJournal(db);
    if (!audit) {
      logger.error("Could not open audit journal.");
      return;
    }

    const query: AuditQuery = {};
    if (fromStr) query.fromTimestamp = parseInt(fromStr, 10);
    if (toStr) query.toTimestamp = parseInt(toStr, 10);
    if (terminalClass) query.terminalClass = terminalClass;

    const entries = audit.query(query);

    if (entries.length === 0) {
      logger.info("No audit entries found for the given report period.");
      return;
    }

    // Build summary
    const summary = buildReportSummary(entries);

    logger.info("=== Audit Report ===\n");
    logger.info(`Generated: ${new Date().toISOString()}`);
    logger.info(`Period: ${summary.timeRange.from ? new Date(summary.timeRange.from * 1000).toISOString() : "N/A"} to ${summary.timeRange.to ? new Date(summary.timeRange.to * 1000).toISOString() : "N/A"}`);
    logger.info(`Total entries: ${summary.totalEntries}`);
    logger.info("");

    logger.info("By Kind:");
    for (const [kind, count] of Object.entries(summary.byKind)) {
      logger.info(`  ${kind}: ${count}`);
    }
    logger.info("");

    if (Object.keys(summary.byTerminal).length > 0) {
      logger.info("By Terminal:");
      for (const [terminal, count] of Object.entries(summary.byTerminal)) {
        logger.info(`  ${terminal}: ${count}`);
      }
      logger.info("");
    }

    if (Object.keys(summary.byActor).length > 0) {
      logger.info("By Actor:");
      for (const [actor, count] of Object.entries(summary.byActor)) {
        logger.info(`  ${actor}: ${count}`);
      }
      logger.info("");
    }

    if (Object.keys(summary.bySponsor).length > 0) {
      logger.info("By Sponsor:");
      for (const [sponsor, count] of Object.entries(summary.bySponsor)) {
        logger.info(`  ${sponsor}: ${count}`);
      }
      logger.info("");
    }

    if (summary.totalValue !== "0") {
      logger.info(`Total value transacted: ${summary.totalValue} tomi`);
    }
  } finally {
    db.close();
  }
}

// ── proofs ──────────────────────────────────────────────────────

async function handleProofs(args: string[]): Promise<void> {
  const intentId = args[0];
  if (!intentId) {
    logger.error("Usage: openfox audit proofs <intentId>");
    return;
  }

  const config = requireConfig();
  if (!config) return;
  const db = createDatabase(resolvePath(config.dbPath));

  try {
    const audit = createAuditJournal(db);
    if (!audit) {
      logger.error("Could not open audit journal.");
      return;
    }

    const entries = audit.getIntentTimeline(intentId);
    if (entries.length === 0) {
      logger.info(`No audit entries found for intent ${intentId}.`);
      return;
    }

    logger.info(`=== Audit Proofs: ${intentId} ===\n`);

    // Extract proof-relevant entries (policy decisions, approvals, execution, settlement)
    const proofEntries = entries.filter((e) =>
      ["policy_decision", "approval_granted", "approval_denied", "execution_settled", "execution_failed", "sponsor_selected"].includes(e.kind),
    );

    if (proofEntries.length === 0) {
      logger.info("No proof-relevant entries found for this intent.");
      logger.info("The intent may still be in progress or may have been created but not executed.");
      return;
    }

    for (const entry of proofEntries) {
      const ts = new Date(entry.timestamp * 1000).toISOString();
      logger.info(`[${ts}] ${formatKindLabel(entry.kind)}`);
      logger.info(`  ${entry.summary}`);
      if (entry.policyHash) logger.info(`  Policy hash: ${entry.policyHash}`);
      if (entry.policyDecision) logger.info(`  Decision: ${entry.policyDecision}`);
      if (entry.txHash) logger.info(`  Tx hash: ${entry.txHash}`);
      if (entry.approvalId) logger.info(`  Approval: ${entry.approvalId}`);
      if (entry.receiptId) logger.info(`  Receipt: ${entry.receiptId}`);
      logger.info("");
    }

    logger.info(`Total proof entries: ${proofEntries.length} of ${entries.length} audit entries.`);
  } finally {
    db.close();
  }
}

// ── Helpers ─────────────────────────────────────────────────────

function printUsage(): void {
  logger.info(`
OpenFox audit journal

Usage:
  openfox audit journal [--intent <id>] [--kind <kind>] [--limit <n>]
  openfox audit report [--from <timestamp>] [--to <timestamp>] [--terminal <class>]
  openfox audit proofs <intentId>

Subcommands:
  journal    Query the append-only audit journal with filters
  report     Generate a summary report for a time period
  proofs     Show proof-relevant audit entries for an intent
`);
}

function requireConfig() {
  const config = loadConfig();
  if (!config) {
    logger.error("OpenFox is not configured. Run openfox --setup first.");
    return null;
  }
  return config;
}

function parseFlag(args: string[], flag: string, defaultValue: string): string {
  const idx = args.indexOf(flag);
  if (idx !== -1 && idx + 1 < args.length) {
    return args[idx + 1]!;
  }
  return defaultValue;
}

function buildReportSummary(entries: AuditEntry[]): AuditReportSummary {
  const byKind: Record<string, number> = {};
  const byTerminal: Record<string, number> = {};
  const byActor: Record<string, number> = {};
  const bySponsor: Record<string, number> = {};
  let totalValue = 0n;
  let minTs = Infinity;
  let maxTs = 0;

  for (const entry of entries) {
    // Count by kind
    byKind[entry.kind] = (byKind[entry.kind] ?? 0) + 1;

    // Count by terminal
    if (entry.terminalClass) {
      byTerminal[entry.terminalClass] = (byTerminal[entry.terminalClass] ?? 0) + 1;
    }

    // Count by actor
    if (entry.actorAddress) {
      byActor[entry.actorAddress] = (byActor[entry.actorAddress] ?? 0) + 1;
    }

    // Count by sponsor
    if (entry.sponsorAddress) {
      bySponsor[entry.sponsorAddress] = (bySponsor[entry.sponsorAddress] ?? 0) + 1;
    }

    // Sum value
    if (entry.value) {
      try {
        totalValue += BigInt(entry.value);
      } catch {
        // ignore non-numeric values
      }
    }

    // Track time range
    if (entry.timestamp < minTs) minTs = entry.timestamp;
    if (entry.timestamp > maxTs) maxTs = entry.timestamp;
  }

  return {
    totalEntries: entries.length,
    byKind,
    byTerminal,
    byActor,
    bySponsor,
    totalValue: totalValue.toString(),
    timeRange: {
      from: minTs === Infinity ? 0 : minTs,
      to: maxTs,
    },
  };
}

function formatKindLabel(kind: string): string {
  return kind
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}
