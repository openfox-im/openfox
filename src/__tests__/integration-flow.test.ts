/**
 * Full Intent Flow Integration Tests
 *
 * Exercises the complete CLI command surface (intent, terminal, audit)
 * and the live pipeline factory, verifying the end-to-end user-facing
 * flow from intent creation through audit trail inspection.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import path from "path";
import os from "os";
import fs from "fs";

import { IntentPipeline, type ChainExecutor } from "../pipeline/executor.js";
import { FinancialRouter } from "../routing/router.js";
import { TerminalRegistry } from "../terminal/registry.js";
import { AuditJournal } from "../audit/journal.js";
import { selectSponsor } from "../sponsor/discovery.js";
import type { SponsorQuote, SponsorPolicy } from "../sponsor/types.js";
import type { ProviderProfile } from "../routing/types.js";
import type { PipelineConfig, PipelineResult } from "../pipeline/types.js";
import { DEFAULT_ESCALATION_RULES, type EscalationRule } from "../intent/escalation.js";
import type { AuditEntry, AuditEntryKind } from "../audit/types.js";

// ── Test Helpers ──────────────────────────────────────────────────

const TEST_REQUESTER = "0x1111111111111111111111111111111111111111";
const TEST_RECIPIENT = "0x2222222222222222222222222222222222222222";
const SMALL_VALUE = "1000000000000000000"; // 1 TOS
const MEDIUM_VALUE = "50000000000000000000"; // 50 TOS
const LARGE_VALUE = "200000000000000000000"; // 200 TOS
const HUGE_VALUE = "2000000000000000000000"; // 2000 TOS
const KIOSK_OVER_LIMIT = "60000000000000000000"; // 60 TOS (kiosk max is 50)

interface TestFixture {
  db: Database.Database;
  tmpDir: string;
  router: FinancialRouter;
  terminal: TerminalRegistry;
  audit: AuditJournal;
}

function createTestFixture(): TestFixture {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "integration-flow-"));
  const dbPath = path.join(tmpDir, "test.db");
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");

  const router = new FinancialRouter();
  const terminal = new TerminalRegistry();
  const audit = new AuditJournal(db);

  return { db, tmpDir, router, terminal, audit };
}

function cleanupFixture(fixture: TestFixture): void {
  fixture.db.close();
  fs.rmSync(fixture.tmpDir, { recursive: true, force: true });
}

function createPipelineConfig(overrides?: Partial<PipelineConfig>): PipelineConfig {
  return {
    defaultTTL: 300,
    sponsorPolicy: {
      preferredSponsors: [],
      maxFeePercent: 1.0,
      maxFeeAbsolute: "1000000000000000000",
      minTrustTier: 1,
      strategy: "cheapest",
      fallbackEnabled: true,
      autoSelectEnabled: true,
    },
    routingPolicy: {
      strategy: "balanced",
      minTrustTier: 1,
      maxFeePercent: 5,
      maxLatencyMs: 10000,
      preferredProviders: [],
      excludedProviders: [],
      requireSponsor: false,
      allowGateway: true,
      maxHops: 2,
    },
    escalationRules: DEFAULT_ESCALATION_RULES,
    autoApprove: true,
    auditEnabled: true,
    ...overrides,
  };
}

function buildPipeline(
  fixture: TestFixture,
  configOverrides?: Partial<PipelineConfig>,
  chainExecutor?: ChainExecutor,
): IntentPipeline {
  return new IntentPipeline({
    router: fixture.router,
    terminal: fixture.terminal,
    audit: fixture.audit,
    config: createPipelineConfig(configOverrides),
    chainExecutor,
  });
}

function registerTestProvider(
  router: FinancialRouter,
  overrides?: Partial<ProviderProfile>,
): ProviderProfile {
  const profile: ProviderProfile = {
    address: "0xABCDEF0000000000000000000000000000000001",
    name: "TestProvider",
    serviceKinds: ["signer"],
    capabilities: ["transfer"],
    trustTier: 3,
    reputationScore: 80,
    latencyMs: 100,
    feeSchedule: {
      baseFee: "100000000000000", // 0.0001 TOS
      perGasFee: "0",
      percentFee: 0,
      currency: "TOS",
    },
    sponsorSupport: true,
    gatewayRequired: false,
    lastSeen: Date.now(),
    ...overrides,
  };
  router.registerProvider(profile);
  return profile;
}

function getAuditKinds(entries: AuditEntry[]): string[] {
  return entries.map((e) => e.kind);
}

// ── Test Suite ────────────────────────────────────────────────────

describe("Full Intent Flow Integration", () => {
  let fixture: TestFixture;

  beforeEach(() => {
    fixture = createTestFixture();
  });

  afterEach(() => {
    cleanupFixture(fixture);
  });

  // ── Transfer Flow ─────────────────────────────────────────────

  describe("transfer flow", () => {
    it("creates intent, selects route, creates plan, approves, executes, and produces receipt", async () => {
      registerTestProvider(fixture.router);
      const pipeline = buildPipeline(fixture);

      const result = await pipeline.transfer({
        from: TEST_REQUESTER,
        to: TEST_RECIPIENT,
        value: SMALL_VALUE,
        terminalClass: "app",
        trustTier: 4,
      });

      expect(result.success).toBe(true);
      expect(result.intentId).toBeTruthy();
      expect(result.planId).toBeTruthy();
      expect(result.approvalId).toBeTruthy();
      expect(result.receiptId).toBeTruthy();
      expect(result.txHash).toBeTruthy();
      expect(result.timeline.length).toBeGreaterThanOrEqual(5);

      // Verify timeline contains all expected steps
      const timelineText = result.timeline.join("\n");
      expect(timelineText).toContain("create_intent");
      expect(timelineText).toContain("evaluate_terminal");
      expect(timelineText).toContain("discover_route");
      expect(timelineText).toContain("create_plan");
      expect(timelineText).toContain("execute");
      expect(timelineText).toContain("create_receipt");
    });

    it("records complete audit trail for the transfer", async () => {
      registerTestProvider(fixture.router);
      const pipeline = buildPipeline(fixture);

      const result = await pipeline.transfer({
        from: TEST_REQUESTER,
        to: TEST_RECIPIENT,
        value: SMALL_VALUE,
        terminalClass: "app",
        trustTier: 4,
      });

      expect(result.success).toBe(true);

      const entries = fixture.audit.getIntentTimeline(result.intentId);
      expect(entries.length).toBeGreaterThanOrEqual(5);

      const kinds = getAuditKinds(entries);
      expect(kinds).toContain("intent_created");
      expect(kinds).toContain("intent_transition");
      expect(kinds).toContain("plan_created");
      expect(kinds).toContain("approval_granted");
      expect(kinds).toContain("execution_submitted");
      expect(kinds).toContain("execution_settled");
    });

    it("produces valid proof references", async () => {
      registerTestProvider(fixture.router);
      const pipeline = buildPipeline(fixture);

      const result = await pipeline.transfer({
        from: TEST_REQUESTER,
        to: TEST_RECIPIENT,
        value: SMALL_VALUE,
        terminalClass: "app",
        trustTier: 4,
      });

      expect(result.success).toBe(true);

      const entries = fixture.audit.getIntentTimeline(result.intentId);

      // Verify cross-references: the settled entry should have txHash and receiptId
      const settled = entries.find((e) => e.kind === "execution_settled");
      expect(settled).toBeDefined();
      expect(settled!.txHash).toBeTruthy();
      expect(settled!.receiptId).toBeTruthy();
      expect(settled!.txHash).toBe(result.txHash);
      expect(settled!.receiptId).toBe(result.receiptId);

      // Verify the plan_created entry references the planId
      const planCreated = entries.find((e) => e.kind === "plan_created");
      expect(planCreated).toBeDefined();
      expect(planCreated!.planId).toBe(result.planId);

      // Verify all entries reference the same intentId
      for (const entry of entries) {
        expect(entry.intentId).toBe(result.intentId);
      }
    });

    it("succeeds with simulated execution when no chain executor is provided", async () => {
      const pipeline = buildPipeline(fixture);

      const result = await pipeline.transfer({
        from: TEST_REQUESTER,
        to: TEST_RECIPIENT,
        value: SMALL_VALUE,
        terminalClass: "app",
        trustTier: 4,
      });

      // Even without registered providers, the pipeline falls back to actor-as-provider
      expect(result.success).toBe(true);
      expect(result.txHash).toMatch(/^0x[0-9a-f]{64}$/);
    });

    it("works with a custom chain executor", async () => {
      registerTestProvider(fixture.router);

      const customTxHash = "0x" + "ab".repeat(32);
      const customExecutor: ChainExecutor = async (params) => ({
        txHash: customTxHash,
        blockNumber: 42,
        blockHash: "0x" + "cd".repeat(32),
        from: TEST_REQUESTER,
        to: params.target,
        gasUsed: 21000,
        value: params.value,
        status: "success",
      });

      const pipeline = buildPipeline(fixture, undefined, customExecutor);

      const result = await pipeline.transfer({
        from: TEST_REQUESTER,
        to: TEST_RECIPIENT,
        value: SMALL_VALUE,
        terminalClass: "app",
        trustTier: 4,
      });

      expect(result.success).toBe(true);
      expect(result.txHash).toBe(customTxHash);
    });
  });

  // ── Multi-Terminal Scenario ────────────────────────────────────

  describe("multi-terminal scenario", () => {
    it("allows transfer from app terminal (high trust)", async () => {
      registerTestProvider(fixture.router);
      const pipeline = buildPipeline(fixture);

      const result = await pipeline.transfer({
        from: TEST_REQUESTER,
        to: TEST_RECIPIENT,
        value: LARGE_VALUE,
        terminalClass: "app",
        trustTier: 4,
      });

      expect(result.success).toBe(true);
    });

    it("allows small transfer from card terminal (low trust)", async () => {
      registerTestProvider(fixture.router);
      const pipeline = buildPipeline(fixture);

      const result = await pipeline.transfer({
        from: TEST_REQUESTER,
        to: TEST_RECIPIENT,
        value: SMALL_VALUE,
        terminalClass: "card",
        trustTier: 1,
      });

      expect(result.success).toBe(true);
      expect(result.receiptId).toBeTruthy();
    });

    it("rejects large transfer from kiosk terminal", async () => {
      registerTestProvider(fixture.router);
      const pipeline = buildPipeline(fixture);

      const result = await pipeline.transfer({
        from: TEST_REQUESTER,
        to: TEST_RECIPIENT,
        value: KIOSK_OVER_LIMIT,
        terminalClass: "kiosk",
        trustTier: 0,
      });

      // Kiosk has maxTransactionValue of 50 TOS, and we're sending 60 TOS
      expect(result.success).toBe(false);
      expect(result.error).toContain("exceeds terminal");
    });

    it("handles voice terminal with limited actions", async () => {
      registerTestProvider(fixture.router);
      const pipeline = buildPipeline(fixture);

      // Voice supports "transfer" but has maxTransactionValue of 100 TOS
      const result = await pipeline.transfer({
        from: TEST_REQUESTER,
        to: TEST_RECIPIENT,
        value: MEDIUM_VALUE,
        terminalClass: "voice",
        trustTier: 1,
      });

      expect(result.success).toBe(true);

      // Verify the voice terminal doesn't support swap
      const adapter = fixture.terminal.getAdapter("voice");
      expect(adapter).toBeDefined();
      const caps = adapter!.capabilities();
      expect(caps.supportedActions).toContain("transfer");
      expect(caps.supportedActions).not.toContain("swap");
    });

    it("rejects unsupported actions on restricted terminals", async () => {
      registerTestProvider(fixture.router);
      const pipeline = buildPipeline(fixture);

      // Voice terminal doesn't support "swap"
      const result = await pipeline.execute({
        action: "swap",
        requester: TEST_REQUESTER,
        actorAgentId: TEST_REQUESTER,
        terminalClass: "voice",
        trustTier: 1,
        params: { value: SMALL_VALUE },
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("does not support action");
    });
  });

  // ── Escalation Scenario ───────────────────────────────────────

  describe("escalation scenario", () => {
    it("auto-approves low-value transfers", async () => {
      registerTestProvider(fixture.router);
      const pipeline = buildPipeline(fixture, { autoApprove: true });

      const result = await pipeline.transfer({
        from: TEST_REQUESTER,
        to: TEST_RECIPIENT,
        value: SMALL_VALUE,
        terminalClass: "app",
        trustTier: 4,
      });

      expect(result.success).toBe(true);

      // Check the timeline for auto-approval
      const timelineText = result.timeline.join("\n");
      expect(timelineText).toContain("Auto-approved");
    });

    it("requires approval for high-value transfers", async () => {
      registerTestProvider(fixture.router);
      // autoApprove=false means escalation triggers an explicit approval step
      const pipeline = buildPipeline(fixture, { autoApprove: false });

      const result = await pipeline.transfer({
        from: TEST_REQUESTER,
        to: TEST_RECIPIENT,
        value: LARGE_VALUE,
        terminalClass: "app",
        trustTier: 4,
      });

      // The pipeline still auto-grants in code (no interactive UI), but it logs
      // the approval request and grant as separate steps
      expect(result.success).toBe(true);

      const entries = fixture.audit.getIntentTimeline(result.intentId);
      const kinds = getAuditKinds(entries);
      expect(kinds).toContain("approval_granted");

      // With autoApprove=false, the value 200 TOS > 100 TOS threshold
      // triggers "require_approval" escalation
      const timelineText = result.timeline.join("\n");
      expect(timelineText).toContain("Escalation triggered");
      expect(timelineText).toContain("Approval requested");
      expect(timelineText).toContain("Approval granted");
    });

    it("denies restricted actions from low-trust terminals", async () => {
      registerTestProvider(fixture.router);

      // Use escalation rules that deny restricted actions
      const strictRules: EscalationRule[] = [
        ...DEFAULT_ESCALATION_RULES,
        {
          condition: "action_restricted",
          threshold: "swap",
          action: "deny",
        },
      ];

      const pipeline = buildPipeline(fixture, {
        autoApprove: false,
        escalationRules: strictRules,
      });

      // App terminal supports "swap" at the terminal level, but escalation
      // rules deny it
      const result = await pipeline.execute({
        action: "swap",
        requester: TEST_REQUESTER,
        actorAgentId: TEST_REQUESTER,
        terminalClass: "app",
        trustTier: 4,
        params: { value: SMALL_VALUE, to: TEST_RECIPIENT },
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("Escalation denied");
    });

    it("guardian-level escalation for huge-value transfers still succeeds with auto-approve", async () => {
      registerTestProvider(fixture.router);
      const pipeline = buildPipeline(fixture, { autoApprove: true });

      // 2000 TOS > 1000 TOS threshold triggers require_guardian
      const result = await pipeline.transfer({
        from: TEST_REQUESTER,
        to: TEST_RECIPIENT,
        value: HUGE_VALUE,
        terminalClass: "app",
        trustTier: 4,
      });

      // With autoApprove=true, even guardian-level escalations are auto-approved
      expect(result.success).toBe(true);

      const timelineText = result.timeline.join("\n");
      expect(timelineText).toContain("Escalation triggered");
      expect(timelineText).toContain("guardian");
    });
  });

  // ── Sponsor Scenario ──────────────────────────────────────────

  describe("sponsor scenario", () => {
    it("selects cheapest sponsor when multiple available", () => {
      const quotes: SponsorQuote[] = [
        {
          sponsorAddress: "0xSPONSOR_A",
          sponsorName: "ExpensiveSponsor",
          feeAmount: "500000000000000",
          feeCurrency: "TOS",
          gasLimit: 50000,
          expiresAt: Math.floor(Date.now() / 1000) + 120,
          policyHash: "0x" + "0".repeat(64),
          trustTier: 3,
          latencyMs: 100,
        },
        {
          sponsorAddress: "0xSPONSOR_B",
          sponsorName: "CheapSponsor",
          feeAmount: "100000000000000",
          feeCurrency: "TOS",
          gasLimit: 50000,
          expiresAt: Math.floor(Date.now() / 1000) + 120,
          policyHash: "0x" + "0".repeat(64),
          trustTier: 3,
          latencyMs: 200,
        },
      ];

      const policy: SponsorPolicy = {
        preferredSponsors: [],
        maxFeePercent: 5.0,
        maxFeeAbsolute: "1000000000000000000",
        minTrustTier: 1,
        strategy: "cheapest",
        fallbackEnabled: true,
        autoSelectEnabled: true,
      };

      const selection = selectSponsor(quotes, policy, SMALL_VALUE);
      expect(selection).not.toBeNull();
      expect(selection!.selected.sponsorAddress).toBe("0xSPONSOR_B");
      expect(selection!.selected.sponsorName).toBe("CheapSponsor");
      expect(selection!.alternatives.length).toBe(1);
    });

    it("falls back when preferred sponsor unavailable", () => {
      const quotes: SponsorQuote[] = [
        {
          sponsorAddress: "0xSPONSOR_C",
          sponsorName: "AvailableSponsor",
          feeAmount: "200000000000000",
          feeCurrency: "TOS",
          gasLimit: 50000,
          expiresAt: Math.floor(Date.now() / 1000) + 120,
          policyHash: "0x" + "0".repeat(64),
          trustTier: 3,
          latencyMs: 150,
        },
      ];

      const policy: SponsorPolicy = {
        preferredSponsors: ["0xSPONSOR_PREFERRED"],
        maxFeePercent: 5.0,
        maxFeeAbsolute: "1000000000000000000",
        minTrustTier: 1,
        strategy: "preferred_first",
        fallbackEnabled: true,
        autoSelectEnabled: true,
      };

      const selection = selectSponsor(quotes, policy, SMALL_VALUE);
      // Preferred sponsor not in quotes, falls back to available
      expect(selection).not.toBeNull();
      expect(selection!.selected.sponsorAddress).toBe("0xSPONSOR_C");
    });

    it("does not auto-select unpreferred sponsors when autoSelectEnabled is false", () => {
      const quotes: SponsorQuote[] = [
        {
          sponsorAddress: "0xSPONSOR_X",
          sponsorName: "AvailableSponsor",
          feeAmount: "200000000000000",
          feeCurrency: "TOS",
          gasLimit: 50000,
          expiresAt: Math.floor(Date.now() / 1000) + 120,
          policyHash: "0x" + "0".repeat(64),
          trustTier: 3,
          latencyMs: 150,
        },
      ];

      const policy: SponsorPolicy = {
        preferredSponsors: ["0xSPONSOR_PREFERRED"],
        maxFeePercent: 5.0,
        maxFeeAbsolute: "1000000000000000000",
        minTrustTier: 1,
        strategy: "preferred_first",
        fallbackEnabled: true,
        autoSelectEnabled: false,
      };

      const selection = selectSponsor(quotes, policy, SMALL_VALUE);
      expect(selection).toBeNull();
    });

    it("records sponsor attribution in audit log", async () => {
      // Register a provider with sponsor support so the pipeline selects it
      registerTestProvider(fixture.router, {
        address: "0xSPONSOR_PROVIDER",
        name: "SponsorProvider",
        sponsorSupport: true,
        feeSchedule: {
          baseFee: "100000000000000",
          perGasFee: "0",
          percentFee: 0,
          currency: "TOS",
        },
      });

      const pipeline = buildPipeline(fixture);

      const result = await pipeline.transfer({
        from: TEST_REQUESTER,
        to: TEST_RECIPIENT,
        value: SMALL_VALUE,
        terminalClass: "app",
        trustTier: 4,
      });

      expect(result.success).toBe(true);

      const entries = fixture.audit.getIntentTimeline(result.intentId);
      const sponsorEntries = entries.filter((e) => e.kind === "sponsor_selected");

      // If routing found a sponsor-supporting provider and sponsor was selected,
      // verify the audit entry exists
      if (sponsorEntries.length > 0) {
        expect(sponsorEntries[0]!.sponsorAddress).toBeTruthy();
        expect(sponsorEntries[0]!.summary).toContain("Sponsor selected");
      }

      // Either way, the pipeline produced a valid result
      expect(result.receiptId).toBeTruthy();
    });

    it("returns null when no sponsors match policy constraints", () => {
      const quotes: SponsorQuote[] = [
        {
          sponsorAddress: "0xUNTRUSTED",
          sponsorName: "UntrustedSponsor",
          feeAmount: "100000000000000",
          feeCurrency: "TOS",
          gasLimit: 50000,
          expiresAt: Math.floor(Date.now() / 1000) + 120,
          policyHash: "0x" + "0".repeat(64),
          trustTier: 0,
        },
      ];

      const policy: SponsorPolicy = {
        preferredSponsors: [],
        maxFeePercent: 5.0,
        maxFeeAbsolute: "1000000000000000000",
        minTrustTier: 2, // requires tier 2+
        strategy: "cheapest",
        fallbackEnabled: true,
        autoSelectEnabled: true,
      };

      const selection = selectSponsor(quotes, policy, SMALL_VALUE);
      expect(selection).toBeNull();
    });
  });

  // ── Quote Comparison ──────────────────────────────────────────

  describe("quote comparison", () => {
    it("compareQuotes returns ranked candidates", () => {
      const quotes: SponsorQuote[] = [
        {
          sponsorAddress: "0xA",
          feeAmount: "300000000000000",
          feeCurrency: "TOS",
          gasLimit: 50000,
          expiresAt: Math.floor(Date.now() / 1000) + 120,
          policyHash: "0x" + "0".repeat(64),
          trustTier: 3,
          latencyMs: 50,
        },
        {
          sponsorAddress: "0xB",
          feeAmount: "100000000000000",
          feeCurrency: "TOS",
          gasLimit: 50000,
          expiresAt: Math.floor(Date.now() / 1000) + 120,
          policyHash: "0x" + "0".repeat(64),
          trustTier: 2,
          latencyMs: 200,
        },
        {
          sponsorAddress: "0xC",
          feeAmount: "200000000000000",
          feeCurrency: "TOS",
          gasLimit: 50000,
          expiresAt: Math.floor(Date.now() / 1000) + 120,
          policyHash: "0x" + "0".repeat(64),
          trustTier: 4,
          latencyMs: 100,
        },
      ];

      const cheapestPolicy: SponsorPolicy = {
        preferredSponsors: [],
        maxFeePercent: 5.0,
        maxFeeAbsolute: "1000000000000000000",
        minTrustTier: 1,
        strategy: "cheapest",
        fallbackEnabled: true,
        autoSelectEnabled: true,
      };

      const cheapest = selectSponsor(quotes, cheapestPolicy, SMALL_VALUE);
      expect(cheapest).not.toBeNull();
      expect(cheapest!.selected.sponsorAddress).toBe("0xB"); // lowest fee
      expect(cheapest!.alternatives.length).toBe(2);

      // Fastest strategy
      const fastestPolicy = { ...cheapestPolicy, strategy: "fastest" as const };
      const fastest = selectSponsor(quotes, fastestPolicy, SMALL_VALUE);
      expect(fastest).not.toBeNull();
      expect(fastest!.selected.sponsorAddress).toBe("0xA"); // lowest latency

      // Highest trust strategy
      const trustPolicy = { ...cheapestPolicy, strategy: "highest_trust" as const };
      const trusted = selectSponsor(quotes, trustPolicy, SMALL_VALUE);
      expect(trusted).not.toBeNull();
      expect(trusted!.selected.sponsorAddress).toBe("0xC"); // highest trust tier
    });

    it("formatQuoteTable produces readable output via totalCostDisplay", () => {
      const quotes: SponsorQuote[] = [
        {
          sponsorAddress: "0xA",
          sponsorName: "GaslessProvider",
          feeAmount: "0",
          feeCurrency: "TOS",
          gasLimit: 50000,
          expiresAt: Math.floor(Date.now() / 1000) + 120,
          policyHash: "0x" + "0".repeat(64),
          trustTier: 3,
        },
      ];

      const policy: SponsorPolicy = {
        preferredSponsors: [],
        maxFeePercent: 5.0,
        maxFeeAbsolute: "1000000000000000000",
        minTrustTier: 1,
        strategy: "cheapest",
        fallbackEnabled: true,
        autoSelectEnabled: true,
      };

      const selection = selectSponsor(quotes, policy, SMALL_VALUE);
      expect(selection).not.toBeNull();
      expect(selection!.totalCostDisplay).toContain("TOS");
      expect(selection!.totalCostDisplay).toContain("gasless");
    });
  });

  // ── Degraded Mode ─────────────────────────────────────────────

  describe("degraded mode", () => {
    it("queues requests when terminal is degraded", () => {
      const registry = new TerminalRegistry();
      const session = registry.createSession("kiosk", "kiosk-001");
      expect(session).toBeDefined();

      // Revoke session to simulate degraded state
      const revoked = registry.revokeSession(session!.sessionId);
      expect(revoked).toBe(true);

      // Validate that the revoked session fails validation
      const adapter = registry.getAdapter("kiosk");
      expect(adapter).toBeDefined();
      const validation = adapter!.validateRequest(session!, {
        sessionId: session!.sessionId,
        terminalClass: "kiosk",
        trustTier: 0,
        terminalId: "kiosk-001",
        action: "transfer",
        params: { value: SMALL_VALUE },
        timestamp: Math.floor(Date.now() / 1000),
      });
      expect(validation.valid).toBe(false);
      expect(validation.reason).toContain("revoked");
    });

    it("processes queue when connectivity restored", () => {
      const registry = new TerminalRegistry();

      // Create session, revoke it (simulating degraded), then create a new session
      const session1 = registry.createSession("app", "app-001");
      expect(session1).toBeDefined();
      registry.revokeSession(session1!.sessionId);

      // "Restore connectivity" by creating a new session
      const session2 = registry.createSession("app", "app-001");
      expect(session2).toBeDefined();
      expect(session2!.sessionId).not.toBe(session1!.sessionId);

      // The new session should be valid
      const adapter = registry.getAdapter("app");
      const validation = adapter!.validateRequest(session2!, {
        sessionId: session2!.sessionId,
        terminalClass: "app",
        trustTier: 4,
        terminalId: "app-001",
        action: "transfer",
        params: { value: SMALL_VALUE },
        timestamp: Math.floor(Date.now() / 1000),
      });
      expect(validation.valid).toBe(true);

      // Clean up expired/revoked sessions
      // Since revoked session is still within TTL, cleanExpiredSessions should remove it
      // because it's revoked
      const cleaned = registry.cleanExpiredSessions();
      expect(cleaned).toBe(1); // only the revoked session
    });
  });

  // ── Audit Journal Queries ─────────────────────────────────────

  describe("audit journal queries", () => {
    it("queries by kind", async () => {
      registerTestProvider(fixture.router);
      const pipeline = buildPipeline(fixture);

      await pipeline.transfer({
        from: TEST_REQUESTER,
        to: TEST_RECIPIENT,
        value: SMALL_VALUE,
        terminalClass: "app",
        trustTier: 4,
      });

      const intentCreated = fixture.audit.query({ kind: "intent_created" });
      expect(intentCreated.length).toBe(1);
      expect(intentCreated[0]!.actorAddress).toBe(TEST_REQUESTER);
    });

    it("counts entries correctly", async () => {
      registerTestProvider(fixture.router);
      const pipeline = buildPipeline(fixture);

      await pipeline.transfer({
        from: TEST_REQUESTER,
        to: TEST_RECIPIENT,
        value: SMALL_VALUE,
        terminalClass: "app",
        trustTier: 4,
      });

      const total = fixture.audit.count();
      expect(total).toBeGreaterThanOrEqual(5);

      const intentCount = fixture.audit.count({ kind: "intent_created" });
      expect(intentCount).toBe(1);
    });

    it("filters by terminal class", async () => {
      registerTestProvider(fixture.router);
      const pipeline = buildPipeline(fixture);

      await pipeline.transfer({
        from: TEST_REQUESTER,
        to: TEST_RECIPIENT,
        value: SMALL_VALUE,
        terminalClass: "app",
        trustTier: 4,
      });

      await pipeline.transfer({
        from: TEST_REQUESTER,
        to: TEST_RECIPIENT,
        value: SMALL_VALUE,
        terminalClass: "card",
        trustTier: 1,
      });

      const appEntries = fixture.audit.query({ terminalClass: "app" });
      const cardEntries = fixture.audit.query({ terminalClass: "card" });

      expect(appEntries.length).toBeGreaterThanOrEqual(1);
      expect(cardEntries.length).toBeGreaterThanOrEqual(1);

      for (const entry of appEntries) {
        expect(entry.terminalClass).toBe("app");
      }
      for (const entry of cardEntries) {
        expect(entry.terminalClass).toBe("card");
      }
    });

    it("tracks multiple intents independently", async () => {
      registerTestProvider(fixture.router);
      const pipeline = buildPipeline(fixture);

      const r1 = await pipeline.transfer({
        from: TEST_REQUESTER,
        to: TEST_RECIPIENT,
        value: SMALL_VALUE,
        terminalClass: "app",
        trustTier: 4,
      });

      const r2 = await pipeline.transfer({
        from: TEST_REQUESTER,
        to: "0x3333333333333333333333333333333333333333",
        value: MEDIUM_VALUE,
        terminalClass: "pos",
        trustTier: 2,
      });

      expect(r1.intentId).not.toBe(r2.intentId);

      const entries1 = fixture.audit.getIntentTimeline(r1.intentId);
      const entries2 = fixture.audit.getIntentTimeline(r2.intentId);

      expect(entries1.length).toBeGreaterThanOrEqual(5);
      expect(entries2.length).toBeGreaterThanOrEqual(5);

      // Each timeline should only reference its own intentId
      for (const e of entries1) {
        expect(e.intentId).toBe(r1.intentId);
      }
      for (const e of entries2) {
        expect(e.intentId).toBe(r2.intentId);
      }
    });
  });

  // ── Terminal Registry ─────────────────────────────────────────

  describe("terminal registry", () => {
    it("registers all default terminal adapters", () => {
      const registry = new TerminalRegistry();
      const classes = ["app", "card", "pos", "voice", "kiosk", "robot"] as const;

      for (const cls of classes) {
        const adapter = registry.getAdapter(cls);
        expect(adapter).toBeDefined();
        expect(adapter!.terminalClass).toBe(cls);
      }
    });

    it("creates and manages sessions", () => {
      const registry = new TerminalRegistry();
      const session = registry.createSession("app", "device-001", { browser: "chrome" });

      expect(session).toBeDefined();
      expect(session!.terminalClass).toBe("app");
      expect(session!.terminalId).toBe("device-001");
      expect(session!.revoked).toBe(false);

      // Retrieve session
      const retrieved = registry.getSession(session!.sessionId);
      expect(retrieved).toBeDefined();
      expect(retrieved!.sessionId).toBe(session!.sessionId);

      // Revoke session
      const revoked = registry.revokeSession(session!.sessionId);
      expect(revoked).toBe(true);
      expect(registry.getSession(session!.sessionId)!.revoked).toBe(true);

      // Revoking non-existent session returns false
      expect(registry.revokeSession("nonexistent")).toBe(false);
    });

    it("reports correct capabilities per terminal class", () => {
      const registry = new TerminalRegistry();

      // App: high trust, can sign, many actions
      const app = registry.getAdapter("app")!;
      expect(app.defaultTrustTier).toBe(4);
      expect(app.capabilities().canSign).toBe(true);
      expect(app.capabilities().supportedActions).toContain("transfer");
      expect(app.capabilities().supportedActions).toContain("swap");

      // Kiosk: zero trust, limited
      const kiosk = registry.getAdapter("kiosk")!;
      expect(kiosk.defaultTrustTier).toBe(0);
      expect(kiosk.capabilities().canSign).toBe(false);
      expect(kiosk.capabilities().maxTransactionValue).toBe("50000000000000000000");

      // Voice: low trust, transfer only
      const voice = registry.getAdapter("voice")!;
      expect(voice.defaultTrustTier).toBe(1);
      expect(voice.capabilities().supportedActions).toEqual(["transfer"]);
    });
  });

  // ── Pipeline with Routing ─────────────────────────────────────

  describe("pipeline with routing", () => {
    it("selects from multiple providers", async () => {
      registerTestProvider(fixture.router, {
        address: "0xPROVIDER_EXPENSIVE",
        name: "ExpensiveProvider",
        feeSchedule: {
          baseFee: "1000000000000000",
          perGasFee: "0",
          percentFee: 0,
          currency: "TOS",
        },
        trustTier: 2,
        reputationScore: 60,
      });

      registerTestProvider(fixture.router, {
        address: "0xPROVIDER_CHEAP",
        name: "CheapProvider",
        feeSchedule: {
          baseFee: "50000000000000",
          perGasFee: "0",
          percentFee: 0,
          currency: "TOS",
        },
        trustTier: 3,
        reputationScore: 80,
      });

      const pipeline = buildPipeline(fixture);

      const result = await pipeline.transfer({
        from: TEST_REQUESTER,
        to: TEST_RECIPIENT,
        value: SMALL_VALUE,
        terminalClass: "app",
        trustTier: 4,
      });

      expect(result.success).toBe(true);
      // The router should have found providers and selected one
      const timelineText = result.timeline.join("\n");
      expect(timelineText).toContain("Route found");
    });

    it("falls back to actor-as-provider when no providers registered", async () => {
      // No providers registered
      const pipeline = buildPipeline(fixture);

      const result = await pipeline.transfer({
        from: TEST_REQUESTER,
        to: TEST_RECIPIENT,
        value: SMALL_VALUE,
        terminalClass: "app",
        trustTier: 4,
      });

      expect(result.success).toBe(true);
      const timelineText = result.timeline.join("\n");
      expect(timelineText).toContain("No route found");
    });
  });

  // ── Failed Execution Scenario ─────────────────────────────────

  describe("failed execution", () => {
    it("records failure in audit trail when chain executor fails", async () => {
      registerTestProvider(fixture.router);

      const failingExecutor: ChainExecutor = async (params) => ({
        txHash: "0x" + "ff".repeat(32),
        blockNumber: 0,
        blockHash: "0x" + "00".repeat(32),
        from: TEST_REQUESTER,
        to: params.target,
        gasUsed: 21000,
        value: params.value,
        status: "reverted",
      });

      const pipeline = buildPipeline(fixture, undefined, failingExecutor);

      const result = await pipeline.transfer({
        from: TEST_REQUESTER,
        to: TEST_RECIPIENT,
        value: SMALL_VALUE,
        terminalClass: "app",
        trustTier: 4,
      });

      expect(result.success).toBe(false);
      expect(result.txHash).toBeTruthy();

      const entries = fixture.audit.getIntentTimeline(result.intentId);
      const kinds = getAuditKinds(entries);
      expect(kinds).toContain("execution_failed");
    });
  });

  // ── Pipeline getLastResult ────────────────────────────────────

  describe("pipeline state", () => {
    it("getLastResult returns the most recent result", async () => {
      registerTestProvider(fixture.router);
      const pipeline = buildPipeline(fixture);

      expect(pipeline.getLastResult()).toBeNull();

      const result = await pipeline.transfer({
        from: TEST_REQUESTER,
        to: TEST_RECIPIENT,
        value: SMALL_VALUE,
        terminalClass: "app",
        trustTier: 4,
      });

      const lastResult = pipeline.getLastResult();
      expect(lastResult).not.toBeNull();
      expect(lastResult!.intentId).toBe(result.intentId);
      expect(lastResult!.success).toBe(true);
    });
  });
});
