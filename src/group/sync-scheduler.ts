/**
 * OpenFox Group Sync Scheduler
 *
 * Heartbeat integration for periodic group state sync.
 * Manages sync cursors per peer per group.
 */

import { createLogger } from "../observability/logger.js";
import type { OpenFoxDatabase } from "../types.js";
import { listGroups } from "./store.js";
import {
  buildGroupSyncOffer,
  buildGroupSyncBundle,
  applyGroupSyncBundle,
  updateSyncCursor,
  getSyncCursor,
  recordSyncError,
  listSyncPeers,
  type GroupSyncPeer,
} from "./sync.js";
import {
  createGroupSyncTransport,
  type GroupSyncTransport,
} from "./sync-transport.js";

const logger = createLogger("group-sync-scheduler");

// ─── Types ──────────────────────────────────────────────────────

export interface GroupSyncConfig {
  /** Whether sync is enabled */
  enabled: boolean;
  /** Interval between sync runs in seconds */
  intervalSeconds: number;
  /** Maximum number of groups to sync per run */
  maxGroupsPerRun: number;
  /** Maximum events per sync bundle */
  maxEventsPerBundle: number;
  /** Default transport kind */
  defaultTransportKind: "peer" | "gateway" | "relay" | "storage";
}

export const DEFAULT_GROUP_SYNC_CONFIG: GroupSyncConfig = {
  enabled: false,
  intervalSeconds: 60,
  maxGroupsPerRun: 10,
  maxEventsPerBundle: 500,
  defaultTransportKind: "peer",
};

export interface GroupSyncTaskResult {
  groupsSynced: number;
  totalApplied: number;
  totalSkipped: number;
  totalRejected: number;
  errors: Array<{ groupId: string; peerAddress: string; error: string }>;
}

// ─── Sync Task ──────────────────────────────────────────────────

/**
 * A heartbeat task that periodically syncs all joined groups.
 * Iterates over all local groups, finds registered peers for each,
 * and exchanges sync bundles.
 */
export async function runGroupSyncTask(
  db: OpenFoxDatabase,
  config: GroupSyncConfig = DEFAULT_GROUP_SYNC_CONFIG,
): Promise<GroupSyncTaskResult> {
  const result: GroupSyncTaskResult = {
    groupsSynced: 0,
    totalApplied: 0,
    totalSkipped: 0,
    totalRejected: 0,
    errors: [],
  };

  if (!config.enabled) {
    logger.info("Group sync is disabled, skipping");
    return result;
  }

  const groups = listGroups(db, config.maxGroupsPerRun);
  if (groups.length === 0) {
    logger.info("No groups to sync");
    return result;
  }

  logger.info(`Starting group sync for ${groups.length} groups`);

  for (const group of groups) {
    const peers = listSyncPeers(db, group.groupId);
    if (peers.length === 0) {
      continue;
    }

    let groupSynced = false;

    for (const peer of peers) {
      try {
        const syncResult = await syncGroupWithPeer(db, group.groupId, peer, config);
        result.totalApplied += syncResult.applied;
        result.totalSkipped += syncResult.skipped;
        result.totalRejected += syncResult.rejected;
        if (syncResult.applied > 0 || syncResult.skipped > 0) {
          groupSynced = true;
        }
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        logger.warn(
          `Sync failed for group ${group.groupId} with peer ${peer.peerAddress}: ${errorMsg}`,
        );
        recordSyncError(
          db,
          group.groupId,
          peer.peerAddress,
          peer.syncKind,
          errorMsg,
        );
        result.errors.push({
          groupId: group.groupId,
          peerAddress: peer.peerAddress,
          error: errorMsg,
        });
      }
    }

    if (groupSynced) {
      result.groupsSynced++;
    }
  }

  logger.info(
    `Group sync complete: ${result.groupsSynced} groups synced, ` +
      `${result.totalApplied} applied, ${result.totalSkipped} skipped, ` +
      `${result.totalRejected} rejected, ${result.errors.length} errors`,
  );

  return result;
}

// ─── Per-peer sync ──────────────────────────────────────────────

async function syncGroupWithPeer(
  db: OpenFoxDatabase,
  groupId: string,
  peer: GroupSyncPeer,
  config: GroupSyncConfig,
): Promise<{ applied: number; skipped: number; rejected: number }> {
  const transportKind = (peer.syncKind ?? config.defaultTransportKind) as
    | "peer"
    | "gateway"
    | "relay"
    | "storage";
  const transport = createGroupSyncTransport(transportKind);

  // Build our sync offer
  const offer = buildGroupSyncOffer(db, groupId);

  // Send offer and get bundle from peer
  const bundle = await transport.sendSyncOffer(peer.peerEndpoint, offer);
  if (!bundle || bundle.events.length === 0) {
    return { applied: 0, skipped: 0, rejected: 0 };
  }

  // Apply the received bundle
  const applyResult = applyGroupSyncBundle(db, groupId, bundle);

  // Update sync cursor if we applied any events
  if (applyResult.applied > 0 && bundle.events.length > 0) {
    const lastEvent = bundle.events[bundle.events.length - 1];
    updateSyncCursor(
      db,
      groupId,
      peer.peerAddress,
      transportKind,
      lastEvent.eventId,
    );
  }

  return {
    applied: applyResult.applied,
    skipped: applyResult.skipped,
    rejected: applyResult.rejected,
  };
}
