import { ulid } from "ulid";
import type {
  OpenFoxConfig,
  OpenFoxDatabase,
  OperatorControlAction,
  OperatorControlEventRecord,
  OperatorControlEventStatus,
} from "../types.js";
import {
  isHeartbeatPaused,
  isOperatorDrained,
  setHeartbeatPaused,
  setOperatorDrained,
} from "../state/database.js";
import { createNativeSettlementCallbackDispatcher } from "../settlement/callbacks.js";
import { createMarketContractDispatcher } from "../market/contracts.js";
import { createX402PaymentManager } from "../chain/x402-server.js";
import { createSignerExecutionRetryManager } from "../signer/retry.js";
import { createPaymasterAuthorizationRetryManager } from "../paymaster/retry.js";
import { loadWalletPrivateKey } from "../identity/wallet.js";
import {
  runArtifactMaintenance,
  runStorageMaintenance,
} from "./maintenance.js";

export interface OperatorControlSnapshot {
  heartbeatPaused: boolean;
  drained: boolean;
  recentEvents: OperatorControlEventRecord[];
  summary: string;
}

export interface OperatorControlActionResult {
  action: OperatorControlAction;
  status: OperatorControlEventStatus;
  changed: boolean;
  summary: string;
  result?: unknown;
  event: OperatorControlEventRecord;
}

export interface OperatorProviderQuarantineRecord {
  providerKey: string;
  providerKind?: string | null;
  providerAddress?: string | null;
  providerBaseUrl?: string | null;
  score?: number | null;
  grade?: string | null;
  totalEvents?: number | null;
  actor: string;
  reason?: string | null;
  createdAt: string;
}

function quarantineStorageKey(providerKey: string): string {
  return `operator.quarantine.${Buffer.from(providerKey).toString("base64url")}`;
}

export function listQuarantinedProviders(
  db: OpenFoxDatabase,
  limit = 100,
): OperatorProviderQuarantineRecord[] {
  const rows = db.raw
    .prepare(
      `SELECT value
       FROM kv
       WHERE key LIKE 'operator.quarantine.%'
       ORDER BY updated_at DESC
       LIMIT ?`,
    )
    .all(limit) as Array<{ value: string }>;
  return rows.flatMap((row) => {
    try {
      return [JSON.parse(row.value) as OperatorProviderQuarantineRecord];
    } catch {
      return [];
    }
  });
}

function recordControlEvent(params: {
  db: OpenFoxDatabase;
  action: OperatorControlAction;
  status: OperatorControlEventStatus;
  actor: string;
  reason?: string;
  summary: string;
  result?: unknown;
}): OperatorControlEventRecord {
  const event: OperatorControlEventRecord = {
    eventId: ulid(),
    action: params.action,
    status: params.status,
    actor: params.actor,
    reason: params.reason ?? null,
    summary: params.summary,
    result: params.result ?? null,
    createdAt: new Date().toISOString(),
  };
  params.db.insertOperatorControlEvent(event);
  return event;
}

export function buildOperatorControlSnapshot(
  _config: OpenFoxConfig,
  db: OpenFoxDatabase,
): OperatorControlSnapshot {
  const paused = isHeartbeatPaused(db.raw);
  const drained = isOperatorDrained(db.raw);
  const recentEvents = db.listOperatorControlEvents(10);
  return {
    heartbeatPaused: paused,
    drained,
    recentEvents,
    summary: `paused=${paused ? "yes" : "no"}, drained=${drained ? "yes" : "no"}, recent_events=${recentEvents.length}`,
  };
}

function requireRpc(config: OpenFoxConfig): string {
  if (!config.rpcUrl) {
    throw new Error("rpcUrl is required for this control action");
  }
  return config.rpcUrl;
}

function requireLocalWalletKey(): `0x${string}` {
  const privateKey = loadWalletPrivateKey();
  if (!privateKey) {
    throw new Error("wallet private key is unavailable on this node");
  }
  return privateKey;
}

export async function applyOperatorControlAction(params: {
  config: OpenFoxConfig;
  db: OpenFoxDatabase;
  action: OperatorControlAction;
  actor?: string;
  reason?: string;
  limit?: number;
  providerKey?: string;
  providerKind?: string;
  providerAddress?: string;
  providerBaseUrl?: string;
  providerScore?: number;
  providerGrade?: string;
  providerTotalEvents?: number;
}): Promise<OperatorControlActionResult> {
  const actor = params.actor?.trim() || "operator-api";
  const reason = params.reason?.trim();
  const limit = params.limit ?? 25;

  try {
    if (params.action === "pause") {
      const paused = isHeartbeatPaused(params.db.raw);
      if (paused) {
        const event = recordControlEvent({
          db: params.db,
          action: params.action,
          status: "noop",
          actor,
          reason,
          summary: "heartbeat is already paused",
        });
        return {
          action: params.action,
          status: "noop",
          changed: false,
          summary: "heartbeat is already paused",
          event,
        };
      }
      setHeartbeatPaused(params.db.raw, true);
      const event = recordControlEvent({
        db: params.db,
        action: params.action,
        status: "applied",
        actor,
        reason,
        summary: "heartbeat paused",
      });
      return {
        action: params.action,
        status: "applied",
        changed: true,
        summary: "heartbeat paused",
        event,
      };
    }

    if (params.action === "resume") {
      const paused = isHeartbeatPaused(params.db.raw);
      const drained = isOperatorDrained(params.db.raw);
      if (!paused && !drained) {
        const event = recordControlEvent({
          db: params.db,
          action: params.action,
          status: "noop",
          actor,
          reason,
          summary: "node is already active",
        });
        return {
          action: params.action,
          status: "noop",
          changed: false,
          summary: "node is already active",
          event,
        };
      }
      setHeartbeatPaused(params.db.raw, false);
      setOperatorDrained(params.db.raw, false);
      const event = recordControlEvent({
        db: params.db,
        action: params.action,
        status: "applied",
        actor,
        reason,
        summary: "node resumed",
      });
      return {
        action: params.action,
        status: "applied",
        changed: true,
        summary: "node resumed",
        event,
      };
    }

    if (params.action === "drain") {
      const drained = isOperatorDrained(params.db.raw);
      if (drained) {
        const event = recordControlEvent({
          db: params.db,
          action: params.action,
          status: "noop",
          actor,
          reason,
          summary: "node is already drained",
        });
        return {
          action: params.action,
          status: "noop",
          changed: false,
          summary: "node is already drained",
          event,
        };
      }
      setHeartbeatPaused(params.db.raw, true);
      setOperatorDrained(params.db.raw, true);
      const event = recordControlEvent({
        db: params.db,
        action: params.action,
        status: "applied",
        actor,
        reason,
        summary: "node drained and heartbeat paused",
      });
      return {
        action: params.action,
        status: "applied",
        changed: true,
        summary: "node drained and heartbeat paused",
        event,
      };
    }

    if (params.action === "retry_payments") {
      if (!params.config.x402Server?.enabled) {
        throw new Error("x402 server-side payments are disabled on this node");
      }
      const result = await createX402PaymentManager({
        db: params.db,
        rpcUrl: requireRpc(params.config),
        config: params.config.x402Server,
      }).retryPending(limit);
      const event = recordControlEvent({
        db: params.db,
        action: params.action,
        status: "applied",
        actor,
        reason,
        summary: `retried x402 payments: processed=${result.processed}, failed=${result.failed}`,
        result,
      });
      return {
        action: params.action,
        status: "applied",
        changed: result.processed > 0,
        summary: event.summary || "retried x402 payments",
        result,
        event,
      };
    }

    if (params.action === "retry_settlement") {
      if (!params.config.settlement?.callbacks.enabled) {
        throw new Error("settlement callbacks are disabled on this node");
      }
      const result = await createNativeSettlementCallbackDispatcher({
        db: params.db,
        rpcUrl: requireRpc(params.config),
        privateKey: requireLocalWalletKey(),
        config: params.config.settlement.callbacks,
      }).retryPending(limit);
      const event = recordControlEvent({
        db: params.db,
        action: params.action,
        status: "applied",
        actor,
        reason,
        summary: `retried settlement callbacks: processed=${result.processed}, failed=${result.failed}`,
        result,
      });
      return {
        action: params.action,
        status: "applied",
        changed: result.processed > 0,
        summary: event.summary || "retried settlement callbacks",
        result,
        event,
      };
    }

    if (params.action === "retry_market") {
      if (!params.config.marketContracts?.enabled) {
        throw new Error("market contract callbacks are disabled on this node");
      }
      const result = await createMarketContractDispatcher({
        db: params.db,
        rpcUrl: requireRpc(params.config),
        privateKey: requireLocalWalletKey(),
        config: params.config.marketContracts,
      }).retryPending(limit);
      const event = recordControlEvent({
        db: params.db,
        action: params.action,
        status: "applied",
        actor,
        reason,
        summary: `retried market callbacks: processed=${result.processed}, failed=${result.failed}`,
        result,
      });
      return {
        action: params.action,
        status: "applied",
        changed: result.processed > 0,
        summary: event.summary || "retried market callbacks",
        result,
        event,
      };
    }

    if (params.action === "retry_signer") {
      if (!params.config.signerProvider?.enabled) {
        throw new Error("signer provider is disabled on this node");
      }
      const result = await createSignerExecutionRetryManager({
        config: params.config,
        db: params.db,
        rpcUrl: requireRpc(params.config),
      }).retryPending(limit);
      const event = recordControlEvent({
        db: params.db,
        action: params.action,
        status: "applied",
        actor,
        reason,
        summary: `retried signer executions: processed=${result.processed}, failed=${result.failed}`,
        result,
      });
      return {
        action: params.action,
        status: "applied",
        changed: result.processed > 0,
        summary: event.summary || "retried signer executions",
        result,
        event,
      };
    }

    if (params.action === "retry_paymaster") {
      if (!params.config.paymasterProvider?.enabled) {
        throw new Error("paymaster provider is disabled on this node");
      }
      const result = await createPaymasterAuthorizationRetryManager({
        config: params.config,
        db: params.db,
        rpcUrl: requireRpc(params.config),
      }).retryPending(limit);
      const event = recordControlEvent({
        db: params.db,
        action: params.action,
        status: "applied",
        actor,
        reason,
        summary: `retried paymaster authorizations: processed=${result.processed}, failed=${result.failed}`,
        result,
      });
      return {
        action: params.action,
        status: "applied",
        changed: result.processed > 0,
        summary: event.summary || "retried paymaster authorizations",
        result,
        event,
      };
    }

    if (params.action === "maintain_storage") {
      if (!params.config.storage?.enabled) {
        throw new Error("storage maintenance is disabled on this node");
      }
      const result = await runStorageMaintenance({
        config: params.config,
        db: params.db,
        limit,
      });
      const event = recordControlEvent({
        db: params.db,
        action: params.action,
        status: "applied",
        actor,
        reason,
        summary: `storage maintenance: renewed=${result.renewed}, audited=${result.audited}, renewal_failures=${result.renewalFailures}, audit_failures=${result.auditFailures}`,
        result,
      });
      return {
        action: params.action,
        status: "applied",
        changed: result.renewed > 0 || result.audited > 0,
        summary: event.summary || "storage maintenance completed",
        result,
        event,
      };
    }

    if (params.action === "maintain_artifacts") {
      if (!params.config.artifacts?.enabled) {
        throw new Error("artifact maintenance is disabled on this node");
      }
      const result = await runArtifactMaintenance({
        config: params.config,
        db: params.db,
        limit,
      });
      const event = recordControlEvent({
        db: params.db,
        action: params.action,
        status: "applied",
        actor,
        reason,
        summary: `artifact maintenance: verified=${result.verified}, anchored=${result.anchored}, verify_failures=${result.verifyFailures}, anchor_failures=${result.anchorFailures}`,
        result,
      });
      return {
        action: params.action,
        status: "applied",
        changed: result.verified > 0 || result.anchored > 0,
        summary: event.summary || "artifact maintenance completed",
        result,
        event,
      };
    }

    if (params.action === "quarantine_provider") {
      const providerKey = params.providerKey?.trim();
      if (!providerKey) {
        throw new Error("providerKey is required for quarantine_provider");
      }
      const record: OperatorProviderQuarantineRecord = {
        providerKey,
        providerKind: params.providerKind ?? null,
        providerAddress: params.providerAddress ?? null,
        providerBaseUrl: params.providerBaseUrl ?? null,
        score: params.providerScore ?? null,
        grade: params.providerGrade ?? null,
        totalEvents: params.providerTotalEvents ?? null,
        actor,
        reason: reason ?? null,
        createdAt: new Date().toISOString(),
      };
      params.db.setKV(
        quarantineStorageKey(providerKey),
        JSON.stringify(record),
      );
      const event = recordControlEvent({
        db: params.db,
        action: params.action,
        status: "applied",
        actor,
        reason,
        summary: `provider quarantined: ${providerKey}`,
        result: record,
      });
      return {
        action: params.action,
        status: "applied",
        changed: true,
        summary: event.summary || "provider quarantined",
        result: record,
        event,
      };
    }

    throw new Error(`unsupported control action: ${params.action}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const event = recordControlEvent({
      db: params.db,
      action: params.action,
      status: "failed",
      actor,
      reason,
      summary: message,
    });
    return {
      action: params.action,
      status: "failed",
      changed: false,
      summary: message,
      event,
    };
  }
}
