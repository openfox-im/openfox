/**
 * Reactor Heartbeat Tasks
 *
 * Periodic tasks that run the reactor's time-driven operations:
 * - Expire stale governance proposals
 * - Reset expired budget periods
 * - Sync treasury balances from on-chain
 * - Publish pending chain state commitments
 * - Run federation sync cycle and flush outbound broadcasts
 *
 * Each task follows the existing HeartbeatTaskFn pattern and is
 * registered in REACTOR_TASKS for inclusion in BUILTIN_TASKS.
 */

import type {
  TickContext,
  HeartbeatLegacyContext,
  HeartbeatTaskFn,
} from "../types.js";
import { createLogger } from "../observability/logger.js";

const logger = createLogger("heartbeat.reactor");

// ─── Reactor Tasks ──────────────────────────────────────────────

export const REACTOR_TASKS: Record<string, HeartbeatTaskFn> = {
  /**
   * Expire stale governance proposals across all groups.
   * Runs every ~60s via cron.
   */
  reactor_expire_proposals: async (
    _ctx: TickContext,
    taskCtx: HeartbeatLegacyContext,
  ) => {
    try {
      const { expireStaleProposals } = await import(
        "../group/governance.js"
      );
      const { loadWalletPrivateKey } = await import(
        "../identity/wallet.js"
      );
      const { privateKeyToAccount } = await import("tosdk");

      const privateKey = loadWalletPrivateKey();
      if (!privateKey) {
        return { shouldWake: false };
      }
      const account = privateKeyToAccount(privateKey as `0x${string}`);

      // Find all groups with active proposals
      const groupRows = taskCtx.db.raw
        .prepare(
          `SELECT DISTINCT group_id FROM group_governance_proposals
           WHERE status = 'active' AND expires_at <= datetime('now')`,
        )
        .all() as Array<{ group_id: string }>;

      let totalExpired = 0;

      for (const row of groupRows) {
        try {
          const expired = await expireStaleProposals(
            taskCtx.db,
            row.group_id,
            account,
            taskCtx.identity.address,
          );
          totalExpired += expired.length;
        } catch (err) {
          logger.warn(
            `failed to expire proposals for group ${row.group_id}: ${err}`,
          );
        }
      }

      if (totalExpired > 0) {
        logger.info(`expired ${totalExpired} stale proposal(s)`);
      }

      return { shouldWake: false };
    } catch (err) {
      logger.error(
        "reactor_expire_proposals failed",
        err instanceof Error ? err : undefined,
      );
      return { shouldWake: false };
    }
  },

  /**
   * Reset expired budget periods across all groups with treasury.
   * Runs every ~60s via cron.
   */
  reactor_reset_budgets: async (
    _ctx: TickContext,
    taskCtx: HeartbeatLegacyContext,
  ) => {
    try {
      const { resetExpiredBudgetPeriods } = await import(
        "../group/treasury.js"
      );

      // Find all groups with active treasury
      const groupRows = taskCtx.db.raw
        .prepare(
          `SELECT group_id FROM group_treasury WHERE status = 'active'`,
        )
        .all() as Array<{ group_id: string }>;

      let totalReset = 0;

      for (const row of groupRows) {
        try {
          const count = resetExpiredBudgetPeriods(taskCtx.db, row.group_id);
          totalReset += count;
        } catch (err) {
          logger.warn(
            `failed to reset budgets for group ${row.group_id}: ${err}`,
          );
        }
      }

      if (totalReset > 0) {
        logger.info(`reset ${totalReset} expired budget period(s)`);
      }

      return { shouldWake: false };
    } catch (err) {
      logger.error(
        "reactor_reset_budgets failed",
        err instanceof Error ? err : undefined,
      );
      return { shouldWake: false };
    }
  },

  /**
   * Sync treasury balances from on-chain for all groups with active treasury.
   * Runs every ~60s via cron.
   */
  reactor_sync_treasury: async (
    _ctx: TickContext,
    taskCtx: HeartbeatLegacyContext,
  ) => {
    try {
      const rpcUrl = taskCtx.config.rpcUrl;
      if (!rpcUrl) {
        return { shouldWake: false };
      }

      const { ChainRpcClient } = await import("../chain/client.js");

      // Find all groups with active treasury
      const treasuryRows = taskCtx.db.raw
        .prepare(
          `SELECT group_id, treasury_address, balance_wei
           FROM group_treasury WHERE status = 'active'`,
        )
        .all() as Array<{
        group_id: string;
        treasury_address: string;
        balance_wei: string;
      }>;

      if (treasuryRows.length === 0) {
        return { shouldWake: false };
      }

      const client = new ChainRpcClient({ rpcUrl });
      let synced = 0;

      for (const row of treasuryRows) {
        try {
          const onChainBalance = await client.getBalance(
            row.treasury_address as any,
          );
          const onChainWei = onChainBalance.toString();

          if (onChainWei !== row.balance_wei) {
            const now = new Date().toISOString();
            taskCtx.db.raw
              .prepare(
                `UPDATE group_treasury
                 SET balance_wei = ?, last_synced_at = ?, updated_at = ?
                 WHERE group_id = ?`,
              )
              .run(onChainWei, now, now, row.group_id);

            // If on-chain balance is higher, record an inflow
            const previousBig = BigInt(row.balance_wei);
            const currentBig = BigInt(onChainWei);
            if (currentBig > previousBig) {
              const { recordTreasuryInflow } = await import(
                "../group/treasury.js"
              );
              const delta = (currentBig - previousBig).toString();
              try {
                recordTreasuryInflow(
                  taskCtx.db,
                  row.group_id,
                  delta,
                  undefined,
                  undefined,
                  "on-chain balance sync (detected external inflow)",
                );
              } catch {
                // Inflow recording is best-effort; balance was already updated
              }
            }

            synced++;
            logger.info(
              `synced treasury balance for ${row.group_id}: ${row.balance_wei} -> ${onChainWei}`,
            );
          }
        } catch (err) {
          logger.warn(
            `failed to sync treasury for group ${row.group_id}: ${err}`,
          );
        }
      }

      if (synced > 0) {
        logger.info(`synced ${synced} treasury balance(s)`);
      }

      return { shouldWake: false };
    } catch (err) {
      logger.error(
        "reactor_sync_treasury failed",
        err instanceof Error ? err : undefined,
      );
      return { shouldWake: false };
    }
  },

  /**
   * Publish pending chain state commitments for groups with on-chain anchoring.
   * Runs every ~5 minutes via cron.
   */
  reactor_chain_commitments: async (
    _ctx: TickContext,
    taskCtx: HeartbeatLegacyContext,
  ) => {
    try {
      const rpcUrl = taskCtx.config.rpcUrl;
      if (!rpcUrl) {
        return { shouldWake: false };
      }

      const { publishGroupStateCommitment } = await import(
        "../group/chain-anchor.js"
      );
      const { loadWalletPrivateKey } = await import(
        "../identity/wallet.js"
      );

      const privateKey = loadWalletPrivateKey();
      if (!privateKey) {
        return { shouldWake: false };
      }

      // Find groups that have been registered on-chain (have at least one commitment)
      // and whose epoch has advanced since the last commitment
      const groupRows = taskCtx.db.raw
        .prepare(
          `SELECT DISTINCT g.group_id, g.current_epoch
           FROM groups g
           INNER JOIN group_chain_commitments c ON c.group_id = g.group_id
           WHERE g.status = 'active'
             AND NOT EXISTS (
               SELECT 1 FROM group_chain_commitments c2
               WHERE c2.group_id = g.group_id AND c2.epoch = g.current_epoch
             )`,
        )
        .all() as Array<{ group_id: string; current_epoch: number }>;

      let published = 0;

      for (const row of groupRows) {
        try {
          await publishGroupStateCommitment({
            db: taskCtx.db,
            groupId: row.group_id,
            privateKey: privateKey as any,
            rpcUrl,
          });
          published++;
        } catch (err) {
          logger.warn(
            `failed to publish chain commitment for group ${row.group_id}: ${err}`,
          );
        }
      }

      if (published > 0) {
        logger.info(`published ${published} chain state commitment(s)`);
      }

      return { shouldWake: false };
    } catch (err) {
      logger.error(
        "reactor_chain_commitments failed",
        err instanceof Error ? err : undefined,
      );
      return { shouldWake: false };
    }
  },

  /**
   * Run federation sync cycle: pull events from peers and flush outbound queue.
   * Runs every ~5 minutes via cron.
   */
  reactor_federation_sync: async (
    _ctx: TickContext,
    taskCtx: HeartbeatLegacyContext,
  ) => {
    try {
      const {
        runWorldFederationSync,
        PeerWorldFederationTransport,
        listFederationPeers,
      } = await import("../metaworld/federation.js");

      // Check if we have any federation peers at all
      const peers = listFederationPeers(taskCtx.db);
      if (peers.length === 0) {
        return { shouldWake: false };
      }

      const transport = new PeerWorldFederationTransport();

      // 1. Pull inbound events from peers
      const syncResult = await runWorldFederationSync({
        db: taskCtx.db,
        transports: [transport],
      });

      // 2. Flush outbound broadcast queue
      const { ensureFederationOutboundTable, flushFederationOutbound } =
        await import("../metaworld/federation-outbound.js");

      ensureFederationOutboundTable(taskCtx.db);

      const flushResult = await flushFederationOutbound({
        db: taskCtx.db,
        transports: [transport],
      });

      if (syncResult.synced > 0 || flushResult.sent > 0) {
        logger.info(
          `federation sync: pulled ${syncResult.synced} event(s), pushed ${flushResult.sent} event(s)`,
        );
      }

      return { shouldWake: false };
    } catch (err) {
      logger.error(
        "reactor_federation_sync failed",
        err instanceof Error ? err : undefined,
      );
      return { shouldWake: false };
    }
  },
};
