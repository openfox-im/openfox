/**
 * Pipeline Input Validation
 *
 * GTOS 2046: Security validation module for pipeline inputs.
 * Validates addresses, values, terminal classes, trust tiers,
 * RPC URLs, and intent parameters to prevent injection, SSRF,
 * overflow, and resource exhaustion attacks.
 */

import type { TerminalClass, TrustTier } from "../intent/types.js";

/** Maximum allowed size for intent params object (total serialized bytes). */
export const MAX_PARAMS_SIZE = 64 * 1024; // 64 KB

/** Maximum number of keys in intent params. */
export const MAX_PARAMS_KEYS = 64;

/** Maximum string length for any single param value. */
export const MAX_PARAM_STRING_LENGTH = 4096;

/** Maximum nesting depth for intent params. */
export const MAX_PARAMS_DEPTH = 4;

/** Maximum value in tomi (2^256 - 1, the EVM max uint256). */
const MAX_UINT256 = (2n ** 256n) - 1n;

/** Valid terminal class values. */
const VALID_TERMINAL_CLASSES: ReadonlySet<string> = new Set<string>([
  "app", "card", "pos", "voice", "kiosk", "robot", "api",
]);

/** Valid trust tier values. */
const VALID_TRUST_TIERS: ReadonlySet<number> = new Set([0, 1, 2, 3, 4]);

/** Allowed RPC URL schemes. */
const ALLOWED_RPC_SCHEMES: ReadonlySet<string> = new Set(["http:", "https:"]);

/**
 * Validate a hex address string.
 * Must be "0x" followed by exactly 40 or 64 hex characters (20 or 32 bytes).
 */
export function validateAddress(addr: string): boolean {
  if (typeof addr !== "string") return false;
  // Accept both 20-byte (Ethereum-style) and 32-byte addresses
  return /^0x[0-9a-fA-F]{40}$/.test(addr) || /^0x[0-9a-fA-F]{64}$/.test(addr);
}

/**
 * Validate a tomi value string.
 * Must be a non-negative integer string that does not exceed uint256 max.
 */
export function validateValue(value: string): boolean {
  if (typeof value !== "string") return false;
  // Must be a decimal integer (no leading zeros except "0" itself)
  if (!/^(0|[1-9]\d*)$/.test(value)) return false;
  try {
    const bi = BigInt(value);
    return bi >= 0n && bi <= MAX_UINT256;
  } catch {
    return false;
  }
}

/**
 * Validate intent params for safety.
 * Checks size limits, key count, nesting depth, and value types.
 */
export function validateIntentParams(
  params: Record<string, unknown>,
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (params === null || typeof params !== "object" || Array.isArray(params)) {
    return { valid: false, errors: ["params must be a plain object"] };
  }

  // Check key count
  const keys = Object.keys(params);
  if (keys.length > MAX_PARAMS_KEYS) {
    errors.push(`params has ${keys.length} keys, maximum is ${MAX_PARAMS_KEYS}`);
  }

  // Check serialized size
  let serialized: string;
  try {
    serialized = JSON.stringify(params);
  } catch {
    return { valid: false, errors: ["params cannot be serialized to JSON"] };
  }

  if (serialized.length > MAX_PARAMS_SIZE) {
    errors.push(`params serialized size (${serialized.length}) exceeds maximum (${MAX_PARAMS_SIZE})`);
  }

  // Check nesting depth and string lengths
  const depthErrors = checkDepthAndValues(params, 0, "params");
  errors.push(...depthErrors);

  // Validate specific well-known fields
  if ("value" in params) {
    const v = params["value"];
    if (typeof v === "string" && !validateValue(v)) {
      errors.push(`params.value "${v}" is not a valid tomi value`);
    }
  }

  if ("to" in params) {
    const to = params["to"];
    if (typeof to === "string" && !validateAddress(to)) {
      errors.push(`params.to "${to}" is not a valid address`);
    }
  }

  if ("from" in params) {
    const from = params["from"];
    if (typeof from === "string" && !validateAddress(from)) {
      errors.push(`params.from "${from}" is not a valid address`);
    }
  }

  return { valid: errors.length === 0, errors };
}

function checkDepthAndValues(
  obj: unknown,
  depth: number,
  path: string,
): string[] {
  const errors: string[] = [];

  if (depth > MAX_PARAMS_DEPTH) {
    errors.push(`${path}: nesting depth exceeds maximum (${MAX_PARAMS_DEPTH})`);
    return errors;
  }

  if (typeof obj === "string" && obj.length > MAX_PARAM_STRING_LENGTH) {
    errors.push(`${path}: string length (${obj.length}) exceeds maximum (${MAX_PARAM_STRING_LENGTH})`);
  }

  if (obj !== null && typeof obj === "object") {
    if (Array.isArray(obj)) {
      if (obj.length > MAX_PARAMS_KEYS) {
        errors.push(`${path}: array length (${obj.length}) exceeds maximum (${MAX_PARAMS_KEYS})`);
      }
      for (let i = 0; i < Math.min(obj.length, MAX_PARAMS_KEYS); i++) {
        errors.push(...checkDepthAndValues(obj[i], depth + 1, `${path}[${i}]`));
      }
    } else {
      const entries = Object.entries(obj as Record<string, unknown>);
      for (const [key, value] of entries) {
        errors.push(...checkDepthAndValues(value, depth + 1, `${path}.${key}`));
      }
    }
  }

  return errors;
}

/**
 * Sanitize and validate an RPC URL.
 * Only allows http: and https: schemes to prevent SSRF via file://, data://, etc.
 * Returns the sanitized URL string.
 * Throws if the URL is invalid or uses a disallowed scheme.
 */
export function sanitizeRPCUrl(url: string): string {
  if (typeof url !== "string" || url.trim().length === 0) {
    throw new Error("RPC URL must be a non-empty string");
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid RPC URL: ${url}`);
  }

  if (!ALLOWED_RPC_SCHEMES.has(parsed.protocol)) {
    throw new Error(
      `RPC URL scheme "${parsed.protocol}" is not allowed. Only http: and https: are permitted.`,
    );
  }

  // Block localhost/private IPs in production could be added here as a policy layer
  // For now, return the canonical URL form
  return parsed.toString();
}

/**
 * Validate a terminal class string.
 */
export function validateTerminalClass(tc: string): boolean {
  return typeof tc === "string" && VALID_TERMINAL_CLASSES.has(tc);
}

/**
 * Validate a trust tier number.
 */
export function validateTrustTier(tier: number): boolean {
  return typeof tier === "number" && Number.isInteger(tier) && VALID_TRUST_TIERS.has(tier);
}

/**
 * Validate an action string.
 * Must be non-empty alphanumeric with underscores/hyphens, max 64 chars.
 */
export function validateAction(action: string): boolean {
  if (typeof action !== "string") return false;
  return /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(action);
}

/**
 * Validate all pipeline execute params. Returns a list of errors (empty if valid).
 */
export function validateExecuteParams(params: {
  action: string;
  requester: string;
  actorAgentId: string;
  terminalClass: string;
  trustTier: number;
  params: Record<string, unknown>;
}): string[] {
  const errors: string[] = [];

  if (!validateAction(params.action)) {
    errors.push(`Invalid action: "${params.action}". Must be alphanumeric with hyphens/underscores, 1-64 chars.`);
  }

  if (!validateAddress(params.requester)) {
    errors.push(`Invalid requester address: "${params.requester}"`);
  }

  if (!validateAddress(params.actorAgentId)) {
    errors.push(`Invalid actorAgentId address: "${params.actorAgentId}"`);
  }

  if (!validateTerminalClass(params.terminalClass)) {
    errors.push(`Invalid terminal class: "${params.terminalClass}". Must be one of: ${[...VALID_TERMINAL_CLASSES].join(", ")}`);
  }

  if (!validateTrustTier(params.trustTier)) {
    errors.push(`Invalid trust tier: ${params.trustTier}. Must be 0, 1, 2, 3, or 4.`);
  }

  const paramValidation = validateIntentParams(params.params);
  if (!paramValidation.valid) {
    errors.push(...paramValidation.errors);
  }

  return errors;
}

/** Maximum number of sponsor quotes to process. */
export const MAX_SPONSOR_QUOTES = 100;

/**
 * Enforce a size limit on an array, returning the truncated array.
 */
export function enforceArrayLimit<T>(arr: T[], limit: number): T[] {
  if (arr.length <= limit) return arr;
  return arr.slice(0, limit);
}
