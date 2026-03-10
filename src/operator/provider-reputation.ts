import type {
  ArtifactRecord,
  OpenFoxDatabase,
  PaymasterAuthorizationRecord,
  SignerExecutionRecord,
  StorageAuditRecord,
  StorageLeaseRecord,
  StorageRenewalRecord,
} from "../types.js";

export type ProviderReputationKind =
  | "storage"
  | "artifacts"
  | "signer"
  | "paymaster";

export type ProviderReputationGrade =
  | "excellent"
  | "good"
  | "fair"
  | "poor";

export interface ProviderReputationEntry {
  kind: ProviderReputationKind;
  providerAddress: string | null;
  providerBaseUrl: string | null;
  providerKey: string;
  score: number;
  grade: ProviderReputationGrade;
  totalEvents: number;
  successCount: number;
  failureCount: number;
  pendingCount: number;
  lastSeenAt: string | null;
  metrics: Record<string, number>;
}

export interface ProviderReputationSnapshot {
  generatedAt: string;
  totalProviders: number;
  weakProviders: number;
  summary: string;
  entries: ProviderReputationEntry[];
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function gradeScore(score: number): ProviderReputationGrade {
  if (score >= 85) return "excellent";
  if (score >= 70) return "good";
  if (score >= 50) return "fair";
  return "poor";
}

function isoToMs(value: string | null | undefined): number {
  if (!value) return 0;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function maxIso(values: Array<string | null | undefined>): string | null {
  let selected: string | null = null;
  let selectedMs = 0;
  for (const value of values) {
    const ms = isoToMs(value);
    if (ms > selectedMs && value) {
      selected = value;
      selectedMs = ms;
    }
  }
  return selected;
}

function sortEntries(entries: ProviderReputationEntry[], limit?: number): ProviderReputationEntry[] {
  const sorted = [...entries].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return isoToMs(b.lastSeenAt) - isoToMs(a.lastSeenAt);
  });
  return typeof limit === "number" ? sorted.slice(0, limit) : sorted;
}

function buildStorageEntries(
  db: OpenFoxDatabase,
  nowMs: number,
): ProviderReputationEntry[] {
  const leases = db.listStorageLeases(1000);
  const renewals = db.listStorageRenewals(1000);
  const audits = db.listStorageAudits(1000);
  const groups = new Map<
    string,
    {
      providerAddress: string | null;
      providerBaseUrl: string | null;
      activeLeases: number;
      nonActiveLeases: number;
      renewals: number;
      auditVerified: number;
      auditFailed: number;
      dueRenewals: number;
      dueAudits: number;
      replicationGap: number;
      lastSeen: Array<string | null | undefined>;
    }
  >();

  const activeByCid = new Map<string, StorageLeaseRecord[]>();
  for (const lease of leases) {
    if (lease.status === "active") {
      const current = activeByCid.get(lease.cid) ?? [];
      current.push(lease);
      activeByCid.set(lease.cid, current);
    }
  }

  const latestAuditByLease = new Map<string, StorageAuditRecord>();
  for (const audit of audits) {
    const current = latestAuditByLease.get(audit.leaseId);
    if (!current || isoToMs(audit.checkedAt) > isoToMs(current.checkedAt)) {
      latestAuditByLease.set(audit.leaseId, audit);
    }
  }

  const latestRenewalByLease = new Map<string, StorageRenewalRecord>();
  for (const renewal of renewals) {
    const current = latestRenewalByLease.get(renewal.leaseId);
    if (!current || isoToMs(renewal.updatedAt) > isoToMs(current.updatedAt)) {
      latestRenewalByLease.set(renewal.leaseId, renewal);
    }
  }

  for (const lease of leases) {
    const key = lease.providerAddress;
    const current = groups.get(key) ?? {
      providerAddress: lease.providerAddress,
      providerBaseUrl: lease.providerBaseUrl || null,
      activeLeases: 0,
      nonActiveLeases: 0,
      renewals: 0,
      auditVerified: 0,
      auditFailed: 0,
      dueRenewals: 0,
      dueAudits: 0,
      replicationGap: 0,
      lastSeen: [],
    };
    current.lastSeen.push(lease.updatedAt, lease.createdAt);
    if (lease.status === "active") {
      current.activeLeases += 1;
      const expiresMs = isoToMs(lease.receipt.expiresAt);
      if (expiresMs <= nowMs + 24 * 60 * 60 * 1000) {
        current.dueRenewals += 1;
      }
      const latestAudit = latestAuditByLease.get(lease.leaseId);
      const auditCutoffMs = nowMs - 24 * 60 * 60 * 1000;
      if (!latestAudit || isoToMs(latestAudit.checkedAt) < auditCutoffMs) {
        current.dueAudits += 1;
      }
      const activeCopies = activeByCid.get(lease.cid)?.length ?? 1;
      current.replicationGap += Math.max(0, 1 - activeCopies);
    } else {
      current.nonActiveLeases += 1;
    }
    const latestRenewal = latestRenewalByLease.get(lease.leaseId);
    if (latestRenewal) {
      current.lastSeen.push(latestRenewal.updatedAt, latestRenewal.createdAt);
    }
    groups.set(key, current);
  }

  for (const renewal of renewals) {
    const key = renewal.providerAddress;
    const current = groups.get(key) ?? {
      providerAddress: renewal.providerAddress,
      providerBaseUrl: renewal.providerBaseUrl || null,
      activeLeases: 0,
      nonActiveLeases: 0,
      renewals: 0,
      auditVerified: 0,
      auditFailed: 0,
      dueRenewals: 0,
      dueAudits: 0,
      replicationGap: 0,
      lastSeen: [],
    };
    current.renewals += 1;
    current.lastSeen.push(renewal.updatedAt, renewal.createdAt);
    groups.set(key, current);
  }

  for (const audit of audits) {
    const lease = db.getStorageLease(audit.leaseId);
    const key = lease?.providerAddress || "unknown";
    const current = groups.get(key) ?? {
      providerAddress: lease?.providerAddress || null,
      providerBaseUrl: lease?.providerBaseUrl || null,
      activeLeases: 0,
      nonActiveLeases: 0,
      renewals: 0,
      auditVerified: 0,
      auditFailed: 0,
      dueRenewals: 0,
      dueAudits: 0,
      replicationGap: 0,
      lastSeen: [],
    };
    if (audit.status === "verified") current.auditVerified += 1;
    else current.auditFailed += 1;
    current.lastSeen.push(audit.updatedAt, audit.createdAt, audit.checkedAt);
    groups.set(key, current);
  }

  return Array.from(groups.values()).map((group) => {
    const successCount =
      group.activeLeases + group.renewals + group.auditVerified;
    const failureCount = group.auditFailed + group.nonActiveLeases;
    const pendingCount =
      group.dueRenewals + group.dueAudits + group.replicationGap;
    const totalEvents = successCount + failureCount + pendingCount;
    const score = clampScore(
      55 +
        successCount * 4 -
        failureCount * 8 -
        pendingCount * 5 +
        Math.min(group.activeLeases, 10),
    );
    return {
      kind: "storage",
      providerAddress: group.providerAddress,
      providerBaseUrl: group.providerBaseUrl,
      providerKey: group.providerAddress || group.providerBaseUrl || "unknown",
      score,
      grade: gradeScore(score),
      totalEvents,
      successCount,
      failureCount,
      pendingCount,
      lastSeenAt: maxIso(group.lastSeen),
      metrics: {
        activeLeases: group.activeLeases,
        renewals: group.renewals,
        auditVerified: group.auditVerified,
        auditFailed: group.auditFailed,
        dueRenewals: group.dueRenewals,
        dueAudits: group.dueAudits,
        replicationGap: group.replicationGap,
      },
    };
  });
}

function buildArtifactEntries(db: OpenFoxDatabase): ProviderReputationEntry[] {
  const artifacts = db.listArtifacts(1000);
  const groups = new Map<
    string,
    {
      providerAddress: string | null;
      providerBaseUrl: string | null;
      stored: number;
      verified: number;
      anchored: number;
      failed: number;
      lastSeen: Array<string | null | undefined>;
    }
  >();

  for (const artifact of artifacts) {
    const key = artifact.providerAddress;
    const current = groups.get(key) ?? {
      providerAddress: artifact.providerAddress,
      providerBaseUrl: artifact.providerBaseUrl,
      stored: 0,
      verified: 0,
      anchored: 0,
      failed: 0,
      lastSeen: [],
    };
    if (artifact.status === "stored") current.stored += 1;
    if (artifact.status === "verified") current.verified += 1;
    if (artifact.status === "anchored") current.anchored += 1;
    if (artifact.status === "failed") current.failed += 1;
    current.lastSeen.push(artifact.updatedAt, artifact.createdAt);
    groups.set(key, current);
  }

  return Array.from(groups.values()).map((group) => {
    const successCount = group.verified + group.anchored;
    const failureCount = group.failed;
    const pendingCount = group.stored;
    const totalEvents = successCount + failureCount + pendingCount;
    const score = clampScore(
      55 + successCount * 6 - failureCount * 10 - pendingCount * 2,
    );
    return {
      kind: "artifacts",
      providerAddress: group.providerAddress,
      providerBaseUrl: group.providerBaseUrl,
      providerKey: group.providerAddress || group.providerBaseUrl || "unknown",
      score,
      grade: gradeScore(score),
      totalEvents,
      successCount,
      failureCount,
      pendingCount,
      lastSeenAt: maxIso(group.lastSeen),
      metrics: {
        stored: group.stored,
        verified: group.verified,
        anchored: group.anchored,
        failed: group.failed,
      },
    };
  });
}

function buildSignerEntries(db: OpenFoxDatabase): ProviderReputationEntry[] {
  const executions = db.listSignerExecutions(1000);
  const groups = new Map<
    string,
    {
      confirmed: number;
      failed: number;
      rejected: number;
      pending: number;
      submitted: number;
      lastSeen: Array<string | null | undefined>;
    }
  >();

  for (const execution of executions) {
    const current = groups.get(execution.providerAddress) ?? {
      confirmed: 0,
      failed: 0,
      rejected: 0,
      pending: 0,
      submitted: 0,
      lastSeen: [],
    };
    if (execution.status === "confirmed") current.confirmed += 1;
    if (execution.status === "failed") current.failed += 1;
    if (execution.status === "rejected") current.rejected += 1;
    if (execution.status === "pending") current.pending += 1;
    if (execution.status === "submitted") current.submitted += 1;
    current.lastSeen.push(execution.updatedAt, execution.createdAt);
    groups.set(execution.providerAddress, current);
  }

  return Array.from(groups.entries()).map(([providerAddress, group]) => {
    const successCount = group.confirmed;
    const failureCount = group.failed + group.rejected;
    const pendingCount = group.pending + group.submitted;
    const totalEvents = successCount + failureCount + pendingCount;
    const score = clampScore(
      55 + successCount * 8 - failureCount * 12 - pendingCount * 3,
    );
    return {
      kind: "signer",
      providerAddress,
      providerBaseUrl: null,
      providerKey: providerAddress,
      score,
      grade: gradeScore(score),
      totalEvents,
      successCount,
      failureCount,
      pendingCount,
      lastSeenAt: maxIso(group.lastSeen),
      metrics: {
        confirmed: group.confirmed,
        failed: group.failed,
        rejected: group.rejected,
        pending: group.pending,
        submitted: group.submitted,
      },
    };
  });
}

function buildPaymasterEntries(db: OpenFoxDatabase): ProviderReputationEntry[] {
  const authorizations = db.listPaymasterAuthorizations(1000);
  const groups = new Map<
    string,
    {
      confirmed: number;
      failed: number;
      rejected: number;
      expired: number;
      pending: number;
      submitted: number;
      lastSeen: Array<string | null | undefined>;
    }
  >();

  for (const authorization of authorizations) {
    const current = groups.get(authorization.providerAddress) ?? {
      confirmed: 0,
      failed: 0,
      rejected: 0,
      expired: 0,
      pending: 0,
      submitted: 0,
      lastSeen: [],
    };
    if (authorization.status === "confirmed") current.confirmed += 1;
    if (authorization.status === "failed") current.failed += 1;
    if (authorization.status === "rejected") current.rejected += 1;
    if (authorization.status === "expired") current.expired += 1;
    if (authorization.status === "authorized") current.pending += 1;
    if (authorization.status === "submitted") current.submitted += 1;
    current.lastSeen.push(authorization.updatedAt, authorization.createdAt);
    groups.set(authorization.providerAddress, current);
  }

  return Array.from(groups.entries()).map(([providerAddress, group]) => {
    const successCount = group.confirmed;
    const failureCount = group.failed + group.rejected + group.expired;
    const pendingCount = group.pending + group.submitted;
    const totalEvents = successCount + failureCount + pendingCount;
    const score = clampScore(
      55 + successCount * 8 - failureCount * 12 - pendingCount * 3,
    );
    return {
      kind: "paymaster",
      providerAddress,
      providerBaseUrl: null,
      providerKey: providerAddress,
      score,
      grade: gradeScore(score),
      totalEvents,
      successCount,
      failureCount,
      pendingCount,
      lastSeenAt: maxIso(group.lastSeen),
      metrics: {
        confirmed: group.confirmed,
        failed: group.failed,
        rejected: group.rejected,
        expired: group.expired,
        authorized: group.pending,
        submitted: group.submitted,
      },
    };
  });
}

export function buildProviderReputationSnapshot(params: {
  db: OpenFoxDatabase;
  kind?: ProviderReputationKind;
  limit?: number;
}): ProviderReputationSnapshot {
  const nowMs = Date.now();
  const entries = [
    ...(params.kind && params.kind !== "storage"
      ? []
      : buildStorageEntries(params.db, nowMs)),
    ...(params.kind && params.kind !== "artifacts"
      ? []
      : buildArtifactEntries(params.db)),
    ...(params.kind && params.kind !== "signer"
      ? []
      : buildSignerEntries(params.db)),
    ...(params.kind && params.kind !== "paymaster"
      ? []
      : buildPaymasterEntries(params.db)),
  ];
  const totalProviders = entries.length;
  const weakProviders = entries.filter((entry) => entry.score < 50).length;
  const sorted = sortEntries(entries, params.limit);
  return {
    generatedAt: new Date().toISOString(),
    totalProviders,
    weakProviders,
    summary: `${totalProviders} provider${totalProviders === 1 ? "" : "s"} tracked, ${weakProviders} weak`,
    entries: sorted,
  };
}
