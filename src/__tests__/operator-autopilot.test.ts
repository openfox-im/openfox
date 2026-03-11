import { describe, expect, it } from "vitest";
import { createTestConfig, createTestDb } from "./mocks.js";
import {
  buildOperatorAutopilotSnapshot,
  createOperatorApprovalRequest,
  decideOperatorApprovalRequest,
  runOperatorAutopilot,
} from "../operator/autopilot.js";
import { listQuarantinedProviders } from "../operator/control.js";
import {
  DEFAULT_OPERATOR_AUTOPILOT_CONFIG,
  type PaymasterAuthorizationRecord,
} from "../types.js";

function createAutopilotConfig() {
  return createTestConfig({
    operatorAutopilot: {
      ...DEFAULT_OPERATOR_AUTOPILOT_CONFIG,
      enabled: true,
      queuePolicies: {
        payments: {
          ...DEFAULT_OPERATOR_AUTOPILOT_CONFIG.queuePolicies.payments,
          enabled: false,
        },
        settlement: {
          ...DEFAULT_OPERATOR_AUTOPILOT_CONFIG.queuePolicies.settlement,
          enabled: false,
        },
        market: {
          ...DEFAULT_OPERATOR_AUTOPILOT_CONFIG.queuePolicies.market,
          enabled: false,
        },
        signer: {
          ...DEFAULT_OPERATOR_AUTOPILOT_CONFIG.queuePolicies.signer,
          enabled: false,
        },
        paymaster: {
          ...DEFAULT_OPERATOR_AUTOPILOT_CONFIG.queuePolicies.paymaster,
          enabled: false,
        },
      },
      storageMaintenance: {
        ...DEFAULT_OPERATOR_AUTOPILOT_CONFIG.storageMaintenance,
        enabled: false,
      },
      artifactMaintenance: {
        ...DEFAULT_OPERATOR_AUTOPILOT_CONFIG.artifactMaintenance,
        enabled: false,
      },
      providerQuarantine: {
        ...DEFAULT_OPERATOR_AUTOPILOT_CONFIG.providerQuarantine,
        enabled: true,
        quarantineMinEvents: 3,
        maxProvidersPerRun: 1,
        cooldownSeconds: 3600,
      },
    },
  });
}

function insertFailedPaymasterAuthorizations(providerAddress: `0x${string}`) {
  return [
    "auth-1",
    "auth-2",
    "auth-3",
  ].map((authorizationId, index) => ({
    authorizationId,
    quoteId: `quote-${index + 1}`,
    chainId: "1666",
    requestKey: `paymaster:req:${index + 1}`,
    requestHash:
      `0x${`${index + 1}`.repeat(64)}` as `0x${string}`,
    providerAddress,
    sponsorAddress:
      "0xabababababababababababababababababababababababababababababababab",
    sponsorSignerType: "secp256k1",
    walletAddress:
      "0xcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcd",
    requesterAddress:
      "0xefefefefefefefefefefefefefefefefefefefefefefefefefefefefefefefef",
    requesterSignerType: "secp256k1",
    targetAddress:
      "0x9898989898989898989898989898989898989898989898989898989898989898",
    valueWei: "0",
    dataHex: "0x",
    gas: "21000",
    policyId: "policy-2",
    policyHash:
      "0x8888888888888888888888888888888888888888888888888888888888888888",
    scopeHash:
      "0x9999999999999999999999999999999999999999999999999999999999999999",
    trustTier: "self_hosted",
    requestNonce: `${index + 1}`,
    requestExpiresAt: Date.now() + 60_000,
    executionNonce: `${index + 1}`,
    sponsorNonce: `${index + 1}`,
    sponsorExpiry: Date.now() + 60_000,
    status: "failed",
    createdAt: new Date(Date.now() - (index + 1) * 60_000).toISOString(),
    updatedAt: new Date(Date.now() - index * 30_000).toISOString(),
  } satisfies PaymasterAuthorizationRecord));
}

describe("operator autopilot", () => {
  it("creates, lists, and decides approval requests", () => {
    const db = createTestDb();
    const config = createAutopilotConfig();

    const request = createOperatorApprovalRequest({
      db,
      config,
      kind: "treasury_policy_change",
      scope: "treasury.max_single_transfer",
      requestedBy: "test-suite",
      reason: "increase reserve ceiling",
      ttlSeconds: 3600,
    });

    let snapshot = buildOperatorAutopilotSnapshot(config, db);
    expect(snapshot.approvals.pending).toBe(1);
    expect(snapshot.approvals.recent[0]?.requestId).toBe(request.requestId);

    const approved = decideOperatorApprovalRequest({
      db,
      requestId: request.requestId,
      status: "approved",
      decidedBy: "approver",
      decisionNote: "looks safe",
    });
    expect(approved.status).toBe("approved");

    snapshot = buildOperatorAutopilotSnapshot(config, db);
    expect(snapshot.approvals.pending).toBe(0);
    expect(snapshot.approvals.recent[0]?.status).toBe("approved");

    db.close();
  });

  it("quarantines degraded providers and respects cooldown", async () => {
    const db = createTestDb();
    const config = createAutopilotConfig();
    const providerAddress =
      "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as const;

    for (const record of insertFailedPaymasterAuthorizations(providerAddress)) {
      db.upsertPaymasterAuthorization(record);
    }

    const first = await runOperatorAutopilot({
      config,
      db,
      actor: "test-suite",
      reason: "scheduled autopilot check",
    });
    expect(first.enabled).toBe(true);
    expect(first.actions.find((action) => action.action === "quarantine_provider")?.changed).toBe(true);
    expect(listQuarantinedProviders(db, 10)).toHaveLength(1);

    const second = await runOperatorAutopilot({
      config,
      db,
      actor: "test-suite",
      reason: "scheduled autopilot check",
    });
    const quarantineAction = second.actions.find(
      (action) => action.action === "quarantine_provider",
    );
    expect(quarantineAction?.changed).toBe(false);
    expect(quarantineAction?.summary).toContain("no weak providers");
    expect(listQuarantinedProviders(db, 10)).toHaveLength(1);

    const snapshot = buildOperatorAutopilotSnapshot(config, db);
    expect(snapshot.quarantinedProviders).toHaveLength(1);
    expect(snapshot.summary).toContain("quarantined=1");

    db.close();
  });
});
