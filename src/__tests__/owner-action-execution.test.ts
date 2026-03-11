import { afterEach, describe, expect, it } from "vitest";
import { createBountyEngine } from "../bounty/engine.js";
import { startBountyHttpServer } from "../bounty/http.js";
import {
  executeOwnerOpportunityAction,
  executeQueuedOwnerOpportunityActions,
} from "../reports/action-execution.js";
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
  const now = "2026-03-11T18:00:00.000Z";
  const config = createTestConfig();
  params.db.upsertOwnerOpportunityAlert({
    alertId: params.alertId,
    opportunityHash:
      "0x1111111111111111111111111111111111111111111111111111111111111111",
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
        submissionDeadline: "2026-03-12T00:00:00.000Z",
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
        installedAt: "2026-03-11T18:00:00.000Z",
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
});
