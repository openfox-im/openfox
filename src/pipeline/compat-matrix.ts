/**
 * Compatibility Matrix
 *
 * GTOS 2046: Mirrors the TOL metadata/compatibility.go compatibility matrix
 * so OpenFox can check cross-repository compatibility at startup without
 * needing a live connection to TOL.
 *
 * In production this would be fetched from a shared package or registry;
 * for now it is a hardcoded constant that must be kept in sync with TOL.
 */

import { parseSemver } from "./schema-check.js";

export interface RepoCompat {
  name: string;
  minBoundary: string;
  maxBoundary: string;
  features: string[];
}

export interface CompatMatrix {
  schemaVersion: string;
  repositories: Record<string, RepoCompat>;
}

/**
 * The compatibility matrix -- must match TOL metadata/compatibility.go.
 */
export const COMPAT_MATRIX: CompatMatrix = {
  schemaVersion: "0.1.0",
  repositories: {
    openfox: {
      name: "OpenFox Runtime",
      minBoundary: "0.1.0",
      maxBoundary: "0.1.x",
      features: ["intent_routing", "approval_ux", "discovery_client", "policy_enforcement"],
    },
    gtos: {
      name: "GTOS Boundary",
      minBoundary: "0.1.0",
      maxBoundary: "0.1.x",
      features: ["artifact_storage", "cross_repo_ref", "schema_validation"],
    },
    tolang: {
      name: "TOL Compiler",
      minBoundary: "0.1.0",
      maxBoundary: "0.1.x",
      features: ["abi_json", "metadata_extract", "human_readable", "discovery_manifest", "artifact_ref"],
    },
  },
};

export interface MatrixCheckResult {
  compatible: boolean;
  reason: string;
}

/**
 * Check whether a local repository is compatible with a remote repository
 * at a given remote boundary version, according to the compatibility matrix.
 *
 * @param localRepo - The local repository key (e.g. "openfox").
 * @param remoteRepo - The remote repository key (e.g. "gtos").
 * @param remoteVersion - The remote boundary schema version string.
 */
export function checkMatrixCompatibility(
  localRepo: string,
  remoteRepo: string,
  remoteVersion: string,
): MatrixCheckResult {
  const localEntry = COMPAT_MATRIX.repositories[localRepo];
  if (!localEntry) {
    return { compatible: false, reason: `Unknown local repository: ${localRepo}` };
  }

  const remoteEntry = COMPAT_MATRIX.repositories[remoteRepo];
  if (!remoteEntry) {
    return { compatible: false, reason: `Unknown remote repository: ${remoteRepo}` };
  }

  // Check that remoteVersion falls within the local repo's accepted boundary range.
  if (!versionInRange(remoteVersion, localEntry.minBoundary, localEntry.maxBoundary)) {
    return {
      compatible: false,
      reason: `Remote version ${remoteVersion} outside ${localRepo} accepted range [${localEntry.minBoundary}, ${localEntry.maxBoundary}]`,
    };
  }

  // Check that remoteVersion falls within the remote repo's own boundary range.
  if (!versionInRange(remoteVersion, remoteEntry.minBoundary, remoteEntry.maxBoundary)) {
    return {
      compatible: false,
      reason: `Remote version ${remoteVersion} outside ${remoteRepo} declared range [${remoteEntry.minBoundary}, ${remoteEntry.maxBoundary}]`,
    };
  }

  return {
    compatible: true,
    reason: `${localRepo} and ${remoteRepo} are compatible at boundary version ${remoteVersion}`,
  };
}

/**
 * Check if a version falls within a min..max range.
 * Supports "x" as a wildcard for patch (e.g. "0.1.x" matches any 0.1.N).
 */
function versionInRange(version: string, min: string, max: string): boolean {
  const v = parseSemver(version);
  const minV = parseSemver(min);
  if (!v || !minV) return false;

  // Check >= min
  if (v.major < minV.major) return false;
  if (v.major === minV.major && v.minor < minV.minor) return false;
  if (v.major === minV.major && v.minor === minV.minor && v.patch < minV.patch) return false;

  // Parse max, handling "x" wildcard in patch
  const maxParts = max.split(".");
  if (maxParts.length !== 3) return false;

  const maxMajor = Number(maxParts[0]);
  const maxMinor = Number(maxParts[1]);

  if (!Number.isInteger(maxMajor) || !Number.isInteger(maxMinor)) return false;

  // Check major.minor <= max major.minor
  if (v.major > maxMajor) return false;
  if (v.major === maxMajor && v.minor > maxMinor) return false;

  // If patch is "x", any patch is fine as long as major.minor matches
  // If patch is a number, check it
  if (maxParts[2] !== "x") {
    const maxPatch = Number(maxParts[2]);
    if (Number.isInteger(maxPatch) && v.major === maxMajor && v.minor === maxMinor && v.patch > maxPatch) {
      return false;
    }
  }

  return true;
}
