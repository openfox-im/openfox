/**
 * Skill Environment Variable Overrides
 *
 * Reference-counted environment variable injection for skills, inspired by
 * OpenClaw's env-overrides.ts. Safely injects skill-configured env vars
 * (e.g. API keys) into `process.env`, tracks baselines, and restores
 * originals when the last consumer releases.
 *
 * Security features:
 * - Blocks dangerous host env vars (LD_*, DYLD_*, loader paths, etc.)
 * - Blocks OPENSSL_CONF injection
 * - Validates no null bytes in values
 * - Sensitive keys only allowed if in skill's primaryEnv / requires.env
 */

import type { Skill, SkillConfig, SkillsConfig } from "../types.js";
import { resolveSkillConfig, resolveSkillKey } from "./config.js";
import { createLogger } from "../observability/logger.js";

const logger = createLogger("skills.env-overrides");

// ─── Types ───────────────────────────────────────────────────────

type EnvEntry = {
  baseline: string | undefined;
  injected: string;
  count: number;
};

// ─── State ───────────────────────────────────────────────────────

const activeEntries = new Map<string, EnvEntry>();

// ─── Blocked Patterns ────────────────────────────────────────────

const ALWAYS_BLOCKED_PATTERNS: RegExp[] = [/^OPENSSL_CONF$/i];

const DANGEROUS_ENV_PREFIXES = [
  "LD_",
  "DYLD_",
  "_JAVA_",
];

const DANGEROUS_ENV_NAMES = new Set([
  "PYTHONPATH",
  "PYTHONSTARTUP",
  "PYTHONHOME",
  "NODE_PATH",
  "NODE_OPTIONS",
  "NODE_EXTRA_CA_CERTS",
  "PERL5LIB",
  "PERL5OPT",
  "RUBYLIB",
  "RUBYOPT",
  "GEM_HOME",
  "GEM_PATH",
  "GOPATH",
  "GOROOT",
  "JAVA_HOME",
  "JAVA_TOOL_OPTIONS",
  "CLASSPATH",
  "BASH_ENV",
  "ENV",
  "ZDOTDIR",
  "EDITOR",
  "VISUAL",
  "SHELL",
  "COMSPEC",
  "PATH",
  "HOME",
  "USER",
  "LOGNAME",
  "TMPDIR",
  "TMP",
  "TEMP",
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME",
  "XDG_CACHE_HOME",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
  "CURL_CA_BUNDLE",
  "REQUESTS_CA_BUNDLE",
  "AWS_CA_BUNDLE",
  "GIT_SSL_CAINFO",
  "http_proxy",
  "https_proxy",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "ALL_PROXY",
  "NO_PROXY",
]);

function isDangerousEnvVar(name: string): boolean {
  if (DANGEROUS_ENV_NAMES.has(name)) return true;
  const upper = name.toUpperCase();
  return DANGEROUS_ENV_PREFIXES.some((prefix) => upper.startsWith(prefix));
}

function isAlwaysBlocked(name: string): boolean {
  return ALWAYS_BLOCKED_PATTERNS.some((p) => p.test(name));
}

function hasNullByte(value: string): boolean {
  return value.includes("\0");
}

// ─── Reference Counting ─────────────────────────────────────────

function acquireEnvKey(name: string, value: string): boolean {
  const existing = activeEntries.get(name);
  if (existing) {
    if (existing.injected === value) {
      existing.count++;
      return true;
    }
    // Different value — conflict with an already-injected key
    logger.warn(`Env var "${name}" already injected with different value, skipping.`);
    return false;
  }

  // Check if externally set (not by us)
  const current = process.env[name];

  activeEntries.set(name, {
    baseline: current,
    injected: value,
    count: 1,
  });

  process.env[name] = value;
  return true;
}

function releaseEnvKey(name: string): void {
  const entry = activeEntries.get(name);
  if (!entry) return;

  entry.count--;
  if (entry.count <= 0) {
    // Restore baseline
    if (entry.baseline === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = entry.baseline;
    }
    activeEntries.delete(name);
  }
}

// ─── Public API ──────────────────────────────────────────────────

/**
 * Returns the set of env var names currently injected by skills.
 */
export function getActiveSkillEnvKeys(): ReadonlySet<string> {
  return new Set(activeEntries.keys());
}

/**
 * Build the set of env vars a single skill wants to inject, based on
 * its `SkillConfig.env` and `SkillConfig.apiKey` + `skill.primaryEnv`.
 */
function buildPendingOverrides(
  skill: Skill,
  skillConfig: SkillConfig | undefined,
): Record<string, string> {
  const pending: Record<string, string> = {};

  // Env overrides from config
  if (skillConfig?.env) {
    for (const [key, value] of Object.entries(skillConfig.env)) {
      if (typeof value === "string" && value) {
        pending[key] = value;
      }
    }
  }

  // API key → primaryEnv
  if (skillConfig?.apiKey && skill.primaryEnv) {
    const envName = skill.primaryEnv;
    // Only inject if not already set in process.env
    if (!process.env[envName]) {
      pending[envName] = skillConfig.apiKey;
    }
  }

  return pending;
}

/**
 * Determine which env vars are "sensitive" for a skill — only these
 * are allowed to be injected even if they match dangerous patterns.
 */
function buildSensitiveAllowlist(skill: Skill): Set<string> {
  const allowed = new Set<string>();
  if (skill.primaryEnv) allowed.add(skill.primaryEnv);
  if (skill.requires?.env) {
    for (const e of skill.requires.env) allowed.add(e);
  }
  return allowed;
}

/**
 * Sanitize a set of pending env overrides. Returns only the safe ones.
 */
function sanitizeOverrides(
  pending: Record<string, string>,
  sensitiveAllowlist: Set<string>,
  skillName: string,
): Record<string, string> {
  const safe: Record<string, string> = {};

  for (const [name, value] of Object.entries(pending)) {
    if (isAlwaysBlocked(name)) {
      logger.warn(`Skill "${skillName}": blocked env var "${name}" (always-blocked pattern).`);
      continue;
    }
    if (hasNullByte(value)) {
      logger.warn(`Skill "${skillName}": blocked env var "${name}" (null byte in value).`);
      continue;
    }
    if (isDangerousEnvVar(name) && !sensitiveAllowlist.has(name)) {
      logger.warn(`Skill "${skillName}": blocked dangerous env var "${name}".`);
      continue;
    }
    safe[name] = value;
  }

  return safe;
}

/**
 * Apply env overrides for a list of skills. Returns a reverter function
 * that restores all injected vars when called.
 */
export function applySkillEnvOverrides(
  skills: Skill[],
  skillsConfig?: SkillsConfig,
): () => void {
  const injectedKeys: string[] = [];

  for (const skill of skills) {
    const key = resolveSkillKey(skill);
    const skillConfig = resolveSkillConfig(skillsConfig, key);
    const pending = buildPendingOverrides(skill, skillConfig);
    if (Object.keys(pending).length === 0) continue;

    const allowlist = buildSensitiveAllowlist(skill);
    const safe = sanitizeOverrides(pending, allowlist, skill.name);

    for (const [name, value] of Object.entries(safe)) {
      if (acquireEnvKey(name, value)) {
        injectedKeys.push(name);
      }
    }
  }

  // Return reverter
  return () => {
    for (const key of injectedKeys) {
      releaseEnvKey(key);
    }
  };
}
