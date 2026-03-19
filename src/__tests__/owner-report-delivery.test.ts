import fs from "fs/promises";
import http from "http";
import os from "os";
import path from "path";
import { describe, expect, it } from "vitest";
import { createOperatorApprovalRequest } from "../operator/autopilot.js";
import { createBountyEngine } from "../bounty/engine.js";
import { deliverOwnerReportChannels } from "../reports/delivery.js";
import type { OwnerOpportunityAlertRecord } from "../types.js";
import { generateOwnerReport } from "../reports/generation.js";
import { startOwnerReportServer } from "../reports/server.js";
import { startBountyHttpServer } from "../bounty/http.js";
import { DEFAULT_BOUNTY_CONFIG, DEFAULT_OWNER_REPORTS_CONFIG } from "../types.js";
import {
  MockInferenceClient,
  createTestConfig,
  createTestDb,
  createTestIdentity,
  noToolResponse,
} from "./mocks.js";

describe("owner report delivery", () => {
  async function startMockInferenceServer(answer: string): Promise<{
    url: string;
    close(): Promise<void>;
  }> {
    const server = http.createServer((_req, res) => {
      const payload = JSON.stringify({
        id: "chatcmpl-test",
        model: "ollama/test",
        choices: [
          {
            finish_reason: "stop",
            message: { role: "assistant", content: answer },
          },
        ],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 2,
          total_tokens: 12,
        },
      });
      res.writeHead(200, {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(payload),
      });
      res.end(payload);
    });
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => resolve());
    });
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("failed to resolve mock inference server address");
    }
    return {
      url: `http://127.0.0.1:${address.port}`,
      close: async () =>
        await new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        ),
    };
  }

  function createAlert(alertId: string): OwnerOpportunityAlertRecord {
    const now = new Date().toISOString();
    return {
      alertId,
      opportunityHash:
        "0x752a3d0f953b4ae91fca3bf4c1b93863c1884902f778aa65ff6e3aa02f730d02",
      kind: "bounty",
      providerClass: "task_market",
      trustTier: "org_trusted",
      title: "Translate a bounded task",
      summary: "reward=100 margin=90 score=1500 trust=org_trusted",
      suggestedAction: "Review and submit a bounded response.",
      capability: "task.submit",
      baseUrl: "https://host.example.com",
      rewardTomi: "100",
      estimatedCostTomi: "10",
      marginTomi: "90",
      marginBps: 9000,
      strategyScore: 1500,
      strategyMatched: true,
      strategyReasons: [],
      payload: { bountyId: "bounty-1" },
      status: "unread",
      createdAt: now,
      updatedAt: now,
      readAt: null,
      dismissedAt: null,
    };
  }

  it("renders and records web and email owner report deliveries", async () => {
    const db = createTestDb();
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "openfox-owner-report-"));
    try {
      const config = createTestConfig({
        openaiApiKey: "test-key",
        ownerReports: {
          ...DEFAULT_OWNER_REPORTS_CONFIG,
          enabled: true,
          web: {
            ...DEFAULT_OWNER_REPORTS_CONFIG.web,
            enabled: true,
            outputDir: path.join(rootDir, "web"),
          },
          email: {
            ...DEFAULT_OWNER_REPORTS_CONFIG.email,
            enabled: true,
            outboxDir: path.join(rootDir, "outbox"),
          },
        },
      });

      const report = await generateOwnerReport({
        config,
        db,
        inference: new MockInferenceClient([
          noToolResponse(
            '{"overview":"Daily summary","gains":"Gain summary","losses":"Loss summary","opportunityDigest":"Digest","anomalies":"None","recommendations":["Stay bounded."]}',
          ),
        ]),
        periodKind: "daily",
        nowMs: Date.parse("2027-03-11T18:00:00.000Z"),
      });

      const results = await deliverOwnerReportChannels({
        config,
        db,
        report,
        channels: ["web", "email"],
      });

      expect(results).toHaveLength(2);
      expect(results.every((item) => item.status === "delivered")).toBe(true);
      expect(
        await fs.readFile(path.join(rootDir, "web", `${report.reportId}.html`), "utf8"),
      ).toContain("OpenFox Owner Report");
      expect(
        await fs.readFile(path.join(rootDir, "outbox", `${report.reportId}.eml`), "utf8"),
      ).toContain("[OpenFox] daily owner report");
      expect(db.listOwnerReportDeliveries(10).length).toBe(2);
    } finally {
      db.close();
      await fs.rm(rootDir, { recursive: true, force: true });
    }
  });

  it("serves latest owner reports over the owner report web surface", async () => {
    const db = createTestDb();
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "openfox-owner-report-server-"));
    let server: Awaited<ReturnType<typeof startOwnerReportServer>> | null = null;
    try {
      const config = createTestConfig({
        ownerReports: {
          ...DEFAULT_OWNER_REPORTS_CONFIG,
          enabled: true,
          generateWithInference: false,
          web: {
            ...DEFAULT_OWNER_REPORTS_CONFIG.web,
            enabled: true,
            bindHost: "127.0.0.1",
            port: 0,
            pathPrefix: "/owner",
            outputDir: path.join(rootDir, "web"),
          },
        },
      });

      const report = await generateOwnerReport({
        config,
        db,
        periodKind: "daily",
        nowMs: Date.parse("2027-03-11T18:00:00.000Z"),
      });
      expect(report.generationStatus).toBe("deterministic_only");

      server = await startOwnerReportServer({ config, db });
      expect(server).not.toBeNull();

      const latestJson = await fetch(`${server!.url}/reports/latest/daily`);
      expect(latestJson.status).toBe(200);
      const latestPayload = await latestJson.json();
      expect(latestPayload.reportId).toBe(report.reportId);

      const latestHtml = await fetch(`${server!.url}/reports/latest/daily?format=html`);
      expect(latestHtml.status).toBe(200);
      expect(await latestHtml.text()).toContain("OpenFox Owner Report");
    } finally {
      await server?.close?.();
      db.close();
      await fs.rm(rootDir, { recursive: true, force: true });
    }
  });

  it("serves and decides owner approval requests over the owner report web surface", async () => {
    const db = createTestDb();
    let server: Awaited<ReturnType<typeof startOwnerReportServer>> | null = null;
    try {
      const config = createTestConfig({
        ownerReports: {
          ...DEFAULT_OWNER_REPORTS_CONFIG,
          enabled: true,
          web: {
            ...DEFAULT_OWNER_REPORTS_CONFIG.web,
            enabled: true,
            bindHost: "127.0.0.1",
            port: 0,
            pathPrefix: "/owner",
            authToken: "owner-secret",
          },
        },
      });

      const request = createOperatorApprovalRequest({
        db,
        config,
        kind: "treasury_policy_change",
        scope: "treasury:daily-spend-cap",
        requestedBy: "autopilot",
        reason: "raise spend cap",
      });

      server = await startOwnerReportServer({ config, db });
      expect(server).not.toBeNull();

      const approvalsJson = await fetch(
        `${server!.url}/approvals?status=pending&format=json`,
        {
          headers: {
            Authorization: "Bearer owner-secret",
          },
        },
      );
      expect(approvalsJson.status).toBe(200);
      const approvalsPayload = (await approvalsJson.json()) as {
        items: Array<{ requestId: string; status: string }>;
      };
      expect(approvalsPayload.items[0]?.requestId).toBe(request.requestId);

      const approvalsHtml = await fetch(
        `${server!.url}/approvals?token=owner-secret`,
      );
      expect(approvalsHtml.status).toBe(200);
      expect(await approvalsHtml.text()).toContain("OpenFox Approval Inbox");

      const approve = await fetch(
        `${server!.url}/approvals/${encodeURIComponent(request.requestId)}/approve?format=json`,
        {
          method: "POST",
          headers: {
            Authorization: "Bearer owner-secret",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ note: "approved from phone" }),
        },
      );
      expect(approve.status).toBe(200);
      const approvePayload = (await approve.json()) as {
        requestId: string;
        status: string;
        decisionNote?: string | null;
      };
      expect(approvePayload.requestId).toBe(request.requestId);
      expect(approvePayload.status).toBe("approved");
      expect(approvePayload.decisionNote).toBe("approved from phone");
    } finally {
      await server?.close?.();
      db.close();
    }
  });

  it("serves and updates owner opportunity alerts over the owner report web surface", async () => {
    const db = createTestDb();
    let server: Awaited<ReturnType<typeof startOwnerReportServer>> | null = null;
    try {
      const config = createTestConfig({
        ownerReports: {
          ...DEFAULT_OWNER_REPORTS_CONFIG,
          enabled: true,
          web: {
            ...DEFAULT_OWNER_REPORTS_CONFIG.web,
            enabled: true,
            bindHost: "127.0.0.1",
            port: 0,
            pathPrefix: "/owner",
            authToken: "owner-secret",
          },
        },
      });

      const alert = createAlert("alert-1");
      db.upsertOwnerOpportunityAlert(alert);

      server = await startOwnerReportServer({ config, db });
      expect(server).not.toBeNull();

      const alertsJson = await fetch(`${server!.url}/alerts?format=json`, {
        headers: {
          Authorization: "Bearer owner-secret",
        },
      });
      expect(alertsJson.status).toBe(200);
      const alertsPayload = (await alertsJson.json()) as {
        items: Array<{ alertId: string; status: string }>;
      };
      expect(alertsPayload.items[0]?.alertId).toBe(alert.alertId);

      const alertsHtml = await fetch(`${server!.url}/alerts?token=owner-secret`);
      expect(alertsHtml.status).toBe(200);
      expect(await alertsHtml.text()).toContain("OpenFox Opportunity Alerts");

      const markRead = await fetch(
        `${server!.url}/alerts/${encodeURIComponent(alert.alertId)}/read?format=json`,
        {
          method: "POST",
          headers: {
            Authorization: "Bearer owner-secret",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            resultKind: "report",
            resultRef: "report://owner/daily/latest",
            note: "captured in owner daily report",
          }),
        },
      );
      expect(markRead.status).toBe(200);
      const readPayload = (await markRead.json()) as {
        alertId: string;
        status: string;
      };
      expect(readPayload.alertId).toBe(alert.alertId);
      expect(readPayload.status).toBe("read");

      const queueAction = await fetch(
        `${server!.url}/alerts/${encodeURIComponent(alert.alertId)}/request-action?format=json`,
        {
          method: "POST",
          headers: {
            Authorization: "Bearer owner-secret",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ action: "review" }),
        },
      );
      expect(queueAction.status).toBe(200);
      const queuedPayload = (await queueAction.json()) as {
        alert: { alertId: string; actionRequestId?: string | null; actionKind?: string | null };
        request: { requestId: string; kind: string };
      };
      expect(queuedPayload.alert.alertId).toBe(alert.alertId);
      expect(queuedPayload.request.kind).toBe("opportunity_action");
      expect(queuedPayload.alert.actionRequestId).toBe(queuedPayload.request.requestId);
      expect(queuedPayload.alert.actionKind).toBe("review");
    } finally {
      await server?.close?.();
      db.close();
    }
  });

  it("serves and updates owner opportunity actions over the owner report web surface", async () => {
    const db = createTestDb();
    const hostDb = createTestDb();
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "openfox-owner-action-server-"));
    const previousHome = process.env.HOME;
    process.env.HOME = rootDir;
    let server: Awaited<ReturnType<typeof startOwnerReportServer>> | null = null;
    let bountyServer: Awaited<ReturnType<typeof startBountyHttpServer>> | null = null;
    let inferenceServer: Awaited<ReturnType<typeof startMockInferenceServer>> | null = null;
    try {
      const hostIdentity = createTestIdentity();
      const hostEngine = createBountyEngine({
        identity: hostIdentity,
        db: hostDb,
        inference: new MockInferenceClient([
          noToolResponse('{"decision":"accepted","confidence":0.96,"reason":"Correct."}'),
        ]),
        bountyConfig: {
          ...DEFAULT_BOUNTY_CONFIG,
          enabled: true,
          role: "host",
          bindHost: "127.0.0.1",
          port: 0,
        },
      });
      const bounty = hostEngine.openQuestionBounty({
        question: "Capital of Spain?",
        referenceAnswer: "Madrid",
        rewardTomi: "1000",
        submissionDeadline: "2027-03-12T00:00:00.000Z",
      });
      bountyServer = await startBountyHttpServer({
        bountyConfig: {
          ...DEFAULT_BOUNTY_CONFIG,
          enabled: true,
          role: "host",
          bindHost: "127.0.0.1",
          port: 0,
        },
        engine: hostEngine,
      });
      inferenceServer = await startMockInferenceServer("Madrid");

      const config = createTestConfig({
        inferenceModel: "ollama/test",
        ollamaBaseUrl: inferenceServer.url,
        ownerReports: {
          ...DEFAULT_OWNER_REPORTS_CONFIG,
          enabled: true,
          web: {
            ...DEFAULT_OWNER_REPORTS_CONFIG.web,
            enabled: true,
            bindHost: "127.0.0.1",
            port: 0,
            pathPrefix: "/owner",
            authToken: "owner-secret",
          },
        },
      });

      const alert = createAlert("alert-action-1");
      db.upsertOwnerOpportunityAlert(alert);
      const request = createOperatorApprovalRequest({
        db,
        config,
        kind: "opportunity_action",
        scope: "owner-alert:alert-action-1:review",
        requestedBy: "owner-alert",
        reason: "review this opportunity",
        payload: {
          alertId: alert.alertId,
          actionKind: "pursue",
          title: alert.title,
          summary: alert.summary,
          capability: alert.capability,
          baseUrl: bountyServer.url,
          payload: {
            baseUrl: bountyServer.url,
            bountyId: bounty.bountyId,
          },
        },
      });

      server = await startOwnerReportServer({ config, db });
      expect(server).not.toBeNull();

      const approve = await fetch(
        `${server!.url}/approvals/${encodeURIComponent(request.requestId)}/approve?format=json`,
        {
          method: "POST",
          headers: {
            Authorization: "Bearer owner-secret",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ note: "approved from phone" }),
        },
      );
      expect(approve.status).toBe(200);
      const approvePayload = (await approve.json()) as {
        request: { requestId: string; status: string };
        action: { actionId: string; status: string };
      };
      expect(approvePayload.request.status).toBe("approved");
      expect(approvePayload.action.status).toBe("queued");

      const actionsJson = await fetch(`${server!.url}/actions?format=json`, {
        headers: {
          Authorization: "Bearer owner-secret",
        },
      });
      expect(actionsJson.status).toBe(200);
      const actionsPayload = (await actionsJson.json()) as {
        items: Array<{ actionId: string; status: string }>;
      };
      expect(actionsPayload.items[0]?.actionId).toBe(approvePayload.action.actionId);

      const execute = await fetch(
        `${server!.url}/actions/${encodeURIComponent(approvePayload.action.actionId)}/execute?format=json`,
        {
          method: "POST",
          headers: {
            Authorization: "Bearer owner-secret",
          },
        },
      );
      expect(execute.status).toBe(200);
      const executePayload = (await execute.json()) as {
        action: { status: string; resolutionKind: string | null };
        execution: { status: string; executionRef: string | null };
      };
      expect(executePayload.action.status).toBe("completed");
      expect(executePayload.action.resolutionKind).toBe("bounty");
      expect(executePayload.execution.status).toBe("completed");

      const executionsJson = await fetch(
        `${server!.url}/action-executions?format=json&actionId=${encodeURIComponent(
          approvePayload.action.actionId,
        )}`,
        {
          headers: {
            Authorization: "Bearer owner-secret",
          },
        },
      );
      expect(executionsJson.status).toBe(200);
      const executionsPayload = (await executionsJson.json()) as {
        items: Array<{ actionId: string; status: string }>;
      };
      expect(executionsPayload.items[0]?.actionId).toBe(approvePayload.action.actionId);
      expect(executionsPayload.items[0]?.status).toBe("completed");

      const actionsHtml = await fetch(`${server!.url}/actions?token=owner-secret`);
      expect(actionsHtml.status).toBe(200);
      expect(await actionsHtml.text()).toContain("OpenFox Opportunity Actions");

      const complete = await fetch(
        `${server!.url}/actions/${encodeURIComponent(approvePayload.action.actionId)}/complete?format=json`,
        {
          method: "POST",
          headers: {
            Authorization: "Bearer owner-secret",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            resultKind: "report",
            resultRef: "report://owner/daily/latest",
            note: "captured in owner daily report",
          }),
        },
      );
      expect(complete.status).toBe(200);
      const completePayload = (await complete.json()) as {
        actionId: string;
        status: string;
        resolutionKind: string | null;
        resolutionRef: string | null;
      };
      expect(completePayload.actionId).toBe(approvePayload.action.actionId);
      expect(completePayload.status).toBe("completed");
      expect(completePayload.resolutionKind).toBe("report");
      expect(completePayload.resolutionRef).toBe("report://owner/daily/latest");
    } finally {
      process.env.HOME = previousHome;
      await server?.close?.();
      await bountyServer?.close?.();
      await inferenceServer?.close?.();
      db.close();
      hostDb.close();
      await fs.rm(rootDir, { recursive: true, force: true });
    }
  });
});
