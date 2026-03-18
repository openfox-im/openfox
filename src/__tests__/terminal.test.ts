/**
 * Terminal Adapters & Registry Tests
 *
 * Tests for terminal adapters (capabilities, sessions, validation),
 * the TerminalRegistry (registration, session management, cleanup),
 * privacy escalation conditions, and SessionStore persistence.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import {
  AppTerminalAdapter,
  CardTerminalAdapter,
  POSTerminalAdapter,
  VoiceTerminalAdapter,
  KioskTerminalAdapter,
  RobotTerminalAdapter,
  TerminalRegistry,
  SessionStore,
} from "../terminal/index.js";
import type { TerminalRequest, TerminalSession } from "../terminal/index.js";
import { evaluateEscalation, DEFAULT_ESCALATION_RULES } from "../intent/escalation.js";
import type { EscalationRule } from "../intent/escalation.js";
import type { IntentEnvelope, PlanRecord } from "../intent/types.js";

// ─── Adapter Tests ───────────────────────────────────────────────

describe("Terminal Adapters", () => {
  const adapters = [
    {
      Adapter: AppTerminalAdapter,
      expectedClass: "app",
      expectedTrust: 4,
      canSign: true,
      expectedActions: ["transfer", "swap", "subscribe", "delegate", "policy_update", "recovery"],
      sessionTTL: 86400,
    },
    {
      Adapter: CardTerminalAdapter,
      expectedClass: "card",
      expectedTrust: 1,
      canSign: false,
      expectedActions: ["transfer"],
      sessionTTL: 30,
    },
    {
      Adapter: POSTerminalAdapter,
      expectedClass: "pos",
      expectedTrust: 2,
      canSign: false,
      expectedActions: ["transfer", "subscribe"],
      sessionTTL: 300,
    },
    {
      Adapter: VoiceTerminalAdapter,
      expectedClass: "voice",
      expectedTrust: 1,
      canSign: false,
      expectedActions: ["transfer"],
      sessionTTL: 120,
    },
    {
      Adapter: KioskTerminalAdapter,
      expectedClass: "kiosk",
      expectedTrust: 0,
      canSign: false,
      expectedActions: ["transfer"],
      sessionTTL: 60,
    },
    {
      Adapter: RobotTerminalAdapter,
      expectedClass: "robot",
      expectedTrust: 2,
      canSign: true,
      expectedActions: ["transfer", "swap", "delegate"],
      sessionTTL: 3600,
    },
  ] as const;

  for (const spec of adapters) {
    describe(`${spec.expectedClass} adapter`, () => {
      it(`has correct terminalClass: ${spec.expectedClass}`, () => {
        const adapter = new spec.Adapter();
        expect(adapter.terminalClass).toBe(spec.expectedClass);
      });

      it(`has correct defaultTrustTier: ${spec.expectedTrust}`, () => {
        const adapter = new spec.Adapter();
        expect(adapter.defaultTrustTier).toBe(spec.expectedTrust);
      });

      it("has correct capabilities", () => {
        const adapter = new spec.Adapter();
        const caps = adapter.capabilities();

        expect(caps.canSign).toBe(spec.canSign);
        expect(caps.supportedActions).toEqual(spec.expectedActions);
      });

      it("creates session with correct TTL", () => {
        const adapter = new spec.Adapter();
        const session = adapter.createSession("terminal-001");

        expect(session.sessionId).toBeTruthy();
        expect(session.terminalClass).toBe(spec.expectedClass);
        expect(session.trustTier).toBe(spec.expectedTrust);
        expect(session.terminalId).toBe("terminal-001");
        expect(session.revoked).toBe(false);
        expect(session.expiresAt - session.connectedAt).toBe(spec.sessionTTL);
      });
    });
  }

  describe("Request validation", () => {
    it("rejects expired sessions", () => {
      const adapter = new AppTerminalAdapter();
      const session = adapter.createSession("terminal-001");
      // Force session to be expired
      const expiredSession: TerminalSession = {
        ...session,
        expiresAt: Math.floor(Date.now() / 1000) - 10,
      };

      const request: TerminalRequest = {
        sessionId: expiredSession.sessionId,
        terminalClass: "app",
        trustTier: 4,
        terminalId: "terminal-001",
        action: "transfer",
        params: {},
        timestamp: Math.floor(Date.now() / 1000),
      };

      const result = adapter.validateRequest(expiredSession, request);
      expect(result.valid).toBe(false);
      expect(result.reason).toBe("Session expired");
    });

    it("rejects wrong terminal class", () => {
      const adapter = new AppTerminalAdapter();
      const session = adapter.createSession("terminal-001");

      const request: TerminalRequest = {
        sessionId: session.sessionId,
        terminalClass: "card", // mismatch
        trustTier: 1,
        terminalId: "terminal-001",
        action: "transfer",
        params: {},
        timestamp: Math.floor(Date.now() / 1000),
      };

      const result = adapter.validateRequest(session, request);
      expect(result.valid).toBe(false);
      expect(result.reason).toBe("Terminal class mismatch");
    });

    it("rejects revoked sessions", () => {
      const adapter = new AppTerminalAdapter();
      const session = adapter.createSession("terminal-001");
      session.revoked = true;

      const request: TerminalRequest = {
        sessionId: session.sessionId,
        terminalClass: "app",
        trustTier: 4,
        terminalId: "terminal-001",
        action: "transfer",
        params: {},
        timestamp: Math.floor(Date.now() / 1000),
      };

      const result = adapter.validateRequest(session, request);
      expect(result.valid).toBe(false);
      expect(result.reason).toBe("Session revoked");
    });

    it("rejects unsupported actions", () => {
      const adapter = new CardTerminalAdapter();
      const session = adapter.createSession("terminal-001");

      const request: TerminalRequest = {
        sessionId: session.sessionId,
        terminalClass: "card",
        trustTier: 1,
        terminalId: "terminal-001",
        action: "swap", // card only supports "transfer"
        params: {},
        timestamp: Math.floor(Date.now() / 1000),
      };

      const result = adapter.validateRequest(session, request);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain("Action not supported");
    });

    it("accepts valid requests", () => {
      const adapter = new AppTerminalAdapter();
      const session = adapter.createSession("terminal-001");

      const request: TerminalRequest = {
        sessionId: session.sessionId,
        terminalClass: "app",
        trustTier: 4,
        terminalId: "terminal-001",
        action: "transfer",
        params: {},
        timestamp: Math.floor(Date.now() / 1000),
      };

      const result = adapter.validateRequest(session, request);
      expect(result.valid).toBe(true);
    });
  });
});

// ─── Registry Tests ──────────────────────────────────────────────

describe("TerminalRegistry", () => {
  it("registers all default adapters", () => {
    const registry = new TerminalRegistry();

    for (const cls of ["app", "card", "pos", "voice", "kiosk", "robot"] as const) {
      const adapter = registry.getAdapter(cls);
      expect(adapter).toBeDefined();
      expect(adapter!.terminalClass).toBe(cls);
    }
  });

  it("creates and retrieves sessions", () => {
    const registry = new TerminalRegistry();
    const session = registry.createSession("app", "terminal-001");

    expect(session).toBeDefined();
    expect(session!.terminalClass).toBe("app");
    expect(session!.terminalId).toBe("terminal-001");

    const retrieved = registry.getSession(session!.sessionId);
    expect(retrieved).toEqual(session);
  });

  it("returns undefined for unknown terminal class", () => {
    const registry = new TerminalRegistry();
    const session = registry.createSession("api" as any, "terminal-001");
    expect(session).toBeUndefined();
  });

  it("revokes sessions", () => {
    const registry = new TerminalRegistry();
    const session = registry.createSession("app", "terminal-001");
    expect(session).toBeDefined();

    const revoked = registry.revokeSession(session!.sessionId);
    expect(revoked).toBe(true);

    const retrieved = registry.getSession(session!.sessionId);
    expect(retrieved!.revoked).toBe(true);
  });

  it("returns false when revoking non-existent session", () => {
    const registry = new TerminalRegistry();
    const result = registry.revokeSession("non-existent-id");
    expect(result).toBe(false);
  });

  it("cleans expired sessions", () => {
    const registry = new TerminalRegistry();

    // Create a session and forcibly expire it
    const session = registry.createSession("app", "terminal-001");
    expect(session).toBeDefined();
    session!.expiresAt = Math.floor(Date.now() / 1000) - 10;

    // Create a valid session
    const validSession = registry.createSession("app", "terminal-002");
    expect(validSession).toBeDefined();

    const removed = registry.cleanExpiredSessions();
    expect(removed).toBe(1);

    // Expired session should be gone
    expect(registry.getSession(session!.sessionId)).toBeUndefined();
    // Valid session should remain
    expect(registry.getSession(validSession!.sessionId)).toBeDefined();
  });

  it("cleans revoked sessions", () => {
    const registry = new TerminalRegistry();
    const session = registry.createSession("app", "terminal-001");
    expect(session).toBeDefined();

    registry.revokeSession(session!.sessionId);
    const removed = registry.cleanExpiredSessions();
    expect(removed).toBe(1);

    expect(registry.getSession(session!.sessionId)).toBeUndefined();
  });
});

// ─── Privacy Escalation Tests ───────────────────────────────────

function makeIntent(overrides: Partial<IntentEnvelope> = {}): IntentEnvelope {
  return {
    intentId: "test-intent-1",
    schemaVersion: "0.1.0",
    action: "transfer",
    requester: "0xabc",
    actorAgentId: "0xdef",
    terminalClass: "app",
    trustTier: 4,
    params: {},
    createdAt: Math.floor(Date.now() / 1000),
    expiresAt: Math.floor(Date.now() / 1000) + 3600,
    status: "pending",
    ...overrides,
  };
}

function makePlan(overrides: Partial<PlanRecord> = {}): PlanRecord {
  return {
    planId: "test-plan-1",
    intentId: "test-intent-1",
    schemaVersion: "0.1.0",
    provider: "0xprovider",
    policyHash: "0xhash",
    estimatedGas: 21000,
    estimatedValue: "0",
    createdAt: Math.floor(Date.now() / 1000),
    expiresAt: Math.floor(Date.now() / 1000) + 3600,
    status: "ready",
    ...overrides,
  };
}

describe("Privacy Escalation Conditions", () => {
  const privacyWeakRule: EscalationRule = {
    condition: "privacy_action_weak_terminal",
    threshold: "2",
    action: "deny",
  };

  const privacyHighValueRule: EscalationRule = {
    condition: "privacy_action_high_value",
    threshold: "500000000000000000000", // 500 TOS
    action: "require_guardian",
  };

  describe("privacy_action_weak_terminal", () => {
    it("denies shield action from trust tier 1 terminal", () => {
      const intent = makeIntent({ action: "shield", trustTier: 1 });
      const plan = makePlan();
      const result = evaluateEscalation(intent, plan, [privacyWeakRule]);
      expect(result.escalated).toBe(true);
      expect(result.level).toBe("deny");
      expect(result.reason).toContain("Privacy action");
      expect(result.reason).toContain("weak terminal");
    });

    it("denies unshield action from trust tier 0 terminal", () => {
      const intent = makeIntent({ action: "unshield", trustTier: 0 });
      const plan = makePlan();
      const result = evaluateEscalation(intent, plan, [privacyWeakRule]);
      expect(result.escalated).toBe(true);
      expect(result.level).toBe("deny");
    });

    it("denies priv_transfer from weak terminal", () => {
      const intent = makeIntent({ action: "priv_transfer", trustTier: 1 });
      const plan = makePlan();
      const result = evaluateEscalation(intent, plan, [privacyWeakRule]);
      expect(result.escalated).toBe(true);
      expect(result.level).toBe("deny");
    });

    it("allows privacy action from trust tier 2+ terminal", () => {
      const intent = makeIntent({ action: "shield", trustTier: 2 });
      const plan = makePlan();
      const result = evaluateEscalation(intent, plan, [privacyWeakRule]);
      expect(result.escalated).toBe(false);
    });

    it("allows privacy action from trust tier 4 terminal", () => {
      const intent = makeIntent({ action: "priv_transfer", trustTier: 4 });
      const plan = makePlan();
      const result = evaluateEscalation(intent, plan, [privacyWeakRule]);
      expect(result.escalated).toBe(false);
    });

    it("does not trigger for non-privacy actions on weak terminals", () => {
      const intent = makeIntent({ action: "transfer", trustTier: 0 });
      const plan = makePlan();
      const result = evaluateEscalation(intent, plan, [privacyWeakRule]);
      expect(result.escalated).toBe(false);
    });
  });

  describe("privacy_action_high_value", () => {
    it("escalates shield with value above threshold", () => {
      const intent = makeIntent({ action: "shield", params: { value: "600000000000000000000" } });
      const plan = makePlan();
      const result = evaluateEscalation(intent, plan, [privacyHighValueRule]);
      expect(result.escalated).toBe(true);
      expect(result.level).toBe("guardian");
      expect(result.reason).toContain("high value");
    });

    it("does not escalate shield with value below threshold", () => {
      const intent = makeIntent({ action: "shield", params: { value: "100000000000000000000" } });
      const plan = makePlan();
      const result = evaluateEscalation(intent, plan, [privacyHighValueRule]);
      expect(result.escalated).toBe(false);
    });

    it("does not trigger for non-privacy actions with high value", () => {
      const intent = makeIntent({ action: "transfer", params: { value: "600000000000000000000" } });
      const plan = makePlan();
      const result = evaluateEscalation(intent, plan, [privacyHighValueRule]);
      expect(result.escalated).toBe(false);
    });

    it("uses plan estimatedValue when available", () => {
      const intent = makeIntent({ action: "priv_transfer" });
      const plan = makePlan({ estimatedValue: "600000000000000000000" });
      const result = evaluateEscalation(intent, plan, [privacyHighValueRule]);
      expect(result.escalated).toBe(true);
      expect(result.level).toBe("guardian");
    });
  });

  it("DEFAULT_ESCALATION_RULES include privacy conditions", () => {
    const conditions = DEFAULT_ESCALATION_RULES.map((r) => r.condition);
    expect(conditions).toContain("privacy_action_weak_terminal");
    expect(conditions).toContain("privacy_action_high_value");
  });
});

// ─── SessionStore Persistence Tests ─────────────────────────────

describe("SessionStore", () => {
  let db: Database.Database;
  let store: SessionStore;

  function makeSession(overrides: Partial<TerminalSession> = {}): TerminalSession {
    const now = Math.floor(Date.now() / 1000);
    return {
      sessionId: `sess-${Math.random().toString(36).slice(2, 10)}`,
      terminalClass: "app",
      trustTier: 4,
      terminalId: "terminal-001",
      connectedAt: now,
      lastActiveAt: now,
      expiresAt: now + 86400,
      metadata: {},
      revoked: false,
      ...overrides,
    };
  }

  beforeEach(() => {
    db = new Database(":memory:");
    store = new SessionStore(db);
  });

  afterEach(() => {
    db.close();
  });

  it("saves and retrieves a session", () => {
    const session = makeSession();
    store.save(session);
    const retrieved = store.get(session.sessionId);
    expect(retrieved).not.toBeNull();
    expect(retrieved!.sessionId).toBe(session.sessionId);
    expect(retrieved!.terminalClass).toBe(session.terminalClass);
    expect(retrieved!.trustTier).toBe(session.trustTier);
    expect(retrieved!.terminalId).toBe(session.terminalId);
    expect(retrieved!.revoked).toBe(false);
  });

  it("returns null for unknown session", () => {
    const result = store.get("nonexistent");
    expect(result).toBeNull();
  });

  it("lists active sessions (excludes revoked and expired)", () => {
    const active1 = makeSession({ sessionId: "active-1" });
    const active2 = makeSession({ sessionId: "active-2" });
    const revoked = makeSession({ sessionId: "revoked-1", revoked: true });
    const expired = makeSession({
      sessionId: "expired-1",
      expiresAt: Math.floor(Date.now() / 1000) - 100,
    });

    store.save(active1);
    store.save(active2);
    store.save(revoked);
    store.save(expired);

    const actives = store.listActive();
    const ids = actives.map((s) => s.sessionId);
    expect(ids).toContain("active-1");
    expect(ids).toContain("active-2");
    expect(ids).not.toContain("revoked-1");
    expect(ids).not.toContain("expired-1");
  });

  it("revokes a session", () => {
    const session = makeSession();
    store.save(session);
    const result = store.revoke(session.sessionId);
    expect(result).toBe(true);

    const retrieved = store.get(session.sessionId);
    expect(retrieved!.revoked).toBe(true);
  });

  it("returns false when revoking nonexistent session", () => {
    const result = store.revoke("nonexistent");
    expect(result).toBe(false);
  });

  it("cleans expired and revoked sessions", () => {
    const active = makeSession({ sessionId: "active-1" });
    const revoked = makeSession({ sessionId: "revoked-1", revoked: true });
    const expired = makeSession({
      sessionId: "expired-1",
      expiresAt: Math.floor(Date.now() / 1000) - 100,
    });

    store.save(active);
    store.save(revoked);
    store.save(expired);

    const cleaned = store.cleanExpired();
    expect(cleaned).toBe(2);

    expect(store.get("active-1")).not.toBeNull();
    expect(store.get("revoked-1")).toBeNull();
    expect(store.get("expired-1")).toBeNull();
  });

  it("deleteAll removes all sessions", () => {
    store.save(makeSession({ sessionId: "s1" }));
    store.save(makeSession({ sessionId: "s2" }));
    store.deleteAll();
    expect(store.listActive()).toHaveLength(0);
    expect(store.get("s1")).toBeNull();
    expect(store.get("s2")).toBeNull();
  });

  it("saves and retrieves session metadata", () => {
    const session = makeSession({ metadata: { device: "iPhone", version: 3 } });
    store.save(session);
    const retrieved = store.get(session.sessionId);
    expect(retrieved!.metadata).toEqual({ device: "iPhone", version: 3 });
  });

  it("upserts on save (updates existing session)", () => {
    const session = makeSession();
    store.save(session);
    session.revoked = true;
    session.lastActiveAt = session.lastActiveAt + 100;
    store.save(session);

    const retrieved = store.get(session.sessionId);
    expect(retrieved!.revoked).toBe(true);
    expect(retrieved!.lastActiveAt).toBe(session.lastActiveAt);
  });
});

// ─── Registry with SessionStore Tests ───────────────────────────

describe("TerminalRegistry with SessionStore", () => {
  let db: Database.Database;
  let store: SessionStore;

  beforeEach(() => {
    db = new Database(":memory:");
    store = new SessionStore(db);
  });

  afterEach(() => {
    db.close();
  });

  it("persists sessions to store on create", () => {
    const registry = new TerminalRegistry(store);
    const session = registry.createSession("app", "terminal-001");
    expect(session).toBeDefined();

    const persisted = store.get(session!.sessionId);
    expect(persisted).not.toBeNull();
    expect(persisted!.terminalId).toBe("terminal-001");
  });

  it("retrieves sessions from store when not in memory", () => {
    // Create session with one registry instance
    const registry1 = new TerminalRegistry(store);
    const session = registry1.createSession("app", "terminal-001");
    expect(session).toBeDefined();

    // Create new registry with same store (simulates restart)
    const registry2 = new TerminalRegistry(store);
    const retrieved = registry2.getSession(session!.sessionId);
    expect(retrieved).toBeDefined();
    expect(retrieved!.terminalId).toBe("terminal-001");
  });

  it("persists revocations to store", () => {
    const registry = new TerminalRegistry(store);
    const session = registry.createSession("app", "terminal-001");
    expect(session).toBeDefined();

    registry.revokeSession(session!.sessionId);
    const persisted = store.get(session!.sessionId);
    expect(persisted!.revoked).toBe(true);
  });
});
