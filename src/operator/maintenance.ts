import { createNativeArtifactAnchorPublisher } from "../artifacts/publisher.js";
import { createArtifactManager } from "../artifacts/manager.js";
import { propagateExecutionTrailsForSubject } from "../audit/execution-trails.js";
import { getWallet } from "../identity/wallet.js";
import {
  auditLocalStorageLease,
  renewTrackedLease,
} from "../storage/lifecycle.js";
import type {
  ArtifactPipelineConfig,
  OpenFoxConfig,
  OpenFoxDatabase,
  StorageLeaseRecord,
  StorageMarketConfig,
} from "../types.js";

export interface StorageMaintenanceResult {
  kind: "storage";
  enabled: boolean;
  checkedLeases: number;
  dueRenewals: number;
  renewalAttempts: number;
  renewed: number;
  renewalFailures: number;
  dueAudits: number;
  auditAttempts: number;
  audited: number;
  auditFailures: number;
  skippedReason?: string;
}

export interface ArtifactMaintenanceResult {
  kind: "artifacts";
  enabled: boolean;
  storedCandidates: number;
  verifyAttempts: number;
  verified: number;
  verifyFailures: number;
  verifiedCandidates: number;
  anchorAttempts: number;
  anchored: number;
  anchorFailures: number;
  skippedReason?: string;
}

function buildArtifactConfig(config: OpenFoxConfig): ArtifactPipelineConfig {
  return (
    config.artifacts ?? {
      enabled: false,
      publishToDiscovery: true,
      defaultProviderBaseUrl: undefined,
      defaultTtlSeconds: 604800,
      autoAnchorOnStore: false,
      captureCapability: "public_news.capture",
      evidenceCapability: "oracle.evidence",
      aggregateCapability: "oracle.aggregate",
      verificationCapability: "artifact.verify",
      service: {
        enabled: false,
        bindHost: "127.0.0.1",
        port: 4896,
        pathPrefix: "/artifacts",
        requireNativeIdentity: true,
        maxBodyBytes: 256 * 1024,
        maxTextChars: 32 * 1024,
      },
      anchor: {
        enabled: false,
        gas: "180000",
        waitForReceipt: true,
        receiptTimeoutMs: 60000,
      },
    }
  );
}

function buildStorageConfig(config: OpenFoxConfig): StorageMarketConfig | null {
  return config.storage?.enabled ? config.storage : null;
}

function computeRenewalDue(
  lease: StorageLeaseRecord,
  config: StorageMarketConfig,
  nowMs: number,
): boolean {
  const expiresMs = Date.parse(lease.receipt.expiresAt);
  if (!Number.isFinite(expiresMs)) return false;
  const leadMs = config.leaseHealth.renewalLeadSeconds * 1000;
  return expiresMs - nowMs <= leadMs;
}

function computeAuditDue(
  lease: StorageLeaseRecord,
  lastAuditAt: string | undefined,
  config: StorageMarketConfig,
  nowMs: number,
): boolean {
  if (!lastAuditAt) return true;
  const checkedAtMs = Date.parse(lastAuditAt);
  if (!Number.isFinite(checkedAtMs)) return true;
  const auditIntervalMs = config.leaseHealth.auditIntervalSeconds * 1000;
  return nowMs - checkedAtMs >= auditIntervalMs;
}

export async function runStorageMaintenance(params: {
  config: OpenFoxConfig;
  db: OpenFoxDatabase;
  limit?: number;
}): Promise<StorageMaintenanceResult> {
  const storageConfig = buildStorageConfig(params.config);
  if (!storageConfig) {
    return {
      kind: "storage",
      enabled: false,
      checkedLeases: 0,
      dueRenewals: 0,
      renewalAttempts: 0,
      renewed: 0,
      renewalFailures: 0,
      dueAudits: 0,
      auditAttempts: 0,
      audited: 0,
      auditFailures: 0,
      skippedReason: "storage_disabled",
    };
  }

  const { account } = await getWallet();
  const nowMs = Date.now();
  const limit = Math.max(1, params.limit ?? 10);
  const leases = params.db
    .listStorageLeases(Math.max(limit * 5, 50), { status: "active" })
    .filter((lease) => lease.requesterAddress === params.config.walletAddress);
  const latestAuditByLease = new Map<string, string>();
  for (const audit of params.db.listStorageAudits(Math.max(leases.length * 5, 50))) {
    if (!latestAuditByLease.has(audit.leaseId)) {
      latestAuditByLease.set(audit.leaseId, audit.checkedAt);
    }
  }

  const dueRenewals = leases.filter((lease) =>
    computeRenewalDue(lease, storageConfig, nowMs),
  );
  const dueAudits = leases.filter((lease) =>
    computeAuditDue(
      lease,
      latestAuditByLease.get(lease.leaseId),
      storageConfig,
      nowMs,
    ),
  );

  let renewed = 0;
  let renewalFailures = 0;
  for (const lease of dueRenewals.slice(0, limit)) {
    try {
      await renewTrackedLease({
        lease,
        requesterAccount: account as any,
        requesterAddress: params.config.walletAddress,
        db: params.db,
      });
      renewed += 1;
    } catch {
      renewalFailures += 1;
    }
  }

  let audited = 0;
  let auditFailures = 0;
  for (const lease of dueAudits.slice(0, limit)) {
    try {
      const audit = await auditLocalStorageLease({ lease });
      params.db.upsertStorageAudit(audit);
      propagateExecutionTrailsForSubject({
        db: params.db,
        fromSubjectKind: "storage_lease",
        fromSubjectId: lease.leaseId,
        toSubjectKind: "storage_audit",
        toSubjectId: audit.auditId,
        metadata: { via: "storage_lease", lease_id: lease.leaseId },
        createdAt: audit.updatedAt,
      });
      audited += 1;
    } catch {
      auditFailures += 1;
    }
  }

  return {
    kind: "storage",
    enabled: true,
    checkedLeases: leases.length,
    dueRenewals: dueRenewals.length,
    renewalAttempts: Math.min(dueRenewals.length, limit),
    renewed,
    renewalFailures,
    dueAudits: dueAudits.length,
    auditAttempts: Math.min(dueAudits.length, limit),
    audited,
    auditFailures,
  };
}

export async function runArtifactMaintenance(params: {
  config: OpenFoxConfig;
  db: OpenFoxDatabase;
  limit?: number;
}): Promise<ArtifactMaintenanceResult> {
  const artifactConfig = buildArtifactConfig(params.config);
  if (!artifactConfig.enabled) {
    return {
      kind: "artifacts",
      enabled: false,
      storedCandidates: 0,
      verifyAttempts: 0,
      verified: 0,
      verifyFailures: 0,
      verifiedCandidates: 0,
      anchorAttempts: 0,
      anchored: 0,
      anchorFailures: 0,
      skippedReason: "artifacts_disabled",
    };
  }

  const { account, privateKey } = await getWallet();
  const limit = Math.max(1, params.limit ?? 10);
  const anchorPublisher =
    artifactConfig.anchor.enabled && params.config.rpcUrl
      ? createNativeArtifactAnchorPublisher({
          db: params.db,
          rpcUrl: params.config.rpcUrl,
          privateKey,
          config: artifactConfig.anchor,
          publisherAddress: params.config.walletAddress,
        })
      : undefined;

  const manager = createArtifactManager({
    identity: {
      name: params.config.name,
      address: params.config.walletAddress,
      account,
      creatorAddress: params.config.creatorAddress,
      sandboxId: params.config.sandboxId,
      apiKey: params.config.runtimeApiKey || "",
      createdAt: new Date().toISOString(),
    },
    requesterAccount: account,
    db: params.db,
    config: artifactConfig,
    anchorPublisher,
  });

  const storedCandidates = manager.listArtifacts(limit, { status: "stored" });
  const verifiedCandidates = manager.listArtifacts(limit, { status: "verified" });

  let verified = 0;
  let verifyFailures = 0;
  for (const artifact of storedCandidates) {
    try {
      await manager.verifyArtifact({ artifactId: artifact.artifactId });
      verified += 1;
    } catch {
      verifyFailures += 1;
    }
  }

  let anchored = 0;
  let anchorFailures = 0;
  const anchorable =
    anchorPublisher && artifactConfig.anchor.enabled ? verifiedCandidates : [];
  for (const artifact of anchorable) {
    try {
      await manager.anchorArtifact({ artifactId: artifact.artifactId });
      anchored += 1;
    } catch {
      anchorFailures += 1;
    }
  }

  return {
    kind: "artifacts",
    enabled: true,
    storedCandidates: storedCandidates.length,
    verifyAttempts: storedCandidates.length,
    verified,
    verifyFailures,
    verifiedCandidates: verifiedCandidates.length,
    anchorAttempts: anchorable.length,
    anchored,
    anchorFailures,
  };
}
