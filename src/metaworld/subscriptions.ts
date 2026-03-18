/**
 * World Subscriptions — notification preferences for feeds.
 *
 * Allows a fox to subscribe to specific event types from foxes,
 * groups, or boards. When activity matching a subscription occurs,
 * the system can generate targeted notifications.
 */

import { ulid } from "ulid";
import type { OpenFoxDatabase } from "../types.js";

export type SubscriptionFeedKind = "fox" | "group" | "board";
export type SubscriptionEventKind =
  | "announcement"
  | "message"
  | "bounty"
  | "artifact"
  | "settlement";

export interface WorldSubscriptionRecord {
  subscriptionId: string;
  subscriberAddress: string;
  feedKind: SubscriptionFeedKind;
  targetId: string;
  notifyOn: SubscriptionEventKind[];
  createdAt: string;
}

export interface SubscriptionActivityTarget {
  eventKind: SubscriptionEventKind | null;
  actorAddress?: string | null;
  groupId?: string | null;
  boardId?: string | null;
}

function normalizeAddressLike(value: string): string {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed.startsWith("0x")) {
    throw new Error(`invalid address-like value: ${value}`);
  }
  return trimmed;
}

function parseJsonSafe<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string" || value.trim().length === 0) {
    return fallback;
  }
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function mapSubscriptionRow(row: {
  subscription_id: string;
  subscriber_address: string;
  feed_kind: string;
  target_id: string;
  notify_on: string;
  created_at: string;
}): WorldSubscriptionRecord {
  return {
    subscriptionId: row.subscription_id,
    subscriberAddress: row.subscriber_address,
    feedKind: row.feed_kind as SubscriptionFeedKind,
    targetId: row.target_id,
    notifyOn: parseJsonSafe<SubscriptionEventKind[]>(row.notify_on, []),
    createdAt: row.created_at,
  };
}

export function subscribeToFeed(
  db: OpenFoxDatabase,
  params: {
    address: string;
    feedKind: SubscriptionFeedKind;
    targetId: string;
    notifyOn: SubscriptionEventKind[];
  },
): WorldSubscriptionRecord {
  const subscriberAddress = normalizeAddressLike(params.address);
  const feedKind = params.feedKind;
  const targetId = params.targetId.trim();
  if (!targetId) {
    throw new Error("targetId cannot be empty");
  }
  const validEventKinds: SubscriptionEventKind[] = [
    "announcement",
    "message",
    "bounty",
    "artifact",
    "settlement",
  ];
  for (const kind of params.notifyOn) {
    if (!validEventKinds.includes(kind)) {
      throw new Error(`invalid event kind: ${kind}`);
    }
  }

  const subscriptionId = ulid();
  const notifyOnJson = JSON.stringify(params.notifyOn);
  const createdAt = new Date().toISOString();

  db.raw
    .prepare(
      `INSERT INTO world_subscriptions (
         subscription_id, subscriber_address, feed_kind, target_id, notify_on, created_at
       ) VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(subscriptionId, subscriberAddress, feedKind, targetId, notifyOnJson, createdAt);

  return {
    subscriptionId,
    subscriberAddress,
    feedKind,
    targetId,
    notifyOn: params.notifyOn,
    createdAt,
  };
}

export function unsubscribe(
  db: OpenFoxDatabase,
  subscriptionId: string,
): boolean {
  const result = db.raw
    .prepare(`DELETE FROM world_subscriptions WHERE subscription_id = ?`)
    .run(subscriptionId);
  return result.changes > 0;
}

export function listSubscriptions(
  db: OpenFoxDatabase,
  address: string,
  options?: { feedKind?: SubscriptionFeedKind; limit?: number },
): WorldSubscriptionRecord[] {
  const subscriberAddress = normalizeAddressLike(address);
  const limit = Math.max(1, options?.limit ?? 50);

  if (options?.feedKind) {
    const rows = db.raw
      .prepare(
        `SELECT * FROM world_subscriptions
         WHERE subscriber_address = ? AND feed_kind = ?
         ORDER BY created_at DESC
         LIMIT ?`,
      )
      .all(subscriberAddress, options.feedKind, limit) as Array<{
      subscription_id: string;
      subscriber_address: string;
      feed_kind: string;
      target_id: string;
      notify_on: string;
      created_at: string;
    }>;
    return rows.map(mapSubscriptionRow);
  }

  const rows = db.raw
    .prepare(
      `SELECT * FROM world_subscriptions
       WHERE subscriber_address = ?
       ORDER BY created_at DESC
       LIMIT ?`,
    )
    .all(subscriberAddress, limit) as Array<{
    subscription_id: string;
    subscriber_address: string;
    feed_kind: string;
    target_id: string;
    notify_on: string;
    created_at: string;
  }>;
  return rows.map(mapSubscriptionRow);
}

export function getSubscriptionMatches(
  db: OpenFoxDatabase,
  address: string,
  eventKind: SubscriptionEventKind,
): WorldSubscriptionRecord[] {
  const subscriberAddress = normalizeAddressLike(address);
  const rows = db.raw
    .prepare(
      `SELECT * FROM world_subscriptions
       WHERE subscriber_address = ?
       ORDER BY created_at DESC`,
    )
    .all(subscriberAddress) as Array<{
    subscription_id: string;
    subscriber_address: string;
    feed_kind: string;
    target_id: string;
    notify_on: string;
    created_at: string;
  }>;

  return rows
    .map(mapSubscriptionRow)
    .filter((sub) => sub.notifyOn.includes(eventKind));
}

export function listMatchingSubscriptionsForActivity(
  db: OpenFoxDatabase,
  address: string,
  activity: SubscriptionActivityTarget,
): WorldSubscriptionRecord[] {
  const subscriberAddress = normalizeAddressLike(address);
  if (!activity.eventKind) {
    return [];
  }
  const actorAddress = activity.actorAddress
    ? normalizeAddressLike(activity.actorAddress)
    : null;
  const groupId = activity.groupId?.trim() || null;
  const boardId = activity.boardId?.trim() || null;

  return listSubscriptions(db, subscriberAddress).filter((subscription) => {
    if (!subscription.notifyOn.includes(activity.eventKind!)) {
      return false;
    }
    if (subscription.feedKind === "fox") {
      return Boolean(actorAddress && subscription.targetId.toLowerCase() === actorAddress);
    }
    if (subscription.feedKind === "group") {
      return Boolean(groupId && subscription.targetId === groupId);
    }
    return Boolean(boardId && subscription.targetId === boardId);
  });
}

export function hasMatchingSubscriptionForActivity(
  db: OpenFoxDatabase,
  address: string,
  activity: SubscriptionActivityTarget,
): boolean {
  return listMatchingSubscriptionsForActivity(db, address, activity).length > 0;
}
