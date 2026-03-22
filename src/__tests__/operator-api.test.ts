import fs from "fs/promises";
import http from "http";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { createTestConfig, createTestDb } from "./mocks.js";
import { startOperatorApiServer } from "../operator/api.js";
import { createBountyEngine } from "../bounty/engine.js";
import { startBountyHttpServer } from "../bounty/http.js";
import { isHeartbeatPaused, isOperatorDrained } from "../state/database.js";
import {
  DEFAULT_BOUNTY_CONFIG,
  DEFAULT_OPERATOR_AUTOPILOT_CONFIG,
  type OwnerFinanceSnapshotRecord,
  type OwnerOpportunityAlertRecord,
  type OwnerReportDeliveryRecord,
  type OwnerReportRecord,
  type PaymasterAuthorizationRecord,
} from "../types.js";
import { MockInferenceClient, createTestIdentity, noToolResponse } from "./mocks.js";
import {
  storeProofVerificationRecord,
  storeZkTlsBundleRecord,
} from "../proof-market/records.js";
import { createCommitteeManager } from "../committee/manager.js";

const servers: Array<{ close(): Promise<void> }> = [];

afterEach(async () => {
  while (servers.length) {
    const server = servers.pop();
    if (!server) continue;
    await server.close();
  }
});

describe("operator api", () => {
  async function startMockInferenceServer(answer: string): Promise<{
    url: string;
    close(): Promise<void>;
  }> {
    const server = http.createServer((_req, res) => {
      const payload = JSON.stringify({
        id: "chatcmpl-test",
        model: "ollama/test",
        choices: [
          {
            finish_reason: "stop",
            message: { role: "assistant", content: answer },
          },
        ],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 2,
          total_tokens: 12,
        },
      });
      res.writeHead(200, {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(payload),
      });
      res.end(payload);
    });
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => resolve());
    });
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("failed to resolve mock inference server address");
    }
    return {
      url: `http://127.0.0.1:${address.port}`,
      close: async () =>
        await new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        ),
    };
  }

  function toHexId(value: string): `0x${string}` {
    return `0x${Buffer.from(value, "utf8")
      .toString("hex")
      .slice(0, 64)
      .padEnd(64, "a")}` as `0x${string}`;
  }

  function createAutopilotConfig() {
    return createTestConfig({
      operatorApi: {
        enabled: true,
        bindHost: "127.0.0.1",
        port: 0,
        pathPrefix: "/operator",
        authToken: "secret-token",
        exposeDoctor: true,
        exposeServiceStatus: true,
      },
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
        },
      },
    });
  }

  function createOwnerFinanceSnapshotRecord(
    snapshotId: string,
  ): OwnerFinanceSnapshotRecord {
    const now = new Date().toISOString();
    return {
      snapshotId,
      periodKind: "daily",
      periodStart: now,
      periodEnd: now,
      createdAt: now,
      updatedAt: now,
      payload: {
        snapshotId,
        periodKind: "daily",
        periodStart: now,
        periodEnd: now,
        generatedAt: now,
        address:
          "0x752a3d0f953b4ae91fca3bf4c1b93863c1884902f778aa65ff6e3aa02f730d02",
        realizedRevenueTomi: "1200",
        realizedCostTomi: "300",
        realizedNetTomi: "900",
        pendingReceivablesTomi: "500",
        pendingPayablesTomi: "100",
        pendingNetTomi: "400",
        revenueEvents: 2,
        costEvents: 1,
        inferenceCostCents: 12,
        spendCostCents: 34,
        operatingCostCents: 56,
        retryableFailedItems: 0,
        pendingOnchainTransactions: 1,
        failedOnchainTransactions: 0,
        majorCategories: {
          x402RevenueTomi: "1200",
          bountySolverRewardsTomi: "0",
          x402CostTomi: "300",
          bountyHostPayoutsTomi: "0",
        },
        topGains: [],
        topLosses: [],
        anomalies: ["pending settlement"],
        summary: "Daily owner finance snapshot",
      },
    };
  }

  function createOwnerReportRecord(
    reportId: string,
    financeSnapshotId: string,
  ): OwnerReportRecord {
    const now = new Date().toISOString();
    return {
      reportId,
      periodKind: "daily",
      financeSnapshotId,
      provider: "mock-provider",
      model: "mock-model",
      inputHash: toHexId(reportId),
      generationStatus: "generated",
      createdAt: now,
      updatedAt: now,
      payload: {
        reportId,
        periodKind: "daily",
        financeSnapshotId,
        generatedAt: now,
        generationStatus: "generated",
        inputHash: toHexId(reportId),
        provider: "mock-provider",
        model: "mock-model",
        input: {
          generatedAt: now,
          periodKind: "daily",
          finance: createOwnerFinanceSnapshotRecord(financeSnapshotId).payload,
          strategy: null,
          opportunities: [],
        },
        narrative: {
          overview: "Overview",
          gains: "Gains",
          losses: "Losses",
          opportunityDigest: "Digest",
          anomalies: "Anomalies",
          recommendations: ["Do more of what works."],
        },
      },
    };
  }

  function createOwnerReportDeliveryRecord(
    deliveryId: string,
    reportId: string,
  ): OwnerReportDeliveryRecord {
    const now = new Date().toISOString();
    return {
      deliveryId,
      reportId,
      channel: "web",
      status: "delivered",
      target: "/owner/reports/latest/daily",
      renderedPath: "/tmp/owner.html",
      metadata: { format: "html" },
      lastError: null,
      deliveredAt: now,
      createdAt: now,
      updatedAt: now,
    };
  }

  function createOwnerOpportunityAlertRecord(
    alertId: string,
  ): OwnerOpportunityAlertRecord {
    const now = new Date().toISOString();
    return {
      alertId,
      opportunityHash: toHexId(`opportunity:${alertId}`),
      kind: "bounty",
      providerClass: "task_market",
      trustTier: "org_trusted",
      title: "Bounded translation bounty",
      summary: "reward=100 margin=90 score=1200 trust=org_trusted",
      suggestedAction: "Review the host and submit one bounded result.",
      capability: "task.submit",
      baseUrl: "https://host.example.com",
      rewardTomi: "100",
      estimatedCostTomi: "10",
      marginTomi: "90",
      marginBps: 9000,
      strategyScore: 1200,
      strategyMatched: true,
      strategyReasons: [],
      payload: { bountyId: "bounty-1" },
      status: "unread",
      createdAt: now,
      updatedAt: now,
      readAt: null,
      dismissedAt: null,
    };
  }

  function createFailedPaymasterAuthorization(
    authorizationId: string,
    providerAddress: `0x${string}`,
  ): PaymasterAuthorizationRecord {
    const now = new Date().toISOString();
    return {
      authorizationId,
      quoteId: `quote-${authorizationId}`,
      chainId: "1666",
      requestKey: `paymaster:${authorizationId}`,
      requestHash: toHexId(authorizationId),
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
      valueTomi: "0",
      dataHex: "0x",
      gas: "21000",
      policyId: "policy-2",
      policyHash:
        "0x8888888888888888888888888888888888888888888888888888888888888888",
      scopeHash:
        "0x74ad93496274ddc81b6336c6fb3f32e17127f96a57dfafa05d87eadcb40b4d01",
      trustTier: "self_hosted",
      requestNonce: "1",
      requestExpiresAt: Date.now() + 60_000,
      executionNonce: "1",
      sponsorNonce: "1",
      sponsorExpiry: Date.now() + 60_000,
      status: "failed",
      createdAt: now,
      updatedAt: now,
    };
  }

  it("serves healthz without auth and protects operator endpoints", async () => {
    const db = createTestDb();
    const server = await startOperatorApiServer({
      config: createTestConfig({
        operatorApi: {
          enabled: true,
          bindHost: "127.0.0.1",
          port: 0,
          pathPrefix: "/operator",
          authToken: "secret-token",
          exposeDoctor: true,
          exposeServiceStatus: true,
        },
      }),
      db,
    });
    expect(server).not.toBeNull();
    if (!server) {
      db.close();
      return;
    }
    servers.push(server);

    const healthz = await fetch(`${server.url}/healthz`);
    expect(healthz.status).toBe(200);
    expect(await healthz.json()).toEqual({ ok: true });

    const unauthorized = await fetch(`${server.url}/status`);
    expect(unauthorized.status).toBe(401);

    const authorized = await fetch(`${server.url}/status`, {
      headers: {
        Authorization: "Bearer secret-token",
      },
    });
    expect(authorized.status).toBe(200);
    const snapshot = (await authorized.json()) as { configured: boolean; operatorApi: { enabled: boolean } | null };
    expect(snapshot.configured).toBe(true);
    expect(snapshot.operatorApi?.enabled).toBe(true);

    db.close();
  });

  it("returns 404 for disabled doctor and service status endpoints", async () => {
    const db = createTestDb();
    const server = await startOperatorApiServer({
      config: createTestConfig({
        operatorApi: {
          enabled: true,
          bindHost: "127.0.0.1",
          port: 0,
          pathPrefix: "/ops",
          authToken: "secret-token",
          exposeDoctor: false,
          exposeServiceStatus: false,
        },
      }),
      db,
    });
    expect(server).not.toBeNull();
    if (!server) {
      db.close();
      return;
    }
    servers.push(server);

    const headers = {
      Authorization: "Bearer secret-token",
    };
    const doctor = await fetch(`${server.url}/doctor`, { headers });
    expect(doctor.status).toBe(404);

    const service = await fetch(`${server.url}/service/status`, { headers });
    expect(service.status).toBe(404);

    db.close();
  });

  it("serves component-specific storage, artifacts, signer, and paymaster status snapshots", async () => {
    const db = createTestDb();
    const config = createTestConfig({
      operatorApi: {
        enabled: true,
        bindHost: "127.0.0.1",
        port: 0,
        pathPrefix: "/operator",
        authToken: "secret-token",
        exposeDoctor: true,
        exposeServiceStatus: true,
      },
      signerProvider: {
        enabled: true,
        bindHost: "127.0.0.1",
        port: 4898,
        pathPrefix: "/signer",
        capabilityPrefix: "signer",
        publishToDiscovery: true,
        quoteValiditySeconds: 300,
        quotePriceTomi: "0",
        submitPriceTomi: "1000",
        requestTimeoutMs: 15000,
        maxDataBytes: 2048,
        defaultGas: "21000",
        policy: {
          trustTier: "self_hosted",
          policyId: "policy-test",
          walletAddress:
            "0x97b1c813eae702332ba3eaa1625f942c5472626d90abcdef1234567890abcdef",
          allowedTargets: [
            "0x74ad93496274ddc81b6336c6fb3f32e17127f96a57dfafa05d87eadcb40b4d01",
          ],
          allowedFunctionSelectors: [],
          maxValueTomi: "1000",
          allowSystemAction: false,
        },
      },
      paymasterProvider: {
        enabled: true,
        bindHost: "127.0.0.1",
        port: 4899,
        pathPrefix: "/paymaster",
        capabilityPrefix: "paymaster",
        publishToDiscovery: true,
        quoteValiditySeconds: 300,
        authorizationValiditySeconds: 600,
        quotePriceTomi: "0",
        authorizePriceTomi: "1000",
        requestTimeoutMs: 15000,
        maxDataBytes: 2048,
        defaultGas: "21000",
        policy: {
          trustTier: "self_hosted",
          policyId: "paymaster-policy",
          sponsorAddress:
            "0x12252ae6b5d22fa4f58b295fe42cdb782f41881025d22645816d196b4f2e5143",
          delegateIdentity: "delegate:paymaster",
          allowedWallets: [],
          allowedTargets: [
            "0x8888888888888888888888888888888888888888888888888888888888888888",
          ],
          allowedFunctionSelectors: [],
          maxValueTomi: "1000",
          allowSystemAction: false,
        },
      },
      storage: {
        enabled: true,
        bindHost: "127.0.0.1",
        port: 4895,
        pathPrefix: "/storage",
        capabilityPrefix: "storage.ipfs",
        storageDir: "/tmp/openfox-storage",
        quoteValiditySeconds: 300,
        defaultTtlSeconds: 86400,
        maxTtlSeconds: 2592000,
        maxBundleBytes: 8 * 1024 * 1024,
        minimumPriceTomi: "1000",
        pricePerMiBTomi: "1000",
        publishToDiscovery: true,
        allowAnonymousGet: true,
        anchor: {
          enabled: false,
          gas: "180000",
          waitForReceipt: true,
          receiptTimeoutMs: 60000,
        },
        leaseHealth: {
          autoAudit: true,
          auditIntervalSeconds: 3600,
          autoRenew: true,
          renewalLeadSeconds: 1800,
          autoReplicate: false,
        },
        replication: {
          enabled: true,
          targetCopies: 2,
          providerBaseUrls: ["https://replica-1.example.com/storage"],
        },
      },
      artifacts: {
        enabled: true,
        publishToDiscovery: true,
        defaultProviderBaseUrl: "http://127.0.0.1:4895/storage",
        defaultTtlSeconds: 604800,
        autoAnchorOnStore: false,
        captureCapability: "public_news.capture",
        evidenceCapability: "oracle.evidence",
        aggregateCapability: "oracle.aggregate",
        verificationCapability: "artifact.verify",
        service: {
          enabled: true,
          bindHost: "127.0.0.1",
          port: 4896,
          pathPrefix: "/artifacts",
          requireNativeIdentity: true,
          maxBodyBytes: 256 * 1024,
          maxTextChars: 32 * 1024,
        },
        anchor: {
          enabled: false,
          gas: "180000",
          waitForReceipt: true,
          receiptTimeoutMs: 60000,
        },
      },
    });
    const server = await startOperatorApiServer({
      config,
      db,
    });
    expect(server).not.toBeNull();
    if (!server) {
      db.close();
      return;
    }
    servers.push(server);

    const headers = {
      Authorization: "Bearer secret-token",
    };

    const storage = await fetch(`${server.url}/storage/status`, { headers });
    expect(storage.status).toBe(200);
    const storageJson = (await storage.json()) as { kind: string; enabled: boolean; summary: string };
    expect(storageJson.kind).toBe("storage");
    expect(storageJson.enabled).toBe(true);
    expect(storageJson.summary).toContain("active lease");

    const artifacts = await fetch(`${server.url}/artifacts/status`, { headers });
    expect(artifacts.status).toBe(200);
    const artifactsJson = (await artifacts.json()) as { kind: string; enabled: boolean; summary: string };
    expect(artifactsJson.kind).toBe("artifacts");
    expect(artifactsJson.enabled).toBe(true);

    const signer = await fetch(`${server.url}/signer/status`, { headers });
    expect(signer.status).toBe(200);
    const signerJson = (await signer.json()) as { kind: string; enabled: boolean; summary: string };
    expect(signerJson.kind).toBe("signer");
    expect(signerJson.enabled).toBe(true);

    const paymaster = await fetch(`${server.url}/paymaster/status`, { headers });
    expect(paymaster.status).toBe(200);
    const paymasterJson = (await paymaster.json()) as { kind: string; enabled: boolean; summary: string };
    expect(paymasterJson.kind).toBe("paymaster");
    expect(paymasterJson.enabled).toBe(true);

    const wallet = await fetch(`${server.url}/wallet/status`, { headers });
    expect(wallet.status).toBe(200);
    const walletJson = (await wallet.json()) as { kind: string; address: string; summary: string };
    expect(walletJson.kind).toBe("wallet");
    expect(walletJson.address).toBe(config.walletAddress);

    const finance = await fetch(`${server.url}/finance/status`, { headers });
    expect(finance.status).toBe(200);
    const financeJson = (await finance.json()) as { kind: string; address: string; summary: string };
    expect(financeJson.kind).toBe("finance");
    expect(financeJson.address).toBe(config.walletAddress);
    expect(financeJson.summary).toContain("30d revenue=");

    const payments = await fetch(`${server.url}/payments/status`, { headers });
    expect(payments.status).toBe(200);
    const paymentsJson = (await payments.json()) as { kind: string; summary: string };
    expect(paymentsJson.kind).toBe("payments");

    const settlement = await fetch(`${server.url}/settlement/status`, { headers });
    expect(settlement.status).toBe(200);
    const settlementJson = (await settlement.json()) as { kind: string; summary: string };
    expect(settlementJson.kind).toBe("settlement");

    const market = await fetch(`${server.url}/market/status`, { headers });
    expect(market.status).toBe(200);
    const marketJson = (await market.json()) as { kind: string; summary: string };
    expect(marketJson.kind).toBe("market");

    db.close();
  });

  it("serves zkTLS, proof, committee, evidence, and oracle summary endpoints", async () => {
    const db = createTestDb();
    const config = createTestConfig({
      operatorApi: {
        enabled: true,
        bindHost: "127.0.0.1",
        port: 0,
        pathPrefix: "/operator",
        authToken: "secret-token",
        exposeDoctor: true,
        exposeServiceStatus: true,
      },
    });

    storeZkTlsBundleRecord(db, {
      recordId: "zktls:1",
      jobId: "job-1",
      requestKey: "request-1",
      capability: "news.fetch",
      requesterIdentity: "tos:requester",
      providerBackend: {
        kind: "skills",
        stages: ["newsfetch.capture", "zktls.prove", "zktls.bundle"],
      },
      sourceUrl: "https://example.com/article",
      resultUrl: "/news/fetch/result/job-1",
      bundleUrl: "/news/fetch/bundle/job-1",
      attestationUrl: "/news/fetch/attestation/job-1",
      bundleFormat: "zktls_bundle_v1",
      verificationMode: "native_attestation",
      nativeProofStatus: "native_attested",
      zktlsAttestationSha256: `0x${"1".repeat(64)}`,
      originClaims: {
        sourceUrl: "https://example.com/article",
        canonicalUrl: "https://example.com/article",
        sourcePolicyId: "example-policy-v1",
        sourcePolicyHost: "example.com",
        fetchedAt: 1773273600,
        httpStatus: 200,
        contentType: "text/html",
      },
      verifierMaterialReferences: [
        {
          kind: "tlsn.attestation",
          ref: "artifact://bundle/1",
          hash: `0x${"a".repeat(64)}`,
        },
      ],
      integrity: {
        bundleSha256: `0x${"b".repeat(64)}`,
        articleSha256: `0x${"c".repeat(64)}`,
        sourceResponseSha256: `0x${"d".repeat(64)}`,
      },
      bundle: { headline: "Example headline" },
      metadata: { provider_backend: "skills_first" },
      createdAt: "2026-03-12T00:00:00.000Z",
      updatedAt: "2026-03-12T00:00:00.000Z",
    });

    storeProofVerificationRecord(db, {
      recordId: "proof:1",
      resultId: "result-1",
      requestKey: "request-1",
      capability: "proof.verify",
      requesterIdentity: "tos:requester",
      providerBackend: { kind: "builtin", stages: ["proofverify.verify"] },
      verifierClass: "bundle_integrity_verification",
      verificationMode: "fallback_integrity",
      verdict: "valid",
      verdictReason: "all_checks_passed",
      summary: "fallback verification succeeded",
      verifierReceiptSha256: `0x${"e".repeat(64)}`,
      verifierMaterialReference: {
        kind: "proof_bundle",
        ref: "https://example.com/bundle.json",
        hash: `0x${"f".repeat(64)}`,
      },
      boundSubjectHashes: {
        subjectSha256: `0x${"1".repeat(64)}`,
        bundleSha256: `0x${"2".repeat(64)}`,
        responseHash: `0x${"3".repeat(64)}`,
      },
      request: {
        subjectUrl: "https://example.com/article",
        proofBundleUrl: "https://example.com/bundle.json",
      },
      metadata: null,
      createdAt: "2026-03-12T00:00:00.000Z",
      updatedAt: "2026-03-12T00:00:00.000Z",
    });
    storeProofVerificationRecord(db, {
      recordId: "proof:2",
      resultId: "result-2",
      requestKey: "request-2",
      capability: "proof.verify",
      requesterIdentity: "tos:requester",
      providerBackend: {
        kind: "skills",
        stages: ["proofverify.verify-attestations", "proofverify.verify-consensus"],
      },
      verifierClass: "m_of_n_consensus_verification",
      verificationMode: "committee_verified",
      verdict: "valid",
      verdictReason: "proof_verified",
      summary: "cryptographic verification succeeded",
      verifierProfile: "tlsn.rust",
      verifierReceiptSha256: `0x${"4".repeat(64)}`,
      verifierMaterialReference: {
        kind: "tlsn.attestation",
        ref: "artifact://proof/1",
      },
      boundSubjectHashes: {
        subjectSha256: `0x${"5".repeat(64)}`,
        bundleSha256: `0x${"6".repeat(64)}`,
        responseHash: `0x${"7".repeat(64)}`,
      },
      request: {
        subjectUrl: "https://example.com/article",
        proofBundleUrl: "artifact://proof/1",
      },
      metadata: null,
      createdAt: "2026-03-12T00:01:00.000Z",
      updatedAt: "2026-03-12T00:01:00.000Z",
    });

    const committee = createCommitteeManager(db);
    const evidenceRun = committee.createRun({
      kind: "evidence",
      title: "Verify Times headline",
      question: "Is the captured headline valid?",
      subjectRef: "artifact://capture/1",
      artifactIds: ["artifact://capture/1"],
      committeeSize: 3,
      thresholdM: 2,
      payoutTotalTomi: "9",
      members: [
        {
          memberId: "agent-a",
          payoutAddress:
            "0x12252ae6b5d22fa4f58b295fe42cdb782f41881025d22645816d196b4f2e5143",
        },
        {
          memberId: "agent-b",
          payoutAddress:
            "0xdca90de7e66cec3a5c7683922036c75aa691b36b473f162b905590f8031217c2",
        },
        {
          memberId: "agent-c",
          payoutAddress:
            "0xc9b7083ed72ae7501f0f76c6fa2737ea3643ce0a7c85b2d81f4a2d030aea04ed",
        },
      ],
    });
    committee.recordVote({
      runId: evidenceRun.runId,
      memberId: "agent-a",
      decision: "accept",
      resultHash: `0x${"1".repeat(64)}`,
      payoutAddress:
        "0x12252ae6b5d22fa4f58b295fe42cdb782f41881025d22645816d196b4f2e5143",
    });
    committee.recordVote({
      runId: evidenceRun.runId,
      memberId: "agent-b",
      decision: "accept",
      resultHash: `0x${"1".repeat(64)}`,
      payoutAddress:
        "0xdca90de7e66cec3a5c7683922036c75aa691b36b473f162b905590f8031217c2",
    });
    committee.markMemberFailed({
      runId: evidenceRun.runId,
      memberId: "agent-c",
      reason: "timeout",
    });
    committee.markPaid(committee.tally(evidenceRun.runId).runId);

    const oracleRun = committee.createRun({
      kind: "oracle",
      title: "Oracle committee",
      question: "Resolve query",
      committeeSize: 3,
      thresholdM: 2,
      members: [{ memberId: "a" }, { memberId: "b" }, { memberId: "c" }],
    });
    committee.recordVote({
      runId: oracleRun.runId,
      memberId: "a",
      decision: "accept",
      resultHash: `0x${"2".repeat(64)}`,
    });
    committee.recordVote({
      runId: oracleRun.runId,
      memberId: "b",
      decision: "reject",
    });
    committee.markMemberFailed({
      runId: oracleRun.runId,
      memberId: "c",
      reason: "unreachable",
    });
    committee.tally(oracleRun.runId);

    const evidenceNow = "2026-03-12T00:02:00.000Z";
    db.setKV(
      "evidence_workflow:run:evidence-run-1",
      JSON.stringify({
        runId: "evidence-run-1",
        title: "Evidence workflow",
        question: "Verify Times",
        quorumM: 2,
        quorumN: 3,
        status: "completed",
        attemptedCount: 3,
        validCount: 2,
        aggregateObjectId: "artifact://aggregate/1",
        aggregateResultUrl: "https://artifacts.example.com/evidence/1",
        sourceRecords: [],
        payments: [],
        createdAt: evidenceNow,
        updatedAt: evidenceNow,
      }),
    );
    db.setKV(
      `evidence_workflow:index:${evidenceNow}:evidence-run-1`,
      "evidence-run-1",
    );

    db.setKV(
      "agent_discovery:oracle:job:oracle-result-1",
      JSON.stringify({
        resultId: "oracle-result-1",
        request: {
          query: "Who won?",
          query_kind: "enum",
        },
        response: {
          status: "ok",
          result_id: "oracle-result-1",
          query_kind: "enum",
          confidence: 0.91,
          price_tomi: "500",
          settlement_tx_hash: `0x${"9".repeat(64)}`,
          market_callback_tx_hash: `0x${"8".repeat(64)}`,
          binding_hash: `0x${"7".repeat(64)}`,
          resolved_at: 1773273720,
        },
        createdAt: "2026-03-12T00:03:00.000Z",
      }),
    );

    const server = await startOperatorApiServer({
      config,
      db,
    });
    expect(server).not.toBeNull();
    if (!server) {
      db.close();
      return;
    }
    servers.push(server);

    const headers = {
      Authorization: "Bearer secret-token",
    };

    const news = await fetch(`${server.url}/news/zktls?limit=10`, { headers });
    expect(news.status).toBe(200);
    const newsJson = (await news.json()) as {
      totalBundles: number;
      sourcePolicies: Record<string, number>;
    };
    expect(newsJson.totalBundles).toBe(1);
    expect(newsJson.sourcePolicies["example-policy-v1"]).toBe(1);

    const newsRecord = await fetch(
      `${server.url}/news/zktls?recordId=${encodeURIComponent("zktls:1")}`,
      { headers },
    );
    expect(newsRecord.status).toBe(200);
    expect((await newsRecord.json()) as { recordId: string }).toMatchObject({
      recordId: "zktls:1",
    });

    const proof = await fetch(`${server.url}/proof/summary?limit=10`, { headers });
    expect(proof.status).toBe(200);
    const proofJson = (await proof.json()) as {
      totalResults: number;
      fallbackIntegrityVerifications: number;
      nativeAttestationVerifications: number;
      committeeVerifiedResults: number;
    };
    expect(proofJson.totalResults).toBe(2);
    expect(proofJson.fallbackIntegrityVerifications).toBe(1);
    expect(proofJson.nativeAttestationVerifications).toBe(0);
    expect(proofJson.committeeVerifiedResults).toBe(1);

    const proofRecord = await fetch(
      `${server.url}/proof/summary?recordId=${encodeURIComponent("proof:2")}`,
      { headers },
    );
    expect(proofRecord.status).toBe(200);
    expect((await proofRecord.json()) as { recordId: string }).toMatchObject({
      recordId: "proof:2",
    });

    const evidenceCommittee = await fetch(
      `${server.url}/committee/summary?kind=evidence&limit=10`,
      { headers },
    );
    expect(evidenceCommittee.status).toBe(200);
    expect((await evidenceCommittee.json()) as { totalRuns: number; quorumMet: number }).toMatchObject({
      totalRuns: 1,
      quorumMet: 1,
    });

    const oracleCommittee = await fetch(
      `${server.url}/committee/summary?kind=oracle&limit=10`,
      { headers },
    );
    expect(oracleCommittee.status).toBe(200);
    expect((await oracleCommittee.json()) as { totalRuns: number; quorumFailed: number }).toMatchObject({
      totalRuns: 1,
      quorumFailed: 1,
    });

    const evidenceSummary = await fetch(`${server.url}/evidence/summary?limit=10`, {
      headers,
    });
    expect(evidenceSummary.status).toBe(200);
    expect((await evidenceSummary.json()) as { totalRuns: number; aggregatePublished: number }).toMatchObject({
      totalRuns: 1,
      aggregatePublished: 1,
    });

    const oracleSummary = await fetch(`${server.url}/oracle/summary?limit=10`, {
      headers,
    });
    expect(oracleSummary.status).toBe(200);
    expect((await oracleSummary.json()) as {
      totalResults: number;
      marketBoundResults: number;
      settledResults: number;
    }).toMatchObject({
      totalResults: 1,
      marketBoundResults: 1,
      settledResults: 1,
    });

    db.close();
  });

  it("accepts authenticated storage and artifact maintenance requests", async () => {
    const db = createTestDb();
    const server = await startOperatorApiServer({
      config: createTestConfig({
        operatorApi: {
          enabled: true,
          bindHost: "127.0.0.1",
          port: 0,
          pathPrefix: "/operator",
          authToken: "secret-token",
          exposeDoctor: true,
          exposeServiceStatus: true,
        },
        storage: {
          enabled: true,
          bindHost: "127.0.0.1",
          port: 4895,
          pathPrefix: "/storage",
          capabilityPrefix: "storage.ipfs",
          storageDir: "/tmp/openfox-storage",
          quoteValiditySeconds: 300,
          defaultTtlSeconds: 86400,
          maxTtlSeconds: 2592000,
          maxBundleBytes: 8 * 1024 * 1024,
          minimumPriceTomi: "1000",
          pricePerMiBTomi: "1000",
          publishToDiscovery: true,
          allowAnonymousGet: true,
          anchor: {
            enabled: false,
            gas: "180000",
            waitForReceipt: true,
            receiptTimeoutMs: 60000,
          },
          leaseHealth: {
            autoAudit: true,
            auditIntervalSeconds: 3600,
            autoRenew: true,
            renewalLeadSeconds: 1800,
            autoReplicate: false,
          },
          replication: {
            enabled: false,
            targetCopies: 1,
            providerBaseUrls: [],
          },
        },
        artifacts: {
          enabled: true,
          publishToDiscovery: true,
          defaultProviderBaseUrl: "http://127.0.0.1:4895/storage",
          defaultTtlSeconds: 604800,
          autoAnchorOnStore: false,
          captureCapability: "public_news.capture",
          evidenceCapability: "oracle.evidence",
          aggregateCapability: "oracle.aggregate",
          verificationCapability: "artifact.verify",
          service: {
            enabled: true,
            bindHost: "127.0.0.1",
            port: 4896,
            pathPrefix: "/artifacts",
            requireNativeIdentity: true,
            maxBodyBytes: 256 * 1024,
            maxTextChars: 32 * 1024,
          },
          anchor: {
            enabled: false,
            gas: "180000",
            waitForReceipt: true,
            receiptTimeoutMs: 60000,
          },
        },
      }),
      db,
    });
    expect(server).not.toBeNull();
    if (!server) {
      db.close();
      return;
    }
    servers.push(server);

    const headers = {
      Authorization: "Bearer secret-token",
      "Content-Type": "application/json",
    };
    const storage = await fetch(`${server.url}/storage/maintain`, {
      method: "POST",
      headers,
      body: JSON.stringify({ limit: 2 }),
    });
    expect(storage.status).toBe(200);
    expect(await storage.json()).toMatchObject({
      kind: "storage",
      enabled: true,
    });

    const artifacts = await fetch(`${server.url}/artifacts/maintain`, {
      method: "POST",
      headers,
      body: JSON.stringify({ limit: 2 }),
    });
    expect(artifacts.status).toBe(200);
    expect(await artifacts.json()).toMatchObject({
      kind: "artifacts",
      enabled: true,
    });

    const leaseHealth = await fetch(`${server.url}/storage/lease-health?limit=5`, {
      headers: {
        Authorization: "Bearer secret-token",
      },
    });
    expect(leaseHealth.status).toBe(200);
    expect(await leaseHealth.json()).toMatchObject({
      totalLeases: expect.any(Number),
      summary: expect.any(String),
    });

    const providers = await fetch(`${server.url}/providers/reputation?limit=5`, {
      headers: {
        Authorization: "Bearer secret-token",
      },
    });
    expect(providers.status).toBe(200);
    expect(await providers.json()).toMatchObject({
      totalProviders: expect.any(Number),
      summary: expect.any(String),
      entries: expect.any(Array),
    });

    db.close();
  });

  it("serves owner report and delivery operator endpoints", async () => {
    const db = createTestDb();
    const config = createTestConfig({
      operatorApi: {
        enabled: true,
        bindHost: "127.0.0.1",
        port: 0,
        pathPrefix: "/operator",
        authToken: "secret-token",
        exposeDoctor: true,
        exposeServiceStatus: true,
      },
      ownerReports: {
        enabled: true,
        generateWithInference: true,
        persistSnapshots: true,
        autoDeliverChannels: ["web"],
        web: {
          enabled: true,
          bindHost: "127.0.0.1",
          port: 4894,
          pathPrefix: "/owner",
          authToken: "owner-secret",
          outputDir: "~/.openfox/reports/web",
        },
        email: {
          enabled: false,
          mode: "outbox",
          from: "openfox@localhost",
          to: "owner@localhost",
          outboxDir: "~/.openfox/reports/outbox",
          sendmailPath: "/usr/sbin/sendmail",
        },
        schedule: {
          enabled: true,
          morningHourUtc: 8,
          endOfDayHourUtc: 22,
          weeklyDayUtc: 1,
          weeklyHourUtc: 9,
          anomalyDeliveryEnabled: true,
        },
        alerts: {
          enabled: true,
          minStrategyScore: 1000,
          minMarginBps: 500,
          maxItemsPerRun: 5,
          requireStrategyMatched: true,
          dedupeHours: 24,
        },
      },
    });
    const snapshot = createOwnerFinanceSnapshotRecord("snapshot-1");
    const report = createOwnerReportRecord("report-1", snapshot.snapshotId);
    const delivery = createOwnerReportDeliveryRecord("delivery-1", report.reportId);
    const alert = createOwnerOpportunityAlertRecord("alert-1");
    db.upsertOwnerFinanceSnapshot(snapshot);
    db.upsertOwnerReport(report);
    db.upsertOwnerReportDelivery(delivery);
    db.upsertOwnerOpportunityAlert(alert);

    const server = await startOperatorApiServer({ config, db });
    expect(server).not.toBeNull();
    if (!server) {
      db.close();
      return;
    }
    servers.push(server);

    const headers = { Authorization: "Bearer secret-token" };

    const reportsResponse = await fetch(
      `${server.url}/owner/reports?period=daily&limit=5`,
      { headers },
    );
    expect(reportsResponse.status).toBe(200);
    const reportsJson = (await reportsResponse.json()) as {
      items: OwnerReportRecord[];
    };
    expect(reportsJson.items).toHaveLength(1);
    expect(reportsJson.items[0]?.reportId).toBe(report.reportId);

    const latestResponse = await fetch(
      `${server.url}/owner/reports/latest?period=daily`,
      { headers },
    );
    expect(latestResponse.status).toBe(200);
    const latestJson = (await latestResponse.json()) as OwnerReportRecord;
    expect(latestJson.reportId).toBe(report.reportId);

    const deliveriesResponse = await fetch(
      `${server.url}/owner/report-deliveries?channel=web&status=delivered&limit=5`,
      { headers },
    );
    expect(deliveriesResponse.status).toBe(200);
    const deliveriesJson = (await deliveriesResponse.json()) as {
      items: OwnerReportDeliveryRecord[];
    };
    expect(deliveriesJson.items).toHaveLength(1);
    expect(deliveriesJson.items[0]?.deliveryId).toBe(delivery.deliveryId);

    const alertsResponse = await fetch(
      `${server.url}/owner/alerts?status=unread&limit=5`,
      { headers },
    );
    expect(alertsResponse.status).toBe(200);
    const alertsJson = (await alertsResponse.json()) as {
      items: OwnerOpportunityAlertRecord[];
    };
    expect(alertsJson.items).toHaveLength(1);
    expect(alertsJson.items[0]?.alertId).toBe(alert.alertId);

    db.close();
  });

  it("supports bounded control actions and records control events", async () => {
    const db = createTestDb();
    const server = await startOperatorApiServer({
      config: createTestConfig({
        operatorApi: {
          enabled: true,
          bindHost: "127.0.0.1",
          port: 0,
          pathPrefix: "/operator",
          authToken: "secret-token",
          exposeDoctor: true,
          exposeServiceStatus: true,
        },
      }),
      db,
    });
    expect(server).not.toBeNull();
    if (!server) {
      db.close();
      return;
    }
    servers.push(server);

    const headers = {
      Authorization: "Bearer secret-token",
      "Content-Type": "application/json",
    };

    const pause = await fetch(`${server.url}/control/pause`, {
      method: "POST",
      headers,
      body: JSON.stringify({ actor: "test-suite", reason: "maintenance" }),
    });
    expect(pause.status).toBe(200);
    const pauseJson = (await pause.json()) as { status: string; changed: boolean };
    expect(pauseJson.status).toBe("applied");
    expect(pauseJson.changed).toBe(true);
    expect(isHeartbeatPaused(db.raw)).toBe(true);

    const controlStatus = await fetch(`${server.url}/control/status`, {
      headers: {
        Authorization: "Bearer secret-token",
      },
    });
    expect(controlStatus.status).toBe(200);
    const controlStatusJson = (await controlStatus.json()) as {
      heartbeatPaused: boolean;
      drained: boolean;
      recentEvents: Array<{ action: string; status: string }>;
    };
    expect(controlStatusJson.heartbeatPaused).toBe(true);
    expect(controlStatusJson.drained).toBe(false);
    expect(controlStatusJson.recentEvents[0]?.action).toBe("pause");

    const drain = await fetch(`${server.url}/control/drain`, {
      method: "POST",
      headers,
      body: JSON.stringify({ actor: "test-suite", reason: "queue recovery" }),
    });
    expect(drain.status).toBe(200);
    const drainJson = (await drain.json()) as { status: string };
    expect(drainJson.status).toBe("applied");
    expect(isHeartbeatPaused(db.raw)).toBe(true);
    expect(isOperatorDrained(db.raw)).toBe(true);

    const resume = await fetch(`${server.url}/control/resume`, {
      method: "POST",
      headers,
      body: JSON.stringify({ actor: "test-suite", reason: "done" }),
    });
    expect(resume.status).toBe(200);
    expect(isHeartbeatPaused(db.raw)).toBe(false);
    expect(isOperatorDrained(db.raw)).toBe(false);

    const retryPayments = await fetch(`${server.url}/control/retry/payments`, {
      method: "POST",
      headers,
      body: JSON.stringify({ actor: "test-suite", reason: "recover" }),
    });
    expect(retryPayments.status).toBe(409);
    const retryJson = (await retryPayments.json()) as { status: string };
    expect(retryJson.status).toBe("failed");

    const events = await fetch(`${server.url}/control/events?limit=10`, {
      headers: {
        Authorization: "Bearer secret-token",
      },
    });
    expect(events.status).toBe(200);
    const eventsJson = (await events.json()) as {
      items: Array<{ action: string; status: string; actor: string }>;
    };
    expect(eventsJson.items.length).toBeGreaterThanOrEqual(4);
    expect(eventsJson.items.some((item) => item.action === "retry_payments" && item.status === "failed")).toBe(true);
    expect(eventsJson.items.some((item) => item.action === "drain" && item.actor === "test-suite")).toBe(true);

    db.close();
  });

  it("serves autopilot status, approvals, and run surfaces", async () => {
    const db = createTestDb();
    const hostDb = createTestDb();
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "openfox-operator-action-"));
    const previousHome = process.env.HOME;
    process.env.HOME = rootDir;
    let bountyServer: Awaited<ReturnType<typeof startBountyHttpServer>> | null = null;
    let inferenceServer: Awaited<ReturnType<typeof startMockInferenceServer>> | null = null;
    try {
      await fs.mkdir(path.join(rootDir, ".openfox"), { recursive: true });
      await fs.writeFile(
        path.join(rootDir, ".openfox", "wallet.json"),
        JSON.stringify({
          privateKey:
            "0x59c6995e998f97a5a0044966f094538e4a2e0d7a5b5d5b4b8b1c1d1e1f1a1b1c",
          createdAt: new Date().toISOString(),
        }),
        "utf8",
      );
      const hostIdentity = createTestIdentity();
      const hostEngine = createBountyEngine({
        identity: hostIdentity,
        db: hostDb,
        inference: new MockInferenceClient([
          noToolResponse('{"decision":"accepted","confidence":0.95,"reason":"Correct."}'),
        ]),
        bountyConfig: {
          ...DEFAULT_BOUNTY_CONFIG,
          enabled: true,
          role: "host",
          bindHost: "127.0.0.1",
          port: 0,
        },
      });
      const bounty = hostEngine.openQuestionBounty({
        question: "Capital of Germany?",
        referenceAnswer: "Berlin",
        rewardTomi: "1000",
        submissionDeadline: "2027-03-12T00:00:00.000Z",
      });
      bountyServer = await startBountyHttpServer({
        bountyConfig: {
          ...DEFAULT_BOUNTY_CONFIG,
          enabled: true,
          role: "host",
          bindHost: "127.0.0.1",
          port: 0,
        },
        engine: hostEngine,
      });
      inferenceServer = await startMockInferenceServer("Berlin");
      servers.push(bountyServer);
      servers.push(inferenceServer);
      const config = createAutopilotConfig();
      config.inferenceModel = "ollama/test";
      config.ollamaBaseUrl = inferenceServer.url;
      db.upsertSkill({
        name: "question-bounty-solver",
        description: "Solve bounded question bounties.",
        autoActivate: false,
        requires: [],
        instructions: "Answer with the bounded reference answer only.",
        source: "bundled",
        path: "skills/question-bounty-solver/SKILL.md",
        enabled: true,
        installedAt: "2026-03-11T18:00:00.000Z",
      });
      const providerAddress =
        "0x12252ae6b5d22fa4f58b295fe42cdb782f41881025d22645816d196b4f2e5143" as const;
      db.upsertPaymasterAuthorization(
        createFailedPaymasterAuthorization("auto-1", providerAddress),
      );
      db.upsertPaymasterAuthorization(
        createFailedPaymasterAuthorization("auto-2", providerAddress),
      );
      db.upsertPaymasterAuthorization(
        createFailedPaymasterAuthorization("auto-3", providerAddress),
      );
      const server = await startOperatorApiServer({ config, db });
      expect(server).not.toBeNull();
      if (!server) {
        db.close();
        return;
      }
      servers.push(server);

      const headers = {
        Authorization: "Bearer secret-token",
        "Content-Type": "application/json",
      };

      const status = await fetch(`${server.url}/autopilot/status`, {
        headers: { Authorization: "Bearer secret-token" },
      });
      expect(status.status).toBe(200);
      const statusJson = (await status.json()) as {
        enabled: boolean;
        approvals: { pending: number };
      };
      expect(statusJson.enabled).toBe(true);
      expect(statusJson.approvals.pending).toBe(0);

      const request = await fetch(`${server.url}/autopilot/approvals/request`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          kind: "opportunity_action",
          scope: "owner-alert:alert-api-1:review",
          reason: "review an opportunity",
          payload: {
            alertId: "alert-api-1",
            actionKind: "pursue",
            title: "Solve one bounded bounty",
            summary: "A bounded owner opportunity action.",
            baseUrl: bountyServer.url,
            payload: {
              baseUrl: bountyServer.url,
              bountyId: bounty.bountyId,
            },
          },
        }),
      });
      expect(request.status).toBe(200);
      const requestJson = (await request.json()) as { requestId: string; status: string };
      expect(requestJson.status).toBe("pending");

      const approvals = await fetch(
        `${server.url}/autopilot/approvals?status=pending&limit=10`,
        {
          headers: { Authorization: "Bearer secret-token" },
        },
      );
      expect(approvals.status).toBe(200);
      const approvalsJson = (await approvals.json()) as {
        items: Array<{ requestId: string; status: string }>;
      };
      expect(approvalsJson.items[0]?.requestId).toBe(requestJson.requestId);

      const approve = await fetch(
        `${server.url}/autopilot/approvals/${requestJson.requestId}/approve`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({ decisionNote: "approved by test" }),
        },
      );
      expect(approve.status).toBe(200);
      const approveJson = (await approve.json()) as {
        request: { status: string; requestId: string };
        action: { actionId: string; status: string; requestId: string };
      };
      expect(approveJson.request.status).toBe("approved");
      expect(approveJson.action.status).toBe("queued");
      expect(approveJson.action.requestId).toBe(requestJson.requestId);

      const ownerActions = await fetch(
        `${server.url}/owner/actions?status=queued&limit=10`,
        {
          headers: { Authorization: "Bearer secret-token" },
        },
      );
      expect(ownerActions.status).toBe(200);
      const ownerActionsJson = (await ownerActions.json()) as {
        items: Array<{ actionId: string; status: string }>;
      };
      expect(ownerActionsJson.items[0]?.actionId).toBe(approveJson.action.actionId);

      const execute = await fetch(
        `${server.url}/owner/actions/${encodeURIComponent(approveJson.action.actionId)}/execute`,
        {
          method: "POST",
          headers,
        },
      );
      expect(execute.status).toBe(200);
      const executeJson = (await execute.json()) as {
        action: { status: string; resolutionKind: string; resolutionRef: string };
        execution: { status: string };
      };
      expect(executeJson.action.status).toBe("completed");
      expect(executeJson.action.resolutionKind).toBe("bounty");
      expect(executeJson.execution.status).toBe("completed");

      const actionExecutions = await fetch(
        `${server.url}/owner/action-executions?actionId=${encodeURIComponent(
          approveJson.action.actionId,
        )}&limit=10`,
        {
          headers: { Authorization: "Bearer secret-token" },
        },
      );
      expect(actionExecutions.status).toBe(200);
      const actionExecutionsJson = (await actionExecutions.json()) as {
        items: Array<{ actionId: string; status: string }>;
      };
      expect(actionExecutionsJson.items[0]?.actionId).toBe(approveJson.action.actionId);
      expect(actionExecutionsJson.items[0]?.status).toBe("completed");

      const run = await fetch(`${server.url}/autopilot/run`, {
        method: "POST",
        headers,
        body: JSON.stringify({ actor: "test-suite" }),
      });
      expect(run.status).toBe(200);
      const runJson = (await run.json()) as {
        enabled: boolean;
        actions: Array<{ action: string; changed: boolean }>;
      };
      expect(runJson.enabled).toBe(true);
      expect(
        runJson.actions.find((item) => item.action === "quarantine_provider")?.changed,
      ).toBe(true);
    } finally {
      process.env.HOME = previousHome;
      await fs.rm(rootDir, { recursive: true, force: true });
      hostDb.close();
      db.close();
    }
  });
});
