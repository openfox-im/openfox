import { expect, test } from "vitest";

import {
  bindExecutionTrailsByTransaction,
  propagateExecutionTrailsForSubject,
} from "../audit/execution-trails.js";
import { createTestDb } from "./mocks.js";

test("binds direct execution trails from signer and paymaster records by tx hash", () => {
  const db = createTestDb();
  try {
    db.upsertSignerExecution({
      executionId: "exec-1",
      quoteId: "quote-1",
      requestKey: "signer:req:1",
      requestHash: "0x11",
      providerAddress:
        "0x12252ae6b5d22fa4f58b295fe42cdb782f41881025d22645816d196b4f2e5143",
      walletAddress:
        "0xdca90de7e66cec3a5c7683922036c75aa691b36b473f162b905590f8031217c2",
      requesterAddress:
        "0xc9b7083ed72ae7501f0f76c6fa2737ea3643ce0a7c85b2d81f4a2d030aea04ed",
      targetAddress:
        "0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
      valueWei: "0",
      dataHex: "0x",
      gas: "21000",
      policyId: "policy-1",
      policyHash: "0x22",
      scopeHash: "0x33",
      delegateIdentity: null,
      trustTier: "self_hosted",
      requestNonce: "nonce-1",
      requestExpiresAt: 1800000000,
      reason: null,
      paymentId: null,
      submittedTxHash: "0xabc",
      submittedReceipt: {},
      receiptHash: "0xdef",
      status: "confirmed",
      lastError: null,
      createdAt: "2026-03-10T00:00:00.000Z",
      updatedAt: "2026-03-10T00:00:00.000Z",
    });
    db.upsertPaymasterAuthorization({
      authorizationId: "auth-1",
      quoteId: "quote-2",
      chainId: "1666",
      requestKey: "paymaster:req:1",
      requestHash: "0x44",
      providerAddress:
        "0x12252ae6b5d22fa4f58b295fe42cdb782f41881025d22645816d196b4f2e5143",
      sponsorAddress:
        "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
      sponsorSignerType: "secp256k1",
      walletAddress:
        "0xdca90de7e66cec3a5c7683922036c75aa691b36b473f162b905590f8031217c2",
      requesterAddress:
        "0xc9b7083ed72ae7501f0f76c6fa2737ea3643ce0a7c85b2d81f4a2d030aea04ed",
      requesterSignerType: "secp256k1",
      targetAddress:
        "0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
      valueWei: "0",
      dataHex: "0x",
      gas: "21000",
      policyId: "policy-2",
      policyHash: "0x55",
      scopeHash: "0x66",
      delegateIdentity: null,
      trustTier: "self_hosted",
      requestNonce: "nonce-2",
      requestExpiresAt: 1800000000,
      executionNonce: "7",
      sponsorNonce: "8",
      sponsorExpiry: 1800000600,
      reason: null,
      paymentId: null,
      executionSignature: null,
      sponsorSignature: null,
      submittedTxHash: "0x123",
      submittedReceipt: {},
      receiptHash: "0x456",
      status: "confirmed",
      lastError: null,
      createdAt: "2026-03-10T00:00:00.000Z",
      updatedAt: "2026-03-10T00:00:00.000Z",
    });

    const signerTrails = bindExecutionTrailsByTransaction({
      db,
      subjectKind: "storage_anchor",
      subjectId: "anchor-1",
      txHash: "0xabc",
    });
    const paymasterTrails = bindExecutionTrailsByTransaction({
      db,
      subjectKind: "artifact_anchor",
      subjectId: "anchor-2",
      txHash: "0x123",
    });

    expect(signerTrails).toHaveLength(1);
    expect(signerTrails[0]?.executionKind).toBe("signer_execution");
    expect(paymasterTrails).toHaveLength(1);
    expect(paymasterTrails[0]?.executionKind).toBe("paymaster_authorization");
  } finally {
    db.close();
  }
});

test("propagates derived trails from a storage lease to related artifact verification", () => {
  const db = createTestDb();
  try {
    db.upsertExecutionTrail({
      trailId: "trail-1",
      subjectKind: "storage_lease",
      subjectId: "lease-1",
      executionKind: "signer_execution",
      executionRecordId: "exec-1",
      executionTxHash: "0xabc",
      executionReceiptHash: "0xdef",
      linkMode: "direct",
      sourceSubjectKind: null,
      sourceSubjectId: null,
      metadata: null,
      createdAt: "2026-03-10T00:00:00.000Z",
      updatedAt: "2026-03-10T00:00:00.000Z",
    });

    const derived = propagateExecutionTrailsForSubject({
      db,
      fromSubjectKind: "storage_lease",
      fromSubjectId: "lease-1",
      toSubjectKind: "artifact_verification",
      toSubjectId: "verify-1",
      metadata: { via: "storage_lease" },
    });

    expect(derived).toHaveLength(1);
    expect(derived[0]?.linkMode).toBe("derived");
    expect(derived[0]?.sourceSubjectKind).toBe("storage_lease");
    expect(
      db.listExecutionTrailsForSubject("artifact_verification", "verify-1"),
    ).toHaveLength(1);
  } finally {
    db.close();
  }
});
