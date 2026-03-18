/**
 * Schema Version Check
 *
 * GTOS 2046: Checks boundary schema compatibility between the local OpenFox
 * runtime and a remote GTOS node at pipeline startup and during cross-system
 * calls. Prefers `policyWallet_getBoundaryVersion`, with a fallback to the
 * legacy `policyWallet_getSchemaVersion` response shape for older nodes.
 */

import { BOUNDARY_SCHEMA_VERSION } from "../intent/types.js";

const PRIMARY_SCHEMA_METHOD = "policyWallet_getBoundaryVersion";
const LEGACY_SCHEMA_METHOD = "policyWallet_getSchemaVersion";

export interface SchemaCheckResult {
  compatible: boolean;
  localVersion: string;
  remoteVersion: string;
  message?: string;
}

interface SchemaRpcBody {
  result?: string | { schema_version?: string; boundary_version?: string };
  error?: { code: number; message: string };
}

interface SchemaRpcResult {
  remoteVersion: string;
  method: string;
  errorCode?: number;
  errorMessage?: string;
  transportError?: string;
}

/**
 * Check compatibility with a GTOS node by calling its boundary version RPC.
 *
 * Invokes `policyWallet_getBoundaryVersion` first and falls back to the legacy
 * `policyWallet_getSchemaVersion` response shape when the newer RPC is not
 * available on the remote node.
 *
 * @param rpcUrl - The JSON-RPC endpoint of the GTOS node.
 * @param fetchImpl - Optional fetch implementation (for testing).
 */
export async function checkSchemaCompatibility(
  rpcUrl: string,
  fetchImpl: typeof globalThis.fetch = globalThis.fetch,
): Promise<SchemaCheckResult> {
  const local = BOUNDARY_SCHEMA_VERSION;

  const primary = await requestSchemaVersion(rpcUrl, PRIMARY_SCHEMA_METHOD, fetchImpl);
  let resolved = primary;

  if (shouldFallbackToLegacy(primary)) {
    const legacy = await requestSchemaVersion(rpcUrl, LEGACY_SCHEMA_METHOD, fetchImpl);
    if (legacy.remoteVersion !== "unknown") {
      resolved = legacy;
    } else if (primary.remoteVersion === "unknown" && !primary.transportError && primary.errorCode === undefined) {
      resolved = legacy;
    }
  }

  if (resolved.transportError) {
    return {
      compatible: false,
      localVersion: local,
      remoteVersion: "unknown",
      message: `Failed to reach GTOS node for schema check: ${resolved.transportError}`,
    };
  }

  if (resolved.errorCode !== undefined) {
    return {
      compatible: false,
      localVersion: local,
      remoteVersion: "unknown",
      message: `Schema version RPC error ${resolved.errorCode}: ${resolved.errorMessage ?? "unknown error"}`,
    };
  }

  if (resolved.remoteVersion === "unknown") {
    return {
      compatible: false,
      localVersion: local,
      remoteVersion: "unknown",
      message: `Remote node did not return a boundary version from ${resolved.method}`,
    };
  }

  const compatible = isVersionCompatible(local, resolved.remoteVersion);
  return {
    compatible,
    localVersion: local,
    remoteVersion: resolved.remoteVersion,
    message: compatible
      ? `Schema versions compatible via ${resolved.method}: local=${local} remote=${resolved.remoteVersion}`
      : `Schema version mismatch via ${resolved.method}: local=${local} remote=${resolved.remoteVersion} (major.minor must match)`,
  };
}

async function requestSchemaVersion(
  rpcUrl: string,
  method: string,
  fetchImpl: typeof globalThis.fetch,
): Promise<SchemaRpcResult> {
  try {
    const response = await fetchImpl(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method,
        params: [],
      }),
    });

    if (!response.ok) {
      return {
        remoteVersion: "unknown",
        method,
        transportError: `HTTP ${response.status} ${response.statusText}`,
      };
    }

    const body = (await response.json()) as SchemaRpcBody;
    if (body.error) {
      return {
        remoteVersion: "unknown",
        method,
        errorCode: body.error.code,
        errorMessage: body.error.message,
      };
    }

    return {
      remoteVersion: parseRemoteVersion(body.result),
      method,
    };
  } catch (err) {
    return {
      remoteVersion: "unknown",
      method,
      transportError: err instanceof Error ? err.message : String(err),
    };
  }
}

function parseRemoteVersion(result: SchemaRpcBody["result"]): string {
  if (typeof result === "string" && result.trim().length > 0) {
    return result.trim();
  }
  if (result && typeof result === "object") {
    if (typeof result.boundary_version === "string" && result.boundary_version.trim().length > 0) {
      return result.boundary_version.trim();
    }
    if (typeof result.schema_version === "string" && result.schema_version.trim().length > 0) {
      return result.schema_version.trim();
    }
  }
  return "unknown";
}

function shouldFallbackToLegacy(result: SchemaRpcResult): boolean {
  if (result.transportError) {
    return false;
  }
  if (result.errorCode === -32601) {
    return true;
  }
  return result.method === PRIMARY_SCHEMA_METHOD && result.remoteVersion === "unknown";
}

/**
 * Parse a semver string into { major, minor, patch }.
 * Returns null if the string is not valid semver.
 */
export function parseSemver(
  v: string,
): { major: number; minor: number; patch: number } | null {
  const trimmed = v.trim();
  const parts = trimmed.split(".");
  if (parts.length !== 3) return null;

  const major = Number(parts[0]);
  const minor = Number(parts[1]);
  const patch = Number(parts[2]);

  if (!Number.isInteger(major) || !Number.isInteger(minor) || !Number.isInteger(patch)) {
    return null;
  }
  if (major < 0 || minor < 0 || patch < 0) return null;

  return { major, minor, patch };
}

/**
 * Check whether two semver strings are compatible.
 * Compatibility requires the same major and minor numbers;
 * patch differences are acceptable.
 */
export function isVersionCompatible(local: string, remote: string): boolean {
  const l = parseSemver(local);
  const r = parseSemver(remote);
  if (!l || !r) return false;
  return l.major === r.major && l.minor === r.minor;
}
