import { describe, expect, it } from "vitest";
import { createTestConfig, createTestDb } from "./mocks.js";
import {
  buildHealthSnapshot,
  buildDoctorReport,
  buildHealthSnapshotReport,
} from "../doctor/report.js";

describe("doctor report formatting", () => {
  it("renders health and doctor reports from a synthetic snapshot", () => {
    const db = createTestDb();
    const config = createTestConfig({
      rpcUrl: "http://127.0.0.1:8545",
      chainId: 1666,
    });

    const snapshot = {
      configPath: "/tmp/openfox.json",
      walletPath: "/tmp/wallet.json",
      configPresent: true,
      walletPresent: true,
      inferenceConfigured: true,
      rpcConfigured: true,
      discoveryEnabled: true,
      operatorApiEnabled: true,
      operatorApiReady: true,
      autopilotEnabled: true,
      autopilotPendingApprovals: 1,
      autopilotQuarantinedProviders: 2,
      gatewayEnabled: false,
      providerEnabled: false,
      signerProviderEnabled: true,
      signerProviderReady: true,
      signerRecentQuotes: 2,
      signerRecentExecutions: 1,
      signerPendingExecutions: 1,
      signerPolicyConfigured: true,
      signerPolicyExpired: false,
      paymasterProviderEnabled: true,
      paymasterProviderReady: true,
      paymasterRecentQuotes: 3,
      paymasterRecentAuthorizations: 2,
      paymasterPendingAuthorizations: 1,
      paymasterPolicyConfigured: true,
      paymasterPolicyExpired: false,
      paymasterSponsorFunded: true,
      paymasterSignerParityAligned: true,
      bountyEnabled: true,
      bountyRole: "host" as const,
      bountyAutoEnabled: true,
      bountyRemoteConfigured: false,
      ownerReportsEnabled: true,
      ownerReportsInferenceEnabled: true,
      ownerReportsWebEnabled: true,
      ownerReportsEmailEnabled: false,
      ownerReportsRecentReports: 2,
      ownerReportsRecentDeliveries: 1,
      ownerReportsPendingDeliveries: 1,
      ownerReportsWebReady: true,
      ownerReportsEmailReady: true,
      storageEnabled: true,
      storageReady: true,
      storageAnonymousGet: true,
      storageAnchorEnabled: true,
      storageRecentLeases: 2,
      storageActiveLeases: 1,
      storageRecentRenewals: 1,
      storageRecentAudits: 1,
      storageRecentAnchors: 1,
      storageDueRenewals: 0,
      storageUnderReplicatedBundles: 0,
      storageReplicationReady: true,
      artifactsEnabled: true,
      artifactsReady: true,
      artifactsRecentCount: 2,
      artifactsVerifiedCount: 1,
      artifactsAnchoredCount: 1,
      x402ServerEnabled: true,
      x402ServerReady: true,
      x402RecentPayments: 2,
      x402PendingPayments: 1,
      x402FailedPayments: 0,
      x402UnboundPayments: 0,
      settlementEnabled: true,
      settlementReady: true,
      settlementRecentCount: 1,
      settlementCallbacksEnabled: true,
      settlementPendingCallbacks: 2,
      settlementMisconfiguredKinds: [],
      marketContractsEnabled: true,
      marketContractsReady: true,
      marketBindingsRecentCount: 1,
      marketPendingCallbacks: 1,
      marketMisconfiguredKinds: [],
      managedService: {
        manager: "systemd-user" as const,
        available: true,
        installed: false,
        enabled: null,
        active: null,
        unitName: "openfox.service",
        unitPath: "/tmp/openfox.service",
        workingDirectory: "/tmp/openfox",
        entryPath: "/tmp/openfox/dist/index.js",
        details: "service unit not installed",
      },
      heartbeatPaused: false,
      operatorDrained: false,
      pendingWakes: 0,
      skillCount: 1,
      ineligibleEnabledSkills: ["test-skill"],
      serviceStatusReport: "service status report",
      gatewayStatusReport: "gateway status report",
      serviceHealthReport: "OK rpc http://127.0.0.1:8545",
      findings: [
        {
          id: "service-not-installed",
          severity: "warn" as const,
          summary: "OpenFox is not installed as a managed service.",
          recommendation: "Run `openfox service install`.",
        },
        {
          id: "skills-warning",
          severity: "warn" as const,
          summary: "Enabled skills are missing requirements: test-skill",
        },
        {
          id: "rpc-ok",
          severity: "ok" as const,
          summary: "Chain RPC probe succeeded.",
        },
        {
          id: "artifacts-enabled",
          severity: "ok" as const,
          summary: "Artifact pipeline is enabled (2 recent artifacts, 1 anchored).",
        },
      ],
    };

    const health = buildHealthSnapshotReport(snapshot);
    const doctor = buildDoctorReport(snapshot);

    expect(health).toContain("=== OPENFOX HEALTH ===");
    expect(health).toContain("Operator API enabled: yes (auth=configured)");
    expect(health).toContain("Operator autopilot: yes (1 pending approvals, 2 quarantined providers)");
    expect(health).toContain("Signer provider enabled: yes (2 quotes, 1 executions, 1 pending)");
    expect(
      health,
    ).toContain(
      "Paymaster provider enabled: yes (3 quotes, 2 authorizations, 1 pending, sponsor funded=yes, signer parity=aligned)",
    );
    expect(health).toContain("Bounty enabled: yes (host)");
    expect(health).toContain(
      "Owner reports enabled: yes (2 recent, 1 deliveries, 1 pending, web=on, email=off)",
    );
    expect(health).toContain(
      "Storage enabled: yes (1 active, 1 renewals, 1 audits, 1 anchors, 0 under-replicated)",
    );
    expect(health).toContain("x402 server: yes (2 recent, 1 pending, 0 failed)");
    expect(health).toContain("Settlement enabled: yes (1 recent)");
    expect(health).toContain("Settlement callbacks: yes (2 pending)");
    expect(health).toContain("Market bindings: yes (1 recent, 1 pending callbacks)");
    expect(health).toContain("Artifacts enabled: yes (2 recent, 1 verified, 1 anchored)");
    expect(health).toContain("service status report");
    expect(doctor).toContain("=== OPENFOX DOCTOR ===");
    expect(doctor).toContain("Warnings: 2");
    expect(doctor).toContain("Run `openfox service install`.");
    expect(doctor).toContain("Artifact pipeline is enabled (2 recent artifacts, 1 anchored).");

    db.close();
    void config;
  });

  it("flags signer provider mode without rpc or a valid policy", async () => {
    const snapshot = await buildHealthSnapshot(
      createTestConfig({
        rpcUrl: undefined,
        signerProvider: {
          enabled: true,
          bindHost: "127.0.0.1",
          port: 4898,
          pathPrefix: "/signer",
          capabilityPrefix: "signer",
          publishToDiscovery: true,
          quoteValiditySeconds: 300,
          quotePriceWei: "0",
          submitPriceWei: "1000",
          requestTimeoutMs: 15000,
          maxDataBytes: 2048,
          defaultGas: "21000",
          policy: {
            trustTier: "self_hosted",
            policyId: "",
            allowedTargets: [],
            allowedFunctionSelectors: [],
            maxValueWei: "1000",
            expiresAt: new Date(Date.now() - 60_000).toISOString(),
            allowSystemAction: false,
          },
        },
      }),
    );

    expect(
      snapshot.findings.some(
        (finding) =>
          finding.id === "signer-provider-enabled" && finding.severity === "error",
      ),
    ).toBe(true);
  });

  it("flags operator api when auth is missing", async () => {
    const snapshot = await buildHealthSnapshot(
      createTestConfig({
        operatorApi: {
          enabled: true,
          bindHost: "0.0.0.0",
          port: 4903,
          pathPrefix: "/operator",
          authToken: undefined,
          exposeDoctor: true,
          exposeServiceStatus: true,
        },
      }),
    );

    expect(
      snapshot.findings.some(
        (finding) =>
          finding.id === "operator-api-misconfigured" &&
          finding.severity === "error",
      ),
    ).toBe(true);
  });

  it("flags owner reports when inference generation is enabled without an inference backend", async () => {
    const snapshot = await buildHealthSnapshot(
      createTestConfig({
        runtimeApiKey: undefined,
        inferenceModel: "",
        openaiApiKey: undefined,
        anthropicApiKey: undefined,
        ollamaBaseUrl: undefined,
        ownerReports: {
          enabled: true,
          generateWithInference: true,
          persistSnapshots: true,
          autoDeliverChannels: ["web"],
          web: {
            enabled: true,
            bindHost: "127.0.0.1",
            port: 4904,
            pathPrefix: "/owner",
            outputDir: "/tmp/openfox-owner-reports",
          },
          email: {
            enabled: false,
            mode: "outbox",
            from: "openfox@localhost",
            to: "owner@localhost",
            outboxDir: "/tmp/openfox-owner-reports/outbox",
            sendmailPath: "/usr/sbin/sendmail",
          },
          schedule: {
            enabled: true,
            morningHourUtc: 8,
            endOfDayHourUtc: 18,
            weeklyDayUtc: 1,
            weeklyHourUtc: 8,
            anomalyDeliveryEnabled: true,
          },
        },
      }),
    );

    expect(
      snapshot.findings.some(
        (finding) =>
          finding.id === "owner-reports-enabled" && finding.severity === "error",
      ),
    ).toBe(true);
  });

  it("flags paymaster provider mode without rpc or a valid policy", async () => {
    const snapshot = await buildHealthSnapshot(
      createTestConfig({
        rpcUrl: undefined,
        paymasterProvider: {
          enabled: true,
          bindHost: "127.0.0.1",
          port: 4899,
          pathPrefix: "/paymaster",
          capabilityPrefix: "paymaster",
          publishToDiscovery: true,
          quoteValiditySeconds: 300,
          authorizationValiditySeconds: 600,
          quotePriceWei: "0",
          authorizePriceWei: "1000",
          requestTimeoutMs: 15000,
          maxDataBytes: 2048,
          defaultGas: "21000",
          policy: {
            trustTier: "self_hosted",
            policyId: "",
            sponsorAddress:
              "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            allowedWallets: [],
            allowedTargets: [],
            allowedFunctionSelectors: [],
            maxValueWei: "1000",
            expiresAt: new Date(Date.now() - 60_000).toISOString(),
            allowSystemAction: false,
          },
        },
      }),
    );

    expect(
      snapshot.findings.some(
        (finding) =>
          finding.id === "paymaster-provider-enabled" && finding.severity === "error",
      ),
    ).toBe(true);
  });

  it("treats paymaster signer parity as aligned once native signer metadata is available", async () => {
    const snapshot = await buildHealthSnapshot(
      createTestConfig({
        rpcUrl: "http://127.0.0.1:8545",
        paymasterProvider: {
          enabled: true,
          bindHost: "127.0.0.1",
          port: 4899,
          pathPrefix: "/paymaster",
          capabilityPrefix: "paymaster",
          publishToDiscovery: true,
          quoteValiditySeconds: 300,
          authorizationValiditySeconds: 600,
          quotePriceWei: "0",
          authorizePriceWei: "1000",
          requestTimeoutMs: 15000,
          maxDataBytes: 2048,
          defaultGas: "21000",
          policy: {
            trustTier: "self_hosted",
            policyId: "policy-test",
            sponsorAddress:
              "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            allowedWallets: [],
            allowedTargets: [
              "0x8888888888888888888888888888888888888888888888888888888888888888",
            ],
            allowedFunctionSelectors: [],
            maxValueWei: "1000",
            allowSystemAction: false,
          },
        },
      }),
    );

    expect(
      snapshot.findings.some((finding) => finding.id === "paymaster-signer-parity"),
    ).toBe(false);
    expect(snapshot.paymasterSignerParityAligned).toBe(true);
  });

  it("flags a solver auto mode with no remote host and no discovery source", async () => {
    const snapshot = await buildHealthSnapshot(
      createTestConfig({
        rpcUrl: "http://127.0.0.1:8545",
        bounty: {
          enabled: true,
          role: "solver",
          skill: "question-bounty-solver",
          bindHost: "127.0.0.1",
          port: 4891,
          pathPrefix: "/bounty",
          discoveryCapability: "bounty.submit",
          rewardWei: "1000",
          autoPayConfidenceThreshold: 0.9,
          defaultSubmissionTtlSeconds: 3600,
          pollIntervalSeconds: 30,
          maxOpenBounties: 10,
          judgeMode: "local_model",
          autoOpenOnStartup: false,
          autoOpenWhenIdle: false,
          autoSolveOnStartup: true,
          autoSolveEnabled: true,
        },
        agentDiscovery: {
          enabled: false,
          publishCard: false,
          cardTtlSeconds: 3600,
          endpoints: [],
          capabilities: [],
        },
      }),
    );

    expect(
      snapshot.findings.some((finding) => finding.id === "bounty-solver-no-source"),
    ).toBe(true);
  });

  it("flags settlement mode without an RPC URL", async () => {
    const snapshot = await buildHealthSnapshot(
      createTestConfig({
        rpcUrl: undefined,
        settlement: {
          enabled: true,
          gas: "160000",
          waitForReceipt: true,
          receiptTimeoutMs: 60000,
          publishBounties: true,
          publishObservations: true,
          publishOracleResults: true,
          callbacks: {
            enabled: false,
            retryBatchSize: 10,
            retryAfterSeconds: 120,
            bounty: {
              enabled: false,
              gas: "220000",
              valueWei: "0",
              waitForReceipt: true,
              receiptTimeoutMs: 60000,
              payloadMode: "canonical_receipt",
              maxAttempts: 3,
            },
            observation: {
              enabled: false,
              gas: "220000",
              valueWei: "0",
              waitForReceipt: true,
              receiptTimeoutMs: 60000,
              payloadMode: "canonical_receipt",
              maxAttempts: 3,
            },
            oracle: {
              enabled: false,
              gas: "220000",
              valueWei: "0",
              waitForReceipt: true,
              receiptTimeoutMs: 60000,
              payloadMode: "canonical_receipt",
              maxAttempts: 3,
            },
          },
        },
      }),
    );

    expect(
      snapshot.findings.some((finding) => finding.id === "settlement-enabled" && finding.severity === "error"),
    ).toBe(true);
  });

  it("flags x402 server mode without an RPC URL", async () => {
    const snapshot = await buildHealthSnapshot(
      createTestConfig({
        rpcUrl: undefined,
        x402Server: {
          enabled: true,
          confirmationPolicy: "receipt",
          receiptTimeoutMs: 15000,
          receiptPollIntervalMs: 1000,
          retryBatchSize: 10,
          retryAfterSeconds: 30,
          maxAttempts: 5,
        },
      }),
    );

    expect(
      snapshot.findings.some(
        (finding) =>
          finding.id === "x402-server-enabled" && finding.severity === "error",
      ),
    ).toBe(true);
  });

  it("flags storage anchoring without an RPC URL", async () => {
    const snapshot = await buildHealthSnapshot(
      createTestConfig({
        rpcUrl: undefined,
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
          minimumPriceWei: "1000",
          pricePerMiBWei: "1000",
          publishToDiscovery: true,
          allowAnonymousGet: true,
          anchor: {
            enabled: true,
            gas: "180000",
            waitForReceipt: true,
            receiptTimeoutMs: 60000,
          },
        },
      }),
    );

    expect(
      snapshot.findings.some(
        (finding) =>
          finding.id === "storage-enabled" && finding.severity === "error",
      ),
    ).toBe(true);
  });

  it("flags settlement callbacks missing a contract target", async () => {
    const snapshot = await buildHealthSnapshot(
      createTestConfig({
        rpcUrl: "http://127.0.0.1:8545",
        settlement: {
          enabled: true,
          gas: "160000",
          waitForReceipt: true,
          receiptTimeoutMs: 60000,
          publishBounties: true,
          publishObservations: true,
          publishOracleResults: true,
          callbacks: {
            enabled: true,
            retryBatchSize: 10,
            retryAfterSeconds: 120,
            bounty: {
              enabled: true,
              gas: "220000",
              valueWei: "0",
              waitForReceipt: true,
              receiptTimeoutMs: 60000,
              payloadMode: "canonical_receipt",
              maxAttempts: 3,
            },
            observation: {
              enabled: false,
              gas: "220000",
              valueWei: "0",
              waitForReceipt: true,
              receiptTimeoutMs: 60000,
              payloadMode: "canonical_receipt",
              maxAttempts: 3,
            },
            oracle: {
              enabled: false,
              gas: "220000",
              valueWei: "0",
              waitForReceipt: true,
              receiptTimeoutMs: 60000,
              payloadMode: "canonical_receipt",
              maxAttempts: 3,
            },
          },
        },
      }),
    );

    expect(
      snapshot.findings.some(
        (finding) =>
          finding.id === "settlement-callbacks-enabled" &&
          finding.severity === "error",
      ),
    ).toBe(true);
  });

  it("flags market contract callbacks missing contract metadata", async () => {
    const snapshot = await buildHealthSnapshot(
      createTestConfig({
        rpcUrl: "http://127.0.0.1:8545",
        marketContracts: {
          enabled: true,
          retryBatchSize: 10,
          retryAfterSeconds: 120,
          bounty: {
            enabled: true,
            gas: "260000",
            valueWei: "0",
            waitForReceipt: true,
            receiptTimeoutMs: 60000,
            payloadMode: "canonical_binding",
            maxAttempts: 3,
          },
          observation: {
            enabled: false,
            gas: "260000",
            valueWei: "0",
            waitForReceipt: true,
            receiptTimeoutMs: 60000,
            payloadMode: "canonical_binding",
            maxAttempts: 3,
          },
          oracle: {
            enabled: false,
            gas: "260000",
            valueWei: "0",
            waitForReceipt: true,
            receiptTimeoutMs: 60000,
            payloadMode: "canonical_binding",
            maxAttempts: 3,
          },
        },
      }),
    );

    expect(
      snapshot.findings.some(
        (finding) =>
          finding.id === "market-contract-callbacks-enabled" &&
          finding.severity === "error",
      ),
    ).toBe(true);
  });

  it("flags an artifact pipeline with no provider and no storage source", async () => {
    const snapshot = await buildHealthSnapshot(
      createTestConfig({
        rpcUrl: "http://127.0.0.1:8545",
        storage: {
          enabled: false,
          bindHost: "127.0.0.1",
          port: 4895,
          pathPrefix: "/storage",
          capabilityPrefix: "storage.ipfs",
          storageDir: "/tmp/openfox-storage",
          quoteValiditySeconds: 300,
          defaultTtlSeconds: 86400,
          maxTtlSeconds: 2592000,
          maxBundleBytes: 8 * 1024 * 1024,
          minimumPriceWei: "1000",
          pricePerMiBWei: "1000",
          publishToDiscovery: true,
          allowAnonymousGet: true,
          anchor: {
            enabled: false,
            gas: "180000",
            waitForReceipt: true,
            receiptTimeoutMs: 60000,
          },
        },
        artifacts: {
          enabled: true,
          defaultProviderBaseUrl: undefined,
          defaultTtlSeconds: 86400,
          autoAnchorOnStore: false,
          captureCapability: "public_news.capture",
          evidenceCapability: "oracle.evidence",
          aggregateCapability: "oracle.aggregate",
          verificationCapability: "artifact.verify",
          anchor: {
            enabled: false,
            gas: "180000",
            waitForReceipt: true,
            receiptTimeoutMs: 60000,
          },
        },
      }),
    );

    expect(
      snapshot.findings.some(
        (finding) =>
          finding.id === "artifacts-enabled" && finding.severity === "warn",
      ),
    ).toBe(true);
  });
});
