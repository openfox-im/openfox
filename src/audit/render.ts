import type { AuditEntry } from "./types.js";

export function formatAuditDetails(
  details: AuditEntry["details"],
  indent = "  ",
): string[] {
  if (!details || Object.keys(details).length === 0) {
    return [];
  }

  const lines = [`${indent}Details:`];
  for (const [key, value] of Object.entries(details)) {
    const label = toLabel(key);
    if (typeof value === "string" && value.includes("\n")) {
      lines.push(`${indent}  ${label}:`);
      for (const line of value.split("\n")) {
        lines.push(`${indent}    ${line}`);
      }
      continue;
    }
    lines.push(`${indent}  ${label}: ${formatValue(value)}`);
  }
  return lines;
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "null";
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => formatValue(item)).join(", ");
  }
  return JSON.stringify(value);
}

function toLabel(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\w/, (char) => char.toUpperCase());
}
