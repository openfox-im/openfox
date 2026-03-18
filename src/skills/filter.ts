/**
 * Skill Filter Utilities
 *
 * Normalizes and compares agent-level skill filters, inspired by
 * OpenClaw's filter.ts. Allows restricting which skills are visible
 * to specific agents.
 */

/**
 * Validate and normalize a skill filter array.
 * Returns undefined if input is empty/invalid (meaning unrestricted).
 */
export function normalizeSkillFilter(
  raw: string[] | undefined | null,
): string[] | undefined {
  if (!raw || !Array.isArray(raw)) return undefined;
  const filtered = raw
    .filter((s): s is string => typeof s === "string" && s.trim().length > 0)
    .map((s) => s.trim().toLowerCase());
  return filtered.length > 0 ? filtered : undefined;
}

/**
 * Deduplicate and sort for equality comparison.
 */
export function normalizeSkillFilterForComparison(
  filter: string[] | undefined,
): string[] | undefined {
  if (!filter) return undefined;
  return [...new Set(filter)].sort();
}

/**
 * Compare two skill filters for equality (order-insensitive).
 */
export function matchesSkillFilter(
  a: string[] | undefined,
  b: string[] | undefined,
): boolean {
  const na = normalizeSkillFilterForComparison(a);
  const nb = normalizeSkillFilterForComparison(b);
  if (na === undefined && nb === undefined) return true;
  if (na === undefined || nb === undefined) return false;
  if (na.length !== nb.length) return false;
  return na.every((v, i) => v === nb[i]);
}
