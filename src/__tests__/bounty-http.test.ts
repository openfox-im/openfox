import { afterEach, describe, expect, it } from "vitest";
import { createBountyEngine } from "../bounty/engine.js";
import { startBountyHttpServer } from "../bounty/http.js";
import { MockInferenceClient, createTestDb, noToolResponse } from "./mocks.js";
import { DEFAULT_BOUNTY_CONFIG } from "../types.js";
import type { OpenFoxIdentity } from "../types.js";

const HOST_ADDRESS =
  "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const SOLVER_ADDRESS =
  "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

function createIdentity(): OpenFoxIdentity {
  return {
    name: "host-openfox",
    address: HOST_ADDRESS,
    account: {} as any,
    creatorAddress: HOST_ADDRESS,
    sandboxId: "host-agent",
    apiKey: "",
    createdAt: "2026-03-09T00:00:00.000Z",
  };
}

describe("bounty http server", () => {
  const db = createTestDb();

  afterEach(() => {
    db.raw.exec("DELETE FROM bounty_results");
    db.raw.exec("DELETE FROM bounty_submissions");
    db.raw.exec("DELETE FROM bounties");
  });

  it("serves the host bounty API and auto-judges submissions", async () => {
    const inference = new MockInferenceClient([
      noToolResponse(
        '{"decision":"accepted","confidence":0.96,"reason":"Correct."}',
      ),
      noToolResponse(
        '{"decision":"accepted","confidence":0.94,"reason":"Translation matches."}',
      ),
    ]);

    const engine = createBountyEngine({
      identity: createIdentity(),
      db,
      inference,
      bountyConfig: {
        ...DEFAULT_BOUNTY_CONFIG,
        enabled: true,
        role: "host",
        bindHost: "127.0.0.1",
        port: 0,
      },
      payoutSender: {
        async send() {
          return { txHash: "0xreward" };
        },
      },
      now: () => new Date("2026-03-09T00:00:00.000Z"),
    });

    const server = await startBountyHttpServer({
      bountyConfig: {
        ...DEFAULT_BOUNTY_CONFIG,
        enabled: true,
        role: "host",
        bindHost: "127.0.0.1",
        port: 0,
      },
      engine,
    });

    try {
      const createResponse = await fetch(`${server.url}/bounties`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: "Capital of France?",
          reference_answer: "Paris",
          reward_wei: "2000",
          submission_ttl_seconds: 3600,
        }),
      });
      expect(createResponse.status).toBe(201);
      const bounty = (await createResponse.json()) as { bountyId: string };

      const listResponse = await fetch(`${server.url}/bounties`);
      const listPayload = (await listResponse.json()) as { items: Array<{ bountyId: string }> };
      expect(listPayload.items.some((item) => item.bountyId === bounty.bountyId)).toBe(true);

      const submitResponse = await fetch(`${server.url}/bounties/${bounty.bountyId}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          solver_address: SOLVER_ADDRESS,
          answer: "Paris",
        }),
      });
      expect(submitResponse.status).toBe(200);

      const resultResponse = await fetch(`${server.url}/bounties/${bounty.bountyId}/result`);
      const resultPayload = (await resultResponse.json()) as {
        result: { decision: string; payoutTxHash: string | null };
      };
      expect(resultPayload.result.decision).toBe("accepted");
      expect(resultPayload.result.payoutTxHash).toBe("0xreward");

      const createTranslation = await fetch(`${server.url}/bounties`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "translation",
          title: "Translate hello",
          task_prompt: "Translate 'hello' into Chinese.",
          reference_output: "你好",
          reward_wei: "2000",
          submission_ttl_seconds: 3600,
        }),
      });
      expect(createTranslation.status).toBe(201);
      const translation = (await createTranslation.json()) as { bountyId: string };

      const submitTranslation = await fetch(
        `${server.url}/bounties/${translation.bountyId}/submit`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            solver_address:
              "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
            submission_text: "你好",
          }),
        },
      );
      expect(submitTranslation.status).toBe(200);
    } finally {
      await server.close();
    }
  });
});
