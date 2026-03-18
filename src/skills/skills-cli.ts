/**
 * Skills CLI Actions
 *
 * Provides `list`, `info`, and `check` actions for skill management.
 * Framework-agnostic — returns structured data and formatted strings
 * that can be consumed by any CLI framework or REPL.
 * Inspired by OpenClaw's skills-cli.ts.
 */

import type {
  OpenFoxDatabase,
  SkillStatusEntry,
  SkillsConfig,
} from "../types.js";
import { buildSkillStatusReport } from "./loader.js";

// ─── Types ───────────────────────────────────────────────────────

export type SkillsListOptions = {
  eligible?: boolean;
  json?: boolean;
  verbose?: boolean;
};

export type SkillsCheckResult = {
  total: number;
  ready: number;
  missing: number;
  entries: SkillStatusEntry[];
};

// ─── Actions ─────────────────────────────────────────────────────

/**
 * List all skills with optional eligibility filtering.
 */
export function skillsList(
  skillsDir: string,
  db: OpenFoxDatabase,
  skillsConfig?: SkillsConfig,
  options?: SkillsListOptions,
): SkillStatusEntry[] {
  let entries = buildSkillStatusReport(skillsDir, db, skillsConfig);
  if (options?.eligible) {
    entries = entries.filter((e) => e.eligible);
  }
  return entries;
}

/**
 * Get detailed info for a single skill.
 */
export function skillsInfo(
  skillsDir: string,
  db: OpenFoxDatabase,
  name: string,
  skillsConfig?: SkillsConfig,
): SkillStatusEntry | undefined {
  const entries = buildSkillStatusReport(skillsDir, db, skillsConfig);
  return entries.find((e) => e.name === name);
}

/**
 * Summary check: how many skills are ready vs missing requirements.
 */
export function skillsCheck(
  skillsDir: string,
  db: OpenFoxDatabase,
  skillsConfig?: SkillsConfig,
): SkillsCheckResult {
  const entries = buildSkillStatusReport(skillsDir, db, skillsConfig);
  const ready = entries.filter((e) => e.eligible).length;
  return {
    total: entries.length,
    ready,
    missing: entries.length - ready,
    entries,
  };
}

// ─── Formatting ──────────────────────────────────────────────────

/**
 * Format a list of skill status entries for terminal display.
 */
export function formatSkillsList(
  entries: SkillStatusEntry[],
  verbose?: boolean,
): string {
  if (entries.length === 0) return "No skills found.";

  const lines: string[] = [];
  for (const e of entries) {
    const status = e.eligible ? "ready" : "missing";
    const badge = e.eligible ? "[+]" : "[-]";
    const src = e.source === "bundled" ? "" : ` (${e.source})`;
    lines.push(`${badge} ${e.name}${src} — ${e.description || "(no description)"} [${status}]`);

    if (verbose) {
      if (e.missingBins.length > 0) lines.push(`    missing bins: ${e.missingBins.join(", ")}`);
      if (e.missingEnv.length > 0) lines.push(`    missing env: ${e.missingEnv.join(", ")}`);
      if (e.missingConfig.length > 0) lines.push(`    missing config: ${e.missingConfig.join(", ")}`);
      if (e.preferredInstall) lines.push(`    install: ${e.preferredInstall.kind} — ${e.preferredInstall.label || ""}`);
    }
  }
  return lines.join("\n");
}

/**
 * Format a single skill's detailed info.
 */
export function formatSkillInfo(entry: SkillStatusEntry): string {
  const lines: string[] = [
    `Name:        ${entry.name}`,
    `Description: ${entry.description || "(none)"}`,
    `Source:      ${entry.source}`,
    `Path:        ${entry.path}`,
    `Eligible:    ${entry.eligible ? "yes" : "no"}`,
    `Enabled:     ${entry.enabled ? "yes" : "no"}`,
  ];
  if (entry.always) lines.push("Always:      yes");
  if (entry.homepage) lines.push(`Homepage:    ${entry.homepage}`);
  if (entry.primaryEnv) lines.push(`Primary Env: ${entry.primaryEnv}`);
  if (entry.os) lines.push(`OS:          ${entry.os.join(", ")}`);
  if (entry.license) lines.push(`License:     ${entry.license}`);
  if (entry.missingBins.length > 0) lines.push(`Missing bins:   ${entry.missingBins.join(", ")}`);
  if (entry.missingEnv.length > 0) lines.push(`Missing env:    ${entry.missingEnv.join(", ")}`);
  if (entry.missingConfig.length > 0) lines.push(`Missing config: ${entry.missingConfig.join(", ")}`);
  if (entry.install.length > 0) {
    lines.push("Install options:");
    for (const spec of entry.install) {
      lines.push(`  - ${spec.kind}: ${spec.label || spec.formula || spec.package || spec.module || spec.url || ""}`);
    }
    if (entry.preferredInstall) {
      lines.push(`  Preferred: ${entry.preferredInstall.kind}`);
    }
  }
  return lines.join("\n");
}

/**
 * Format a check summary.
 */
export function formatSkillsCheck(result: SkillsCheckResult): string {
  const lines: string[] = [
    `Skills: ${result.total} total, ${result.ready} ready, ${result.missing} missing requirements`,
  ];
  if (result.missing > 0) {
    lines.push("");
    const missing = result.entries.filter((e) => !e.eligible);
    for (const e of missing) {
      const reasons: string[] = [];
      if (e.missingBins.length > 0) reasons.push(`bins: ${e.missingBins.join(", ")}`);
      if (e.missingEnv.length > 0) reasons.push(`env: ${e.missingEnv.join(", ")}`);
      if (e.missingConfig.length > 0) reasons.push(`config: ${e.missingConfig.join(", ")}`);
      lines.push(`  ${e.name}: ${reasons.join("; ")}`);
    }
  }
  return lines.join("\n");
}
