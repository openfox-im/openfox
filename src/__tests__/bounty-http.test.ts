import { afterEach, describe, expect, it } from "vitest";
import { createBountyEngine } from "../bounty/engine.js";
import { startBountyHttpServer } from "../bounty/http.js";
import { MockInferenceClient, createTestDb, noToolResponse } from "./mocks.js";
import { DEFAULT_BOUNTY_CONFIG } from "../types.js";
import type { OpenFoxIdentity } from "../types.js";

const HOST_ADDRESS =
  "0x12252ae6b5d22fa4f58b295fe42cdb782f41881025d22645816d196b4f2e5143";
const SOLVER_ADDRESS =
  "0xdca90de7e66cec3a5c7683922036c75aa691b36b473f162b905590f8031217c2";

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
    db.raw.exec("DELETE FROM campaigns");
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
      settlementPublisher: {
        async publish(input) {
          const record = {
            receiptId: `bounty:${input.subjectId}`,
            kind: "bounty",
            subjectId: input.subjectId,
            receipt: {
              version: 1,
              receiptId: `bounty:${input.subjectId}`,
              kind: "bounty",
              subjectId: input.subjectId,
              publisherAddress: HOST_ADDRESS,
              resultHash:
                "0x752a3d0f953b4ae91fca3bf4c1b93863c1884902f778aa65ff6e3aa02f730d02",
              createdAt: "2026-03-09T00:00:00.000Z",
            },
            receiptHash:
              "0x976eafa23799bc976e0d3da2d651f1caac6b3bcc292380de921560142fbba9e6",
            settlementTxHash:
              "0xfb43d57082cdcd5103e2d7593ab60734eeee43e7c023635d644c37105b69c022",
            createdAt: "2026-03-09T00:00:00.000Z",
            updatedAt: "2026-03-09T00:00:00.000Z",
          };
          db.upsertSettlementReceipt(record);
          return record;
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
      const createCampaign = await fetch(`${server.url}/campaigns`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "Spring Sprint",
          description: "Group several translation tasks.",
          budget_tomi: "10000",
          max_open_bounties: 2,
          allowed_kinds: ["question", "translation"],
        }),
      });
      expect(createCampaign.status).toBe(201);
      const campaign = (await createCampaign.json()) as { campaignId: string };

      const campaignsResponse = await fetch(`${server.url}/campaigns`);
      const campaignsPayload = (await campaignsResponse.json()) as {
        items: Array<{ campaignId: string }>;
      };
      expect(campaignsPayload.items.some((item) => item.campaignId === campaign.campaignId)).toBe(
        true,
      );

      const createResponse = await fetch(`${server.url}/bounties`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          campaign_id: campaign.campaignId,
          question: "Capital of France?",
          reference_answer: "Paris",
          reward_tomi: "2000",
          submission_ttl_seconds: 3600,
        }),
      });
      expect(createResponse.status).toBe(201);
      const bounty = (await createResponse.json()) as { bountyId: string; campaignId: string };
      expect(bounty.campaignId).toBe(campaign.campaignId);

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
        settlement: { receiptId: string; settlementTxHash: string };
      };
      expect(resultPayload.result.decision).toBe("accepted");
      expect(resultPayload.result.payoutTxHash).toBe("0xreward");
      expect(resultPayload.settlement.receiptId).toBe(`bounty:${bounty.bountyId}`);
      expect(resultPayload.settlement.settlementTxHash).toBe(
        "0xfb43d57082cdcd5103e2d7593ab60734eeee43e7c023635d644c37105b69c022",
      );

      const campaignStatus = await fetch(`${server.url}/campaigns/${campaign.campaignId}`);
      const campaignDetails = (await campaignStatus.json()) as {
        campaign: { campaignId: string };
        progress: { allocatedTomi: string };
        bounties: Array<{ bountyId: string }>;
      };
      expect(campaignDetails.campaign.campaignId).toBe(campaign.campaignId);
      expect(campaignDetails.progress.allocatedTomi).toBe("2000");
      expect(campaignDetails.bounties.some((item) => item.bountyId === bounty.bountyId)).toBe(true);

      const createTranslation = await fetch(`${server.url}/bounties`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "translation",
          title: "Translate hello",
          task_prompt: "Translate 'hello' into Chinese.",
          reference_output: "你好",
          reward_tomi: "2000",
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
              "0xc9b7083ed72ae7501f0f76c6fa2737ea3643ce0a7c85b2d81f4a2d030aea04ed",
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
