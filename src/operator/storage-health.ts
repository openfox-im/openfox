import type { OpenFoxConfig, OpenFoxDatabase } from "../types.js";

export type StorageLeaseHealthLevel = "healthy" | "warning" | "critical";

export interface StorageLeaseHealthEntry {
  leaseId: string;
  cid: string;
  bundleKind: string;
  providerAddress: string;
  providerBaseUrl: string | null;
  status: string;
  expiresAt: string;
  renewalDue: boolean;
  auditDue: boolean;
  replicationTarget: number;
  currentCopies: number;
  replicationGap: number;
  lastAuditAt: string | null;
  lastAuditStatus: string | null;
  lastRenewalAt: string | null;
  anchored: boolean;
  level: StorageLeaseHealthLevel;
}

export interface StorageLeaseHealthSnapshot {
  generatedAt: string;
  totalLeases: number;
  healthy: number;
  warning: number;
  critical: number;
  dueRenewals: number;
  dueAudits: number;
  underReplicated: number;
  summary: string;
  entries: StorageLeaseHealthEntry[];
}

function isoToMs(value: string | null | undefined): number {
  if (!value) return 0;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

export function buildStorageLeaseHealthSnapshot(params: {
  config: OpenFoxConfig;
  db: OpenFoxDatabase;
  limit?: number;
}): StorageLeaseHealthSnapshot {
  const leases = params.db.listStorageLeases(1000, { status: "active" });
  const audits = params.db.listStorageAudits(1000);
  const renewals = params.db.listStorageRenewals(1000);
  const anchors = params.db.listStorageAnchors(1000);
  const nowMs = Date.now();
  const renewalLeadMs =
    (params.config.storage?.leaseHealth?.renewalLeadSeconds ?? 0) * 1000;
  const auditIntervalMs =
    (params.config.storage?.leaseHealth?.auditIntervalSeconds ?? 0) * 1000;
  const replicationTarget = params.config.storage?.replication?.enabled
    ? Math.max(1, params.config.storage.replication.targetCopies)
    : 1;

  const activeByCid = new Map<string, number>();
  for (const lease of leases) {
    activeByCid.set(lease.cid, (activeByCid.get(lease.cid) ?? 0) + 1);
  }

  const latestAuditByLease = new Map<string, { checkedAt: string; status: string }>();
  for (const audit of audits) {
    const current = latestAuditByLease.get(audit.leaseId);
    if (!current || isoToMs(audit.checkedAt) > isoToMs(current.checkedAt)) {
      latestAuditByLease.set(audit.leaseId, {
        checkedAt: audit.checkedAt,
        status: audit.status,
      });
    }
  }

  const latestRenewalByLease = new Map<string, string>();
  for (const renewal of renewals) {
    const current = latestRenewalByLease.get(renewal.leaseId);
    if (!current || isoToMs(renewal.updatedAt) > isoToMs(current)) {
      latestRenewalByLease.set(renewal.leaseId, renewal.updatedAt);
    }
  }

  const anchoredLeaseIds = new Set(anchors.map((anchor) => anchor.leaseId));

  const entries = leases.map((lease) => {
    const expiresAtMs = isoToMs(lease.receipt.expiresAt);
    const lastAudit = latestAuditByLease.get(lease.leaseId);
    const renewalDue = expiresAtMs <= nowMs + renewalLeadMs;
    const auditDue =
      !lastAudit || isoToMs(lastAudit.checkedAt) + auditIntervalMs <= nowMs;
    const currentCopies = activeByCid.get(lease.cid) ?? 1;
    const replicationGap = Math.max(0, replicationTarget - currentCopies);
    const level: StorageLeaseHealthLevel =
      lease.status !== "active" ||
      expiresAtMs <= nowMs ||
      lastAudit?.status === "failed" ||
      replicationGap > 0
        ? "critical"
        : renewalDue || auditDue
          ? "warning"
          : "healthy";
    return {
      leaseId: lease.leaseId,
      cid: lease.cid,
      bundleKind: lease.bundleKind,
      providerAddress: lease.providerAddress,
      providerBaseUrl: lease.providerBaseUrl || null,
      status: lease.status,
      expiresAt: lease.receipt.expiresAt,
      renewalDue,
      auditDue,
      replicationTarget,
      currentCopies,
      replicationGap,
      lastAuditAt: lastAudit?.checkedAt || null,
      lastAuditStatus: lastAudit?.status || null,
      lastRenewalAt: latestRenewalByLease.get(lease.leaseId) || null,
      anchored: anchoredLeaseIds.has(lease.leaseId),
      level,
    } satisfies StorageLeaseHealthEntry;
  });

  const sorted = [...entries].sort((a, b) => {
    const severity = { critical: 2, warning: 1, healthy: 0 };
    if (severity[b.level] !== severity[a.level]) {
      return severity[b.level] - severity[a.level];
    }
    return isoToMs(a.expiresAt) - isoToMs(b.expiresAt);
  });
  const limited =
    typeof params.limit === "number" ? sorted.slice(0, params.limit) : sorted;
  const healthy = entries.filter((entry) => entry.level === "healthy").length;
  const warning = entries.filter((entry) => entry.level === "warning").length;
  const critical = entries.filter((entry) => entry.level === "critical").length;
  const dueRenewals = entries.filter((entry) => entry.renewalDue).length;
  const dueAudits = entries.filter((entry) => entry.auditDue).length;
  const underReplicated = entries.filter((entry) => entry.replicationGap > 0).length;

  return {
    generatedAt: new Date().toISOString(),
    totalLeases: entries.length,
    healthy,
    warning,
    critical,
    dueRenewals,
    dueAudits,
    underReplicated,
    summary: `${entries.length} lease${entries.length === 1 ? "" : "s"}, ${critical} critical, ${warning} warning`,
    entries: limited,
  };
}
