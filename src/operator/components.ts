import { buildHealthSnapshot } from "../doctor/report.js";
import { buildServiceStatusSnapshot } from "../service/operator.js";
import type { OpenFoxConfig, OpenFoxDatabase } from "../types.js";
import { buildRuntimeStatusSnapshot } from "./status.js";

function yesNo(value: boolean): string {
  return value ? "yes" : "no";
}

export async function buildStorageOperatorStatusSnapshot(
  config: OpenFoxConfig,
  db: OpenFoxDatabase,
): Promise<Record<string, unknown>> {
  const runtime = buildRuntimeStatusSnapshot(config, db);
  const health = await buildHealthSnapshot(config, db);
  const service = buildServiceStatusSnapshot(config, db.raw);
  const status = runtime.storage as Record<string, unknown> | null;
  const surface = service.providerSurfaces.storage;
  const enabled = Boolean(status?.enabled);
  const summary = enabled
    ? [
        `${health.storageActiveLeases} active lease${health.storageActiveLeases === 1 ? "" : "s"}`,
        `${health.storageDueRenewals} due renewal${health.storageDueRenewals === 1 ? "" : "s"}`,
        `${health.storageUnderReplicatedBundles} under-replicated bundle${health.storageUnderReplicatedBundles === 1 ? "" : "s"}`,
        `ready=${yesNo(health.storageReady)}`,
      ].join(", ")
    : "storage provider disabled";
  return {
    kind: "storage",
    enabled,
    summary,
    status,
    health: {
      ready: health.storageReady,
      anonymousGet: health.storageAnonymousGet,
      anchorEnabled: health.storageAnchorEnabled,
      activeLeases: health.storageActiveLeases,
      recentLeases: health.storageRecentLeases,
      recentRenewals: health.storageRecentRenewals,
      recentAudits: health.storageRecentAudits,
      recentAnchors: health.storageRecentAnchors,
      dueRenewals: health.storageDueRenewals,
      underReplicatedBundles: health.storageUnderReplicatedBundles,
      replicationReady: health.storageReplicationReady,
    },
    serviceSurface: surface,
  };
}

export async function buildArtifactsOperatorStatusSnapshot(
  config: OpenFoxConfig,
  db: OpenFoxDatabase,
): Promise<Record<string, unknown>> {
  const runtime = buildRuntimeStatusSnapshot(config, db);
  const health = await buildHealthSnapshot(config, db);
  const service = buildServiceStatusSnapshot(config, db.raw);
  const status = runtime.artifacts as Record<string, unknown> | null;
  const surface = service.providerSurfaces.artifacts;
  const enabled = Boolean(status?.enabled);
  const summary = enabled
    ? [
        `${health.artifactsRecentCount} recent artifact${health.artifactsRecentCount === 1 ? "" : "s"}`,
        `${health.artifactsVerifiedCount} verified`,
        `${health.artifactsAnchoredCount} anchored`,
        `ready=${yesNo(health.artifactsReady)}`,
      ].join(", ")
    : "artifact pipeline disabled";
  return {
    kind: "artifacts",
    enabled,
    summary,
    status,
    health: {
      ready: health.artifactsReady,
      recentCount: health.artifactsRecentCount,
      verifiedCount: health.artifactsVerifiedCount,
      anchoredCount: health.artifactsAnchoredCount,
    },
    serviceSurface: surface,
  };
}

export async function buildSignerOperatorStatusSnapshot(
  config: OpenFoxConfig,
  db: OpenFoxDatabase,
): Promise<Record<string, unknown>> {
  const runtime = buildRuntimeStatusSnapshot(config, db);
  const health = await buildHealthSnapshot(config, db);
  const service = buildServiceStatusSnapshot(config, db.raw);
  const status = runtime.signerProvider as Record<string, unknown> | null;
  const surface = service.providerSurfaces.signer;
  const enabled = Boolean(status?.enabled);
  const summary = enabled
    ? [
        `${health.signerRecentQuotes} recent quote${health.signerRecentQuotes === 1 ? "" : "s"}`,
        `${health.signerRecentExecutions} recent execution${health.signerRecentExecutions === 1 ? "" : "s"}`,
        `${health.signerPendingExecutions} pending`,
        `ready=${yesNo(health.signerProviderReady)}`,
      ].join(", ")
    : "signer provider disabled";
  return {
    kind: "signer",
    enabled,
    summary,
    status,
    health: {
      ready: health.signerProviderReady,
      policyConfigured: health.signerPolicyConfigured,
      policyExpired: health.signerPolicyExpired,
      recentQuotes: health.signerRecentQuotes,
      recentExecutions: health.signerRecentExecutions,
      pendingExecutions: health.signerPendingExecutions,
    },
    serviceSurface: surface,
  };
}

export async function buildPaymasterOperatorStatusSnapshot(
  config: OpenFoxConfig,
  db: OpenFoxDatabase,
): Promise<Record<string, unknown>> {
  const runtime = buildRuntimeStatusSnapshot(config, db);
  const health = await buildHealthSnapshot(config, db);
  const service = buildServiceStatusSnapshot(config, db.raw);
  const status = runtime.paymasterProvider as Record<string, unknown> | null;
  const surface = service.providerSurfaces.paymaster;
  const enabled = Boolean(status?.enabled);
  const summary = enabled
    ? [
        `${health.paymasterRecentQuotes} recent quote${health.paymasterRecentQuotes === 1 ? "" : "s"}`,
        `${health.paymasterRecentAuthorizations} recent authorization${health.paymasterRecentAuthorizations === 1 ? "" : "s"}`,
        `${health.paymasterPendingAuthorizations} pending`,
        `sponsorFunded=${health.paymasterSponsorFunded === null ? "unknown" : yesNo(health.paymasterSponsorFunded)}`,
        `parity=${health.paymasterSignerParityAligned ? "aligned" : "limited"}`,
      ].join(", ")
    : "paymaster provider disabled";
  return {
    kind: "paymaster",
    enabled,
    summary,
    status,
    health: {
      ready: health.paymasterProviderReady,
      policyConfigured: health.paymasterPolicyConfigured,
      policyExpired: health.paymasterPolicyExpired,
      sponsorFunded: health.paymasterSponsorFunded,
      signerParityAligned: health.paymasterSignerParityAligned,
      recentQuotes: health.paymasterRecentQuotes,
      recentAuthorizations: health.paymasterRecentAuthorizations,
      pendingAuthorizations: health.paymasterPendingAuthorizations,
    },
    serviceSurface: surface,
  };
}
