import { describe, expect, it, beforeEach } from "vitest";
import Database from "better-sqlite3";
import {
  validateAddress,
  validateValue,
  validateIntentParams,
  sanitizeRPCUrl,
  validateTerminalClass,
  validateTrustTier,
  validateAction,
  validateExecuteParams,
  enforceArrayLimit,
  MAX_SPONSOR_QUOTES,
  MAX_PARAMS_SIZE,
  MAX_PARAMS_KEYS,
  MAX_PARAM_STRING_LENGTH,
} from "../pipeline/validation.js";
import { evaluateEscalation, DEFAULT_ESCALATION_RULES } from "../intent/escalation.js";
import { createIntent } from "../intent/intent.js";
import { AuditJournal } from "../audit/journal.js";
import { RPCChainExecutor } from "../pipeline/chain-executor.js";
import { SponsoredChainExecutor } from "../pipeline/sponsored-executor.js";
import type { IntentEnvelope, PlanRecord } from "../intent/types.js";

// ── Address validation ──────────────────────────────────────────────

describe("validateAddress", () => {
  it("accepts valid 20-byte hex addresses", () => {
    expect(validateAddress("0x" + "a".repeat(40))).toBe(true);
    expect(validateAddress("0x" + "0".repeat(40))).toBe(true);
    expect(validateAddress("0x" + "Ff".repeat(20))).toBe(true);
  });

  it("accepts valid 32-byte hex addresses", () => {
    expect(validateAddress("0x" + "a".repeat(64))).toBe(true);
  });

  it("rejects addresses without 0x prefix", () => {
    expect(validateAddress("a".repeat(40))).toBe(false);
  });

  it("rejects addresses with wrong length", () => {
    expect(validateAddress("0x" + "a".repeat(39))).toBe(false);
    expect(validateAddress("0x" + "a".repeat(41))).toBe(false);
    expect(validateAddress("0x" + "a".repeat(63))).toBe(false);
    expect(validateAddress("0x")).toBe(false);
  });

  it("rejects non-hex characters", () => {
    expect(validateAddress("0x" + "g".repeat(40))).toBe(false);
    expect(validateAddress("0x" + "!".repeat(40))).toBe(false);
  });

  it("rejects empty and non-string values", () => {
    expect(validateAddress("")).toBe(false);
    expect(validateAddress(123 as unknown as string)).toBe(false);
    expect(validateAddress(null as unknown as string)).toBe(false);
  });
});

// ── Value validation ────────────────────────────────────────────────

describe("validateValue", () => {
  it("accepts valid wei values", () => {
    expect(validateValue("0")).toBe(true);
    expect(validateValue("1")).toBe(true);
    expect(validateValue("1000000000000000000")).toBe(true);
  });

  it("rejects negative values", () => {
    expect(validateValue("-1")).toBe(false);
    expect(validateValue("-1000000000000000000")).toBe(false);
  });

  it("rejects values exceeding uint256 max", () => {
    const overflow = (2n ** 256n).toString();
    expect(validateValue(overflow)).toBe(false);
  });

  it("accepts uint256 max", () => {
    const maxUint256 = ((2n ** 256n) - 1n).toString();
    expect(validateValue(maxUint256)).toBe(true);
  });

  it("rejects non-numeric strings", () => {
    expect(validateValue("abc")).toBe(false);
    expect(validateValue("12.5")).toBe(false);
    expect(validateValue("1e18")).toBe(false);
    expect(validateValue("0x1")).toBe(false);
  });

  it("rejects leading zeros", () => {
    expect(validateValue("01")).toBe(false);
    expect(validateValue("007")).toBe(false);
  });

  it("rejects non-string types", () => {
    expect(validateValue(42 as unknown as string)).toBe(false);
    expect(validateValue(null as unknown as string)).toBe(false);
  });
});

// ── Terminal class validation ───────────────────────────────────────

describe("validateTerminalClass", () => {
  it("accepts all valid terminal classes", () => {
    for (const tc of ["app", "card", "pos", "voice", "kiosk", "robot", "api"]) {
      expect(validateTerminalClass(tc)).toBe(true);
    }
  });

  it("rejects unknown terminal classes", () => {
    expect(validateTerminalClass("browser")).toBe(false);
    expect(validateTerminalClass("mobile")).toBe(false);
    expect(validateTerminalClass("")).toBe(false);
    expect(validateTerminalClass("APP")).toBe(false); // case-sensitive
  });

  it("rejects non-string values", () => {
    expect(validateTerminalClass(1 as unknown as string)).toBe(false);
  });
});

// ── Trust tier validation ───────────────────────────────────────────

describe("validateTrustTier", () => {
  it("accepts valid trust tiers 0-4", () => {
    for (let i = 0; i <= 4; i++) {
      expect(validateTrustTier(i)).toBe(true);
    }
  });

  it("rejects out-of-range values", () => {
    expect(validateTrustTier(-1)).toBe(false);
    expect(validateTrustTier(5)).toBe(false);
    expect(validateTrustTier(100)).toBe(false);
  });

  it("rejects non-integer values", () => {
    expect(validateTrustTier(1.5)).toBe(false);
    expect(validateTrustTier(NaN)).toBe(false);
    expect(validateTrustTier(Infinity)).toBe(false);
  });

  it("rejects non-number types", () => {
    expect(validateTrustTier("2" as unknown as number)).toBe(false);
  });
});

// ── Escalation bypass prevention ────────────────────────────────────

describe("escalation bypass prevention", () => {
  function makeTestIntent(overrides?: Partial<IntentEnvelope>): IntentEnvelope {
    return {
      intentId: "test-intent",
      schemaVersion: "0.1.0",
      action: "transfer",
      requester: "0x" + "a".repeat(64),
      actorAgentId: "0x" + "a".repeat(64),
      terminalClass: "app",
      trustTier: 3,
      params: { value: "50000000000000000000", to: "0x" + "b".repeat(64) },
      createdAt: Math.floor(Date.now() / 1000),
      expiresAt: Math.floor(Date.now() / 1000) + 300,
      status: "planning",
      ...overrides,
    };
  }

  function makeTestPlan(overrides?: Partial<PlanRecord>): PlanRecord {
    return {
      planId: "test-plan",
      intentId: "test-intent",
      schemaVersion: "0.1.0",
      provider: "0x" + "c".repeat(64),
      policyHash: "0x" + "0".repeat(64),
      estimatedGas: 50_000,
      estimatedValue: "50000000000000000000",
      createdAt: Math.floor(Date.now() / 1000),
      expiresAt: Math.floor(Date.now() / 1000) + 300,
      status: "ready",
      ...overrides,
    };
  }

  it("cannot bypass escalation by setting a high trust tier", () => {
    const rules = DEFAULT_ESCALATION_RULES;
    // High-value transaction with high trust tier still triggers value_above
    const intent = makeTestIntent({
      trustTier: 4,
      params: { value: "2000000000000000000000", to: "0x" + "b".repeat(64) },
    });
    const plan = makeTestPlan({ estimatedValue: "2000000000000000000000" });

    const result = evaluateEscalation(intent, plan, rules);
    expect(result.escalated).toBe(true);
    expect(result.level).toBe("guardian");
  });

  it("trust tier below threshold triggers escalation even for low values", () => {
    const rules = DEFAULT_ESCALATION_RULES;
    const intent = makeTestIntent({ trustTier: 1 }); // below threshold of 2
    const plan = makeTestPlan({ estimatedValue: "1000000000000000" }); // low value

    const result = evaluateEscalation(intent, plan, rules);
    expect(result.escalated).toBe(true);
    // Should trigger terminal_low_trust and recipient_unknown
    expect(result.rules_triggered.length).toBeGreaterThanOrEqual(1);
  });

  it("denies when deny rule matches", () => {
    const rules = [
      { condition: "action_restricted" as const, threshold: "transfer", action: "deny" as const },
    ];
    const intent = makeTestIntent({ action: "transfer" });
    const plan = makeTestPlan();

    const result = evaluateEscalation(intent, plan, rules);
    expect(result.escalated).toBe(true);
    expect(result.level).toBe("deny");
  });

  it("manipulating trustTier to invalid value is caught by validation", () => {
    // The validateTrustTier function rejects invalid values
    expect(validateTrustTier(99)).toBe(false);
    expect(validateTrustTier(-1)).toBe(false);
    // Full pipeline params validation catches it
    const errors = validateExecuteParams({
      action: "transfer",
      requester: "0x" + "a".repeat(64),
      actorAgentId: "0x" + "a".repeat(64),
      terminalClass: "app",
      trustTier: 99,
      params: {},
    });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.includes("trust tier"))).toBe(true);
  });
});

// ── RPC URL validation ──────────────────────────────────────────────

describe("sanitizeRPCUrl", () => {
  it("accepts valid HTTP URLs", () => {
    expect(sanitizeRPCUrl("http://localhost:8545")).toBe("http://localhost:8545/");
    expect(sanitizeRPCUrl("https://rpc.example.com")).toBe("https://rpc.example.com/");
    expect(sanitizeRPCUrl("https://rpc.example.com/v1")).toBe("https://rpc.example.com/v1");
  });

  it("rejects file:// scheme (SSRF)", () => {
    expect(() => sanitizeRPCUrl("file:///etc/passwd")).toThrow("not allowed");
  });

  it("rejects data: scheme", () => {
    expect(() => sanitizeRPCUrl("data:text/html,<script>alert(1)</script>")).toThrow("not allowed");
  });

  it("rejects javascript: scheme", () => {
    expect(() => sanitizeRPCUrl("javascript:alert(1)")).toThrow("not allowed");
  });

  it("rejects ftp: scheme", () => {
    expect(() => sanitizeRPCUrl("ftp://malicious.com")).toThrow("not allowed");
  });

  it("rejects invalid URLs", () => {
    expect(() => sanitizeRPCUrl("not-a-url")).toThrow("Invalid RPC URL");
  });

  it("rejects empty strings", () => {
    expect(() => sanitizeRPCUrl("")).toThrow("non-empty string");
  });

  it("blocks non-HTTP in chain executor constructor", () => {
    expect(() => {
      new RPCChainExecutor({
        rpcUrl: "file:///etc/passwd",
        defaultGasLimit: 50_000,
        confirmationTimeout: 30_000,
        maxRetries: 3,
      });
    }).toThrow("not allowed");
  });
});

// ── Intent params size limits ───────────────────────────────────────

describe("validateIntentParams", () => {
  it("accepts valid params", () => {
    const result = validateIntentParams({
      to: "0x" + "b".repeat(64),
      value: "1000000000000000000",
      data: "0x",
    });
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("rejects too many keys", () => {
    const params: Record<string, unknown> = {};
    for (let i = 0; i < MAX_PARAMS_KEYS + 1; i++) {
      params[`key${i}`] = "value";
    }
    const result = validateIntentParams(params);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("keys"))).toBe(true);
  });

  it("rejects oversized params", () => {
    const params = { bigData: "x".repeat(MAX_PARAMS_SIZE + 1) };
    const result = validateIntentParams(params);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("serialized size") || e.includes("string length"))).toBe(true);
  });

  it("rejects deeply nested params", () => {
    // Create nesting depth of 6 (exceeds MAX_PARAMS_DEPTH of 4)
    const params = { a: { b: { c: { d: { e: { f: "deep" } } } } } };
    const result = validateIntentParams(params);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("nesting depth"))).toBe(true);
  });

  it("rejects invalid value in params", () => {
    const result = validateIntentParams({ value: "-1" });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("params.value"))).toBe(true);
  });

  it("rejects invalid to address in params", () => {
    const result = validateIntentParams({ to: "not-an-address" });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("params.to"))).toBe(true);
  });

  it("rejects non-object params", () => {
    const result = validateIntentParams(null as unknown as Record<string, unknown>);
    expect(result.valid).toBe(false);
  });

  it("rejects arrays as params", () => {
    const result = validateIntentParams([] as unknown as Record<string, unknown>);
    expect(result.valid).toBe(false);
  });
});

// ── Audit journal immutability ──────────────────────────────────────

describe("audit journal immutability", () => {
  let db: Database.Database;
  let journal: AuditJournal;

  beforeEach(() => {
    db = new Database(":memory:");
    journal = new AuditJournal(db);
  });

  it("allows appending entries", () => {
    const entry = journal.append({
      kind: "intent_created",
      timestamp: Math.floor(Date.now() / 1000),
      intentId: "test-intent-1",
      summary: "Test intent created",
    });
    expect(entry.entryId).toBeTruthy();
    expect(journal.count()).toBe(1);
  });

  it("prevents updating audit entries", () => {
    const entry = journal.append({
      kind: "intent_created",
      timestamp: Math.floor(Date.now() / 1000),
      intentId: "test-intent-1",
      summary: "Original summary",
    });

    expect(() => {
      db.prepare("UPDATE audit_journal SET summary = ? WHERE entry_id = ?").run(
        "Tampered summary",
        entry.entryId,
      );
    }).toThrow(/immutable/i);

    // Verify original is intact
    const entries = journal.getIntentTimeline("test-intent-1");
    expect(entries[0].summary).toBe("Original summary");
  });

  it("prevents deleting audit entries", () => {
    const entry = journal.append({
      kind: "intent_created",
      timestamp: Math.floor(Date.now() / 1000),
      intentId: "test-intent-1",
      summary: "Test intent",
    });

    expect(() => {
      db.prepare("DELETE FROM audit_journal WHERE entry_id = ?").run(entry.entryId);
    }).toThrow(/immutable/i);

    // Verify entry still exists
    expect(journal.count()).toBe(1);
  });

  it("maintains append-only ordering", () => {
    for (let i = 0; i < 5; i++) {
      journal.append({
        kind: "intent_created",
        timestamp: Math.floor(Date.now() / 1000) + i,
        intentId: "test-intent",
        summary: `Entry ${i}`,
      });
    }

    const entries = journal.getIntentTimeline("test-intent");
    expect(entries).toHaveLength(5);
    for (let i = 0; i < 5; i++) {
      expect(entries[i].summary).toBe(`Entry ${i}`);
    }
  });
});

// ── Chain executor config bounds ────────────────────────────────────

describe("chain executor config bounds", () => {
  it("rejects maxRetries out of bounds", () => {
    expect(() => {
      new RPCChainExecutor({
        rpcUrl: "http://localhost:8545",
        defaultGasLimit: 50_000,
        confirmationTimeout: 30_000,
        maxRetries: 100,
      });
    }).toThrow("maxRetries");
  });

  it("rejects negative maxRetries", () => {
    expect(() => {
      new RPCChainExecutor({
        rpcUrl: "http://localhost:8545",
        defaultGasLimit: 50_000,
        confirmationTimeout: 30_000,
        maxRetries: -1,
      });
    }).toThrow("maxRetries");
  });

  it("rejects gasLimit out of bounds", () => {
    expect(() => {
      new RPCChainExecutor({
        rpcUrl: "http://localhost:8545",
        defaultGasLimit: 100,
        confirmationTimeout: 30_000,
        maxRetries: 3,
      });
    }).toThrow("defaultGasLimit");
  });
});

// ── enforceArrayLimit ───────────────────────────────────────────────

describe("enforceArrayLimit", () => {
  it("returns array unchanged if within limit", () => {
    const arr = [1, 2, 3];
    expect(enforceArrayLimit(arr, 10)).toEqual([1, 2, 3]);
  });

  it("truncates array to limit", () => {
    const arr = Array.from({ length: 200 }, (_, i) => i);
    const result = enforceArrayLimit(arr, MAX_SPONSOR_QUOTES);
    expect(result).toHaveLength(MAX_SPONSOR_QUOTES);
  });
});

// ── validateExecuteParams integration ───────────────────────────────

describe("validateExecuteParams", () => {
  const validParams = {
    action: "transfer",
    requester: "0x" + "a".repeat(64),
    actorAgentId: "0x" + "a".repeat(64),
    terminalClass: "app",
    trustTier: 3,
    params: { value: "1000000000000000000", to: "0x" + "b".repeat(64) },
  };

  it("accepts fully valid params", () => {
    expect(validateExecuteParams(validParams)).toEqual([]);
  });

  it("rejects invalid action", () => {
    const errors = validateExecuteParams({ ...validParams, action: "" });
    expect(errors.some((e) => e.includes("action"))).toBe(true);
  });

  it("rejects action with special characters", () => {
    const errors = validateExecuteParams({ ...validParams, action: "transfer; rm -rf /" });
    expect(errors.some((e) => e.includes("action"))).toBe(true);
  });

  it("rejects invalid requester", () => {
    const errors = validateExecuteParams({ ...validParams, requester: "not-an-address" });
    expect(errors.some((e) => e.includes("requester"))).toBe(true);
  });

  it("rejects invalid terminal class", () => {
    const errors = validateExecuteParams({ ...validParams, terminalClass: "hacked" });
    expect(errors.some((e) => e.includes("terminal class"))).toBe(true);
  });

  it("rejects invalid trust tier", () => {
    const errors = validateExecuteParams({ ...validParams, trustTier: 99 });
    expect(errors.some((e) => e.includes("trust tier"))).toBe(true);
  });
});
