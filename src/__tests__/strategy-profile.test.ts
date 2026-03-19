import { describe, expect, it } from "vitest";
import { createTestDb } from "./mocks.js";
import {
  getCurrentStrategyProfile,
  upsertStrategyProfile,
  validateStrategyProfile,
} from "../opportunity/strategy.js";

describe("strategy profile", () => {
  it("creates and persists a bounded earning strategy", () => {
    const db = createTestDb();
    const profile = upsertStrategyProfile(db, {
      name: "High margin sponsored work",
      revenueTargetTomi: "100000000000000000",
      maxSpendPerOpportunityTomi: "5000000000000000",
      minMarginBps: 2500,
      enabledOpportunityKinds: ["bounty", "provider"],
      enabledProviderClasses: ["task_market", "sponsored_execution"],
      allowedTrustTiers: ["self_hosted", "org_trusted"],
      automationLevel: "bounded_auto",
      reportCadence: "daily",
      maxDeadlineHours: 72,
    });

    expect(profile.name).toBe("High margin sponsored work");
    expect(getCurrentStrategyProfile(db).name).toBe("High margin sponsored work");
    expect(validateStrategyProfile(profile)).toMatchObject({ valid: true });
    db.close();
  });

  it("warns when spend is zero for paid opportunities", () => {
    const db = createTestDb();
    const profile = getCurrentStrategyProfile(db);
    const validation = validateStrategyProfile(profile);
    expect(validation.valid).toBe(true);
    expect(validation.warnings).toContain(
      "maxSpendPerOpportunityTomi is zero, so paid provider opportunities will not match.",
    );
    db.close();
  });
});
