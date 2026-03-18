/**
 * Sponsor Module Tests
 *
 * Tests for sponsor discovery/ranking (selectSponsor) and the
 * attribution store (save, retrieve, list, updateStatus).
 */

import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";

import { selectSponsor } from "../sponsor/discovery.js";
import type { SponsorQuote, SponsorPolicy, SponsorAttribution } from "../sponsor/types.js";
import { createSponsorAttributionStore } from "../sponsor/attribution.js";
import type { SponsorAttributionStore } from "../sponsor/attribution.js";

// ── Helpers ──────────────────────────────────────────────────────

function makeQuote(overrides?: Partial<SponsorQuote>): SponsorQuote {
  return {
    sponsorAddress: "0xSPONSOR1111111111111111111111111111111111",
    sponsorName: "TestSponsor",
    feeAmount: "50000000000000000", // 0.05 ETH
    feeCurrency: "TOS",
    gasLimit: 21000,
    expiresAt: Math.floor(Date.now() / 1000) + 600,
    policyHash: "0xPOLICY_HASH",
    trustTier: 2,
    latencyMs: 100,
    reputationScore: 80,
    ...overrides,
  };
}

function makePolicy(overrides?: Partial<SponsorPolicy>): SponsorPolicy {
  return {
    preferredSponsors: [],
    maxFeePercent: 0,
    maxFeeAbsolute: "0",
    minTrustTier: 0,
    strategy: "cheapest",
    fallbackEnabled: true,
    autoSelectEnabled: true,
    ...overrides,
  };
}

// ── Sponsor Discovery ────────────────────────────────────────────

describe("Sponsor Discovery", () => {
  describe("selectSponsor", () => {
    it("returns null when no quotes provided", () => {
      const result = selectSponsor([], makePolicy(), "1000000000000000000");
      expect(result).toBeNull();
    });

    it("filters by minimum trust tier", () => {
      const quotes = [
        makeQuote({ trustTier: 1, sponsorAddress: "0xLOW_TRUST" }),
        makeQuote({ trustTier: 3, sponsorAddress: "0xHIGH_TRUST" }),
      ];
      const policy = makePolicy({ minTrustTier: 2 });
      const result = selectSponsor(quotes, policy, "1000000000000000000");

      expect(result).not.toBeNull();
      expect(result!.selected.sponsorAddress).toBe("0xHIGH_TRUST");
      expect(result!.alternatives).toHaveLength(0);
    });

    it("filters by max fee absolute", () => {
      const quotes = [
        makeQuote({ feeAmount: "100000000000000000", sponsorAddress: "0xEXPENSIVE" }), // 0.1
        makeQuote({ feeAmount: "10000000000000000", sponsorAddress: "0xCHEAP" }),       // 0.01
      ];
      const policy = makePolicy({ maxFeeAbsolute: "50000000000000000" }); // 0.05 max
      const result = selectSponsor(quotes, policy, "1000000000000000000");

      expect(result).not.toBeNull();
      expect(result!.selected.sponsorAddress).toBe("0xCHEAP");
      expect(result!.alternatives).toHaveLength(0);
    });

    it("filters by max fee percent", () => {
      const quotes = [
        makeQuote({ feeAmount: "50000000000000000", sponsorAddress: "0xEXPENSIVE" }),  // 5% of 1 ETH
        makeQuote({ feeAmount: "5000000000000000", sponsorAddress: "0xCHEAP" }),        // 0.5% of 1 ETH
      ];
      // maxFeePercent = 1.0 means 1%, so max fee = 1% of 1 ETH = 0.01 ETH = 10000000000000000
      const policy = makePolicy({ maxFeePercent: 1.0 });
      const result = selectSponsor(quotes, policy, "1000000000000000000");

      expect(result).not.toBeNull();
      expect(result!.selected.sponsorAddress).toBe("0xCHEAP");
      expect(result!.alternatives).toHaveLength(0);
    });

    it("selects cheapest with cheapest strategy", () => {
      const quotes = [
        makeQuote({ feeAmount: "30000000000000000", sponsorAddress: "0xMID" }),
        makeQuote({ feeAmount: "10000000000000000", sponsorAddress: "0xCHEAP" }),
        makeQuote({ feeAmount: "50000000000000000", sponsorAddress: "0xEXPENSIVE" }),
      ];
      const policy = makePolicy({ strategy: "cheapest" });
      const result = selectSponsor(quotes, policy, "1000000000000000000");

      expect(result).not.toBeNull();
      expect(result!.selected.sponsorAddress).toBe("0xCHEAP");
      expect(result!.reason).toBe("cheapest");
    });

    it("selects fastest with fastest strategy", () => {
      const quotes = [
        makeQuote({ latencyMs: 200, sponsorAddress: "0xSLOW" }),
        makeQuote({ latencyMs: 50, sponsorAddress: "0xFAST" }),
        makeQuote({ latencyMs: 150, sponsorAddress: "0xMID" }),
      ];
      const policy = makePolicy({ strategy: "fastest" });
      const result = selectSponsor(quotes, policy, "1000000000000000000");

      expect(result).not.toBeNull();
      expect(result!.selected.sponsorAddress).toBe("0xFAST");
      expect(result!.reason).toBe("fastest");
    });

    it("selects highest trust with highest_trust strategy", () => {
      const quotes = [
        makeQuote({ trustTier: 1, sponsorAddress: "0xLOW" }),
        makeQuote({ trustTier: 4, sponsorAddress: "0xHIGH" }),
        makeQuote({ trustTier: 2, sponsorAddress: "0xMID" }),
      ];
      const policy = makePolicy({ strategy: "highest_trust" });
      const result = selectSponsor(quotes, policy, "1000000000000000000");

      expect(result).not.toBeNull();
      expect(result!.selected.sponsorAddress).toBe("0xHIGH");
      expect(result!.reason).toBe("highest_trust");
    });

    it("prefers preferred sponsors with preferred_first strategy", () => {
      const quotes = [
        makeQuote({ feeAmount: "10000000000000000", sponsorAddress: "0xCHEAP_NOT_PREFERRED" }),
        makeQuote({ feeAmount: "30000000000000000", sponsorAddress: "0xPREFERRED" }),
        makeQuote({ feeAmount: "20000000000000000", sponsorAddress: "0xOTHER" }),
      ];
      const policy = makePolicy({
        strategy: "preferred_first",
        preferredSponsors: ["0xPREFERRED"],
      });
      const result = selectSponsor(quotes, policy, "1000000000000000000");

      expect(result).not.toBeNull();
      expect(result!.selected.sponsorAddress).toBe("0xPREFERRED");
      expect(result!.reason).toBe("preferred_first");
    });

    it("returns alternatives in ranked order", () => {
      const quotes = [
        makeQuote({ feeAmount: "30000000000000000", sponsorAddress: "0xC" }),
        makeQuote({ feeAmount: "10000000000000000", sponsorAddress: "0xA" }),
        makeQuote({ feeAmount: "20000000000000000", sponsorAddress: "0xB" }),
      ];
      const policy = makePolicy({ strategy: "cheapest" });
      const result = selectSponsor(quotes, policy, "1000000000000000000");

      expect(result).not.toBeNull();
      expect(result!.selected.sponsorAddress).toBe("0xA");
      expect(result!.alternatives).toHaveLength(2);
      expect(result!.alternatives[0].sponsorAddress).toBe("0xB");
      expect(result!.alternatives[1].sponsorAddress).toBe("0xC");
    });

    it("generates human-readable totalCostDisplay", () => {
      const quotes = [
        makeQuote({ feeAmount: "50000000000000000" }), // 0.05 ETH fee
      ];
      const policy = makePolicy({ strategy: "cheapest" });
      const result = selectSponsor(quotes, policy, "1000000000000000000"); // 1 ETH value

      expect(result).not.toBeNull();
      expect(result!.totalCostDisplay).toBe("1.0000 TOS (+ 0.050000 fee)");
    });

    it("shows gasless for zero-fee sponsors", () => {
      const quotes = [
        makeQuote({ feeAmount: "0" }),
      ];
      const policy = makePolicy({ strategy: "cheapest" });
      const result = selectSponsor(quotes, policy, "1000000000000000000"); // 1 ETH value

      expect(result).not.toBeNull();
      expect(result!.totalCostDisplay).toBe("1.0000 TOS (gasless)");
    });
  });
});

// ── Sponsor Attribution Store ────────────────────────────────────

describe("Sponsor Attribution Store", () => {
  let db: Database.Database;
  let store: SponsorAttributionStore;

  beforeEach(() => {
    db = new Database(":memory:");
    db.exec(`
      CREATE TABLE IF NOT EXISTS sponsor_attributions (
        intent_id TEXT NOT NULL,
        plan_id TEXT NOT NULL,
        sponsor_address TEXT NOT NULL,
        sponsor_name TEXT,
        fee_charged TEXT NOT NULL,
        fee_display TEXT NOT NULL,
        policy_hash TEXT NOT NULL,
        selected_at INTEGER NOT NULL,
        settled_at INTEGER,
        status TEXT NOT NULL CHECK(status IN ('selected','submitted','settled','failed')),
        PRIMARY KEY (intent_id, plan_id)
      );
    `);
    store = createSponsorAttributionStore(db);
  });

  function makeAttribution(overrides?: Partial<SponsorAttribution>): SponsorAttribution {
    return {
      intentId: "intent-001",
      planId: "plan-001",
      sponsorAddress: "0xSPONSOR",
      sponsorName: "TestSponsor",
      feeCharged: "50000000000000000",
      feeDisplay: "0.05 TOS",
      policyHash: "0xPOLICY",
      selectedAt: 1700000000,
      status: "selected",
      ...overrides,
    };
  }

  it("saves and retrieves attribution", () => {
    const attr = makeAttribution();
    store.save(attr);

    const retrieved = store.get("intent-001", "plan-001");
    expect(retrieved).toBeDefined();
    expect(retrieved!.intentId).toBe("intent-001");
    expect(retrieved!.planId).toBe("plan-001");
    expect(retrieved!.sponsorAddress).toBe("0xSPONSOR");
    expect(retrieved!.sponsorName).toBe("TestSponsor");
    expect(retrieved!.feeCharged).toBe("50000000000000000");
    expect(retrieved!.feeDisplay).toBe("0.05 TOS");
    expect(retrieved!.policyHash).toBe("0xPOLICY");
    expect(retrieved!.selectedAt).toBe(1700000000);
    expect(retrieved!.status).toBe("selected");
  });

  it("lists by intent", () => {
    store.save(makeAttribution({ intentId: "intent-001", planId: "plan-001", selectedAt: 1700000001 }));
    store.save(makeAttribution({ intentId: "intent-001", planId: "plan-002", selectedAt: 1700000002 }));
    store.save(makeAttribution({ intentId: "intent-002", planId: "plan-003", selectedAt: 1700000003 }));

    const results = store.listByIntent("intent-001");
    expect(results).toHaveLength(2);
    // Should be ordered by selected_at DESC
    expect(results[0].planId).toBe("plan-002");
    expect(results[1].planId).toBe("plan-001");
  });

  it("lists recent", () => {
    store.save(makeAttribution({ intentId: "i1", planId: "p1", selectedAt: 1700000001 }));
    store.save(makeAttribution({ intentId: "i2", planId: "p2", selectedAt: 1700000003 }));
    store.save(makeAttribution({ intentId: "i3", planId: "p3", selectedAt: 1700000002 }));

    const results = store.listRecent(2);
    expect(results).toHaveLength(2);
    // Should be ordered by selected_at DESC
    expect(results[0].intentId).toBe("i2");
    expect(results[1].intentId).toBe("i3");
  });

  it("updates status", () => {
    store.save(makeAttribution());

    store.updateStatus("intent-001", "plan-001", "settled", 1700001000);
    const updated = store.get("intent-001", "plan-001");
    expect(updated).toBeDefined();
    expect(updated!.status).toBe("settled");
    expect(updated!.settledAt).toBe(1700001000);
  });
});
