/**
 * Skills Registry
 *
 * Install skills from remote sources:
 * - Git repos: git clone <url> ~/.openfox/skills/<name>
 * - URLs: fetch a SKILL.md from any URL
 * - Self-created: the openfox writes its own SKILL.md files
 *
 * All shell commands use execFileSync with argument arrays to prevent injection.
 * Directory operations use fs.* to avoid shell interpolation entirely.
 */

import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";
import * as yaml from "yaml";
import type {
  Skill,
  SkillSource,
  OpenFoxDatabase,
  RuntimeClient,
} from "../types.js";
import { parseSkillMd } from "./format.js";

// Validation patterns to prevent injection via path/URL arguments
const SKILL_NAME_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;
const SAFE_URL_RE = /^https?:\/\/[^\s;|&$`(){}<>]+$/;

// Install spec validation patterns (aligned with OpenClaw)
export const BREW_FORMULA_PATTERN = /^[A-Za-z0-9][A-Za-z0-9@+._/-]*$/;
export const GO_MODULE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._~+\-/]*(?:@[A-Za-z0-9][A-Za-z0-9._~+\-/]*)?$/;
export const UV_PACKAGE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._\-[\]=<>!~+,]*$/;
export const NPM_SPEC_PATTERN = /^[a-zA-Z0-9@][a-zA-Z0-9@._\-/]*$/;

// Size limits for skill content
const MAX_DESCRIPTION_LENGTH = 1024;
const MAX_INSTRUCTIONS_LENGTH = 10_000;

/**
 * Validate that a skill path does not escape the skills directory.
 * Prevents path traversal attacks via crafted skill names.
 */
function validateSkillPath(skillsDir: string, name: string): string {
  const resolved = path.resolve(skillsDir, name);
  if (!resolved.startsWith(path.resolve(skillsDir) + path.sep)) {
    throw new Error(`Skill path traversal detected: ${name}`);
  }
  return resolved;
}

// ─── Install Spec Validation ──────────────────────────────────────

function hasUnsafeChars(value: string): boolean {
  return value.startsWith("-") || value.includes("\\") || value.includes("..");
}

function hasProtocolScheme(value: string): boolean {
  return /:\/\//.test(value);
}

/**
 * Validate a brew formula name. Blocks flag injection, backslash, `..`.
 */
export function normalizeSafeBrewFormula(formula: string): string | null {
  if (!formula || hasUnsafeChars(formula)) return null;
  return BREW_FORMULA_PATTERN.test(formula) ? formula : null;
}

/**
 * Validate an npm package spec. Blocks flag injection.
 */
export function normalizeSafeNpmSpec(spec: string): string | null {
  if (!spec || spec.startsWith("-")) return null;
  return NPM_SPEC_PATTERN.test(spec) ? spec : null;
}

/**
 * Validate a Go module path. Blocks backslash, protocol schemes.
 */
export function normalizeSafeGoModule(mod: string): string | null {
  if (!mod || hasUnsafeChars(mod) || hasProtocolScheme(mod)) return null;
  return GO_MODULE_PATTERN.test(mod) ? mod : null;
}

/**
 * Validate a uv/pip package spec. Blocks backslash, protocol schemes.
 */
export function normalizeSafeUvPackage(pkg: string): string | null {
  if (!pkg || hasUnsafeChars(pkg) || hasProtocolScheme(pkg)) return null;
  return UV_PACKAGE_PATTERN.test(pkg) ? pkg : null;
}

/**
 * Validate a download URL. Only allows http/https, no whitespace.
 */
export function normalizeSafeDownloadUrl(rawUrl: string): string | null {
  if (!rawUrl) return null;
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    if (/\s/.test(rawUrl)) return null;
    return rawUrl;
  } catch {
    return null;
  }
}

/**
 * Install a skill from a git repository.
 * Clones the repo into ~/.openfox/skills/<name>/
 * Uses execFileSync with argument arrays to prevent shell injection.
 */
export async function installSkillFromGit(
  repoUrl: string,
  name: string,
  skillsDir: string,
  db: OpenFoxDatabase,
  _runtime: RuntimeClient,
): Promise<Skill | null> {
  // Validate inputs to prevent injection
  if (!SKILL_NAME_RE.test(name)) {
    throw new Error(`Invalid skill name: "${name}". Must match ${SKILL_NAME_RE.source}`);
  }
  if (!SAFE_URL_RE.test(repoUrl)) {
    throw new Error(`Invalid repo URL: "${repoUrl}". Must be an http(s) URL with no shell metacharacters.`);
  }

  const resolvedDir = resolveHome(skillsDir);
  const targetDir = validateSkillPath(resolvedDir, name);

  // Clone using execFileSync with argument array (no shell interpolation)
  try {
    execFileSync("git", ["clone", "--depth", "1", repoUrl, targetDir], {
      encoding: "utf-8",
      timeout: 60_000,
    });
  } catch (err: any) {
    throw new Error(`Failed to clone skill repo: ${err.message}`);
  }

  // Read SKILL.md using fs (no shell needed)
  const skillMdPath = path.join(targetDir, "SKILL.md");
  if (!fs.existsSync(skillMdPath)) {
    throw new Error(`No SKILL.md found in cloned repo at ${skillMdPath}`);
  }

  const content = fs.readFileSync(skillMdPath, "utf-8");
  const skill = parseSkillMd(content, skillMdPath, "git");
  if (!skill) {
    throw new Error("Failed to parse SKILL.md from cloned repo");
  }

  db.upsertSkill(skill);
  return skill;
}

/**
 * Install a skill from a URL (fetches a single SKILL.md).
 * Uses execFileSync with argument arrays and fs.* for safe operations.
 */
export async function installSkillFromUrl(
  url: string,
  name: string,
  skillsDir: string,
  db: OpenFoxDatabase,
  _runtime: RuntimeClient,
): Promise<Skill | null> {
  // Validate inputs to prevent injection
  if (!SKILL_NAME_RE.test(name)) {
    throw new Error(`Invalid skill name: "${name}". Must match ${SKILL_NAME_RE.source}`);
  }
  if (!SAFE_URL_RE.test(url)) {
    throw new Error(`Invalid URL: "${url}". Must be an http(s) URL with no shell metacharacters.`);
  }

  const resolvedDir = resolveHome(skillsDir);
  const targetDir = validateSkillPath(resolvedDir, name);
  const skillMdPath = path.join(targetDir, "SKILL.md");

  // Create directory using fs (no shell needed)
  fs.mkdirSync(targetDir, { recursive: true });

  // Fetch SKILL.md using execFileSync with argument array (no shell interpolation)
  try {
    execFileSync("curl", ["-fsSL", "-o", skillMdPath, url], {
      encoding: "utf-8",
      timeout: 30_000,
    });
  } catch (err: any) {
    throw new Error(`Failed to fetch SKILL.md from URL: ${err.message}`);
  }

  // Read content using fs (no shell needed)
  const content = fs.readFileSync(skillMdPath, "utf-8");
  const skill = parseSkillMd(content, skillMdPath, "url");
  if (!skill) {
    throw new Error("Failed to parse fetched SKILL.md");
  }

  db.upsertSkill(skill);
  return skill;
}

/**
 * Create a new skill authored by the openfox itself.
 * Uses fs.* for directory creation and file writing (no shell needed).
 */
export async function createSkill(
  name: string,
  description: string,
  instructions: string,
  skillsDir: string,
  db: OpenFoxDatabase,
  runtime: RuntimeClient,
): Promise<Skill> {
  // Validate name to prevent path traversal/injection
  if (!SKILL_NAME_RE.test(name)) {
    throw new Error(`Invalid skill name: "${name}". Must match ${SKILL_NAME_RE.source}`);
  }

  // Enforce size limits
  const safeDescription = description.slice(0, MAX_DESCRIPTION_LENGTH);
  const safeInstructions = instructions.slice(0, MAX_INSTRUCTIONS_LENGTH);

  const resolvedDir = resolveHome(skillsDir);
  const targetDir = validateSkillPath(resolvedDir, name);

  // Create directory using fs (no shell needed)
  fs.mkdirSync(targetDir, { recursive: true });

  // Generate YAML frontmatter safely using yaml.stringify (prevents YAML injection)
  const frontmatter = yaml.stringify({
    name,
    description: safeDescription,
    "auto-activate": true,
  });
  const content = `---\n${frontmatter}---\n\n${safeInstructions}`;

  const skillMdPath = path.join(targetDir, "SKILL.md");
  await runtime.writeFile(skillMdPath, content);

  const skill: Skill = {
    name,
    description: safeDescription,
    autoActivate: true,
    instructions: safeInstructions,
    source: "self",
    path: skillMdPath,
    baseDir: targetDir,
    enabled: true,
    installedAt: new Date().toISOString(),
  };

  db.upsertSkill(skill);
  return skill;
}

/**
 * Remove a skill (disable in DB and optionally delete from disk).
 * Uses fs.rmSync for safe file deletion (no shell needed).
 */
export async function removeSkill(
  name: string,
  db: OpenFoxDatabase,
  _runtime: RuntimeClient,
  skillsDir: string,
  deleteFiles: boolean = false,
): Promise<void> {
  // Validate name to prevent path traversal/injection
  if (!SKILL_NAME_RE.test(name)) {
    throw new Error(`Invalid skill name: "${name}". Must match ${SKILL_NAME_RE.source}`);
  }

  db.removeSkill(name);

  if (deleteFiles) {
    const resolvedDir = resolveHome(skillsDir);
    const targetDir = validateSkillPath(resolvedDir, name);
    fs.rmSync(targetDir, { recursive: true, force: true });
  }
}

/**
 * List all installed skills.
 */
export function listSkills(db: OpenFoxDatabase): Skill[] {
  return db.getSkills();
}

function resolveHome(p: string): string {
  if (p.startsWith("~")) {
    return path.join(process.env.HOME || "/root", p.slice(1));
  }
  return p;
}
