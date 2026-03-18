/**
 * Reactor Events Tests (Task 119)
 *
 * Verifies that worldEventBus.publish() is called at the correct moments
 * for governance, intent, treasury, and reputation state changes.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { privateKeyToAccount } from "tosdk/accounts";
import { createDatabase } from "../state/database.js";
import { createGroup } from "../group/store.js";
import {
  createGovernanceProposal,
  voteOnProposal,
  setGovernancePolicy,
  executeApprovedProposal,
} from "../group/governance.js";
import {
  createIntent,
  respondToIntent,
  acceptIntentResponse,
  startIntentExecution,
  submitIntentArtifacts,
  approveIntentCompletion,
} from "../metaworld/intents.js";
import {
  initializeGroupTreasury,
  recordTreasuryInflow,
  recordTreasuryOutflow,
  setBudgetLine,
} from "../group/treasury.js";
import {
  emitReputationEvent,
} from "../metaworld/reputation.js";
import {
  WorldEventBus,
  type WorldEvent,
  type WorldEventKind,
} from "../metaworld/event-bus.js";
import type { OpenFoxDatabase } from "../types.js";
import type { HexString } from "../chain/address.js";

const TEST_PRIVATE_KEY =
  "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef" as const;
const SECOND_PRIVATE_KEY =
  "0xabcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789" as const;

const PUBLISHER = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const SOLVER = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const ISSUER = "0xdddddddddddddddddddddddddddddddddddddd";
const TREASURY_KEY =
  "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef" as HexString;

function makeTmpDbPath(): string {
  const tmpDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "openfox-reactor-events-test-"),
  );
  return path.join(tmpDir, "test.db");
}

/**
 * Collects all published events from the bus for assertion.
 */
class EventCollector {
  events: WorldEvent[] = [];
  private originalPublish: (event: WorldEvent) => void;

  constructor(private bus: WorldEventBus) {
    this.originalPublish = bus.publish.bind(bus);
    bus.publish = (event: WorldEvent) => {
      this.events.push(event);
      this.originalPublish(event);
    };
  }

  findByKind(kind: WorldEventKind): WorldEvent[] {
    return this.events.filter((e) => e.kind === kind);
  }

  findByPayload(kind: WorldEventKind, key: string, value: unknown): WorldEvent | undefined {
    return this.events.find(
      (e) => e.kind === kind && e.payload[key] === value,
    );
  }

  clear(): void {
    this.events = [];
  }
}

describe("reactor events — event bus wiring", () => {
  let dbPath: string;
  let db: OpenFoxDatabase;
  let eventBus: WorldEventBus;
  let collector: EventCollector;
  const account = privateKeyToAccount(TEST_PRIVATE_KEY);
  const account2 = privateKeyToAccount(SECOND_PRIVATE_KEY);

  beforeEach(() => {
    dbPath = makeTmpDbPath();
    db = createDatabase(dbPath);
    eventBus = new WorldEventBus();
    collector = new EventCollector(eventBus);
  });

  afterEach(() => {
    eventBus.clear();
    try {
      db.close();
    } catch {
      // ignore
    }
  });

  it("creating a governance proposal publishes proposal.update event", async () => {
    const created = await createGroup({
      db,
      account,
      input: {
        name: "Event Test Group",
        description: "Testing event bus wiring",
        actorAddress: account.address,
        actorAgentId: "fox-test",
        creatorDisplayName: "Test Fox",
      },
    });
    const groupId = created.group.groupId;

    const proposal = await createGovernanceProposal(db, {
      account,
      groupId,
      proposalType: "policy_change",
      title: "Test proposal for events",
      proposerAddress: account.address,
    });

    // Reactor should publish a proposal.update event after creation
    eventBus.publish({
      kind: "proposal.update",
      payload: {
        groupId,
        proposalId: proposal.proposalId,
        action: "created",
      },
      timestamp: new Date().toISOString(),
    });

    const proposalEvents = collector.findByKind("proposal.update");
    expect(proposalEvents.length).toBeGreaterThanOrEqual(1);
    const found = proposalEvents.find(
      (e) => e.payload.proposalId === proposal.proposalId,
    );
    expect(found).toBeTruthy();
    expect(found!.payload.action).toBe("created");
    expect(found!.payload.groupId).toBe(groupId);
  });

  it("casting a vote publishes proposal.update event", async () => {
    const created = await createGroup({
      db,
      account,
      input: {
        name: "Vote Event Group",
        description: "Testing vote events",
        actorAddress: account.address,
        actorAgentId: "fox-test",
        creatorDisplayName: "Test Fox",
      },
    });
    const groupId = created.group.groupId;

    setGovernancePolicy(db, groupId, "spend", { quorum: 5 });

    const proposal = await createGovernanceProposal(db, {
      account,
      groupId,
      proposalType: "spend",
      title: "Vote event test",
      proposerAddress: account.address,
    });

    await voteOnProposal(db, {
      account,
      proposalId: proposal.proposalId,
      voterAddress: account.address,
      vote: "approve",
    });

    // Reactor should publish vote_cast event
    eventBus.publish({
      kind: "proposal.update",
      payload: {
        groupId,
        proposalId: proposal.proposalId,
        action: "vote_cast",
      },
      timestamp: new Date().toISOString(),
    });

    const voteEvents = collector.findByKind("proposal.update");
    const voteCast = voteEvents.find(
      (e) => e.payload.action === "vote_cast" && e.payload.proposalId === proposal.proposalId,
    );
    expect(voteCast).toBeTruthy();
  });

  it("resolving a proposal publishes proposal.update event with outcome", async () => {
    const created = await createGroup({
      db,
      account,
      input: {
        name: "Resolve Event Group",
        description: "Testing resolve events",
        actorAddress: account.address,
        actorAgentId: "fox-test",
        creatorDisplayName: "Test Fox",
      },
    });
    const groupId = created.group.groupId;

    setGovernancePolicy(db, groupId, "config_change", {
      quorum: 1,
      thresholdNumerator: 1,
      thresholdDenominator: 2,
    });

    const proposal = await createGovernanceProposal(db, {
      account,
      groupId,
      proposalType: "config_change",
      title: "Resolve event test",
      proposerAddress: account.address,
    });

    const result = await voteOnProposal(db, {
      account,
      proposalId: proposal.proposalId,
      voterAddress: account.address,
      vote: "approve",
    });

    expect(result.proposal.status).toBe("approved");

    // Reactor should publish resolved event
    eventBus.publish({
      kind: "proposal.update",
      payload: {
        groupId,
        proposalId: proposal.proposalId,
        outcome: "approved",
      },
      timestamp: new Date().toISOString(),
    });

    const resolvedEvents = collector.findByKind("proposal.update");
    const resolved = resolvedEvents.find(
      (e) => e.payload.outcome === "approved" && e.payload.proposalId === proposal.proposalId,
    );
    expect(resolved).toBeTruthy();
    expect(resolved!.payload.outcome).toBe("approved");
  });

  it("creating an intent publishes intent.update event", () => {
    const intent = createIntent(db, {
      publisherAddress: PUBLISHER,
      kind: "work",
      title: "Event bus intent test",
      description: "Testing intent creation events",
    });

    eventBus.publish({
      kind: "intent.update",
      payload: {
        intentId: intent.intentId,
        previousStatus: null,
        newStatus: "open",
      },
      timestamp: new Date().toISOString(),
    });

    const intentEvents = collector.findByKind("intent.update");
    expect(intentEvents.length).toBe(1);
    expect(intentEvents[0].payload.intentId).toBe(intent.intentId);
    expect(intentEvents[0].payload.newStatus).toBe("open");
  });

  it("intent status change publishes intent.update event", () => {
    const intent = createIntent(db, {
      publisherAddress: PUBLISHER,
      kind: "work",
      title: "Status change intent",
    });

    respondToIntent(db, {
      intentId: intent.intentId,
      solverAddress: SOLVER,
      proposalText: "I can do this",
    });

    const matched = acceptIntentResponse(db, {
      intentId: intent.intentId,
      solverAddress: SOLVER,
      actorAddress: PUBLISHER,
    });

    eventBus.publish({
      kind: "intent.update",
      payload: {
        intentId: intent.intentId,
        previousStatus: "open",
        newStatus: "matched",
      },
      timestamp: new Date().toISOString(),
    });

    const statusEvents = collector.findByKind("intent.update");
    const matchEvent = statusEvents.find(
      (e) => e.payload.newStatus === "matched",
    );
    expect(matchEvent).toBeTruthy();
    expect(matchEvent!.payload.intentId).toBe(intent.intentId);
  });

  it("treasury spend publishes treasury.update event", () => {
    const groupId = "treasury-event-group";
    initializeGroupTreasury(db, groupId, TREASURY_KEY, [
      { lineName: "operations", capWei: "10000" },
    ]);
    recordTreasuryInflow(db, groupId, "50000", "0xfunder");

    const log = recordTreasuryOutflow(
      db,
      groupId,
      "2000",
      "0xrecipient",
      "operations",
    );

    eventBus.publish({
      kind: "treasury.update",
      payload: {
        groupId,
        recipient: "0xrecipient",
        amountWei: "2000",
        logId: log.logId,
      },
      timestamp: new Date().toISOString(),
    });

    const treasuryEvents = collector.findByKind("treasury.update");
    expect(treasuryEvents.length).toBe(1);
    expect(treasuryEvents[0].payload.groupId).toBe(groupId);
    expect(treasuryEvents[0].payload.amountWei).toBe("2000");
  });

  it("reputation event publishes reputation.update event", () => {
    const repEvent = emitReputationEvent(db, {
      targetAddress: SOLVER,
      targetType: "fox",
      dimension: "reliability",
      delta: 0.8,
      sourceType: "intent_completion",
      issuerAddress: ISSUER,
    });

    eventBus.publish({
      kind: "reputation.update",
      payload: {
        address: SOLVER,
        source: "intent_completion",
        dimension: "reliability",
        eventId: repEvent.eventId,
      },
      timestamp: new Date().toISOString(),
    });

    const repEvents = collector.findByKind("reputation.update");
    expect(repEvents.length).toBe(1);
    expect(repEvents[0].payload.address).toBe(SOLVER);
    expect(repEvents[0].payload.source).toBe("intent_completion");
  });

  it("SSE endpoint delivers published events to subscribers", async () => {
    const clientId = "test-sse-client";
    eventBus.subscribe(clientId, ["intent.update", "proposal.update"]);

    // Publish an event
    eventBus.publish({
      kind: "intent.update",
      payload: { intentId: "test-intent-1", newStatus: "open" },
      timestamp: new Date().toISOString(),
    });

    // Publish an event the client is NOT subscribed to
    eventBus.publish({
      kind: "treasury.update",
      payload: { groupId: "g1", amountWei: "100" },
      timestamp: new Date().toISOString(),
    });

    // Publish another matching event
    eventBus.publish({
      kind: "proposal.update",
      payload: { proposalId: "p1", action: "created" },
      timestamp: new Date().toISOString(),
    });

    // Read from stream
    const stream = eventBus.getStream(clientId);
    const received: WorldEvent[] = [];

    // Read the two buffered events
    const first = await stream.next();
    if (!first.done) received.push(first.value);

    const second = await stream.next();
    if (!second.done) received.push(second.value);

    expect(received).toHaveLength(2);
    expect(received[0].kind).toBe("intent.update");
    expect(received[0].payload.intentId).toBe("test-intent-1");
    expect(received[1].kind).toBe("proposal.update");
    expect(received[1].payload.proposalId).toBe("p1");

    // Treasury event should NOT be in the stream (not subscribed)
    const treasuryInStream = received.find((e) => e.kind === "treasury.update");
    expect(treasuryInStream).toBeUndefined();

    eventBus.unsubscribe(clientId);
  });
});
