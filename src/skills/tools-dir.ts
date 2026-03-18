/**
 * Skill Tools Directory Resolution
 *
 * Provides a safe, hashed storage path for skill-specific tool artifacts.
 * Inspired by OpenClaw's tools-dir.ts.
 */

import crypto from "crypto";
import os from "os";
import path from "path";

/**
 * Hash a skill key into a safe directory segment.
 * Prevents directory traversal via crafted skill names.
 */
function safePathSegmentHashed(key: string): string {
  const hash = crypto.createHash("sha256").update(key).digest("hex").slice(0, 16);
  // Keep a sanitized prefix for readability
  const safe = key.replace(/[^a-z0-9-]/gi, "_").slice(0, 32);
  return `${safe}-${hash}`;
}

/**
 * Returns a safe path for storing skill-specific tool artifacts.
 * Path: ~/.openfox/config/tools/<hashed-key>/
 */
export function resolveSkillToolsRootDir(skillKey: string): string {
  return path.join(os.homedir(), ".openfox", "config", "tools", safePathSegmentHashed(skillKey));
}
