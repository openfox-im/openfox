import { afterEach, describe, expect, it } from "vitest";
import { createBountyEngine } from "../bounty/engine.js";
import {
  ensureAutoQuestionBountyOpen,
  runSolverBountyPass,
} from "../bounty/automation.js";
import { startBountyHttpServer } from "../bounty/http.js";
import {
  MockInferenceClient,
  createTestConfig,
  createTestDb,
  noToolResponse,
} from "./mocks.js";
import type { BountyConfig, OpenFoxIdentity } from "../types.js";
import { DEFAULT_BOUNTY_CONFIG } from "../types.js";

const HOST_ADDRESS =
  "0x1111111111111111111111111111111111111111111111111111111111111111";
const SOLVER_ADDRESS =
  "0x2222222222222222222222222222222222222222222222222222222222222222";

function createIdentity(
  name: string,
  address: `0x${string}`,
  sandboxId: string,
): OpenFoxIdentity {
  return {
    name,
    address,
    account: {} as any,
    creatorAddress: address,
    sandboxId,
    apiKey: "",
    createdAt: "2026-03-09T00:00:00.000Z",
  };
}

describe("bounty automation", () => {
  const hostDb = createTestDb();
  const solverDb = createTestDb();

  afterEach(() => {
    for (const db of [hostDb, solverDb]) {
      db.raw.exec("DELETE FROM bounty_results");
      db.raw.exec("DELETE FROM bounty_submissions");
      db.raw.exec("DELETE FROM bounties");
      db.raw.exec("DELETE FROM kv");
    }
  });

  it("auto-opens one bounded question bounty and does not duplicate while open", async () => {
    const hostIdentity = createIdentity("host", HOST_ADDRESS, "host-agent");
    const bountyConfig: BountyConfig = {
      ...DEFAULT_BOUNTY_CONFIG,
      enabled: true,
      role: "host",
      autoOpenOnStartup: true,
      autoOpenWhenIdle: true,
    };
    const inference = new MockInferenceClient([
      noToolResponse(
        '{"question":"Capital of Japan?","reference_answer":"Tokyo","submission_ttl_seconds":1800}',
      ),
    ]);
    const engine = createBountyEngine({
      identity: hostIdentity,
      db: hostDb,
      inference,
      bountyConfig,
      now: () => new Date("2026-03-09T00:00:00.000Z"),
    });

    const opened = await ensureAutoQuestionBountyOpen({
      identity: hostIdentity,
      db: hostDb,
      inference,
      bountyConfig,
      engine,
    });
    expect(opened?.question).toBe("Capital of Japan?");
    expect(hostDb.listBounties().length).toBe(1);

    const duplicate = await ensureAutoQuestionBountyOpen({
      identity: hostIdentity,
      db: hostDb,
      inference,
      bountyConfig,
      engine,
    });
    expect(duplicate).toBeNull();
    expect(hostDb.listBounties().length).toBe(1);
  });

  it("solver discovers a remote host via direct base URL and submits one answer", async () => {
    const hostIdentity = createIdentity("host", HOST_ADDRESS, "host-agent");
    const solverIdentity = createIdentity("solver", SOLVER_ADDRESS, "solver-agent");

    const hostInference = new MockInferenceClient([
      noToolResponse(
        '{"decision":"accepted","confidence":0.97,"reason":"Correct canonical answer."}',
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
      now: () => new Date("2026-03-09T00:00:00.000Z"),
    });

    const bounty = hostEngine.openQuestionBounty({
      question: "Capital of France?",
      referenceAnswer: "Paris",
      rewardWei: "1000",
      submissionDeadline: "2026-03-09T01:00:00.000Z",
    });

    const server = await startBountyHttpServer({
      bountyConfig: {
        ...DEFAULT_BOUNTY_CONFIG,
        enabled: true,
        role: "host",
        bindHost: "127.0.0.1",
        port: 0,
      },
      engine: hostEngine,
    });

    try {
      const solverInference = new MockInferenceClient([noToolResponse("Paris")]);
      const result = await runSolverBountyPass({
        identity: solverIdentity,
        config: createTestConfig({
          walletAddress: SOLVER_ADDRESS,
          bounty: {
            ...DEFAULT_BOUNTY_CONFIG,
            enabled: true,
            role: "solver",
            remoteBaseUrl: server.url,
            autoSolveOnStartup: true,
          },
        }),
        db: solverDb,
        inference: solverInference,
      });

      expect(result).not.toBeNull();
      expect(result?.bountyId).toBe(bounty.bountyId);
      expect(result?.answer).toBe("Paris");
      expect(hostDb.getBountyResult(bounty.bountyId)?.decision).toBe("accepted");

      const secondPass = await runSolverBountyPass({
        identity: solverIdentity,
        config: createTestConfig({
          walletAddress: SOLVER_ADDRESS,
          bounty: {
            ...DEFAULT_BOUNTY_CONFIG,
            enabled: true,
            role: "solver",
            remoteBaseUrl: server.url,
            autoSolveOnStartup: true,
          },
        }),
        db: solverDb,
        inference: solverInference,
      });
      expect(secondPass).toBeNull();
    } finally {
      await server.close();
    }
  });
});
