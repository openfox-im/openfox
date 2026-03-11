import { beforeEach, describe, expect, it, vi } from "vitest";
import { BUILTIN_TASKS } from "../heartbeat/tasks.js";
import { generateOwnerReport } from "../reports/generation.js";
import {
  DEFAULT_OWNER_REPORTS_CONFIG,
  type HeartbeatLegacyContext,
  type TickContext,
} from "../types.js";
import {
  MockInferenceClient,
  MockRuntimeClient,
  createTestConfig,
  createTestDb,
  createTestIdentity,
  noToolResponse,
} from "./mocks.js";

function createTickContext(db: ReturnType<typeof createTestDb>): TickContext {
  return {
    tickId: "tick-owner-report",
    startedAt: new Date(),
    creditBalance: 10000,
    walletBalance: 1,
    survivalTier: "normal",
    lowComputeMultiplier: 4,
    config: { entries: [], defaultIntervalMs: 60000, lowComputeMultiplier: 4 },
    db: db.raw,
  };
}

describe("owner reports", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it("generates and persists a structured owner report", async () => {
    const db = createTestDb();
    try {
      const config = createTestConfig({
        openaiApiKey: "test-key",
        ownerReports: {
          ...DEFAULT_OWNER_REPORTS_CONFIG,
          enabled: true,
        },
      });
      const inference = new MockInferenceClient([
        noToolResponse(
          JSON.stringify({
            overview: "Revenue improved and costs stayed bounded.",
            gains: "x402 observation jobs were the main positive contributor.",
            losses: "No material losses were detected.",
            opportunityDigest: "Prioritize medium-trust paid observation providers.",
            anomalies: "Pending payables remain within tolerance.",
            recommendations: ["Keep pursuing paid observation work."],
          }),
        ),
      ]);

      const report = await generateOwnerReport({
        config,
        db,
        inference,
        periodKind: "daily",
        nowMs: Date.parse("2026-03-11T18:00:00.000Z"),
      });

      expect(report.periodKind).toBe("daily");
      expect(report.generationStatus).toBe("generated");
      expect(report.payload.narrative?.overview).toContain("Revenue improved");
      expect(db.getLatestOwnerReport("daily")?.reportId).toBe(report.reportId);
      expect(db.getLatestOwnerFinanceSnapshot("daily")?.snapshotId).toBe(
        report.financeSnapshotId,
      );
    } finally {
      db.close();
    }
  });

  it("generates and delivers scheduled owner reports through heartbeat tasks", async () => {
    vi.useFakeTimers();
    const db = createTestDb();
    try {
      const outputRoot = "/tmp/openfox-owner-reports-test";
      const config = createTestConfig({
        openaiApiKey: "test-key",
        ownerReports: {
          ...DEFAULT_OWNER_REPORTS_CONFIG,
          enabled: true,
          generateWithInference: false,
          autoDeliverChannels: ["web"],
          web: {
            ...DEFAULT_OWNER_REPORTS_CONFIG.web,
            enabled: true,
            outputDir: `${outputRoot}/web`,
          },
          schedule: {
            ...DEFAULT_OWNER_REPORTS_CONFIG.schedule,
            enabled: true,
            endOfDayHourUtc: 18,
            morningHourUtc: 8,
          },
        },
      });
      const identity = createTestIdentity();
      const runtime = new MockRuntimeClient();
      const taskCtx: HeartbeatLegacyContext = {
        identity,
        config,
        db,
        runtime,
      };

      vi.setSystemTime(new Date("2026-03-11T18:05:00.000Z"));
      const generated = await BUILTIN_TASKS.generate_owner_reports(
        createTickContext(db),
        taskCtx,
      );
      expect(generated.shouldWake).toBe(false);
      const report = db.getLatestOwnerReport("daily");
      expect(report?.periodKind).toBe("daily");

      const delivered = await BUILTIN_TASKS.deliver_owner_reports(
        createTickContext(db),
        taskCtx,
      );
      expect(delivered.shouldWake).toBe(false);
      expect(db.listOwnerReportDeliveries(10).length).toBeGreaterThanOrEqual(1);
    } finally {
      vi.useRealTimers();
      db.close();
    }
  });
});
