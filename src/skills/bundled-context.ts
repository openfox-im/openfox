/**
 * Bundled Skills Context Cache
 *
 * Lazily loads and caches the set of bundled skill names to avoid
 * re-scanning on every load cycle. Inspired by OpenClaw's bundled-context.ts.
 */

import fs from "fs";
import path from "path";
import { resolveBundledSkillsDir } from "./bundled-dir.js";
import { createLogger } from "../observability/logger.js";

const logger = createLogger("skills.bundled-context");

type BundledContext = {
  dir: string | undefined;
  names: Set<string>;
};

let cached: BundledContext | undefined;
let warnedMissing = false;

/**
 * Returns the bundled skills directory and a Set of bundled skill names.
 * Caches the result after the first call.
 */
export function resolveBundledSkillsContext(): BundledContext {
  if (cached) {
    return { dir: cached.dir, names: new Set(cached.names) };
  }

  const dir = resolveBundledSkillsDir();
  const names = new Set<string>();

  if (!dir) {
    if (!warnedMissing) {
      logger.warn("Bundled skills directory not found.");
      warnedMissing = true;
    }
    cached = { dir: undefined, names };
    return { dir: undefined, names };
  }

  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const skillMd = path.join(dir, entry.name, "SKILL.md");
      if (fs.existsSync(skillMd)) {
        names.add(entry.name.toLowerCase());
      }
    }
  } catch {
    // not readable
  }

  cached = { dir, names: new Set(names) };
  return { dir, names };
}

/**
 * Clear the cache (for testing or when bundled dir changes).
 */
export function clearBundledSkillsCache(): void {
  cached = undefined;
  warnedMissing = false;
}
