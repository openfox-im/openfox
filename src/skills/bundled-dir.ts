/**
 * Bundled Skills Directory Resolution
 *
 * Resolves the location of bundled skills with a multi-level fallback
 * chain, inspired by OpenClaw's bundled-dir.ts.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

/**
 * Heuristic: does this directory look like a skills root?
 * True if it contains .md files or subdirectories with SKILL.md.
 */
function looksLikeSkillsDir(dir: string): boolean {
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) return true;
      if (entry.isDirectory()) {
        const skillMd = path.join(dir, entry.name, "SKILL.md");
        if (fs.existsSync(skillMd)) return true;
      }
    }
  } catch {
    // not readable
  }
  return false;
}

/**
 * Resolve the bundled skills directory.
 *
 * Resolution order:
 * 1. OPENFOX_BUNDLED_SKILLS_DIR env var
 * 2. Sibling `skills/` next to executable (bundled binary case)
 * 3. `<packageRoot>/skills` (npm install case)
 * 4. Walk up 6 levels from module dir looking for `skills/`
 * 5. Return undefined if not found
 */
export function resolveBundledSkillsDir(): string | undefined {
  // 1. Env var override
  const envDir = process.env.OPENFOX_BUNDLED_SKILLS_DIR;
  if (envDir && fs.existsSync(envDir) && looksLikeSkillsDir(envDir)) {
    return envDir;
  }

  // 2. Sibling skills/ next to executable (bun --compile, pkg, etc.)
  if (process.execPath) {
    const execSibling = path.join(path.dirname(process.execPath), "skills");
    if (fs.existsSync(execSibling) && looksLikeSkillsDir(execSibling)) {
      return execSibling;
    }
  }

  // 3-4. Walk up from this module's directory
  const thisDir = path.dirname(fileURLToPath(import.meta.url));
  let current = thisDir;
  for (let i = 0; i < 6; i++) {
    const candidate = path.join(current, "skills");
    if (fs.existsSync(candidate) && looksLikeSkillsDir(candidate)) {
      return candidate;
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }

  return undefined;
}
