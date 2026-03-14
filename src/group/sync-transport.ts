/**
 * OpenFox Group Sync Transport Abstraction
 *
 * Defines transport interfaces and implementations for syncing
 * group state through different paths: peer-to-peer, gateway, storage.
 */

import { createLogger } from "../observability/logger.js";
import type {
  GroupSyncOffer,
  GroupSyncBundle,
  GroupSnapshot,
} from "./sync.js";

const logger = createLogger("group-sync-transport");

// ─── Transport Interface ────────────────────────────────────────

export interface GroupSyncTransport {
  readonly kind: "peer" | "gateway" | "relay" | "storage";

  sendSyncOffer(
    endpoint: string,
    offer: GroupSyncOffer,
  ): Promise<GroupSyncBundle | null>;

  receiveSyncBundle(
    endpoint: string,
    groupId: string,
    sinceEventId: string | null,
  ): Promise<GroupSyncBundle | null>;

  sendSnapshot(
    endpoint: string,
    snapshot: GroupSnapshot,
  ): Promise<{ cid?: string; ok: boolean }>;

  receiveSnapshot(
    endpoint: string,
    groupId: string,
  ): Promise<GroupSnapshot | null>;
}

// ─── Peer Transport ─────────────────────────────────────────────

/**
 * Direct HTTP peer-to-peer sync transport.
 * Sends/receives sync data directly to/from another OpenFox node.
 */
export class PeerGroupSyncTransport implements GroupSyncTransport {
  readonly kind = "peer" as const;

  async sendSyncOffer(
    endpoint: string,
    offer: GroupSyncOffer,
  ): Promise<GroupSyncBundle | null> {
    try {
      const url = `${endpoint}/group-sync/offer`;
      logger.info(`Sending sync offer to peer: ${url}`);
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(offer),
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) {
        logger.warn(
          `Peer sync offer rejected: ${response.status} ${response.statusText}`,
        );
        return null;
      }
      const bundle = (await response.json()) as GroupSyncBundle;
      return bundle;
    } catch (err) {
      logger.warn(
        `Peer sync offer failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }

  async receiveSyncBundle(
    endpoint: string,
    groupId: string,
    sinceEventId: string | null,
  ): Promise<GroupSyncBundle | null> {
    try {
      const url = `${endpoint}/group-sync/bundle`;
      logger.info(`Requesting sync bundle from peer: ${url}`);
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ groupId, sinceEventId }),
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) {
        logger.warn(
          `Peer sync bundle request failed: ${response.status} ${response.statusText}`,
        );
        return null;
      }
      return (await response.json()) as GroupSyncBundle;
    } catch (err) {
      logger.warn(
        `Peer sync bundle request failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }

  async sendSnapshot(
    endpoint: string,
    snapshot: GroupSnapshot,
  ): Promise<{ cid?: string; ok: boolean }> {
    try {
      const url = `${endpoint}/group-sync/snapshot`;
      logger.info(`Sending snapshot to peer: ${url}`);
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(snapshot),
        signal: AbortSignal.timeout(60_000),
      });
      if (!response.ok) {
        logger.warn(
          `Peer snapshot send failed: ${response.status} ${response.statusText}`,
        );
        return { ok: false };
      }
      return { ok: true };
    } catch (err) {
      logger.warn(
        `Peer snapshot send failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return { ok: false };
    }
  }

  async receiveSnapshot(
    endpoint: string,
    groupId: string,
  ): Promise<GroupSnapshot | null> {
    try {
      const url = `${endpoint}/group-sync/snapshot/${groupId}`;
      logger.info(`Requesting snapshot from peer: ${url}`);
      const response = await fetch(url, {
        method: "GET",
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(60_000),
      });
      if (!response.ok) {
        logger.warn(
          `Peer snapshot request failed: ${response.status} ${response.statusText}`,
        );
        return null;
      }
      return (await response.json()) as GroupSnapshot;
    } catch (err) {
      logger.warn(
        `Peer snapshot request failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }
}

// ─── Gateway Transport ──────────────────────────────────────────

/**
 * Sync through an existing Agent Gateway relay.
 * Routes sync messages through the gateway's relay infrastructure.
 */
export class GatewayGroupSyncTransport implements GroupSyncTransport {
  readonly kind = "gateway" as const;

  async sendSyncOffer(
    endpoint: string,
    offer: GroupSyncOffer,
  ): Promise<GroupSyncBundle | null> {
    try {
      const url = `${endpoint}/relay/group-sync/offer`;
      logger.info(`Sending sync offer via gateway: ${url}`);
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(offer),
        signal: AbortSignal.timeout(45_000),
      });
      if (!response.ok) return null;
      return (await response.json()) as GroupSyncBundle;
    } catch (err) {
      logger.warn(
        `Gateway sync offer failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }

  async receiveSyncBundle(
    endpoint: string,
    groupId: string,
    sinceEventId: string | null,
  ): Promise<GroupSyncBundle | null> {
    try {
      const url = `${endpoint}/relay/group-sync/bundle`;
      logger.info(`Requesting sync bundle via gateway: ${url}`);
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ groupId, sinceEventId }),
        signal: AbortSignal.timeout(45_000),
      });
      if (!response.ok) return null;
      return (await response.json()) as GroupSyncBundle;
    } catch (err) {
      logger.warn(
        `Gateway sync bundle request failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }

  async sendSnapshot(
    endpoint: string,
    snapshot: GroupSnapshot,
  ): Promise<{ cid?: string; ok: boolean }> {
    try {
      const url = `${endpoint}/relay/group-sync/snapshot`;
      logger.info(`Sending snapshot via gateway: ${url}`);
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(snapshot),
        signal: AbortSignal.timeout(60_000),
      });
      if (!response.ok) return { ok: false };
      return { ok: true };
    } catch (err) {
      logger.warn(
        `Gateway snapshot send failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return { ok: false };
    }
  }

  async receiveSnapshot(
    endpoint: string,
    groupId: string,
  ): Promise<GroupSnapshot | null> {
    try {
      const url = `${endpoint}/relay/group-sync/snapshot/${groupId}`;
      logger.info(`Requesting snapshot via gateway: ${url}`);
      const response = await fetch(url, {
        method: "GET",
        signal: AbortSignal.timeout(60_000),
      });
      if (!response.ok) return null;
      return (await response.json()) as GroupSnapshot;
    } catch (err) {
      logger.warn(
        `Gateway snapshot request failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }
}

// ─── Storage Transport ──────────────────────────────────────────

/**
 * Sync through the storage market.
 * Puts/gets snapshot bundles by CID through storage providers.
 */
export class StorageGroupSyncTransport implements GroupSyncTransport {
  readonly kind = "storage" as const;

  async sendSyncOffer(
    _endpoint: string,
    _offer: GroupSyncOffer,
  ): Promise<GroupSyncBundle | null> {
    // Storage transport does not support real-time sync offers.
    // Sync via storage is snapshot-based only.
    logger.info(
      "Storage transport does not support sync offers; use snapshot-based sync",
    );
    return null;
  }

  async receiveSyncBundle(
    _endpoint: string,
    _groupId: string,
    _sinceEventId: string | null,
  ): Promise<GroupSyncBundle | null> {
    // Storage transport does not support incremental bundles.
    logger.info(
      "Storage transport does not support incremental bundles; use snapshot-based sync",
    );
    return null;
  }

  async sendSnapshot(
    endpoint: string,
    snapshot: GroupSnapshot,
  ): Promise<{ cid?: string; ok: boolean }> {
    try {
      const url = `${endpoint}/storage/put`;
      logger.info(`Putting snapshot to storage: ${url}`);
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "group_snapshot",
          groupId: snapshot.groupId,
          snapshotId: snapshot.snapshotId,
          data: snapshot,
        }),
        signal: AbortSignal.timeout(60_000),
      });
      if (!response.ok) return { ok: false };
      const result = (await response.json()) as { cid?: string };
      return { cid: result.cid, ok: true };
    } catch (err) {
      logger.warn(
        `Storage snapshot put failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return { ok: false };
    }
  }

  async receiveSnapshot(
    endpoint: string,
    groupId: string,
  ): Promise<GroupSnapshot | null> {
    try {
      const url = `${endpoint}/storage/get?kind=group_snapshot&groupId=${encodeURIComponent(groupId)}`;
      logger.info(`Getting snapshot from storage: ${url}`);
      const response = await fetch(url, {
        method: "GET",
        signal: AbortSignal.timeout(60_000),
      });
      if (!response.ok) return null;
      const result = (await response.json()) as { data?: GroupSnapshot };
      return result.data ?? null;
    } catch (err) {
      logger.warn(
        `Storage snapshot get failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }
}

// ─── Factory ────────────────────────────────────────────────────

export function createGroupSyncTransport(
  kind: "peer" | "gateway" | "relay" | "storage",
): GroupSyncTransport {
  switch (kind) {
    case "peer":
      return new PeerGroupSyncTransport();
    case "gateway":
    case "relay":
      return new GatewayGroupSyncTransport();
    case "storage":
      return new StorageGroupSyncTransport();
    default:
      throw new Error(`Unknown sync transport kind: ${kind}`);
  }
}
