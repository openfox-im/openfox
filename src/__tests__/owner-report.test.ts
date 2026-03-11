import { beforeEach, describe, expect, it, vi } from "vitest";
import { BUILTIN_TASKS } from "../heartbeat/tasks.js";
import { generateOwnerReport, buildOwnerReportInput } from "../reports/generation.js";
import {
  DEFAULT_OWNER_REPORTS_CONFIG,
  type HeartbeatLegacyContext,
  type TickContext,
  type OpportunityItem,
} from "../types.js";
import {
  MockInferenceClient,
  MockRuntimeClient,
  createTestConfig,
  createTestDb,
  createTestIdentity,
  noToolResponse,
} from "./mocks.js";
import { upsertStrategyProfile } from "../opportunity/strategy.js";
import * as scoutModule from "../opportunity/scout.js";

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

  it("carries execution-capable opportunity templates and execution summary into report input", async () => {
    const db = createTestDb();
    try {
      upsertStrategyProfile(db, {
        profileId: "default",
        name: "default",
        revenueTargetWei: "1000000000000000000",
        maxSpendPerOpportunityWei: "100000000000000000",
        minMarginBps: 100,
        enabledOpportunityKinds: ["campaign", "provider"],
        enabledProviderClasses: ["oracle", "task_market"],
        allowedTrustTiers: ["org_trusted", "public_low_trust", "unknown"],
        automationLevel: "bounded_auto",
        reportCadence: "daily",
        maxDeadlineHours: 168,
      });
      const config = createTestConfig({
        ownerReports: {
          ...DEFAULT_OWNER_REPORTS_CONFIG,
          enabled: true,
          actionExecution: {
            ...DEFAULT_OWNER_REPORTS_CONFIG.actionExecution!,
            enabled: true,
            autoExecutePursue: true,
            autoQueueFollowUps: true,
            maxFollowUpDepth: 2,
            maxFollowUpsPerRun: 1,
          },
        },
      });
      const campaignOpportunity: OpportunityItem = {
        kind: "campaign",
        providerClass: "task_market",
        trustTier: "org_trusted",
        title: "Campaign: solve the best open macro bounty",
        description: "Pick one bounded bounty inside the campaign.",
        capability: "campaign.solve",
        baseUrl: "https://host.example.com",
        campaignId: "campaign-1",
        providerAgentId: "host-agent-1",
        providerAddress:
          "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
        grossValueWei: "50000000000000000",
        estimatedCostWei: "1000000000000000",
        marginWei: "49000000000000000",
        marginBps: 9800,
        rawScore: 10,
      };
      db.upsertOwnerOpportunityAction({
        actionId: "owner-action:followup-1",
        alertId: "owner-followup-alert:1",
        requestId: "owner-followup-request:1",
        kind: "pursue",
        title: "Follow up: another campaign bounty",
        summary: "Auto-queued follow-up action.",
        capability: "campaign.solve",
        baseUrl: "https://host.example.com",
        requestedBy: "owner-test",
        approvedBy: "openfox-follow-up",
        approvedAt: "2026-03-11T18:00:00.000Z",
        decisionNote: "auto follow-up",
        payload: {
          followUpDepth: 1,
          parentActionId: "owner-action:root",
        },
        status: "queued",
        resolutionKind: null,
        resolutionRef: null,
        resolutionNote: null,
        queuedAt: "2026-03-11T18:00:00.000Z",
        createdAt: "2026-03-11T18:00:00.000Z",
        updatedAt: "2026-03-11T18:00:00.000Z",
        completedAt: null,
        cancelledAt: null,
      });
      db.upsertOwnerOpportunityActionExecution({
        executionId: "owner-action-exec:followup-1",
        actionId: "owner-action:followup-1",
        kind: "remote_campaign_solve",
        targetKind: "campaign",
        targetRef: "campaign-1",
        remoteBaseUrl: "https://host.example.com",
        status: "completed",
        requestPayload: { followUpDepth: 1 },
        resultPayload: {
          followUpDepth: 1,
          followUp: { queuedCount: 0 },
        },
        executionRef: "submission-1",
        errorMessage: null,
        createdAt: "2026-03-11T18:00:05.000Z",
        updatedAt: "2026-03-11T18:00:05.000Z",
        completedAt: "2026-03-11T18:00:05.000Z",
        failedAt: null,
      });

      const collectSpy = vi
        .spyOn(scoutModule, "collectOpportunityItems")
        .mockResolvedValue([campaignOpportunity]);
      const { input } = await buildOwnerReportInput({
        config,
        db,
        periodKind: "daily",
        nowMs: Date.parse("2026-03-11T18:30:00.000Z"),
      });
      collectSpy.mockRestore();

      expect(input.opportunities).toHaveLength(1);
      expect(input.opportunities[0]?.executionTemplate).toMatchObject({
        executionCapable: true,
        executionKind: "remote_campaign_solve",
        followUpEligible: true,
      });
      expect(input.strategyExecution.autoQueueFollowUps).toBe(true);
      expect(input.strategyExecution.maxFollowUpDepth).toBe(2);
      expect(input.strategyExecution.queuedFollowUpActions).toBe(1);
      expect(input.strategyExecution.recentFollowUpExecutions).toBe(1);
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
