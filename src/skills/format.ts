/**
 * SKILL.md Parser
 *
 * Parses SKILL.md files with YAML frontmatter + Markdown body into structured
 * skill definitions. Follows the agentskills.io standard: platform-specific
 * fields live at the top level of frontmatter; metadata is a generic key-value
 * map for author/version/custom data.
 */

import path from "path";
import { parse as parseYaml } from "yaml";
import type { SkillFrontmatter, Skill, SkillSource, SkillInvocationPolicy } from "../types.js";
import { createLogger } from "../observability/logger.js";

const logger = createLogger("skills.format");

/**
 * Validate and normalize skill name per agentskills.io spec:
 * - Auto-lowercase
 * - 1-64 chars (reject if exceeded)
 * - No leading/trailing hyphens
 * - No consecutive hyphens
 * - Warn on name/directory mismatch
 */
function validateSkillName(name: string, filePath: string): string | null {
  const lowered = name.toLowerCase();
  if (lowered !== name) {
    logger.warn(`Skill name "${name}" auto-lowercased to "${lowered}" in ${filePath}`);
  }
  if (lowered.length === 0 || lowered.length > 64) {
    logger.warn(`Skill name "${lowered}" rejected: must be 1-64 chars in ${filePath}`);
    return null;
  }
  if (/^-|-$/.test(lowered)) {
    logger.warn(`Skill name "${lowered}" rejected: leading/trailing hyphens in ${filePath}`);
    return null;
  }
  if (/--/.test(lowered)) {
    logger.warn(`Skill name "${lowered}" rejected: consecutive hyphens in ${filePath}`);
    return null;
  }
  const dirName = extractNameFromPath(filePath);
  if (dirName && lowered !== dirName.toLowerCase() && dirName !== filePath) {
    logger.warn(`Skill name "${lowered}" does not match directory name "${dirName}" in ${filePath}`);
  }
  return lowered;
}

/**
 * Parse invocation policy from frontmatter.
 */
function resolveInvocationPolicy(fm: SkillFrontmatter): SkillInvocationPolicy {
  return {
    userInvocable: fm["user-invocable"] !== false,
    disableModelInvocation: fm["disable-model-invocation"] === true,
  };
}

/**
 * Parse a SKILL.md file content into frontmatter + body.
 * Handles YAML frontmatter delimited by --- markers.
 */
export function parseSkillMd(
  content: string,
  filePath: string,
  source: SkillSource = "bundled",
): Skill | null {
  const trimmed = content.trim();
  if (!trimmed.startsWith("---")) {
    const name = extractNameFromPath(filePath);
    return {
      name,
      description: "",
      autoActivate: true,
      instructions: trimmed,
      source,
      path: filePath,
      baseDir: path.dirname(filePath),
      enabled: true,
      installedAt: new Date().toISOString(),
    };
  }

  const endIndex = trimmed.indexOf("---", 3);
  if (endIndex === -1) {
    return null;
  }

  const frontmatterRaw = trimmed.slice(3, endIndex).trim();
  const body = trimmed.slice(endIndex + 3).trim();

  const frontmatter = parseYamlFrontmatter(frontmatterRaw);
  if (!frontmatter) {
    return null;
  }

  const rawName = frontmatter.name || extractNameFromPath(filePath);
  const name = validateSkillName(rawName, filePath);
  if (!name) {
    return null;
  }

  // Parse allowed-tools: space/comma-delimited string → array
  let allowedTools: string[] | undefined;
  if (typeof frontmatter["allowed-tools"] === "string" && frontmatter["allowed-tools"].trim()) {
    allowedTools = frontmatter["allowed-tools"]
      .split(/[\s,]+/)
      .map((t) => t.trim())
      .filter(Boolean);
  }

  // Parse os: normalize to lowercase string array
  let os: string[] | undefined;
  if (Array.isArray(frontmatter.os)) {
    os = frontmatter.os
      .filter((v): v is string => typeof v === "string")
      .map((v) => v.toLowerCase().trim())
      .filter(Boolean);
    if (os.length === 0) os = undefined;
  }

  return {
    name,
    skillKey: frontmatter["skill-key"] || undefined,
    description: frontmatter.description || "",
    autoActivate: frontmatter["auto-activate"] !== false,
    always: frontmatter.always === true,
    homepage: frontmatter.homepage,
    primaryEnv: frontmatter["primary-env"],
    os,
    requires: frontmatter.requires,
    install: frontmatter.install,
    providerBackends: normalizeProviderBackends(frontmatter["provider-backends"]),
    instructions: body,
    source,
    path: filePath,
    baseDir: path.dirname(filePath),
    enabled: true,
    installedAt: new Date().toISOString(),
    license: frontmatter.license,
    compatibility: frontmatter.compatibility,
    allowedTools,
    invocation: resolveInvocationPolicy(frontmatter),
  };
}

function parseYamlFrontmatter(raw: string): SkillFrontmatter | null {
  try {
    const parsed = parseYaml(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    return parsed as SkillFrontmatter;
  } catch {
    return null;
  }
}

function normalizeProviderBackends(
  raw: SkillFrontmatter["provider-backends"],
) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return undefined;
  }

  const normalized = Object.entries(raw).reduce<Record<string, { entry: string; description?: string }>>(
    (acc, [name, value]) => {
      if (typeof value === "string" && value.trim()) {
        acc[name] = { entry: value.trim() };
        return acc;
      }
      if (
        value &&
        typeof value === "object" &&
        !Array.isArray(value) &&
        typeof value.entry === "string" &&
        value.entry.trim()
      ) {
        acc[name] = {
          entry: value.entry.trim(),
          ...(typeof value.description === "string" && value.description.trim()
            ? { description: value.description.trim() }
            : {}),
        };
      }
      return acc;
    },
    {},
  );

  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

export function extractNameFromPath(filePath: string): string {
  const parts = filePath.split("/");
  const skillMdIndex = parts.findIndex(
    (p) => p.toLowerCase() === "skill.md",
  );
  if (skillMdIndex > 0) {
    return parts[skillMdIndex - 1];
  }
  return parts[parts.length - 1].replace(/\.md$/i, "");
}
