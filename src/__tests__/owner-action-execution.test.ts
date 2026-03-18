import http from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createBountyEngine } from "../bounty/engine.js";
import { startBountyHttpServer } from "../bounty/http.js";
import {
  executeOwnerOpportunityAction,
  executeQueuedOwnerOpportunityActions,
} from "../reports/action-execution.js";
import * as bountyClientModule from "../bounty/client.js";
import {
  createOperatorApprovalRequest,
  decideOperatorApprovalRequest,
} from "../operator/autopilot.js";
import { materializeApprovedOwnerOpportunityAction } from "../reports/actions.js";
import {
  MockInferenceClient,
  createTestConfig,
  createTestDb,
  createTestIdentity,
  noToolResponse,
} from "./mocks.js";
import { DEFAULT_BOUNTY_CONFIG, DEFAULT_OWNER_REPORTS_CONFIG } from "../types.js";

const servers: Array<{ close(): Promise<void> }> = [];

afterEach(async () => {
  while (servers.length) {
    const server = servers.pop();
    if (!server) continue;
    await server.close();
  }
});

function createQueuedPursueAction(params: {
  db: ReturnType<typeof createTestDb>;
  baseUrl: string;
  bountyId: string;
  alertId: string;
}) {
  const now = "2027-03-11T18:00:00.000Z";
  const config = createTestConfig();
  params.db.upsertOwnerOpportunityAlert({
    alertId: params.alertId,
    opportunityHash:
      "0x752a3d0f953b4ae91fca3bf4c1b93863c1884902f778aa65ff6e3aa02f730d02",
    kind: "bounty",
    providerClass: "task_market",
    trustTier: "org_trusted",
    title: "Solve one bounded bounty",
    summary: "Remote bounty action.",
    suggestedAction: "Pursue this bounty.",
    capability: "task.submit",
    baseUrl: params.baseUrl,
    rewardWei: "1000",
    estimatedCostWei: "10",
    marginWei: "990",
    marginBps: 9900,
    strategyScore: 1200,
    strategyMatched: true,
    strategyReasons: [],
    payload: {
      baseUrl: params.baseUrl,
      bountyId: params.bountyId,
    },
    status: "unread",
    actionKind: null,
    actionRequestId: null,
    actionRequestedAt: null,
    createdAt: now,
    updatedAt: now,
    readAt: null,
    dismissedAt: null,
  });
  const request = createOperatorApprovalRequest({
    db: params.db,
    config,
    kind: "opportunity_action",
    scope: `owner-alert:${params.alertId}:pursue`,
    requestedBy: "owner-test",
    summary: "pursue remote bounty",
    payload: {
      alertId: params.alertId,
      actionKind: "pursue",
      title: "Solve one bounded bounty",
      summary: "Remote bounty action.",
      capability: "task.submit",
      baseUrl: params.baseUrl,
      payload: {
        baseUrl: params.baseUrl,
        bountyId: params.bountyId,
      },
    },
  });
  const approved = decideOperatorApprovalRequest({
    db: params.db,
    requestId: request.requestId,
    status: "approved",
    decidedBy: "owner-test",
    decisionNote: "execute automatically",
  });
  return materializeApprovedOwnerOpportunityAction({
    db: params.db,
    requestId: approved.requestId,
  });
}

describe("owner action execution", () => {
  it("executes a queued pursue action against a remote bounty host", async () => {
    const hostDb = createTestDb();
    const ownerDb = createTestDb();
    const hostIdentity = createTestIdentity();
    const ownerIdentity = createTestIdentity();

    try {
      const hostInference = new MockInferenceClient([
        noToolResponse(
          '{"decision":"accepted","confidence":0.98,"reason":"Correct."}',
        ),
      ]);
      const hostEngine = createBountyEngine({
        identity: hostIdentity,
        db: hostDb,
        inference: hostInference,
        bountyConfig: {
          ...DEFAULT_BOUNTY_CONFIG,
          enabled: true,
          role: "host",
          bindHost: "127.0.0.1",
          port: 0,
        },
      });
      const bounty = hostEngine.openQuestionBounty({
        question: "Capital of Italy?",
        referenceAnswer: "Rome",
        rewardWei: "1000",
        submissionDeadline: "2027-03-12T00:00:00.000Z",
      });
      const bountyServer = await startBountyHttpServer({
        bountyConfig: {
          ...DEFAULT_BOUNTY_CONFIG,
          enabled: true,
          role: "host",
          bindHost: "127.0.0.1",
          port: 0,
        },
        engine: hostEngine,
      });
      servers.push(bountyServer);

      ownerDb.upsertSkill({
        name: "question-bounty-solver",
        description: "solver",
        autoActivate: false,
        instructions: "Answer with the shortest canonical answer only.",
        source: "bundled",
        path: "skills/question-bounty-solver/SKILL.md",
        enabled: true,
        installedAt: "2027-03-11T18:00:00.000Z",
      });
      const action = createQueuedPursueAction({
        db: ownerDb,
        baseUrl: bountyServer.url,
        bountyId: bounty.bountyId,
        alertId: "alert-remote-bounty",
      });

      const result = await executeOwnerOpportunityAction({
        identity: ownerIdentity,
        config: createTestConfig({
          walletAddress: ownerIdentity.address,
          ownerReports: {
            ...DEFAULT_OWNER_REPORTS_CONFIG,
            enabled: true,
          },
        }),
        db: ownerDb,
        inference: new MockInferenceClient([noToolResponse("Rome")]),
        actionId: action.actionId,
      });

      expect(result.execution.status).toBe("completed");
      expect(result.execution.kind).toBe("remote_bounty_solve");
      expect(result.action.status).toBe("completed");
      expect(result.action.resolutionKind).toBe("bounty");
      expect(hostDb.getBountyResult(bounty.bountyId)?.decision).toBe("accepted");
    } finally {
      hostDb.close();
      ownerDb.close();
    }
  });

  it("respects execution cooldown when scanning queued actions", async () => {
    const db = createTestDb();
    try {
      const action = createQueuedPursueAction({
        db,
        baseUrl: "https://host.example.com",
        bountyId: "bounty-1",
        alertId: "alert-cooldown",
      });
      db.upsertOwnerOpportunityActionExecution({
        executionId: "owner-action-exec:recent",
        actionId: action.actionId,
        kind: "remote_bounty_solve",
        targetKind: "bounty",
        targetRef: "bounty-1",
        remoteBaseUrl: "https://host.example.com",
        status: "failed",
        requestPayload: {},
        resultPayload: null,
        executionRef: null,
        errorMessage: "remote down",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        completedAt: null,
        failedAt: new Date().toISOString(),
      });

      const result = await executeQueuedOwnerOpportunityActions({
        identity: createTestIdentity(),
        config: createTestConfig(),
        db,
        inference: new MockInferenceClient([noToolResponse("Rome")]),
        cooldownSeconds: 300,
        autoExecutePursue: true,
      });

      expect(result.attempted).toBe(0);
      expect(result.items).toHaveLength(0);
      expect(db.listOwnerOpportunityActionExecutions(10, { actionId: action.actionId })).toHaveLength(1);
    } finally {
      db.close();
    }
  });

  it("queues one bounded follow-up action after a successful remote campaign execution", async () => {
    const hostDb = createTestDb();
    const ownerDb = createTestDb();
    const hostIdentity = createTestIdentity();
    const ownerIdentity = createTestIdentity();

    try {
      const hostInference = new MockInferenceClient([
        noToolResponse('{"decision":"accepted","confidence":0.98,"reason":"Correct."}'),
      ]);
      const hostEngine = createBountyEngine({
        identity: hostIdentity,
        db: hostDb,
        inference: hostInference,
        bountyConfig: {
          ...DEFAULT_BOUNTY_CONFIG,
          enabled: true,
          role: "host",
          bindHost: "127.0.0.1",
          port: 0,
        },
      });
      const campaign = hostEngine.createCampaign({
        title: "Macro campaign",
        description: "Solve one bounded bounty at a time.",
        budgetWei: "5000",
        maxOpenBounties: 4,
        allowedKinds: ["question"],
      });
      const bountyOne = hostEngine.openQuestionBounty({
        question: "Capital of Italy?",
        referenceAnswer: "Rome",
        rewardWei: "1000",
        submissionDeadline: "2027-03-12T00:00:00.000Z",
        campaignId: campaign.campaignId,
      });
      const bountyTwo = hostEngine.openQuestionBounty({
        question: "Capital of Spain?",
        referenceAnswer: "Madrid",
        rewardWei: "900",
        submissionDeadline: "2027-03-12T00:00:00.000Z",
        campaignId: campaign.campaignId,
      });
      const bountyServer = await startBountyHttpServer({
        bountyConfig: {
          ...DEFAULT_BOUNTY_CONFIG,
          enabled: true,
          role: "host",
          bindHost: "127.0.0.1",
          port: 0,
        },
        engine: hostEngine,
      });
      servers.push(bountyServer);

      ownerDb.upsertSkill({
        name: "question-bounty-solver",
        description: "solver",
        autoActivate: false,
        instructions: "Answer with the shortest canonical answer only.",
        source: "bundled",
        path: "skills/question-bounty-solver/SKILL.md",
        enabled: true,
        installedAt: "2027-03-11T18:00:00.000Z",
      });
      ownerDb.upsertOwnerOpportunityAction({
        actionId: "owner-action:campaign-root",
        alertId: "owner-alert:campaign-root",
        requestId: "owner-request:campaign-root",
        kind: "pursue",
        title: "Solve campaign macro bounties",
        summary: "Execute one bounded campaign solve and queue a follow-up if possible.",
        capability: "campaign.solve",
        baseUrl: bountyServer.url,
        requestedBy: "owner-test",
        approvedBy: "owner-test",
        approvedAt: "2027-03-11T18:00:00.000Z",
        decisionNote: "auto pursue",
        payload: {
          baseUrl: bountyServer.url,
          campaignId: campaign.campaignId,
          followUpDepth: 0,
        },
        status: "queued",
        resolutionKind: null,
        resolutionRef: null,
        resolutionNote: null,
        queuedAt: "2027-03-11T18:00:00.000Z",
        createdAt: "2027-03-11T18:00:00.000Z",
        updatedAt: "2027-03-11T18:00:00.000Z",
        completedAt: null,
        cancelledAt: null,
      });
      const fetchCampaignSpy = vi
        .spyOn(bountyClientModule, "fetchRemoteCampaign")
        .mockResolvedValue({
          campaign,
          progress: {
            openBountyCount: 2,
            totalBountyCount: 2,
            allocatedWei: "1900",
            remainingWei: "3100",
          },
          bounties: [bountyOne, bountyTwo],
        });

      const result = await executeOwnerOpportunityAction({
        identity: ownerIdentity,
        config: createTestConfig({
          walletAddress: ownerIdentity.address,
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
        }),
        db: ownerDb,
        inference: new MockInferenceClient([noToolResponse("Rome")]),
        actionId: "owner-action:campaign-root",
      });
      fetchCampaignSpy.mockRestore();

      expect(result.execution.status).toBe("completed");
      expect(result.execution.kind).toBe("remote_campaign_solve");
      expect(result.action.status).toBe("completed");
      const queued = ownerDb.listOwnerOpportunityActions(10, { status: "queued" });
      expect(queued).toHaveLength(1);
      expect(queued[0]?.payload.parentActionId).toBe("owner-action:campaign-root");
      expect(queued[0]?.payload.followUpDepth).toBe(1);
      expect(queued[0]?.payload.bountyId).toBe(bountyTwo.bountyId);
      expect(result.execution.resultPayload?.followUp).toMatchObject({
        queuedCount: 1,
      });
      expect(result.execution.resultPayload?.selectedBountyId).toBe(bountyOne.bountyId);
    } finally {
      hostDb.close();
      ownerDb.close();
    }
  });

  it("executes a queued delegate action against a remote observation provider", async () => {
    const db = createTestDb();
    const identity = createTestIdentity();
    let capturedBody: any = null;
    const server = http.createServer((req, res) => {
      if (req.method !== "POST") {
        res.writeHead(405);
        res.end();
        return;
      }
      const chunks: Buffer[] = [];
      req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      req.on("end", () => {
        capturedBody = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            status: "ok",
            job_id: "obs-job-1",
            observed_at: Math.floor(Date.now() / 1000),
            target_url: capturedBody.target_url,
            http_status: 200,
            content_type: "application/json",
            body_text: "{\"ok\":true}",
            body_sha256: "0xobs",
            size_bytes: 13,
          }),
        );
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    const baseUrl =
      address && typeof address === "object"
        ? `http://127.0.0.1:${address.port}/observe`
        : "http://127.0.0.1/observe";

    try {
      db.upsertOwnerOpportunityAction({
        actionId: "owner-action:delegate-observation",
        alertId: "owner-alert:delegate-observation",
        requestId: "approval:delegate-observation",
        kind: "delegate",
        title: "Delegate one observation request",
        summary: "Issue one bounded paid observation request.",
        capability: "observation.once",
        baseUrl,
        requestedBy: "owner-test",
        approvedBy: "owner-test",
        approvedAt: "2027-03-11T18:00:00.000Z",
        decisionNote: "delegate automatically",
        payload: {
          baseUrl,
          capability: "observation.once",
          targetUrl: "https://example.com/test",
          reason: "owner delegated observation",
        },
        status: "queued",
        resolutionKind: null,
        resolutionRef: null,
        resolutionNote: null,
        queuedAt: "2027-03-11T18:00:00.000Z",
        createdAt: "2027-03-11T18:00:00.000Z",
        updatedAt: "2027-03-11T18:00:00.000Z",
        completedAt: null,
        cancelledAt: null,
      });

      const result = await executeOwnerOpportunityAction({
        identity,
        config: createTestConfig({
          walletAddress: identity.address,
          ownerReports: {
            ...DEFAULT_OWNER_REPORTS_CONFIG,
            enabled: true,
            actionExecution: {
              ...DEFAULT_OWNER_REPORTS_CONFIG.actionExecution!,
              enabled: true,
              autoExecuteDelegate: true,
            },
          },
        }),
        db,
        inference: new MockInferenceClient(),
        actionId: "owner-action:delegate-observation",
      });

      expect(result.execution.status).toBe("completed");
      expect(result.execution.kind).toBe("remote_observation_request");
      expect(result.action.status).toBe("completed");
      expect(result.action.resolutionKind).toBe("provider_call");
      expect(result.action.resolutionRef).toBe("obs-job-1");
      expect(capturedBody?.target_url).toBe("https://example.com/test");
      expect(capturedBody?.capability).toBe("observation.once");
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      db.close();
    }
  });
});
