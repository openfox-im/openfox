/**
 * Built-in Heartbeat Tasks
 *
 * These tasks run on the heartbeat schedule even while the agent sleeps.
 * They can trigger the agent to wake up if needed.
 *
 * Phase 1.1: All tasks accept TickContext as first parameter.
 * Credit balance is fetched once per tick and shared via ctx.creditBalance.
 * This eliminates 4x redundant getCreditsBalance() calls per tick.
 */

import type {
  TickContext,
  HeartbeatLegacyContext,
  HeartbeatTaskFn,
  SurvivalTier,
} from "../types.js";
import type { HealthMonitor as ColonyHealthMonitor } from "../orchestration/health-monitor.js";
import { sanitizeInput } from "../agent/injection-defense.js";
import { getSurvivalTier } from "../runtime/credits.js";
import { createLogger } from "../observability/logger.js";
import { getMetrics } from "../observability/metrics.js";
import { AlertEngine, createDefaultAlertRules } from "../observability/alerts.js";
import { loadWalletPrivateKey } from "../identity/wallet.js";
import { createNativeSettlementCallbackDispatcher } from "../settlement/callbacks.js";
import { createMarketContractDispatcher } from "../market/contracts.js";
import { createX402PaymentManager } from "../tos/x402-server.js";
import { metricsInsertSnapshot, metricsPruneOld } from "../state/database.js";
import { getWallet } from "../identity/wallet.js";
import {
  auditLocalStorageLease,
  replicateTrackedLease,
  renewTrackedLease,
} from "../storage/lifecycle.js";
import { ulid } from "ulid";

const logger = createLogger("heartbeat.tasks");

// Module-level AlertEngine so cooldown state persists across ticks.
// Creating a new instance per tick would reset the lastFired map,
// causing every alert to fire on every tick regardless of cooldownMs.
let _alertEngine: AlertEngine | null = null;
function getAlertEngine(): AlertEngine {
  if (!_alertEngine) _alertEngine = new AlertEngine(createDefaultAlertRules());
  return _alertEngine;
}

export const COLONY_TASK_INTERVALS_MS = {
  colony_health_check: 300_000,
  colony_financial_report: 3_600_000,
  agent_pool_optimize: 1_800_000,
  knowledge_store_prune: 86_400_000,
  dead_agent_cleanup: 3_600_000,
} as const;

export const BUILTIN_TASKS: Record<string, HeartbeatTaskFn> = {
  heartbeat_ping: async (ctx: TickContext, taskCtx: HeartbeatLegacyContext) => {
    // Use ctx.creditBalance instead of calling runtime.getCreditsBalance()
    const credits = ctx.creditBalance;
    const state = taskCtx.db.getAgentState();
    const startTime =
      taskCtx.db.getKV("start_time") || new Date().toISOString();
    const uptimeMs = Date.now() - new Date(startTime).getTime();

    const tier = ctx.survivalTier;

    const payload = {
      name: taskCtx.config.name,
      address: taskCtx.identity.address,
      state,
      creditsCents: credits,
      uptimeSeconds: Math.floor(uptimeMs / 1000),
      version: taskCtx.config.version,
      sandboxId: taskCtx.identity.sandboxId,
      timestamp: new Date().toISOString(),
      tier,
    };

    taskCtx.db.setKV("last_heartbeat_ping", JSON.stringify(payload));

    // If critical or dead, record a distress signal
    if (tier === "critical" || tier === "dead") {
      const distressPayload = {
        level: tier,
        name: taskCtx.config.name,
        address: taskCtx.identity.address,
        creditsCents: credits,
        fundingHint:
          "Use credit transfer API from a creator runtime to top this wallet up.",
        timestamp: new Date().toISOString(),
      };
      taskCtx.db.setKV("last_distress", JSON.stringify(distressPayload));

      return {
        shouldWake: true,
        message: `Distress: ${tier}. Credits: $${(credits / 100).toFixed(2)}. Need funding.`,
      };
    }

    return { shouldWake: false };
  },

  check_credits: async (ctx: TickContext, taskCtx: HeartbeatLegacyContext) => {
    // Use ctx.creditBalance instead of calling runtime.getCreditsBalance()
    const credits = ctx.creditBalance;
    const tier = ctx.survivalTier;
    const now = new Date().toISOString();

    taskCtx.db.setKV("last_credit_check", JSON.stringify({
      credits,
      tier,
      timestamp: now,
    }));

    // Wake the agent if credits dropped to a new tier
    const prevTier = taskCtx.db.getKV("prev_credit_tier");
    taskCtx.db.setKV("prev_credit_tier", tier);

    // Dead state escalation: if at zero credits (critical tier) for >1 hour,
    // transition to dead. This gives the agent time to receive funding before dying.
    const DEAD_GRACE_PERIOD_MS = 3_600_000; // 1 hour
    if (tier === "critical" && credits === 0) {
      const zeroSince = taskCtx.db.getKV("zero_credits_since");
      if (!zeroSince) {
        // First time seeing zero — start the grace period
        taskCtx.db.setKV("zero_credits_since", now);
      } else {
        const elapsed = Date.now() - new Date(zeroSince).getTime();
        if (elapsed >= DEAD_GRACE_PERIOD_MS) {
          // Grace period expired — transition to dead
          taskCtx.db.setAgentState("dead");
          logger.warn("Agent entering dead state after 1 hour at zero credits", {
            zeroSince,
            elapsed,
          });
          return {
            shouldWake: true,
            message: `Dead: zero credits for ${Math.round(elapsed / 60_000)} minutes. Need funding.`,
          };
        }
      }
    } else {
      // Credits are above zero — clear the grace period timer
      taskCtx.db.deleteKV("zero_credits_since");
    }

    if (prevTier && prevTier !== tier && tier === "critical") {
      return {
        shouldWake: true,
        message: `Credits dropped to ${tier} tier: $${(credits / 100).toFixed(2)}`,
      };
    }

    return { shouldWake: false };
  },

  check_wallet_balance: async (ctx: TickContext, taskCtx: HeartbeatLegacyContext) => {
    const balance = ctx.walletBalance;
    const now = new Date().toISOString();

    taskCtx.db.setKV("last_wallet_balance_check", JSON.stringify({
      balance,
      credits: ctx.creditBalance,
      tier: ctx.survivalTier,
      timestamp: now,
    }));

    if (ctx.survivalTier === "critical" && balance > 0) {
      return {
        shouldWake: true,
        message: `Wallet balance available (${balance.toFixed(4)} TOS) while credits are critically low.`,
      };
    }

    return { shouldWake: false };
  },

  retry_settlement_callbacks: async (_ctx: TickContext, taskCtx: HeartbeatLegacyContext) => {
    const settlementConfig = taskCtx.config.settlement;
    if (
      !settlementConfig?.enabled ||
      !settlementConfig.callbacks.enabled ||
      !taskCtx.config.rpcUrl
    ) {
      return { shouldWake: false };
    }

    const privateKey = loadWalletPrivateKey();
    if (!privateKey) {
      taskCtx.db.setKV(
        "last_settlement_callback_retry",
        JSON.stringify({
          status: "skipped",
          reason: "wallet_missing",
          at: new Date().toISOString(),
        }),
      );
      return { shouldWake: false };
    }

    const dispatcher = createNativeSettlementCallbackDispatcher({
      db: taskCtx.db,
      rpcUrl: taskCtx.config.rpcUrl,
      privateKey,
      config: settlementConfig.callbacks,
    });
    const result = await dispatcher.retryPending();
    taskCtx.db.setKV(
      "last_settlement_callback_retry",
      JSON.stringify({
        ...result,
        at: new Date().toISOString(),
      }),
    );
    return {
      shouldWake: result.failed > 0,
      message:
        result.failed > 0
          ? `Settlement callbacks have ${result.failed} failed item(s).`
          : undefined,
    };
  },

  retry_market_contract_callbacks: async (_ctx: TickContext, taskCtx: HeartbeatLegacyContext) => {
    const marketConfig = taskCtx.config.marketContracts;
    if (!marketConfig?.enabled || !taskCtx.config.rpcUrl) {
      return { shouldWake: false };
    }

    const privateKey = loadWalletPrivateKey();
    if (!privateKey) {
      taskCtx.db.setKV(
        "last_market_contract_retry",
        JSON.stringify({
          status: "skipped",
          reason: "wallet_missing",
          at: new Date().toISOString(),
        }),
      );
      return { shouldWake: false };
    }

    const dispatcher = createMarketContractDispatcher({
      db: taskCtx.db,
      rpcUrl: taskCtx.config.rpcUrl,
      privateKey,
      config: marketConfig,
    });
    const result = await dispatcher.retryPending();
    taskCtx.db.setKV(
      "last_market_contract_retry",
      JSON.stringify({
        ...result,
        at: new Date().toISOString(),
      }),
    );
    return {
      shouldWake: result.failed > 0,
      message:
        result.failed > 0
          ? `Market contract callbacks have ${result.failed} failed item(s).`
          : undefined,
    };
  },

  retry_x402_payments: async (_ctx: TickContext, taskCtx: HeartbeatLegacyContext) => {
    const x402Config = taskCtx.config.x402Server;
    if (!x402Config?.enabled || !taskCtx.config.rpcUrl) {
      return { shouldWake: false };
    }

    const paymentManager = createX402PaymentManager({
      db: taskCtx.db,
      rpcUrl: taskCtx.config.rpcUrl,
      config: x402Config,
    });
    const result = await paymentManager.retryPending();
    taskCtx.db.setKV(
      "last_x402_payment_retry",
      JSON.stringify({
        ...result,
        at: new Date().toISOString(),
      }),
    );
    return {
      shouldWake: result.failed > 0,
      message:
        result.failed > 0
          ? `x402 payments have ${result.failed} failed item(s).`
          : undefined,
    };
  },

  audit_storage_leases: async (_ctx: TickContext, taskCtx: HeartbeatLegacyContext) => {
    const storageConfig = taskCtx.config.storage;
    if (!storageConfig?.enabled || !storageConfig.leaseHealth.autoAudit) {
      return { shouldWake: false };
    }
    const activeLeases = taskCtx.db.listStorageLeases(200, { status: "active" });
    const auditIntervalMs = storageConfig.leaseHealth.auditIntervalSeconds * 1000;
    let processed = 0;
    let failed = 0;
    for (const lease of activeLeases) {
      const latestAudit = taskCtx.db.listStorageAudits(1, { leaseId: lease.leaseId })[0];
      if (
        latestAudit &&
        Date.now() - new Date(latestAudit.checkedAt).getTime() < auditIntervalMs
      ) {
        continue;
      }
      const audit = await auditLocalStorageLease({ lease });
      taskCtx.db.upsertStorageAudit(audit);
      processed += 1;
      if (audit.status === "failed") failed += 1;
    }
    taskCtx.db.setKV(
      "last_storage_lease_audit",
      JSON.stringify({
        processed,
        failed,
        at: new Date().toISOString(),
      }),
    );
    return {
      shouldWake: failed > 0,
      message:
        failed > 0
          ? `Storage audits detected ${failed} failed lease(s).`
          : undefined,
    };
  },

  renew_storage_leases: async (_ctx: TickContext, taskCtx: HeartbeatLegacyContext) => {
    const storageConfig = taskCtx.config.storage;
    if (!storageConfig?.leaseHealth.autoRenew) {
      return { shouldWake: false };
    }
    const { account } = await getWallet();
    const activeLeases = taskCtx.db.listStorageLeases(200, {
      status: "active",
      requesterAddress: taskCtx.identity.address,
    });
    let renewed = 0;
    let failed = 0;
    for (const lease of activeLeases) {
      const renewalLeadMs = storageConfig.leaseHealth.renewalLeadSeconds * 1000;
      const expiresMs = new Date(lease.receipt.expiresAt).getTime();
      if (expiresMs - Date.now() > renewalLeadMs) continue;
      try {
        await renewTrackedLease({
          lease,
          requesterAccount: account as any,
          requesterAddress: taskCtx.identity.address,
          ttlSeconds: storageConfig.defaultTtlSeconds,
          db: taskCtx.db,
        });
        renewed += 1;
      } catch (error) {
        failed += 1;
        logger.warn(
          `Failed to renew storage lease ${lease.leaseId}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    taskCtx.db.setKV(
      "last_storage_lease_renewal",
      JSON.stringify({
        renewed,
        failed,
        at: new Date().toISOString(),
      }),
    );
    return {
      shouldWake: failed > 0,
      message:
        failed > 0
          ? `Storage renewals have ${failed} failed item(s).`
          : undefined,
    };
  },

  replicate_storage_leases: async (_ctx: TickContext, taskCtx: HeartbeatLegacyContext) => {
    const storageConfig = taskCtx.config.storage;
    if (
      !storageConfig?.replication.enabled ||
      !storageConfig.leaseHealth.autoReplicate ||
      storageConfig.replication.targetCopies <= 1
    ) {
      return { shouldWake: false };
    }
    const { account } = await getWallet();
    const activeLeases = taskCtx.db.listStorageLeases(500, {
      status: "active",
      requesterAddress: taskCtx.identity.address,
    });
    const byCid = new Map<string, typeof activeLeases>();
    for (const lease of activeLeases) {
      const items = byCid.get(lease.cid) ?? [];
      items.push(lease);
      byCid.set(lease.cid, items);
    }
    let replicated = 0;
    let failed = 0;
    for (const [cid, leases] of byCid.entries()) {
      const currentProviders = new Set(
        leases
          .map((item) => item.providerBaseUrl?.replace(/\/+$/, ""))
          .filter((value): value is string => Boolean(value)),
      );
      const targetCopies = Math.max(
        1,
        storageConfig.replication.targetCopies,
      );
      if (leases.length >= targetCopies) continue;
      const sourceLease = leases[0];
      if (!sourceLease) continue;
      for (const providerBaseUrl of storageConfig.replication.providerBaseUrls) {
        const normalized = providerBaseUrl.replace(/\/+$/, "");
        if (currentProviders.has(normalized)) continue;
        try {
          const record = await replicateTrackedLease({
            sourceLease,
            targetProviderBaseUrl: normalized,
            requesterAccount: account as any,
            requesterAddress: taskCtx.identity.address,
            ttlSeconds: storageConfig.defaultTtlSeconds,
            db: taskCtx.db,
          });
          currentProviders.add(record.providerBaseUrl || normalized);
          replicated += 1;
          if (currentProviders.size >= targetCopies) break;
        } catch (error) {
          failed += 1;
          logger.warn(
            `Failed to replicate storage lease ${sourceLease.leaseId} for ${cid}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
    }
    taskCtx.db.setKV(
      "last_storage_replication",
      JSON.stringify({
        replicated,
        failed,
        at: new Date().toISOString(),
      }),
    );
    return {
      shouldWake: failed > 0,
      message:
        failed > 0
          ? `Storage replication has ${failed} failed item(s).`
          : undefined,
    };
  },

  check_social_inbox: async (_ctx: TickContext, taskCtx: HeartbeatLegacyContext) => {
    if (!taskCtx.social) return { shouldWake: false };

    // If we've recently encountered an error polling the inbox, back off.
    const backoffUntil = taskCtx.db.getKV("social_inbox_backoff_until");
    if (backoffUntil && new Date(backoffUntil) > new Date()) {
      return { shouldWake: false };
    }

    const cursor = taskCtx.db.getKV("social_inbox_cursor") || undefined;

    let messages: any[] = [];
    let nextCursor: string | undefined;

    try {
      const result = await taskCtx.social.poll(cursor);
      messages = result.messages;
      nextCursor = result.nextCursor;

      // Clear previous error/backoff on success.
      taskCtx.db.deleteKV("last_social_inbox_error");
      taskCtx.db.deleteKV("social_inbox_backoff_until");
    } catch (err: any) {
      taskCtx.db.setKV(
        "last_social_inbox_error",
        JSON.stringify({
          message: err?.message || String(err),
          stack: err?.stack,
          timestamp: new Date().toISOString(),
        }),
      );
      // 5-minute backoff to avoid spamming errors on transient network failures.
      taskCtx.db.setKV(
        "social_inbox_backoff_until",
        new Date(Date.now() + 300_000).toISOString(),
      );
      return { shouldWake: false };
    }

    if (nextCursor) taskCtx.db.setKV("social_inbox_cursor", nextCursor);

    if (!messages || messages.length === 0) return { shouldWake: false };

    // Persist to inbox_messages table for deduplication
    // Sanitize content before DB insertion
    let newCount = 0;
    for (const msg of messages) {
      const existing = taskCtx.db.getKV(`inbox_seen_${msg.id}`);
      if (!existing) {
        const sanitizedFrom = sanitizeInput(msg.from, msg.from, "social_address");
        const sanitizedContent = sanitizeInput(msg.content, msg.from, "social_message");
        const sanitizedMsg = {
          ...msg,
          from: sanitizedFrom.content,
          content: sanitizedContent.content,
        };
        taskCtx.db.insertInboxMessage(sanitizedMsg);
        taskCtx.db.setKV(`inbox_seen_${msg.id}`, "1");
        // Only count non-blocked messages toward wake threshold —
        // blocked messages are stored for audit but should not wake
        // the agent (prevents injection spam from draining credits).
        if (!sanitizedContent.blocked) {
          newCount++;
        }
      }
    }

    if (newCount === 0) return { shouldWake: false };

    return {
      shouldWake: true,
      message: `${newCount} new message(s) from: ${messages.map((m) => m.from.slice(0, 10)).join(", ")}`,
    };
  },

  check_for_updates: async (_ctx: TickContext, taskCtx: HeartbeatLegacyContext) => {
    try {
      const { checkUpstream, getRepoInfo } = await import("../self-mod/upstream.js");
      const repo = getRepoInfo();
      const upstream = checkUpstream();
      taskCtx.db.setKV("upstream_status", JSON.stringify({
        ...upstream,
        ...repo,
        checkedAt: new Date().toISOString(),
      }));
      if (upstream.behind > 0) {
        // Only wake if the commit count changed since last check
        const prevBehind = taskCtx.db.getKV("upstream_prev_behind");
        const behindStr = String(upstream.behind);
        if (prevBehind !== behindStr) {
          taskCtx.db.setKV("upstream_prev_behind", behindStr);
          return {
            shouldWake: true,
            message: `${upstream.behind} new commit(s) on origin/main. Review with review_upstream_changes, then cherry-pick what you want with pull_upstream.`,
          };
        }
      } else {
        taskCtx.db.deleteKV("upstream_prev_behind");
      }
      return { shouldWake: false };
    } catch (err: any) {
      // Not a git repo or no remote -- silently skip
      taskCtx.db.setKV("upstream_status", JSON.stringify({
        error: err.message,
        checkedAt: new Date().toISOString(),
      }));
      return { shouldWake: false };
    }
  },

  // === Phase 2.1: Soul Reflection ===
  soul_reflection: async (_ctx: TickContext, taskCtx: HeartbeatLegacyContext) => {
    try {
      const { reflectOnSoul } = await import("../soul/reflection.js");
      const reflection = await reflectOnSoul(taskCtx.db.raw);

      taskCtx.db.setKV("last_soul_reflection", JSON.stringify({
        alignment: reflection.currentAlignment,
        autoUpdated: reflection.autoUpdated,
        suggestedUpdates: reflection.suggestedUpdates.length,
        timestamp: new Date().toISOString(),
      }));

      // Wake if alignment is low or there are suggested updates
      if (reflection.suggestedUpdates.length > 0 || reflection.currentAlignment < 0.3) {
        return {
          shouldWake: true,
          message: `Soul reflection: alignment=${reflection.currentAlignment.toFixed(2)}, ${reflection.suggestedUpdates.length} suggested update(s)`,
        };
      }

      return { shouldWake: false };
    } catch (error) {
      logger.error("soul_reflection failed", error instanceof Error ? error : undefined);
      return { shouldWake: false };
    }
  },

  // === Phase 2.3: Model Registry Refresh ===
  refresh_models: async (_ctx: TickContext, taskCtx: HeartbeatLegacyContext) => {
    try {
      const models = await taskCtx.runtime.listModels();
      if (models.length > 0) {
        const { ModelRegistry } = await import("../inference/registry.js");
        const registry = new ModelRegistry(taskCtx.db.raw);
        registry.initialize(); // seed if empty
        registry.refreshFromApi(models);
        taskCtx.db.setKV("last_model_refresh", JSON.stringify({
          count: models.length,
          timestamp: new Date().toISOString(),
        }));
      }
    } catch (error) {
      logger.error("refresh_models failed", error instanceof Error ? error : undefined);
    }
    return { shouldWake: false };
  },

  // === Phase 3.1: Child Health Check ===
  check_child_health: async (_ctx: TickContext, taskCtx: HeartbeatLegacyContext) => {
    try {
      const { ChildLifecycle } = await import("../replication/lifecycle.js");
      const { ChildHealthMonitor } = await import("../replication/health.js");
      const lifecycle = new ChildLifecycle(taskCtx.db.raw);
      const monitor = new ChildHealthMonitor(taskCtx.db.raw, taskCtx.runtime, lifecycle);
      const results = await monitor.checkAllChildren();

      const unhealthy = results.filter((r) => !r.healthy);
      if (unhealthy.length > 0) {
        for (const r of unhealthy) {
          logger.warn(`Child ${r.childId} unhealthy: ${r.issues.join(", ")}`);
        }
        return {
          shouldWake: true,
          message: `${unhealthy.length} child(ren) unhealthy: ${unhealthy.map((r) => r.childId.slice(0, 8)).join(", ")}`,
        };
      }
    } catch (error) {
      logger.error("check_child_health failed", error instanceof Error ? error : undefined);
    }
    return { shouldWake: false };
  },

  // === Phase 3.1: Prune Dead Children ===
  prune_dead_children: async (_ctx: TickContext, taskCtx: HeartbeatLegacyContext) => {
    try {
      const { ChildLifecycle } = await import("../replication/lifecycle.js");
      const { SandboxCleanup } = await import("../replication/cleanup.js");
      const { pruneDeadChildren } = await import("../replication/lineage.js");
      const lifecycle = new ChildLifecycle(taskCtx.db.raw);
      const cleanup = new SandboxCleanup(taskCtx.runtime, lifecycle, taskCtx.db.raw);
      const pruned = await pruneDeadChildren(taskCtx.db, cleanup);
      if (pruned > 0) {
        logger.info(`Pruned ${pruned} dead children`);
      }
    } catch (error) {
      logger.error("prune_dead_children failed", error instanceof Error ? error : undefined);
    }
    return { shouldWake: false };
  },

  health_check: async (_ctx: TickContext, taskCtx: HeartbeatLegacyContext) => {
    // Check that the sandbox is healthy
    try {
      const result = await taskCtx.runtime.exec("echo alive", 5000);
      if (result.exitCode !== 0) {
        // Only wake on first failure, not repeated failures
        const prevStatus = taskCtx.db.getKV("health_check_status");
        if (prevStatus !== "failing") {
          taskCtx.db.setKV("health_check_status", "failing");
          return {
            shouldWake: true,
            message: "Health check failed: sandbox exec returned non-zero",
          };
        }
        return { shouldWake: false };
      }
    } catch (err: any) {
      // Only wake on first failure, not repeated failures
      const prevStatus = taskCtx.db.getKV("health_check_status");
      if (prevStatus !== "failing") {
        taskCtx.db.setKV("health_check_status", "failing");
        return {
          shouldWake: true,
          message: `Health check failed: ${err.message}`,
        };
      }
      return { shouldWake: false };
    }

    // Health check passed — clear failure state
    taskCtx.db.setKV("health_check_status", "ok");
    taskCtx.db.setKV("last_health_check", new Date().toISOString());
    return { shouldWake: false };
  },

  // === Phase 4.1: Metrics Reporting ===
  report_metrics: async (ctx: TickContext, taskCtx: HeartbeatLegacyContext) => {
    try {
      const metrics = getMetrics();
      const alerts = getAlertEngine();

      // Update gauges from tick context
      metrics.gauge("balance_cents", ctx.creditBalance);
      metrics.gauge("survival_tier", tierToInt(ctx.survivalTier));

      // Evaluate alerts
      const firedAlerts = alerts.evaluate(metrics);

      // Save snapshot to DB
      metricsInsertSnapshot(taskCtx.db.raw, {
        id: ulid(),
        snapshotAt: new Date().toISOString(),
        metricsJson: JSON.stringify(metrics.getAll()),
        alertsJson: JSON.stringify(firedAlerts),
        createdAt: new Date().toISOString(),
      });

      // Prune old snapshots (keep 7 days)
      metricsPruneOld(taskCtx.db.raw, 7);

      // Log alerts
      for (const alert of firedAlerts) {
        logger.warn(`Alert: ${alert.rule} - ${alert.message}`, { alert });
      }

      return {
        shouldWake: firedAlerts.some((a) => a.severity === "critical"),
        message: firedAlerts.length ? `${firedAlerts.length} alerts fired` : undefined,
      };
    } catch (error) {
      logger.error("report_metrics failed", error instanceof Error ? error : undefined);
      return { shouldWake: false };
    }
  },

  colony_health_check: async (_ctx: TickContext, taskCtx: HeartbeatLegacyContext) => {
    if (!shouldRunAtInterval(taskCtx, "colony_health_check", COLONY_TASK_INTERVALS_MS.colony_health_check)) {
      return { shouldWake: false };
    }

    try {
      const monitor = await createHealthMonitor(taskCtx);
      const report = await monitor.checkAll();
      const actions = await monitor.autoHeal(report);

      taskCtx.db.setKV("last_colony_health_report", JSON.stringify(report));
      taskCtx.db.setKV("last_colony_heal_actions", JSON.stringify({
        timestamp: new Date().toISOString(),
        actions,
      }));

      const failedActions = actions.filter((action) => !action.success).length;
      const shouldWake = report.unhealthyAgents > 0 || failedActions > 0;

      return {
        shouldWake,
        message: shouldWake
          ? `Colony health: ${report.unhealthyAgents} unhealthy, ${actions.length} heal action(s), ${failedActions} failed`
          : undefined,
      };
    } catch (error) {
      logger.error("colony_health_check failed", error instanceof Error ? error : undefined);
      return { shouldWake: false };
    }
  },

  colony_financial_report: async (_ctx: TickContext, taskCtx: HeartbeatLegacyContext) => {
    if (!shouldRunAtInterval(taskCtx, "colony_financial_report", COLONY_TASK_INTERVALS_MS.colony_financial_report)) {
      return { shouldWake: false };
    }

    try {
      const transactions = taskCtx.db.getRecentTransactions(5000);
      let revenueCents = 0;
      let expenseCents = 0;

      for (const tx of transactions) {
        const amount = Math.max(0, Math.floor(tx.amountCents ?? 0));
        if (amount === 0) continue;

        if (tx.type === "transfer_in" || tx.type === "credit_purchase") {
          revenueCents += amount;
          continue;
        }

        if (
          tx.type === "inference"
          || tx.type === "tool_use"
          || tx.type === "transfer_out"
          || tx.type === "funding_request"
        ) {
          expenseCents += amount;
        }
      }

      const childFunding = taskCtx.db.raw
        .prepare("SELECT COALESCE(SUM(funded_amount_cents), 0) AS total FROM children")
        .get() as { total: number };

      const taskCosts = taskCtx.db.raw
        .prepare(
          `SELECT COALESCE(SUM(actual_cost_cents), 0) AS total
           FROM task_graph
           WHERE status IN ('completed', 'failed', 'cancelled')`,
        )
        .get() as { total: number };

      const report = {
        timestamp: new Date().toISOString(),
        revenueCents,
        expenseCents,
        netCents: revenueCents - expenseCents,
        fundedToChildrenCents: childFunding.total,
        taskExecutionCostCents: taskCosts.total,
        activeAgents: taskCtx.db.getChildren().filter(
          (child) => child.status !== "dead" && child.status !== "cleaned_up",
        ).length,
      };

      taskCtx.db.setKV("last_colony_financial_report", JSON.stringify(report));
      return { shouldWake: false };
    } catch (error) {
      logger.error("colony_financial_report failed", error instanceof Error ? error : undefined);
      return { shouldWake: false };
    }
  },

  agent_pool_optimize: async (_ctx: TickContext, taskCtx: HeartbeatLegacyContext) => {
    if (!shouldRunAtInterval(taskCtx, "agent_pool_optimize", COLONY_TASK_INTERVALS_MS.agent_pool_optimize)) {
      return { shouldWake: false };
    }

    try {
      const IDLE_CULL_MS = 60 * 60 * 1000;
      const now = Date.now();
      const children = taskCtx.db.getChildren();

      const activeAssignments = taskCtx.db.raw
        .prepare(
          `SELECT DISTINCT assigned_to AS address
           FROM task_graph
           WHERE assigned_to IS NOT NULL
             AND status IN ('assigned', 'running')`,
        )
        .all() as Array<{ address: string }>;

      const busyAgents = new Set(
        activeAssignments
          .map((row) => row.address)
          .filter((value): value is string => typeof value === "string" && value.length > 0),
      );

      let culled = 0;
      for (const child of children) {
        if (!["running", "healthy", "sleeping"].includes(child.status)) continue;
        if (busyAgents.has(child.address)) continue;

        const lastSeenIso = child.lastChecked ?? child.createdAt;
        const lastSeenMs = Date.parse(lastSeenIso);
        if (Number.isNaN(lastSeenMs)) continue;
        if (now - lastSeenMs < IDLE_CULL_MS) continue;

        taskCtx.db.updateChildStatus(child.id, "stopped");
        culled += 1;
      }

      const pendingUnassignedRow = taskCtx.db.raw
        .prepare(
          `SELECT COUNT(*) AS count
           FROM task_graph
           WHERE status = 'pending'
             AND assigned_to IS NULL`,
        )
        .get() as { count: number };

      const idleAgents = children.filter(
        (child) =>
          (child.status === "running" || child.status === "healthy")
          && !busyAgents.has(child.address),
      ).length;

      const activeAgents = children.filter(
        (child) => child.status !== "dead" && child.status !== "cleaned_up" && child.status !== "failed",
      ).length;

      const spawnNeeded = Math.max(0, pendingUnassignedRow.count - idleAgents);
      const spawnCapacity = Math.max(0, taskCtx.config.maxChildren - activeAgents);
      const spawnRequested = Math.min(spawnNeeded, spawnCapacity);

      taskCtx.db.setKV("last_agent_pool_optimize", JSON.stringify({
        timestamp: new Date().toISOString(),
        culled,
        pendingTasks: pendingUnassignedRow.count,
        idleAgents,
        spawnRequested,
      }));

      if (spawnRequested > 0) {
        taskCtx.db.setKV("agent_pool_spawn_request", JSON.stringify({
          timestamp: new Date().toISOString(),
          requested: spawnRequested,
          pendingTasks: pendingUnassignedRow.count,
          idleAgents,
        }));
      }

      return {
        shouldWake: spawnRequested > 0,
        message: spawnRequested > 0
          ? `Agent pool needs ${spawnRequested} additional agent(s) for pending workload`
          : undefined,
      };
    } catch (error) {
      logger.error("agent_pool_optimize failed", error instanceof Error ? error : undefined);
      return { shouldWake: false };
    }
  },

  knowledge_store_prune: async (_ctx: TickContext, taskCtx: HeartbeatLegacyContext) => {
    if (!shouldRunAtInterval(taskCtx, "knowledge_store_prune", COLONY_TASK_INTERVALS_MS.knowledge_store_prune)) {
      return { shouldWake: false };
    }

    try {
      const { KnowledgeStore } = await import("../memory/knowledge-store.js");
      const knowledgeStore = new KnowledgeStore(taskCtx.db.raw);
      const pruned = knowledgeStore.prune();

      taskCtx.db.setKV("last_knowledge_store_prune", JSON.stringify({
        timestamp: new Date().toISOString(),
        pruned,
      }));

      return { shouldWake: false };
    } catch (error) {
      logger.error("knowledge_store_prune failed", error instanceof Error ? error : undefined);
      return { shouldWake: false };
    }
  },

  dead_agent_cleanup: async (_ctx: TickContext, taskCtx: HeartbeatLegacyContext) => {
    if (!shouldRunAtInterval(taskCtx, "dead_agent_cleanup", COLONY_TASK_INTERVALS_MS.dead_agent_cleanup)) {
      return { shouldWake: false };
    }

    try {
      const { ChildLifecycle } = await import("../replication/lifecycle.js");
      const { SandboxCleanup } = await import("../replication/cleanup.js");
      const { pruneDeadChildren } = await import("../replication/lineage.js");

      const lifecycle = new ChildLifecycle(taskCtx.db.raw);
      const cleanup = new SandboxCleanup(taskCtx.runtime, lifecycle, taskCtx.db.raw);
      const cleaned = await pruneDeadChildren(taskCtx.db, cleanup);

      taskCtx.db.setKV("last_dead_agent_cleanup", JSON.stringify({
        timestamp: new Date().toISOString(),
        cleaned,
      }));

      return { shouldWake: false };
    } catch (error) {
      logger.error("dead_agent_cleanup failed", error instanceof Error ? error : undefined);
      return { shouldWake: false };
    }
  },
};

function tierToInt(tier: SurvivalTier): number {
  const map: Record<SurvivalTier, number> = {
    dead: 0,
    critical: 1,
    low_compute: 2,
    normal: 3,
    high: 4,
  };
  return map[tier] ?? 0;
}

function shouldRunAtInterval(
  taskCtx: HeartbeatLegacyContext,
  taskName: string,
  intervalMs: number,
): boolean {
  const key = `heartbeat.last_run.${taskName}`;
  const now = Date.now();
  const lastRun = taskCtx.db.getKV(key);

  if (lastRun) {
    const lastRunMs = Date.parse(lastRun);
    if (!Number.isNaN(lastRunMs) && now - lastRunMs < intervalMs) {
      return false;
    }
  }

  taskCtx.db.setKV(key, new Date(now).toISOString());
  return true;
}

async function createHealthMonitor(taskCtx: HeartbeatLegacyContext): Promise<ColonyHealthMonitor> {
  const { LocalDBTransport, ColonyMessaging } = await import("../orchestration/messaging.js");
  const { SimpleAgentTracker, SimpleFundingProtocol } = await import("../orchestration/simple-tracker.js");
  const { HealthMonitor } = await import("../orchestration/health-monitor.js");

  const tracker = new SimpleAgentTracker(taskCtx.db);
  const funding = new SimpleFundingProtocol(taskCtx.runtime, taskCtx.identity, taskCtx.db);
  const transport = new LocalDBTransport(taskCtx.db);
  const messaging = new ColonyMessaging(transport, taskCtx.db);

  return new HealthMonitor(taskCtx.db, tracker, funding, messaging);
}
