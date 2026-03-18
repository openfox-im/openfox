/**
 * Heartbeat Tests
 *
 * Tests for heartbeat tasks, especially the social inbox checker.
 * Phase 1.1: Updated to pass TickContext + HeartbeatLegacyContext.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { BUILTIN_TASKS } from "../heartbeat/tasks.js";
import {
  MockRuntimeClient,
  MockSocialClient,
  createTestDb,
  createTestIdentity,
  createTestConfig,
} from "./mocks.js";
import type { OpenFoxDatabase, InboxMessage, TickContext, HeartbeatLegacyContext } from "../types.js";

function createMockTickContext(db: OpenFoxDatabase, overrides?: Partial<TickContext>): TickContext {
  return {
    tickId: "test-tick-1",
    startedAt: new Date(),
    creditBalance: 10_000,
    walletBalance: 1.5,
    survivalTier: "normal",
    lowComputeMultiplier: 4,
    config: {
      entries: [],
      defaultIntervalMs: 60_000,
      lowComputeMultiplier: 4,
    },
    db: db.raw,
    ...overrides,
  };
}

describe("Heartbeat Tasks", () => {
  let db: OpenFoxDatabase;
  let runtime: MockRuntimeClient;

  beforeEach(() => {
    db = createTestDb();
    runtime = new MockRuntimeClient();
  });

  afterEach(() => {
    db.close();
  });

  describe("check_social_inbox", () => {
    it("returns shouldWake false when no social client", async () => {
      const tickCtx = createMockTickContext(db);
      const taskCtx: HeartbeatLegacyContext = {
        identity: createTestIdentity(),
        config: createTestConfig(),
        db,
        runtime,
        // no social client
      };

      const result = await BUILTIN_TASKS.check_social_inbox(tickCtx, taskCtx);

      expect(result.shouldWake).toBe(false);
    });

    it("polls and wakes when messages found", async () => {
      const social = new MockSocialClient();
      social.pollResponses.push({
        messages: [
          {
            id: "msg-1",
            from: "0xsender1",
            to: "0xrecipient",
            content: "Hey there!",
            signedAt: new Date().toISOString(),
            createdAt: new Date().toISOString(),
          },
          {
            id: "msg-2",
            from: "0xsender2",
            to: "0xrecipient",
            content: "What's up?",
            signedAt: new Date().toISOString(),
            createdAt: new Date().toISOString(),
          },
        ],
        nextCursor: new Date().toISOString(),
      });

      const tickCtx = createMockTickContext(db);
      const taskCtx: HeartbeatLegacyContext = {
        identity: createTestIdentity(),
        config: createTestConfig(),
        db,
        runtime,
        social,
      };

      const result = await BUILTIN_TASKS.check_social_inbox(tickCtx, taskCtx);

      expect(result.shouldWake).toBe(true);
      expect(result.message).toContain("2 new message(s)");

      // Verify messages were persisted to inbox
      const unprocessed = db.getUnprocessedInboxMessages(10);
      expect(unprocessed.length).toBe(2);
    });

    it("deduplicates messages", async () => {
      const social = new MockSocialClient();

      // First poll: returns msg-1
      social.pollResponses.push({
        messages: [
          {
            id: "msg-1",
            from: "0xsender1",
            to: "0xrecipient",
            content: "Hello!",
            signedAt: new Date().toISOString(),
            createdAt: new Date().toISOString(),
          },
        ],
      });

      // Second poll: returns same msg-1 again
      social.pollResponses.push({
        messages: [
          {
            id: "msg-1",
            from: "0xsender1",
            to: "0xrecipient",
            content: "Hello!",
            signedAt: new Date().toISOString(),
            createdAt: new Date().toISOString(),
          },
        ],
      });

      const tickCtx = createMockTickContext(db);
      const taskCtx: HeartbeatLegacyContext = {
        identity: createTestIdentity(),
        config: createTestConfig(),
        db,
        runtime,
        social,
      };

      // First run
      const result1 = await BUILTIN_TASKS.check_social_inbox(tickCtx, taskCtx);
      expect(result1.shouldWake).toBe(true);

      // Second run — same message, should not wake
      const result2 = await BUILTIN_TASKS.check_social_inbox(tickCtx, taskCtx);
      expect(result2.shouldWake).toBe(false);

      // Only one inbox row
      const unprocessed = db.getUnprocessedInboxMessages(10);
      expect(unprocessed.length).toBe(1);
    });

    it("returns shouldWake false when no messages", async () => {
      const social = new MockSocialClient();
      social.pollResponses.push({ messages: [] });

      const tickCtx = createMockTickContext(db);
      const taskCtx: HeartbeatLegacyContext = {
        identity: createTestIdentity(),
        config: createTestConfig(),
        db,
        runtime,
        social,
      };

      const result = await BUILTIN_TASKS.check_social_inbox(tickCtx, taskCtx);

      expect(result.shouldWake).toBe(false);
    });

    it("does not wake when all messages are blocked by sanitizer", async () => {
      const social = new MockSocialClient();
      // Message exceeding 50KB triggers the size_limit block
      const oversizedContent = "x".repeat(60_000);
      social.pollResponses.push({
        messages: [
          {
            id: "blocked-msg-1",
            from: "0xattacker",
            to: "0xrecipient",
            content: oversizedContent,
            signedAt: new Date().toISOString(),
            createdAt: new Date().toISOString(),
          },
        ],
      });

      const tickCtx = createMockTickContext(db);
      const taskCtx: HeartbeatLegacyContext = {
        identity: createTestIdentity(),
        config: createTestConfig(),
        db,
        runtime,
        social,
      };

      const result = await BUILTIN_TASKS.check_social_inbox(tickCtx, taskCtx);

      // Blocked messages are stored for audit but should not wake the agent
      expect(result.shouldWake).toBe(false);
      // Message was still persisted
      const unprocessed = db.getUnprocessedInboxMessages(10);
      expect(unprocessed.length).toBe(1);
      expect(unprocessed[0].content).toContain("[BLOCKED:");
    });
  });

  // ─── heartbeat_ping ─────────────────────────────────────────

  describe("heartbeat_ping", () => {
    it("records ping and does not wake on normal tier", async () => {
      const tickCtx = createMockTickContext(db, {
        creditBalance: 10_000,
        survivalTier: "normal",
      });
      const taskCtx: HeartbeatLegacyContext = {
        identity: createTestIdentity(),
        config: createTestConfig(),
        db,
        runtime,
      };

      const result = await BUILTIN_TASKS.heartbeat_ping(tickCtx, taskCtx);

      expect(result.shouldWake).toBe(false);
      const ping = db.getKV("last_heartbeat_ping");
      expect(ping).toBeDefined();
      const parsed = JSON.parse(ping!);
      expect(parsed.creditsCents).toBe(10_000);
      expect(parsed.tier).toBe("normal");
    });

    it("wakes on critical tier with distress signal", async () => {
      const tickCtx = createMockTickContext(db, {
        creditBalance: 50,
        survivalTier: "critical",
      });
      const taskCtx: HeartbeatLegacyContext = {
        identity: createTestIdentity(),
        config: createTestConfig(),
        db,
        runtime,
      };

      const result = await BUILTIN_TASKS.heartbeat_ping(tickCtx, taskCtx);

      expect(result.shouldWake).toBe(true);
      expect(result.message).toContain("Distress");
      const distress = db.getKV("last_distress");
      expect(distress).toBeDefined();
    });

    it("wakes on dead tier with distress signal", async () => {
      const tickCtx = createMockTickContext(db, {
        creditBalance: 0,
        survivalTier: "dead",
      });
      const taskCtx: HeartbeatLegacyContext = {
        identity: createTestIdentity(),
        config: createTestConfig(),
        db,
        runtime,
      };

      const result = await BUILTIN_TASKS.heartbeat_ping(tickCtx, taskCtx);

      expect(result.shouldWake).toBe(true);
      expect(result.message).toContain("dead");
    });
  });

  // ─── check_credits ──────────────────────────────────────────

  describe("check_credits", () => {
    it("does not wake when tier unchanged", async () => {
      const tickCtx = createMockTickContext(db, {
        creditBalance: 10_000,
        survivalTier: "normal",
      });
      const taskCtx: HeartbeatLegacyContext = {
        identity: createTestIdentity(),
        config: createTestConfig(),
        db,
        runtime,
      };

      // Set previous tier to same
      db.setKV("prev_credit_tier", "normal");

      const result = await BUILTIN_TASKS.check_credits(tickCtx, taskCtx);

      expect(result.shouldWake).toBe(false);
      const check = db.getKV("last_credit_check");
      expect(check).toBeDefined();
    });

    it("wakes when tier drops to critical", async () => {
      const tickCtx = createMockTickContext(db, {
        creditBalance: 50,
        survivalTier: "critical",
      });
      const taskCtx: HeartbeatLegacyContext = {
        identity: createTestIdentity(),
        config: createTestConfig(),
        db,
        runtime,
      };

      // Previous tier was normal
      db.setKV("prev_credit_tier", "normal");

      const result = await BUILTIN_TASKS.check_credits(tickCtx, taskCtx);

      expect(result.shouldWake).toBe(true);
      expect(result.message).toContain("critical");
    });

    it("does not wake on first run (no previous tier)", async () => {
      const tickCtx = createMockTickContext(db, {
        creditBalance: 50,
        survivalTier: "critical",
      });
      const taskCtx: HeartbeatLegacyContext = {
        identity: createTestIdentity(),
        config: createTestConfig(),
        db,
        runtime,
      };

      // No previous tier set
      const result = await BUILTIN_TASKS.check_credits(tickCtx, taskCtx);

      expect(result.shouldWake).toBe(false);
    });
  });

  // ─── check_wallet_balance ─────────────────────────────────────

  describe("check_wallet_balance", () => {
    it("does not wake when wallet is empty and credits are healthy", async () => {
      const tickCtx = createMockTickContext(db, {
        creditBalance: 10_000,
        walletBalance: 0,
      });
      const taskCtx: HeartbeatLegacyContext = {
        identity: createTestIdentity(),
        config: createTestConfig(),
        db,
        runtime,
      };

      const result = await BUILTIN_TASKS.check_wallet_balance(tickCtx, taskCtx);

      expect(result.shouldWake).toBe(false);
    });

    it("wakes when wallet has funds but credits are critically low", async () => {
      const tickCtx = createMockTickContext(db, {
        creditBalance: 0, // critical tier
        walletBalance: 10.0, // > 5
        survivalTier: "critical",
      });
      const taskCtx: HeartbeatLegacyContext = {
        identity: createTestIdentity(),
        config: createTestConfig(),
        db,
        runtime,
      };

      const result = await BUILTIN_TASKS.check_wallet_balance(tickCtx, taskCtx);

      expect(result.shouldWake).toBe(true);
      expect(result.message).toContain("TOS");
    });

    it("does not wake when credits are not critical", async () => {
      const tickCtx = createMockTickContext(db, {
        creditBalance: 200,
        walletBalance: 3.0,
      });
      const taskCtx: HeartbeatLegacyContext = {
        identity: createTestIdentity(),
        config: createTestConfig(),
        db,
        runtime,
      };

      const result = await BUILTIN_TASKS.check_wallet_balance(tickCtx, taskCtx);

      expect(result.shouldWake).toBe(false);
    });
  });

  // ─── health_check ───────────────────────────────────────────

  describe("health_check", () => {
    it("returns shouldWake false when sandbox is healthy", async () => {
      const tickCtx = createMockTickContext(db);
      const taskCtx: HeartbeatLegacyContext = {
        identity: createTestIdentity(),
        config: createTestConfig(),
        db,
        runtime,
      };

      const result = await BUILTIN_TASKS.health_check(tickCtx, taskCtx);

      expect(result.shouldWake).toBe(false);
      expect(db.getKV("last_health_check")).toBeDefined();
    });

    it("wakes when sandbox exec fails", async () => {
      runtime.exec = async () => ({ stdout: "", stderr: "unhealthy", exitCode: 1 });

      const tickCtx = createMockTickContext(db);
      const taskCtx: HeartbeatLegacyContext = {
        identity: createTestIdentity(),
        config: createTestConfig(),
        db,
        runtime,
      };

      const result = await BUILTIN_TASKS.health_check(tickCtx, taskCtx);

      expect(result.shouldWake).toBe(true);
      expect(result.message).toContain("Health check failed");
    });

    it("wakes when sandbox exec throws", async () => {
      runtime.exec = async () => {
        throw new Error("sandbox unreachable");
      };

      const tickCtx = createMockTickContext(db);
      const taskCtx: HeartbeatLegacyContext = {
        identity: createTestIdentity(),
        config: createTestConfig(),
        db,
        runtime,
      };

      const result = await BUILTIN_TASKS.health_check(tickCtx, taskCtx);

      expect(result.shouldWake).toBe(true);
      expect(result.message).toContain("sandbox unreachable");
    });
  });

  // ─── refresh_models ─────────────────────────────────────────

  describe("refresh_models", () => {
    it("refreshes model registry from API", async () => {
      const tickCtx = createMockTickContext(db);
      const taskCtx: HeartbeatLegacyContext = {
        identity: createTestIdentity(),
        config: createTestConfig(),
        db,
        runtime,
      };

      const result = await BUILTIN_TASKS.refresh_models(tickCtx, taskCtx);

      expect(result.shouldWake).toBe(false);
      const refresh = db.getKV("last_model_refresh");
      expect(refresh).toBeDefined();
      const parsed = JSON.parse(refresh!);
      expect(parsed.count).toBeGreaterThan(0);
    });
  });

  // ─── Shared Tick Context ────────────────────────────────────

  describe("shared tick context", () => {
    it("all tasks receive the same tick context without redundant API calls", async () => {
      // Verify that tasks use ctx.creditBalance instead of making API calls
      const tickCtx = createMockTickContext(db, {
        creditBalance: 7777,
        survivalTier: "normal",
      });
      const taskCtx: HeartbeatLegacyContext = {
        identity: createTestIdentity(),
        config: createTestConfig(),
        db,
        runtime,
      };

      // Run heartbeat_ping — it should use ctx.creditBalance
      await BUILTIN_TASKS.heartbeat_ping(tickCtx, taskCtx);
      const ping = JSON.parse(db.getKV("last_heartbeat_ping")!);
      expect(ping.creditsCents).toBe(7777);

      // Run check_credits — it should also use ctx.creditBalance
      await BUILTIN_TASKS.check_credits(tickCtx, taskCtx);
      const creditCheck = JSON.parse(db.getKV("last_credit_check")!);
      expect(creditCheck.credits).toBe(7777);

      // No direct getCreditsBalance calls should have been made by these tasks
      // (runtime.getCreditsBalance is only called during buildTickContext, not by tasks)
    });
  });
});
