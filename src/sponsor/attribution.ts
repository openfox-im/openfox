/**
 * Sponsor Module - Attribution Store
 *
 * GTOS 2046 Phase 5: Tracks sponsor attributions for audit,
 * linking intents/plans to the sponsor that covered gas fees.
 */

import type BetterSqlite3 from "better-sqlite3";
import type { SponsorAttribution } from "./types.js";

type DatabaseType = BetterSqlite3.Database;

// ─── Row Deserializer ──────────────────────────────────────────

function deserializeAttribution(row: any): SponsorAttribution {
  return {
    intentId: row.intent_id,
    planId: row.plan_id,
    sponsorAddress: row.sponsor_address,
    sponsorName: row.sponsor_name ?? undefined,
    feeCharged: row.fee_charged,
    feeDisplay: row.fee_display,
    policyHash: row.policy_hash,
    selectedAt: row.selected_at,
    settledAt: row.settled_at ?? undefined,
    status: row.status,
  };
}

// ─── Attribution Store ─────────────────────────────────────────

export interface SponsorAttributionStore {
  save(attr: SponsorAttribution): void;
  get(intentId: string, planId: string): SponsorAttribution | undefined;
  listByIntent(intentId: string): SponsorAttribution[];
  listRecent(limit: number): SponsorAttribution[];
  updateStatus(
    intentId: string,
    planId: string,
    status: SponsorAttribution["status"],
    settledAt?: number,
  ): void;
}

export function createSponsorAttributionStore(
  db: DatabaseType,
): SponsorAttributionStore {
  const save = (attr: SponsorAttribution): void => {
    db.prepare(
      `INSERT OR REPLACE INTO sponsor_attributions
        (intent_id, plan_id, sponsor_address, sponsor_name, fee_charged, fee_display, policy_hash, selected_at, settled_at, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      attr.intentId,
      attr.planId,
      attr.sponsorAddress,
      attr.sponsorName ?? null,
      attr.feeCharged,
      attr.feeDisplay,
      attr.policyHash,
      attr.selectedAt,
      attr.settledAt ?? null,
      attr.status,
    );
  };

  const get = (
    intentId: string,
    planId: string,
  ): SponsorAttribution | undefined => {
    const row = db
      .prepare(
        "SELECT * FROM sponsor_attributions WHERE intent_id = ? AND plan_id = ?",
      )
      .get(intentId, planId) as any | undefined;
    return row ? deserializeAttribution(row) : undefined;
  };

  const listByIntent = (intentId: string): SponsorAttribution[] => {
    const rows = db
      .prepare(
        "SELECT * FROM sponsor_attributions WHERE intent_id = ? ORDER BY selected_at DESC",
      )
      .all(intentId) as any[];
    return rows.map(deserializeAttribution);
  };

  const listRecent = (limit: number): SponsorAttribution[] => {
    const rows = db
      .prepare(
        "SELECT * FROM sponsor_attributions ORDER BY selected_at DESC LIMIT ?",
      )
      .all(limit) as any[];
    return rows.map(deserializeAttribution);
  };

  const updateStatus = (
    intentId: string,
    planId: string,
    status: SponsorAttribution["status"],
    settledAt?: number,
  ): void => {
    if (settledAt !== undefined) {
      db.prepare(
        "UPDATE sponsor_attributions SET status = ?, settled_at = ? WHERE intent_id = ? AND plan_id = ?",
      ).run(status, settledAt, intentId, planId);
    } else {
      db.prepare(
        "UPDATE sponsor_attributions SET status = ? WHERE intent_id = ? AND plan_id = ?",
      ).run(status, intentId, planId);
    }
  };

  return {
    save,
    get,
    listByIntent,
    listRecent,
    updateStatus,
  };
}
