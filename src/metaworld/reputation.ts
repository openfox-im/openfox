/**
 * Global Reputation Graph — multi-dimensional scoring engine.
 *
 * Replaces/extends the simple v1 reputation summaries in identity.ts
 * with exponential-decay-weighted, per-dimension scoring, trust paths,
 * and cross-group attestation support.
 */

import type { OpenFoxDatabase } from "../types.js";
import { keccak256, toHex } from "tosdk";
import { createLogger } from "../observability/logger.js";

const logger = createLogger("reputation");

// ─── Types ──────────────────────────────────────────────────────

export type ReputationEntityType = "fox" | "group";

export type ReputationDimension =
  | "reliability"
  | "quality"
  | "collaboration"
  | "economic"
  | "moderation"
  | "activity"
  | "settlement_volume"
  | "member_quality"
  | "governance_health";

export type ReputationSourceType =
  | "intent_completion"
  | "settlement"
  | "moderation"
  | "peer_endorsement"
  | "governance_participation";

export const FOX_DIMENSIONS: ReputationDimension[] = [
  "reliability",
  "quality",
  "collaboration",
  "economic",
  "moderation",
];

export const GROUP_DIMENSIONS: ReputationDimension[] = [
  "activity",
  "settlement_volume",
  "member_quality",
  "governance_health",
];

export interface ReputationScoreRecord {
  address: string;
  entityType: ReputationEntityType;
  dimension: ReputationDimension;
  score: number;
  eventCount: number;
  lastUpdated: string;
}

export interface ReputationEventRecord {
  eventId: string;
  targetAddress: string;
  targetType: ReputationEntityType;
  dimension: ReputationDimension;
  delta: number;
  sourceType: ReputationSourceType;
  sourceRef: string | null;
  issuerGroupId: string | null;
  issuerAddress: string;
  signature: string | null;
  createdAt: string;
}

export interface ReputationCard {
  address: string;
  entityType: ReputationEntityType;
  dimensions: Array<{
    dimension: ReputationDimension;
    score: number;
    eventCount: number;
  }>;
  overallScore: number;
}

export interface ReputationAttestation {
  targetAddress: string;
  dimension: ReputationDimension;
  score: number;
  eventCount: number;
  issuerGroupId: string;
  issuerAddress: string;
  timestamp: string;
  signature: string;
}

export interface TrustPath {
  from: string;
  to: string;
  hops: Array<{
    type: "shared_group" | "shared_settlement" | "direct_endorsement";
    ref: string;
  }>;
  strength: number;
}

// ─── Helpers ────────────────────────────────────────────────────

const textEncoder = new TextEncoder();

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([a], [b]) => a.localeCompare(b));
  return `{${entries
    .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
    .join(",")}}`;
}

function hashContent(value: unknown): string {
  return keccak256(toHex(textEncoder.encode(stableStringify(value))));
}

function generateEventId(): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 10);
  return `rep_${ts}_${rand}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

// ─── Exponential Decay Scoring ──────────────────────────────────

const LAMBDA = 0.01; // decay constant, half-life ~69 days

function calculateDecayedScore(
  events: ReputationEventRecord[],
  now: Date,
): number {
  let weightedSum = 0;
  let absWeightedSum = 0;
  for (const event of events) {
    const ageDays =
      (now.getTime() - new Date(event.createdAt).getTime()) /
      (1000 * 60 * 60 * 24);
    const weight = Math.exp(-LAMBDA * ageDays);
    weightedSum += event.delta * weight;
    absWeightedSum += Math.abs(event.delta) * weight;
  }
  if (absWeightedSum === 0) return 0;
  // Map from [-1, 1] to [0, 1]
  return (weightedSum / absWeightedSum + 1) / 2;
}

// ─── Core Functions ─────────────────────────────────────────────

export interface EmitReputationEventInput {
  targetAddress: string;
  targetType: ReputationEntityType;
  dimension: ReputationDimension;
  delta: number;
  sourceType: ReputationSourceType;
  sourceRef?: string;
  issuerGroupId?: string;
  issuerAddress: string;
}

export function emitReputationEvent(
  db: OpenFoxDatabase,
  input: EmitReputationEventInput,
): ReputationEventRecord {
  const eventId = generateEventId();
  const createdAt = nowIso();

  const record: ReputationEventRecord = {
    eventId,
    targetAddress: input.targetAddress,
    targetType: input.targetType,
    dimension: input.dimension,
    delta: input.delta,
    sourceType: input.sourceType,
    sourceRef: input.sourceRef ?? null,
    issuerGroupId: input.issuerGroupId ?? null,
    issuerAddress: input.issuerAddress,
    signature: null,
    createdAt,
  };

  db.raw
    .prepare(
      `INSERT INTO world_reputation_events
       (event_id, target_address, target_type, dimension, delta, source_type, source_ref, issuer_group_id, issuer_address, signature, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      record.eventId,
      record.targetAddress,
      record.targetType,
      record.dimension,
      record.delta,
      record.sourceType,
      record.sourceRef,
      record.issuerGroupId,
      record.issuerAddress,
      record.signature,
      record.createdAt,
    );

  logger.debug(
    `emitted reputation event ${eventId}: ${input.dimension} delta=${input.delta} for ${input.targetAddress}`,
  );

  // Recalculate score after inserting the event
  recalculateReputationScore(db, input.targetAddress, input.dimension, input.targetType);

  return record;
}

export function recalculateReputationScore(
  db: OpenFoxDatabase,
  address: string,
  dimension: ReputationDimension,
  entityType?: ReputationEntityType,
): ReputationScoreRecord {
  const events = db.raw
    .prepare(
      `SELECT * FROM world_reputation_events WHERE target_address = ? AND dimension = ? ORDER BY created_at ASC`,
    )
    .all(address, dimension) as Array<{
    event_id: string;
    target_address: string;
    target_type: string;
    dimension: string;
    delta: number;
    source_type: string;
    source_ref: string | null;
    issuer_group_id: string | null;
    issuer_address: string;
    signature: string | null;
    created_at: string;
  }>;

  const mapped: ReputationEventRecord[] = events.map((row) => ({
    eventId: row.event_id,
    targetAddress: row.target_address,
    targetType: row.target_type as ReputationEntityType,
    dimension: row.dimension as ReputationDimension,
    delta: row.delta,
    sourceType: row.source_type as ReputationSourceType,
    sourceRef: row.source_ref,
    issuerGroupId: row.issuer_group_id,
    issuerAddress: row.issuer_address,
    signature: row.signature,
    createdAt: row.created_at,
  }));

  const score = calculateDecayedScore(mapped, new Date());
  const now = nowIso();

  // Resolve entity type from events or parameter
  const resolvedType =
    entityType ?? (mapped.length > 0 ? mapped[0].targetType : "fox");

  db.raw
    .prepare(
      `INSERT INTO world_reputation_scores (address, entity_type, dimension, score, event_count, last_updated)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(address, dimension) DO UPDATE SET
         score = excluded.score,
         event_count = excluded.event_count,
         last_updated = excluded.last_updated`,
    )
    .run(address, resolvedType, dimension, score, mapped.length, now);

  return {
    address,
    entityType: resolvedType,
    dimension,
    score,
    eventCount: mapped.length,
    lastUpdated: now,
  };
}

export function getReputationCard(
  db: OpenFoxDatabase,
  address: string,
): ReputationCard {
  const rows = db.raw
    .prepare(
      `SELECT entity_type, dimension, score, event_count
       FROM world_reputation_scores
       WHERE address = ?
       ORDER BY dimension ASC`,
    )
    .all(address) as Array<{
    entity_type: string;
    dimension: string;
    score: number;
    event_count: number;
  }>;

  const entityType: ReputationEntityType =
    rows.length > 0
      ? (rows[0].entity_type as ReputationEntityType)
      : "fox";

  const dimensions = rows.map((row) => ({
    dimension: row.dimension as ReputationDimension,
    score: row.score,
    eventCount: row.event_count,
  }));

  // Weighted average: all dimensions have equal weight
  const overallScore =
    dimensions.length > 0
      ? dimensions.reduce((sum, d) => sum + d.score, 0) / dimensions.length
      : 0;

  return {
    address,
    entityType,
    dimensions,
    overallScore,
  };
}

export function getReputationLeaderboard(
  db: OpenFoxDatabase,
  entityType: ReputationEntityType,
  dimension: ReputationDimension,
  limit: number = 10,
): ReputationScoreRecord[] {
  const rows = db.raw
    .prepare(
      `SELECT address, entity_type, dimension, score, event_count, last_updated
       FROM world_reputation_scores
       WHERE entity_type = ? AND dimension = ?
       ORDER BY score DESC
       LIMIT ?`,
    )
    .all(entityType, dimension, limit) as Array<{
    address: string;
    entity_type: string;
    dimension: string;
    score: number;
    event_count: number;
    last_updated: string;
  }>;

  return rows.map((row) => ({
    address: row.address,
    entityType: row.entity_type as ReputationEntityType,
    dimension: row.dimension as ReputationDimension,
    score: row.score,
    eventCount: row.event_count,
    lastUpdated: row.last_updated,
  }));
}

export function findTrustPath(
  db: OpenFoxDatabase,
  fromAddress: string,
  toAddress: string,
  maxDepth: number = 4,
): TrustPath | null {
  if (fromAddress === toAddress) {
    return { from: fromAddress, to: toAddress, hops: [], strength: 1.0 };
  }

  // BFS through shared groups
  interface BfsNode {
    address: string;
    hops: TrustPath["hops"];
  }

  const visited = new Set<string>();
  const queue: BfsNode[] = [{ address: fromAddress, hops: [] }];
  visited.add(fromAddress);

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current.hops.length >= maxDepth) continue;

    // Find all groups this address is a member of
    const groups = db.raw
      .prepare(
        `SELECT group_id FROM group_members
         WHERE member_address = ? AND membership_state = 'active'`,
      )
      .all(current.address) as Array<{ group_id: string }>;

    for (const group of groups) {
      // Find all other members of this group
      const members = db.raw
        .prepare(
          `SELECT member_address FROM group_members
           WHERE group_id = ? AND membership_state = 'active' AND member_address != ?`,
        )
        .all(group.group_id, current.address) as Array<{
        member_address: string;
      }>;

      for (const member of members) {
        const newHops: TrustPath["hops"] = [
          ...current.hops,
          { type: "shared_group" as const, ref: group.group_id },
        ];

        if (member.member_address === toAddress) {
          return {
            from: fromAddress,
            to: toAddress,
            hops: newHops,
            strength: 1.0 / (newHops.length + 1),
          };
        }

        if (!visited.has(member.member_address)) {
          visited.add(member.member_address);
          queue.push({ address: member.member_address, hops: newHops });
        }
      }
    }
  }

  return null;
}

// ─── Attestation Functions ──────────────────────────────────────

export function signReputationAttestation(
  attestation: Omit<ReputationAttestation, "signature">,
  _privateKey: string,
): ReputationAttestation {
  const payload = { ...attestation };
  const hash = hashContent(payload);
  // Simplified signing: keccak256(content) serves as the signature
  // Full secp256k1 signing would require more complex key management
  const signature = hash;
  return { ...attestation, signature };
}

export function verifyReputationAttestation(
  attestation: ReputationAttestation,
): boolean {
  const { signature, ...payload } = attestation;
  if (!signature) return false;
  const expectedHash = hashContent(payload);
  return signature === expectedHash;
}

export function importReputationAttestation(
  db: OpenFoxDatabase,
  attestation: ReputationAttestation,
): ReputationEventRecord {
  if (!verifyReputationAttestation(attestation)) {
    throw new Error("Invalid attestation signature");
  }

  // Determine delta from score: score is in [0,1], map to delta in [-1,1]
  const delta = attestation.score * 2 - 1;

  return emitReputationEvent(db, {
    targetAddress: attestation.targetAddress,
    targetType: "fox",
    dimension: attestation.dimension,
    delta,
    sourceType: "peer_endorsement",
    sourceRef: `attestation:${attestation.issuerGroupId}`,
    issuerGroupId: attestation.issuerGroupId,
    issuerAddress: attestation.issuerAddress,
  });
}

// ─── Event Listing ──────────────────────────────────────────────

export function listReputationEvents(
  db: OpenFoxDatabase,
  targetAddress: string,
  dimension?: ReputationDimension,
  limit: number = 50,
): ReputationEventRecord[] {
  let sql =
    "SELECT * FROM world_reputation_events WHERE target_address = ?";
  const params: unknown[] = [targetAddress];

  if (dimension) {
    sql += " AND dimension = ?";
    params.push(dimension);
  }

  sql += " ORDER BY created_at DESC LIMIT ?";
  params.push(limit);

  const rows = db.raw.prepare(sql).all(...params) as Array<{
    event_id: string;
    target_address: string;
    target_type: string;
    dimension: string;
    delta: number;
    source_type: string;
    source_ref: string | null;
    issuer_group_id: string | null;
    issuer_address: string;
    signature: string | null;
    created_at: string;
  }>;

  return rows.map((row) => ({
    eventId: row.event_id,
    targetAddress: row.target_address,
    targetType: row.target_type as ReputationEntityType,
    dimension: row.dimension as ReputationDimension,
    delta: row.delta,
    sourceType: row.source_type as ReputationSourceType,
    sourceRef: row.source_ref,
    issuerGroupId: row.issuer_group_id,
    issuerAddress: row.issuer_address,
    signature: row.signature,
    createdAt: row.created_at,
  }));
}
