import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { IntentPipeline } from "../pipeline/executor.js";
import { FinancialRouter } from "../routing/router.js";
import { AuditJournal } from "../audit/journal.js";
import { TerminalRegistry } from "../terminal/registry.js";
import type { PipelineConfig } from "../pipeline/types.js";
import type { SponsorPolicy, SponsorQuote } from "../sponsor/types.js";
import type { RoutingPolicy } from "../routing/types.js";
import type { EscalationRule } from "../intent/escalation.js";
import type { ChainReceiptData } from "../intent/receipt.js";
import type { ContractMetadata } from "../intent/metadata-consumer.js";

// ── Test fixtures ─────────────────────────────────────────────────────

const TEST_REQUESTER = "0x" + "a".repeat(64);
const TEST_RECIPIENT = "0x" + "b".repeat(64);
const TEST_PROVIDER = "0x" + "c".repeat(64);
const TEST_SPONSOR = "0x" + "d".repeat(64);
const TEST_BACKUP_SPONSOR = "0x" + "e".repeat(64);

function makeSponsorPolicy(overrides?: Partial<SponsorPolicy>): SponsorPolicy {
  return {
    preferredSponsors: [],
    maxFeePercent: 5,
    maxFeeAbsolute: "1000000000000000000", // 1 TOS
    minTrustTier: 1,
    strategy: "cheapest",
    fallbackEnabled: true,
    autoSelectEnabled: true,
    ...overrides,
  };
}

function makeRoutingPolicy(overrides?: Partial<RoutingPolicy>): RoutingPolicy {
  return {
    strategy: "balanced",
    minTrustTier: 1,
    maxFeePercent: 5,
    maxLatencyMs: 10_000,
    preferredProviders: [],
    excludedProviders: [],
    requireSponsor: false,
    allowGateway: true,
    maxHops: 2,
    ...overrides,
  };
}

function makeConfig(overrides?: Partial<PipelineConfig>): PipelineConfig {
  return {
    defaultTTL: 300,
    sponsorPolicy: makeSponsorPolicy(),
    routingPolicy: makeRoutingPolicy(),
    escalationRules: [],
    autoApprove: true,
    auditEnabled: true,
    ...overrides,
  };
}

function makeRouter(): FinancialRouter {
  const router = new FinancialRouter();
  router.registerProvider({
    address: TEST_PROVIDER,
    name: "test-provider",
    serviceKinds: ["signer"],
    capabilities: ["transfer", "swap"],
    trustTier: 3,
    reputationScore: 80,
    latencyMs: 100,
    feeSchedule: {
      baseFee: "1000000000000000", // 0.001 TOS
      perGasFee: "0",
      percentFee: 0,
      currency: "TOS",
    },
    sponsorSupport: false,
    gatewayRequired: false,
    lastSeen: Date.now(),
  });
  return router;
}

function makeAudit(): { audit: AuditJournal; db: Database.Database } {
  const db = new Database(":memory:");
  const audit = new AuditJournal(db);
  return { audit, db };
}

function makeSponsorQuote(
  sponsorAddress: string,
  feeAmount: string,
  overrides?: Partial<SponsorQuote>,
): SponsorQuote {
  return {
    sponsorAddress,
    sponsorName: sponsorAddress,
    feeAmount,
    feeCurrency: "TOS",
    gasLimit: 50_000,
    expiresAt: Math.floor(Date.now() / 1000) + 120,
    policyHash: "0x" + "1".repeat(64),
    trustTier: 3,
    latencyMs: 100,
    ...overrides,
  };
}

function makeHighRiskContractMetadata(): ContractMetadata {
  return {
    schema_version: "0.1.0",
    artifact_ref: {
      package_hash: "0x" + "1".repeat(64),
      bytecode_hash: "0x" + "2".repeat(64),
      abi_hash: "0x" + "3".repeat(64),
      version: "1.0.0",
    },
    contract: {
      name: "GuardianVault",
      base_contracts: ["PolicyWallet"],
      is_account: true,
      storage_slots: 12,
    },
    functions: [
      {
        name: "executeTransfer",
        selector: "0xdeadbeef",
        visibility: "external",
        mutability: "payable",
        params: [
          { name: "to", type: "address" },
          { name: "value", type: "uint256" },
        ],
        returns: [],
        requires_capability: ["guardian-approval"],
        effects: {
          writes: ["owner_balance", "guardian_nonce"],
          calls: [{ interface: "IERC20", selector: "0xa9059cbb", max_gas: 50000 }],
        },
        gas_upper: 90000,
        verifiable: true,
        delegated: true,
        non_composable: false,
        risk_level: "high",
      },
      {
        name: "balanceOf",
        selector: "0x70a08231",
        visibility: "external",
        mutability: "view",
        params: [{ name: "account", type: "address" }],
        returns: [{ name: "balance", type: "uint256" }],
        effects: {
          reads: ["owner_balance"],
        },
        gas_upper: 5000,
        verifiable: true,
        delegated: false,
        non_composable: false,
        risk_level: "low",
      },
    ],
    events: [
      {
        name: "TransferExecuted",
        params: [{ name: "to", type: "address" }],
      },
    ],
    manifest: {
      version: "1.0.0",
      capabilities: ["guardian-approval"],
      spec: "guardian-vault",
    },
    gas_model: {
      version: "istanbul",
      sload: 2100,
      sstore: 20000,
      log_base: 375,
    },
    capabilities: ["guardian-approval"],
    is_account: true,
    policy_profile: {
      has_spend_caps: true,
      has_allowlist: true,
      has_terminal_policy: true,
      has_guardian: true,
      has_recovery: true,
      has_delegation: true,
      has_suspension: false,
    },
  };
}

// ── Tests ─────────────────────────────────────────────────────────────

describe("IntentPipeline", () => {
  let terminal: TerminalRegistry;

  beforeEach(() => {
    terminal = new TerminalRegistry();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("successful transfer pipeline", () => {
    it("completes all steps and produces a receipt", async () => {
      const router = makeRouter();
      const { audit } = makeAudit();
      const config = makeConfig();

      const pipeline = new IntentPipeline({
        router,
        terminal,
        audit,
        config,
      });

      const result = await pipeline.transfer({
        from: TEST_REQUESTER,
        to: TEST_RECIPIENT,
        value: "1000000000000000000", // 1 TOS
        terminalClass: "app",
        trustTier: 4,
      });

      expect(result.success).toBe(true);
      expect(result.intentId).toBeTruthy();
      expect(result.planId).toBeTruthy();
      expect(result.approvalId).toBeTruthy();
      expect(result.receiptId).toBeTruthy();
      expect(result.txHash).toBeTruthy();
      expect(result.error).toBeUndefined();

      // Timeline should contain all major steps
      expect(result.timeline.length).toBeGreaterThanOrEqual(7);
      const timelineText = result.timeline.join("\n");
      expect(timelineText).toContain("create_intent");
      expect(timelineText).toContain("evaluate_terminal");
      expect(timelineText).toContain("discover_route");
      expect(timelineText).toContain("select_sponsor");
      expect(timelineText).toContain("create_plan");
      expect(timelineText).toContain("evaluate_escalation");
      expect(timelineText).toContain("execute");
      expect(timelineText).toContain("create_receipt");
      expect(timelineText).toContain("audit_log");

      // getLastResult should return same result
      expect(pipeline.getLastResult()).toEqual(result);
    });

    it("works with a custom chain executor", async () => {
      const router = makeRouter();
      const config = makeConfig();

      const customReceipt: ChainReceiptData = {
        txHash: "0x" + "f".repeat(64),
        blockNumber: 42,
        blockHash: "0x" + "e".repeat(64),
        from: TEST_REQUESTER,
        to: TEST_RECIPIENT,
        gasUsed: 21_000,
        value: "1000000000000000000",
        status: "success",
      };

      const chainExecutor = vi.fn().mockResolvedValue(customReceipt);

      const pipeline = new IntentPipeline({
        router,
        terminal,
        config,
        chainExecutor,
      });

      const result = await pipeline.transfer({
        from: TEST_REQUESTER,
        to: TEST_RECIPIENT,
        value: "1000000000000000000",
        terminalClass: "app",
        trustTier: 4,
      });

      expect(result.success).toBe(true);
      expect(result.txHash).toBe(customReceipt.txHash);
      expect(chainExecutor).toHaveBeenCalledOnce();
      expect(chainExecutor).toHaveBeenCalledWith(
        expect.objectContaining({
          intentId: result.intentId,
          target: TEST_RECIPIENT,
          value: "1000000000000000000",
        }),
      );
    });
  });

  describe("escalation handling", () => {
    it("triggers escalation for high-value transfers", async () => {
      const router = makeRouter();
      const { audit } = makeAudit();

      const escalationRules: EscalationRule[] = [
        {
          condition: "value_above",
          threshold: "500000000000000000", // 0.5 TOS
          action: "require_approval",
        },
      ];

      const config = makeConfig({
        escalationRules,
        autoApprove: false,
      });

      const pipeline = new IntentPipeline({
        router,
        terminal,
        audit,
        config,
      });

      const result = await pipeline.transfer({
        from: TEST_REQUESTER,
        to: TEST_RECIPIENT,
        value: "1000000000000000000", // 1 TOS - above threshold
        terminalClass: "app",
        trustTier: 4,
      });

      expect(result.success).toBe(true);

      const timelineText = result.timeline.join("\n");
      expect(timelineText).toContain("Escalation triggered");
      expect(timelineText).toContain("Approval requested");
      expect(timelineText).toContain("Approval granted");

      // Audit should have the approval entries
      const entries = audit.getIntentTimeline(result.intentId);
      const kinds = entries.map((e) => e.kind);
      expect(kinds).toContain("approval_requested");
      expect(kinds).toContain("approval_granted");
    });

    it("persists approval context enriched from contract metadata", async () => {
      const router = makeRouter();
      const { audit } = makeAudit();
      const config = makeConfig({
        autoApprove: false,
      });

      const pipeline = new IntentPipeline({
        router,
        terminal,
        audit,
        config,
      });

      const result = await pipeline.transfer({
        from: TEST_REQUESTER,
        to: TEST_RECIPIENT,
        value: "1000000000000000000",
        terminalClass: "app",
        trustTier: 4,
        contractMetadata: makeHighRiskContractMetadata(),
      });

      expect(result.success).toBe(true);

      const timelineText = result.timeline.join("\n");
      expect(timelineText).toContain("Contract metadata: GuardianVault");
      expect(timelineText).toContain("Approval context enriched from TOL metadata for GuardianVault");
      expect(timelineText).toContain("Escalation triggered (level: guardian)");

      const entries = audit.getIntentTimeline(result.intentId);
      const requested = entries.find((entry) => entry.kind === "approval_requested");
      const granted = entries.find((entry) => entry.kind === "approval_granted");

      expect(requested).toBeDefined();
      expect(requested!.details).toMatchObject({
        contractName: "GuardianVault",
        contractRisk: "high",
      });
      expect(String(requested!.details?.approvalPrompt)).toContain("Contract Risk Context");
      expect(String(requested!.details?.approvalPrompt)).toContain("GuardianVault");

      expect(granted).toBeDefined();
      expect(granted!.details).toMatchObject({
        contractName: "GuardianVault",
        contractRisk: "high",
      });
      expect(String(granted!.details?.contractRiskSummary)).toContain("High risk");
    });

    it("hydrates routing and sponsor selection from live discovery callbacks", async () => {
      const router = new FinancialRouter();
      const { audit } = makeAudit();
      const config = makeConfig({
        sponsorPolicy: makeSponsorPolicy({
          strategy: "preferred_first",
          preferredSponsors: [TEST_SPONSOR],
        }),
      });
      const routeDiscoveryProvider = vi.fn().mockResolvedValue([
        {
          address: TEST_PROVIDER,
          name: "discovered-signer",
          serviceKinds: ["signer"],
          capabilities: ["signer.quote"],
          trustTier: 4,
          reputationScore: 88,
          latencyMs: 45,
          feeSchedule: {
            baseFee: "777",
            perGasFee: "0",
            percentFee: 0,
            currency: "TOS",
          },
          sponsorSupport: false,
          gatewayRequired: false,
          endpoint: "https://signer.example",
          lastSeen: Date.now(),
        },
      ]);
      const sponsorQuoteProvider = vi.fn().mockResolvedValue([
        {
          sponsorAddress: TEST_SPONSOR,
          sponsorName: "preferred-paymaster",
          feeAmount: "15",
          feeCurrency: "TOS",
          gasLimit: 50_000,
          expiresAt: Math.floor(Date.now() / 1000) + 120,
          policyHash: "0x" + "1".repeat(64),
          trustTier: 4,
          latencyMs: 30,
          reputationScore: 91,
        },
      ]);

      const pipeline = new IntentPipeline({
        router,
        terminal,
        audit,
        config,
        routeDiscoveryProvider,
        sponsorQuoteProvider,
      });

      const result = await pipeline.transfer({
        from: TEST_REQUESTER,
        to: TEST_RECIPIENT,
        value: "1000000000000000000",
        terminalClass: "app",
        trustTier: 4,
      });

      expect(result.success).toBe(true);
      expect(routeDiscoveryProvider).toHaveBeenCalledOnce();
      expect(sponsorQuoteProvider).toHaveBeenCalledOnce();

      const timelineText = result.timeline.join("\n");
      expect(timelineText).toContain("Discovery hydrated 1 signer provider(s) for live routing");
      expect(timelineText).toContain(`Route found: provider ${TEST_PROVIDER}`);
      expect(timelineText).toContain("Discovered 1 live sponsor quote(s) from paymaster providers");
      expect(timelineText).toContain(`Sponsor selected: ${TEST_SPONSOR}`);

      const sponsorEntry = audit.getIntentTimeline(result.intentId)
        .find((entry) => entry.kind === "sponsor_selected");
      expect(sponsorEntry?.sponsorAddress).toBe(TEST_SPONSOR);
    });

    it("denies execution when escalation level is deny", async () => {
      const router = makeRouter();
      const { audit } = makeAudit();

      const escalationRules: EscalationRule[] = [
        {
          condition: "action_restricted",
          threshold: "stake,delegate",
          action: "deny",
        },
      ];

      const config = makeConfig({
        escalationRules,
        autoApprove: false,
      });

      const pipeline = new IntentPipeline({
        router,
        terminal,
        audit,
        config,
      });

      const result = await pipeline.execute({
        action: "delegate",
        requester: TEST_REQUESTER,
        actorAgentId: TEST_REQUESTER,
        terminalClass: "app",
        trustTier: 4,
        params: { to: TEST_RECIPIENT },
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("Escalation denied");
      expect(result.error).toContain("restricted");
    });

    it("skips approval request when autoApprove is true", async () => {
      const router = makeRouter();

      const escalationRules: EscalationRule[] = [
        {
          condition: "value_above",
          threshold: "100000000000000000", // 0.1 TOS
          action: "require_approval",
        },
      ];

      const config = makeConfig({
        escalationRules,
        autoApprove: true,
      });

      const pipeline = new IntentPipeline({
        router,
        terminal,
        config,
      });

      const result = await pipeline.transfer({
        from: TEST_REQUESTER,
        to: TEST_RECIPIENT,
        value: "1000000000000000000",
        terminalClass: "app",
        trustTier: 4,
      });

      expect(result.success).toBe(true);

      const timelineText = result.timeline.join("\n");
      // Should use auto-approve path even though escalation triggered
      expect(timelineText).toContain("Auto-approved");
    });
  });

  describe("terminal rejection", () => {
    it("rejects kiosk attempting unsupported action", async () => {
      const router = makeRouter();
      const { audit } = makeAudit();
      const config = makeConfig();

      const pipeline = new IntentPipeline({
        router,
        terminal,
        audit,
        config,
      });

      const result = await pipeline.execute({
        action: "swap",
        requester: TEST_REQUESTER,
        actorAgentId: TEST_REQUESTER,
        terminalClass: "kiosk",
        trustTier: 0,
        params: {
          from: TEST_REQUESTER,
          to: TEST_RECIPIENT,
          value: "1000000000000000000",
        },
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("kiosk");
      expect(result.error).toContain("swap");

      const timelineText = result.timeline.join("\n");
      expect(timelineText).toContain("create_intent");
      // Should fail at terminal evaluation, not later
      expect(timelineText).not.toContain("discover_route");
    });

    it("rejects when terminal class has no adapter", async () => {
      const router = makeRouter();
      const config = makeConfig();

      const pipeline = new IntentPipeline({
        router,
        terminal,
        config,
      });

      const result = await pipeline.execute({
        action: "transfer",
        requester: TEST_REQUESTER,
        actorAgentId: TEST_REQUESTER,
        terminalClass: "api",
        trustTier: 2,
        params: { to: TEST_RECIPIENT, value: "100" },
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("No terminal adapter");
      expect(result.error).toContain("api");
    });
  });

  describe("expired intent handling", () => {
    it("handles expired intent gracefully", async () => {
      const router = makeRouter();
      const { audit } = makeAudit();

      const config = makeConfig({
        defaultTTL: 0, // expires immediately
      });

      // We need to mock Date.now to have the intent creation happen in the past.
      // The intent is created with expiresAt = now + 0 = now, so any subsequent
      // check at a later time will find it expired.
      const realNow = Date.now;
      let callCount = 0;
      vi.spyOn(Date, "now").mockImplementation(() => {
        // First few calls: normal time (for intent creation).
        // After that, advance time so isIntentExpired returns true.
        callCount++;
        if (callCount <= 2) {
          return realNow.call(Date);
        }
        // Return a time 10 seconds in the future
        return realNow.call(Date) + 10_000;
      });

      const pipeline = new IntentPipeline({
        router,
        terminal,
        audit,
        config,
      });

      const result = await pipeline.transfer({
        from: TEST_REQUESTER,
        to: TEST_RECIPIENT,
        value: "1000000000000000000",
        terminalClass: "app",
        trustTier: 4,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("expired");
    });
  });

  describe("audit journal integration", () => {
    it("records entries for each pipeline step", async () => {
      const router = makeRouter();
      const { audit } = makeAudit();
      const config = makeConfig();

      const pipeline = new IntentPipeline({
        router,
        terminal,
        audit,
        config,
      });

      const result = await pipeline.transfer({
        from: TEST_REQUESTER,
        to: TEST_RECIPIENT,
        value: "1000000000000000000",
        terminalClass: "app",
        trustTier: 4,
      });

      expect(result.success).toBe(true);

      const entries = audit.getIntentTimeline(result.intentId);
      expect(entries.length).toBeGreaterThanOrEqual(4);

      const kinds = entries.map((e) => e.kind);
      expect(kinds).toContain("intent_created");
      expect(kinds).toContain("intent_transition");
      expect(kinds).toContain("plan_created");
      expect(kinds).toContain("approval_granted");
      expect(kinds).toContain("execution_submitted");
      expect(kinds).toContain("execution_settled");

      // All entries should reference the correct intentId
      for (const entry of entries) {
        expect(entry.intentId).toBe(result.intentId);
      }

      // The settlement entry should contain the txHash
      const settled = entries.find((e) => e.kind === "execution_settled");
      expect(settled).toBeDefined();
      expect(settled!.txHash).toBe(result.txHash);
    });

    it("records audit entries even on failure", async () => {
      const router = makeRouter();
      const { audit } = makeAudit();
      const config = makeConfig();

      const pipeline = new IntentPipeline({
        router,
        terminal,
        audit,
        config,
      });

      // Use kiosk + swap to trigger a terminal rejection
      const result = await pipeline.execute({
        action: "swap",
        requester: TEST_REQUESTER,
        actorAgentId: TEST_REQUESTER,
        terminalClass: "kiosk",
        trustTier: 0,
        params: { to: TEST_RECIPIENT, value: "100" },
      });

      expect(result.success).toBe(false);

      const entries = audit.getIntentTimeline(result.intentId);
      expect(entries.length).toBeGreaterThanOrEqual(2);

      const kinds = entries.map((e) => e.kind);
      expect(kinds).toContain("intent_created");
      expect(kinds).toContain("execution_failed");
    });

    it("does not record audit entries when auditEnabled is false", async () => {
      const router = makeRouter();
      const { audit } = makeAudit();
      const config = makeConfig({ auditEnabled: false });

      const pipeline = new IntentPipeline({
        router,
        terminal,
        audit,
        config,
      });

      const result = await pipeline.transfer({
        from: TEST_REQUESTER,
        to: TEST_RECIPIENT,
        value: "1000000000000000000",
        terminalClass: "app",
        trustTier: 4,
      });

      expect(result.success).toBe(true);
      const entries = audit.getIntentTimeline(result.intentId);
      expect(entries.length).toBe(0);
    });
  });

  describe("failed chain execution", () => {
    it("handles reverted transaction", async () => {
      const router = makeRouter();
      const config = makeConfig();

      const chainExecutor = vi.fn().mockResolvedValue({
        txHash: "0x" + "f".repeat(64),
        blockNumber: 42,
        blockHash: "0x" + "e".repeat(64),
        from: TEST_REQUESTER,
        to: TEST_RECIPIENT,
        gasUsed: 21_000,
        value: "1000000000000000000",
        status: "reverted",
      } satisfies ChainReceiptData);

      const pipeline = new IntentPipeline({
        router,
        terminal,
        config,
        chainExecutor,
      });

      const result = await pipeline.transfer({
        from: TEST_REQUESTER,
        to: TEST_RECIPIENT,
        value: "1000000000000000000",
        terminalClass: "app",
        trustTier: 4,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("reverted");
      expect(result.txHash).toBe("0x" + "f".repeat(64));
    });

    it("retries with a fallback sponsor when the primary sponsor fails", async () => {
      const router = makeRouter();
      const { audit } = makeAudit();
      const config = makeConfig();
      const sponsorQuoteProvider = vi.fn().mockResolvedValue([
        makeSponsorQuote(TEST_SPONSOR, "10", {
          sponsorName: "primary-sponsor",
          policyHash: "0x" + "2".repeat(64),
        }),
        makeSponsorQuote(TEST_BACKUP_SPONSOR, "20", {
          sponsorName: "backup-sponsor",
          policyHash: "0x" + "3".repeat(64),
        }),
      ]);
      const chainExecutor = vi.fn().mockImplementation(async (params) => {
        if (params.sponsor?.sponsorAddress === TEST_SPONSOR) {
          return {
            txHash: "0x" + "a".repeat(64),
            blockNumber: 0,
            blockHash: "0x" + "0".repeat(64),
            from: TEST_REQUESTER,
            to: TEST_RECIPIENT,
            gasUsed: 21_000,
            value: "1000000000000000000",
            status: "failed",
          } satisfies ChainReceiptData;
        }
        return {
          txHash: "0x" + "b".repeat(64),
          blockNumber: 7,
          blockHash: "0x" + "c".repeat(64),
          from: TEST_REQUESTER,
          to: TEST_RECIPIENT,
          gasUsed: 21_000,
          value: "1000000000000000000",
          status: "success",
        } satisfies ChainReceiptData;
      });

      const pipeline = new IntentPipeline({
        router,
        terminal,
        audit,
        config,
        chainExecutor,
        sponsorQuoteProvider,
      });

      const result = await pipeline.transfer({
        from: TEST_REQUESTER,
        to: TEST_RECIPIENT,
        value: "1000000000000000000",
        terminalClass: "app",
        trustTier: 4,
      });

      expect(result.success).toBe(true);
      expect(chainExecutor).toHaveBeenCalledTimes(2);
      expect(chainExecutor.mock.calls[0]?.[0].sponsor?.sponsorAddress).toBe(TEST_SPONSOR);
      expect(chainExecutor.mock.calls[1]?.[0].sponsor?.sponsorAddress).toBe(TEST_BACKUP_SPONSOR);

      const timelineText = result.timeline.join("\n");
      expect(timelineText).toContain(`retrying ${TEST_BACKUP_SPONSOR}`);

      const failureEntries = audit
        .getIntentTimeline(result.intentId)
        .filter((entry) => entry.kind === "execution_failed");
      expect(failureEntries).toHaveLength(1);
      expect(failureEntries[0]?.sponsorAddress).toBe(TEST_SPONSOR);
    });

    it("falls back to self-pay when all sponsor attempts fail", async () => {
      const router = makeRouter();
      const config = makeConfig();
      const sponsorQuoteProvider = vi.fn().mockResolvedValue([
        makeSponsorQuote(TEST_SPONSOR, "10"),
      ]);
      const chainExecutor = vi.fn().mockImplementation(async (params) => {
        if (params.sponsor?.sponsorAddress) {
          return {
            txHash: "0x" + "d".repeat(64),
            blockNumber: 0,
            blockHash: "0x" + "0".repeat(64),
            from: TEST_REQUESTER,
            to: TEST_RECIPIENT,
            gasUsed: 21_000,
            value: "1000000000000000000",
            status: "failed",
          } satisfies ChainReceiptData;
        }
        return {
          txHash: "0x" + "e".repeat(64),
          blockNumber: 8,
          blockHash: "0x" + "f".repeat(64),
          from: TEST_REQUESTER,
          to: TEST_RECIPIENT,
          gasUsed: 21_000,
          value: "1000000000000000000",
          status: "success",
        } satisfies ChainReceiptData;
      });

      const pipeline = new IntentPipeline({
        router,
        terminal,
        config,
        chainExecutor,
        sponsorQuoteProvider,
      });

      const result = await pipeline.transfer({
        from: TEST_REQUESTER,
        to: TEST_RECIPIENT,
        value: "1000000000000000000",
        terminalClass: "app",
        trustTier: 4,
      });

      expect(result.success).toBe(true);
      expect(chainExecutor).toHaveBeenCalledTimes(2);
      expect(chainExecutor.mock.calls[0]?.[0].sponsor?.sponsorAddress).toBe(TEST_SPONSOR);
      expect(chainExecutor.mock.calls[1]?.[0].sponsor).toBeUndefined();

      const timelineText = result.timeline.join("\n");
      expect(timelineText).toContain("self-pay");
    });
  });
});
