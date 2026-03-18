/**
 * Audit Report Generator
 *
 * GTOS 2046 Phase 6: Grouped audit report generation.
 * Builds structured reports from audit journal entries with
 * summary statistics grouped by kind, terminal, actor, and sponsor.
 */

import type { AuditJournal } from "./journal.js";
import type {
  AuditEntry,
  AuditQuery,
  AuditReport,
  AuditReportSummary,
} from "./types.js";

export class AuditReportGenerator {
  private journal: AuditJournal;

  constructor(journal: AuditJournal) {
    this.journal = journal;
  }

  /** Generate a full report for a query (typically a time range). */
  generateReport(query: AuditQuery): AuditReport {
    const entries = this.journal.query(query);
    const summary = this.generateSummary(entries);
    const title = this.buildTitle(query);
    return {
      title,
      generatedAt: Math.floor(Date.now() / 1000),
      entries,
      summary,
    };
  }

  /** Generate summary statistics from a list of entries. */
  generateSummary(entries: AuditEntry[]): AuditReportSummary {
    const byKind: Record<string, number> = {};
    const byTerminal: Record<string, number> = {};
    const byActor: Record<string, number> = {};
    const bySponsor: Record<string, number> = {};
    let totalValueBigInt = 0n;
    let minTimestamp = Infinity;
    let maxTimestamp = -Infinity;

    for (const entry of entries) {
      // By kind
      byKind[entry.kind] = (byKind[entry.kind] ?? 0) + 1;

      // By terminal
      if (entry.terminalClass) {
        byTerminal[entry.terminalClass] =
          (byTerminal[entry.terminalClass] ?? 0) + 1;
      }

      // By actor
      if (entry.actorAddress) {
        byActor[entry.actorAddress] =
          (byActor[entry.actorAddress] ?? 0) + 1;
      }

      // By sponsor
      if (entry.sponsorAddress) {
        bySponsor[entry.sponsorAddress] =
          (bySponsor[entry.sponsorAddress] ?? 0) + 1;
      }

      // Value accumulation
      if (entry.value) {
        try {
          totalValueBigInt += BigInt(entry.value);
        } catch {
          // skip non-numeric values
        }
      }

      // Time range
      if (entry.timestamp < minTimestamp) minTimestamp = entry.timestamp;
      if (entry.timestamp > maxTimestamp) maxTimestamp = entry.timestamp;
    }

    return {
      totalEntries: entries.length,
      byKind,
      byTerminal,
      byActor,
      bySponsor,
      totalValue: totalValueBigInt.toString(),
      timeRange: {
        from: entries.length > 0 ? minTimestamp : 0,
        to: entries.length > 0 ? maxTimestamp : 0,
      },
    };
  }

  /** Generate an intent-focused report showing the full lifecycle. */
  generateIntentReport(intentId: string): AuditReport {
    const entries = this.journal.getIntentTimeline(intentId);
    const summary = this.generateSummary(entries);
    return {
      title: `Intent Lifecycle: ${intentId}`,
      generatedAt: Math.floor(Date.now() / 1000),
      entries,
      summary,
    };
  }

  /** Generate a terminal-focused report for a time range. */
  generateTerminalReport(
    terminalClass: string,
    fromTimestamp: number,
    toTimestamp: number,
  ): AuditReport {
    const entries = this.journal.query({
      terminalClass,
      fromTimestamp,
      toTimestamp,
    });
    const summary = this.generateSummary(entries);
    return {
      title: `Terminal Report: ${terminalClass} (${formatTimestamp(fromTimestamp)} - ${formatTimestamp(toTimestamp)})`,
      generatedAt: Math.floor(Date.now() / 1000),
      entries,
      summary,
    };
  }

  /** Generate a sponsor attribution report for a time range. */
  generateSponsorReport(
    fromTimestamp: number,
    toTimestamp: number,
  ): AuditReport {
    const entries = this.journal.query({
      kind: [
        "sponsor_selected",
        "execution_submitted",
        "execution_settled",
        "execution_failed",
      ],
      fromTimestamp,
      toTimestamp,
    });
    const summary = this.generateSummary(entries);
    return {
      title: `Sponsor Attribution Report (${formatTimestamp(fromTimestamp)} - ${formatTimestamp(toTimestamp)})`,
      generatedAt: Math.floor(Date.now() / 1000),
      entries,
      summary,
    };
  }

  /** Format a report as human-readable text. */
  formatReportText(report: AuditReport): string {
    const lines: string[] = [];

    lines.push(`=== ${report.title} ===`);
    lines.push(`Generated: ${formatTimestamp(report.generatedAt)}`);
    lines.push("");

    // Summary section
    lines.push("--- Summary ---");
    lines.push(`Total entries: ${report.summary.totalEntries}`);
    lines.push(
      `Total value: ${report.summary.totalValue} wei`,
    );
    if (report.summary.timeRange.from > 0) {
      lines.push(
        `Time range: ${formatTimestamp(report.summary.timeRange.from)} - ${formatTimestamp(report.summary.timeRange.to)}`,
      );
    }
    lines.push("");

    // By kind
    if (Object.keys(report.summary.byKind).length > 0) {
      lines.push("By kind:");
      for (const [kind, count] of sortedEntries(report.summary.byKind)) {
        lines.push(`  ${kind}: ${count}`);
      }
      lines.push("");
    }

    // By terminal
    if (Object.keys(report.summary.byTerminal).length > 0) {
      lines.push("By terminal:");
      for (const [terminal, count] of sortedEntries(
        report.summary.byTerminal,
      )) {
        lines.push(`  ${terminal}: ${count}`);
      }
      lines.push("");
    }

    // By actor
    if (Object.keys(report.summary.byActor).length > 0) {
      lines.push("By actor:");
      for (const [actor, count] of sortedEntries(report.summary.byActor)) {
        lines.push(`  ${actor}: ${count}`);
      }
      lines.push("");
    }

    // By sponsor
    if (Object.keys(report.summary.bySponsor).length > 0) {
      lines.push("By sponsor:");
      for (const [sponsor, count] of sortedEntries(
        report.summary.bySponsor,
      )) {
        lines.push(`  ${sponsor}: ${count}`);
      }
      lines.push("");
    }

    // Entry details
    if (report.entries.length > 0) {
      lines.push("--- Entries ---");
      for (const entry of report.entries) {
        const ts = formatTimestamp(entry.timestamp);
        const actor = entry.actorAddress
          ? ` [${entry.actorRole ?? "unknown"}:${truncateAddress(entry.actorAddress)}]`
          : "";
        const terminal = entry.terminalClass
          ? ` (${entry.terminalClass}${entry.trustTier != null ? `:T${entry.trustTier}` : ""})`
          : "";
        lines.push(`${ts} ${entry.kind}${actor}${terminal} - ${entry.summary}`);
      }
    }

    return lines.join("\n");
  }

  // ── Private helpers ──────────────────────────────────────────────

  private buildTitle(query: AuditQuery): string {
    const parts: string[] = ["Audit Report"];
    if (query.intentId) parts.push(`intent:${query.intentId}`);
    if (query.terminalClass) parts.push(`terminal:${query.terminalClass}`);
    if (query.actorAddress)
      parts.push(`actor:${truncateAddress(query.actorAddress)}`);
    if (query.sponsorAddress)
      parts.push(`sponsor:${truncateAddress(query.sponsorAddress)}`);
    if (query.kind) {
      const kinds = Array.isArray(query.kind) ? query.kind : [query.kind];
      parts.push(`kind:${kinds.join(",")}`);
    }
    if (query.fromTimestamp || query.toTimestamp) {
      const from = query.fromTimestamp
        ? formatTimestamp(query.fromTimestamp)
        : "...";
      const to = query.toTimestamp ? formatTimestamp(query.toTimestamp) : "now";
      parts.push(`(${from} - ${to})`);
    }
    return parts.join(" ");
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

function sortedEntries(
  record: Record<string, number>,
): [string, number][] {
  return Object.entries(record).sort((a, b) => b[1] - a[1]);
}
