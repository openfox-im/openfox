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
      gatewayEnabled: false,
      providerEnabled: false,
      bountyEnabled: true,
      bountyRole: "host" as const,
      bountyAutoEnabled: true,
      bountyRemoteConfigured: false,
      settlementEnabled: true,
      settlementReady: true,
      settlementRecentCount: 1,
      settlementCallbacksEnabled: true,
      settlementPendingCallbacks: 2,
      settlementMisconfiguredKinds: [],
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
      ],
    };

    const health = buildHealthSnapshotReport(snapshot);
    const doctor = buildDoctorReport(snapshot);

    expect(health).toContain("=== OPENFOX HEALTH ===");
    expect(health).toContain("Bounty enabled: yes (host)");
    expect(health).toContain("Settlement enabled: yes (1 recent)");
    expect(health).toContain("Settlement callbacks: yes (2 pending)");
    expect(health).toContain("service status report");
    expect(doctor).toContain("=== OPENFOX DOCTOR ===");
    expect(doctor).toContain("Warnings: 2");
    expect(doctor).toContain("Run `openfox service install`.");

    db.close();
    void config;
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
});
