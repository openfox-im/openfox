/**
 * Skills Configuration & Eligibility
 *
 * Per-skill configuration resolution and eligibility evaluation, inspired by
 * OpenClaw's config.ts. Determines whether a skill should be included based
 * on: enabled flag, bundled allowlist, OS platform, binary availability,
 * environment variables, config paths, and `always` bypass.
 */

import { execFileSync } from "child_process";
import os from "os";
import type { Skill, SkillConfig, SkillsConfig } from "../types.js";

const BIN_NAME_RE = /^[a-zA-Z0-9._-]+$/;

const BUNDLED_SOURCES = new Set(["bundled"]);

/**
 * Default truthy values for common config paths.
 * Used as fallback when a skill's `requires.config` path is not in
 * the per-skill config block.
 */
const DEFAULT_CONFIG_VALUES: Record<string, unknown> = {
  "browser.enabled": true,
  "browser.evaluateEnabled": true,
};

/**
 * Resolve the config lookup key for a skill.
 * Uses `skill.skillKey` if set, otherwise falls back to `skill.name`.
 */
export function resolveSkillKey(skill: Skill): string {
  return skill.skillKey ?? skill.name;
}

export function resolveSkillConfig(
  skillsConfig: SkillsConfig | undefined,
  skillName: string,
): SkillConfig | undefined {
  const entries = skillsConfig?.entries;
  if (!entries || typeof entries !== "object") return undefined;
  const entry = entries[skillName];
  return entry && typeof entry === "object" ? entry : undefined;
}

export function hasBinary(bin: string): boolean {
  if (!BIN_NAME_RE.test(bin)) return false;
  try {
    execFileSync("which", [bin], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function isBundledSkill(skill: Skill): boolean {
  return BUNDLED_SOURCES.has(skill.source);
}

export function isBundledSkillAllowed(skill: Skill, allowlist?: string[]): boolean {
  if (!allowlist || allowlist.length === 0) return true;
  if (!isBundledSkill(skill)) return true;
  return allowlist.includes(skill.name);
}

function matchesPlatform(osList?: string[]): boolean {
  if (!osList || osList.length === 0) return true;
  const platform = os.platform();
  return osList.some((o) => o === platform);
}

/**
 * Evaluate whether a skill should be included.
 * Checks in order: enabled, bundled allowlist, always bypass, OS, bins, anyBins, env, config.
 *
 * When `skill.always === true` runtime requirement checks (OS, bins, env, config)
 * are skipped — the skill is always included as long as it is enabled and passes
 * the bundled allowlist.
 */
export function shouldIncludeSkill(params: {
  skill: Skill;
  skillsConfig?: SkillsConfig;
}): boolean {
  const { skill, skillsConfig } = params;
  const key = resolveSkillKey(skill);
  const skillConfig = resolveSkillConfig(skillsConfig, key);
  const allowBundled = skillsConfig?.allowBundled;

  // Explicit disable
  if (skillConfig?.enabled === false) return false;
  if (!skill.enabled) return false;

  // Bundled allowlist
  if (!isBundledSkillAllowed(skill, allowBundled)) return false;

  // always: true bypasses all runtime requirement checks
  if (skill.always === true) return true;

  // OS filter
  if (!matchesPlatform(skill.os)) return false;

  // Binary requirements
  if (skill.requires?.bins) {
    for (const bin of skill.requires.bins) {
      if (!hasBinary(bin)) return false;
    }
  }

  // anyBins: at least one must exist
  if (skill.requires?.anyBins && skill.requires.anyBins.length > 0) {
    if (!skill.requires.anyBins.some(hasBinary)) return false;
  }

  // Environment variables (can be satisfied by skillConfig.env or skillConfig.apiKey)
  if (skill.requires?.env) {
    for (const envName of skill.requires.env) {
      const fromProcess = process.env[envName];
      const fromConfig = skillConfig?.env?.[envName];
      const fromApiKey = skillConfig?.apiKey && skill.primaryEnv === envName;
      if (!fromProcess && !fromConfig && !fromApiKey) return false;
    }
  }

  // Config path requirements (with default fallbacks)
  if (skill.requires?.config) {
    for (const configPath of skill.requires.config) {
      if (!isConfigPathTruthy(skillConfig, configPath)) return false;
    }
  }

  return true;
}

export function isConfigPathTruthy(skillConfig: SkillConfig | undefined, pathStr: string): boolean {
  // Check per-skill config first
  if (skillConfig?.config) {
    const parts = pathStr.split(".");
    let current: unknown = skillConfig.config;
    let resolved = true;
    for (const part of parts) {
      if (current === null || current === undefined || typeof current !== "object") {
        resolved = false;
        break;
      }
      current = (current as Record<string, unknown>)[part];
    }
    // If the path was fully resolved in per-skill config, use that value
    // (even if falsy — explicit false overrides defaults)
    if (resolved && current !== undefined) return Boolean(current);
  }
  // Fall back to default config values
  return Boolean(DEFAULT_CONFIG_VALUES[pathStr]);
}
