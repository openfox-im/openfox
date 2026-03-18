import { beforeEach, describe, expect, it } from "vitest";
import { createMarketBindingPublisher } from "../market/publisher.js";
import { createTestDb, createTestIdentity } from "./mocks.js";

describe("market binding publisher", () => {
  beforeEach(() => {});

  it("publishes and stores an idempotent market binding", () => {
    const db = createTestDb();
    const identity = createTestIdentity();
    const publisher = createMarketBindingPublisher({
      db,
      now: () => new Date("2026-03-09T00:00:00.000Z"),
    });

    const first = publisher.publish({
      kind: "observation",
      subjectId: "job-1",
      publisherAddress: identity.address,
      capability: "observation.once",
      artifactUrl: "/jobs/job-1",
      metadata: { target_url: "https://example.com/data.json" },
    });
    const second = publisher.publish({
      kind: "observation",
      subjectId: "job-1",
      publisherAddress: identity.address,
      capability: "observation.once",
      artifactUrl: "/jobs/job-1",
      metadata: { target_url: "https://example.com/data.json" },
    });

    expect(first.bindingId).toBe("observation:job-1");
    expect(second.receiptHash).toBe(first.receiptHash);
    const stored = db.getMarketBinding("observation", "job-1");
    expect(stored?.bindingId).toBe(first.bindingId);
    expect(stored?.receiptHash).toBe(first.receiptHash);
    db.close();
  });
});
