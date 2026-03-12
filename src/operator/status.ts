import {
  isHeartbeatPaused,
  getUnconsumedWakeEvents,
  isOperatorDrained,
} from "../state/database.js";
import type { OpenFoxConfig, OpenFoxDatabase } from "../types.js";
import { getManagedServiceStatus, type ManagedServiceStatus } from "../service/daemon.js";
import { buildProviderReputationSnapshot } from "./provider-reputation.js";
import { buildStorageLeaseHealthSnapshot } from "./storage-health.js";
import { buildOperatorControlSnapshot } from "./control.js";
import { buildOperatorAutopilotSnapshot } from "./autopilot.js";
import {
  isFollowUpAction,
  isFollowUpExecution,
} from "../reports/opportunity-execution.js";
import { buildZkTlsBundleSummary, buildProofVerificationSummary } from "../proof-market/records.js";
import { createCommitteeManager } from "../committee/manager.js";
import { buildEvidenceWorkflowSummary } from "../evidence-workflow/summary.js";
import { buildOracleSummary } from "../agent-discovery/oracle-summary.js";

export interface RuntimeStatusSnapshot {
  configured: true;
  name: string;
  wallet: string;
  service: ManagedServiceStatus;
  operatorApi: {
    enabled: boolean;
    bind: string;
    pathPrefix: string;
    authTokenConfigured: boolean;
    exposeDoctor: boolean;
    exposeServiceStatus: boolean;
  } | null;
  discovery: {
    enabled: boolean;
    gateway: string;
    agentId: string | null;
  };
  creator: string | null;
  sandboxId: string | null;
  bounty: Record<string, unknown> | null;
  x402Payments: Record<string, unknown> | null;
  signerProvider: Record<string, unknown> | null;
  paymasterProvider: Record<string, unknown> | null;
  ownerReports: Record<string, unknown> | null;
  providerReputation: Record<string, unknown>;
  storage: Record<string, unknown> | null;
  artifacts: Record<string, unknown> | null;
  settlement: Record<string, unknown> | null;
  marketContracts: Record<string, unknown> | null;
  opportunityScout: Record<string, unknown> | null;
  proofMarket:
    | {
        zktlsBundles: number;
        proofVerifications: number;
        cryptographicProofVerifications: number;
        fallbackVerifications: number;
        evidenceCommitteeRuns: number;
        evidenceCommitteeQuorumMet: number;
        oracleCommitteeRuns: number;
        oracleCommitteeQuorumMet: number;
        oracleCommitteeDisagreements: number;
        evidenceWorkflowRuns: number;
        oracleResults: number;
      }
    | null;
  state: string;
  turns: number;
  toolsInstalled: number;
  activeSkills: number;
  activeHeartbeats: number;
  heartbeatPaused: boolean;
  operatorDrained: boolean;
  pendingWakes: number;
  control: {
    drained: boolean;
    recentEvents: number;
    latestAction: string | null;
    latestStatus: string | null;
    summary: string;
  };
  autopilot: {
    enabled: boolean;
    pendingApprovals: number;
    quarantinedProviders: number;
    lastRunAt: string | null;
    summary: string;
  };
  children: {
    alive: number;
    total: number;
  };
  model: string;
  version: string;
}

export function buildRuntimeStatusSnapshot(
  config: OpenFoxConfig,
  db: OpenFoxDatabase,
): RuntimeStatusSnapshot {
  const state = db.getAgentState();
  const turnCount = db.getTurnCount();
  const tools = db.getInstalledTools();
  const heartbeats = db.getHeartbeatEntries();
  const heartbeatPaused = isHeartbeatPaused(db.raw);
  const operatorDrained = isOperatorDrained(db.raw);
  const pendingWakes = getUnconsumedWakeEvents(db.raw);
  const skills = db.getSkills(true);
  const children = db.getChildren();
  const control = buildOperatorControlSnapshot(config, db);
  const autopilot = buildOperatorAutopilotSnapshot(config, db);
  const settlements = db.listSettlementReceipts(5);
  const settlementCallbacks = db.listSettlementCallbacks(5);
  const pendingSettlementCallbacks = db.listSettlementCallbacks(100, {
    status: "pending",
  }).length;
  const marketBindings = db.listMarketBindings(5);
  const marketCallbacks = db.listMarketContractCallbacks(5);
  const pendingMarketCallbacks = db.listMarketContractCallbacks(100, {
    status: "pending",
  }).length;
  const x402Payments = db.listX402Payments(5);
  const pendingX402Payments =
    db.listX402Payments(100, { status: "verified" }).length +
    db.listX402Payments(100, { status: "submitted" }).length;
  const failedX402Payments = db.listX402Payments(100, {
    status: "failed",
  }).length;
  const signerQuotes = db.listSignerQuotes(5);
  const signerExecutions = db.listSignerExecutions(5);
  const pendingSignerExecutions =
    db.listSignerExecutions(100, { status: "pending" }).length +
    db.listSignerExecutions(100, { status: "submitted" }).length;
  const paymasterQuotes = db.listPaymasterQuotes(5);
  const paymasterAuthorizations = db.listPaymasterAuthorizations(5);
  const pendingPaymasterAuthorizations =
    db.listPaymasterAuthorizations(100, { status: "authorized" }).length +
    db.listPaymasterAuthorizations(100, { status: "submitted" }).length;
  const ownerReports = db.listOwnerReports(5);
  const ownerReportDeliveries = db.listOwnerReportDeliveries(5);
  const pendingOwnerReportDeliveries = db.listOwnerReportDeliveries(100, {
    status: "pending",
  }).length;
  const ownerOpportunityAlerts = db.listOwnerOpportunityAlerts(5);
  const unreadOwnerOpportunityAlerts = db.listOwnerOpportunityAlerts(100, {
    status: "unread",
  }).length;
  const ownerOpportunityActions = db.listOwnerOpportunityActions(5);
  const queuedOwnerOpportunityActions = db.listOwnerOpportunityActions(100, {
    status: "queued",
  }).length;
  const queuedFollowUpActions = db
    .listOwnerOpportunityActions(100, { status: "queued" })
    .filter((item) => isFollowUpAction(item)).length;
  const ownerOpportunityActionExecutions =
    db.listOwnerOpportunityActionExecutions(5);
  const runningOwnerOpportunityActionExecutions =
    db.listOwnerOpportunityActionExecutions(100, { status: "running" }).length;
  const recentFollowUpActionExecutions = ownerOpportunityActionExecutions.filter((item) =>
    isFollowUpExecution(item),
  ).length;
  const storageLeases = db.listStorageLeases(5);
  const storageRenewals = db.listStorageRenewals(5);
  const activeStorageLeaseCount = db.listStorageLeases(100, { status: "active" }).length;
  const storageAudits = db.listStorageAudits(5);
  const storageAnchors = db.listStorageAnchors(5);
  const artifacts = db.listArtifacts(5);
  const verifiedArtifactCount = db.listArtifacts(100, { status: "verified" }).length;
  const anchoredArtifactCount = db.listArtifacts(100, { status: "anchored" }).length;
  const artifactAnchors = db.listArtifactAnchors(5);
  const providerReputation = buildProviderReputationSnapshot({ db, limit: 20 });
  const storageLeaseHealth = buildStorageLeaseHealthSnapshot({
    config,
    db,
    limit: 50,
  });
  const zktlsSummary = buildZkTlsBundleSummary(db, 20);
  const proofSummary = buildProofVerificationSummary(db, 20);
  const evidenceCommitteeSummary = createCommitteeManager(db).buildSummary(
    20,
    "evidence",
  );
  const oracleCommitteeSummary = createCommitteeManager(db).buildSummary(
    20,
    "oracle",
  );
  const evidenceWorkflowSummary = buildEvidenceWorkflowSummary({ db, limit: 20 });
  const oracleSummary = buildOracleSummary({ db, limit: 20 });
  const discovery = config.agentDiscovery;
  const gatewaySummary = discovery?.gatewayClient?.enabled
    ? discovery.gatewayClient.gatewayUrl || "discovery/bootnodes"
    : discovery?.gatewayServer?.enabled
      ? discovery.gatewayServer.publicBaseUrl
      : "disabled";
  const managedService = getManagedServiceStatus();

  return {
    configured: true,
    name: config.name,
    wallet: config.walletAddress,
    service: managedService,
    operatorApi: config.operatorApi
      ? {
          enabled: config.operatorApi.enabled,
          bind: `${config.operatorApi.bindHost}:${config.operatorApi.port}`,
          pathPrefix: config.operatorApi.pathPrefix,
          authTokenConfigured: Boolean(config.operatorApi.authToken),
          exposeDoctor: config.operatorApi.exposeDoctor,
          exposeServiceStatus: config.operatorApi.exposeServiceStatus,
        }
      : null,
    discovery: {
      enabled: discovery?.enabled === true,
      gateway: gatewaySummary,
      agentId: config.agentId || null,
    },
    creator: config.creatorAddress || null,
    sandboxId: config.sandboxId || null,
    bounty: config.bounty
      ? {
          enabled: config.bounty.enabled,
          role: config.bounty.role,
          defaultKind: config.bounty.defaultKind,
          skill: config.bounty.skill,
          bind: `${config.bounty.bindHost}:${config.bounty.port}`,
          pathPrefix: config.bounty.pathPrefix,
          remoteBaseUrl: config.bounty.remoteBaseUrl || null,
          discoveryCapability: config.bounty.discoveryCapability,
          pollIntervalSeconds: config.bounty.pollIntervalSeconds,
          autoOpenOnStartup: config.bounty.autoOpenOnStartup,
          autoOpenWhenIdle: config.bounty.autoOpenWhenIdle,
          autoSolveOnStartup: config.bounty.autoSolveOnStartup,
          autoSolveEnabled: config.bounty.autoSolveEnabled,
          policy: config.bounty.policy,
        }
      : null,
    x402Payments: config.x402Server
      ? {
          enabled: config.x402Server.enabled,
          confirmationPolicy: config.x402Server.confirmationPolicy,
          retryBatchSize: config.x402Server.retryBatchSize,
          retryAfterSeconds: config.x402Server.retryAfterSeconds,
          maxAttempts: config.x402Server.maxAttempts,
          pendingCount: pendingX402Payments,
          failedCount: failedX402Payments,
          recentPayments: x402Payments.map((item) => ({
            paymentId: item.paymentId,
            serviceKind: item.serviceKind,
            status: item.status,
            requestKey: item.requestKey,
            txHash: item.txHash,
            boundKind: item.boundKind,
            boundSubjectId: item.boundSubjectId,
          })),
        }
      : null,
    signerProvider: config.signerProvider
      ? {
          enabled: config.signerProvider.enabled,
          bind: `${config.signerProvider.bindHost}:${config.signerProvider.port}`,
          pathPrefix: config.signerProvider.pathPrefix,
          capabilityPrefix: config.signerProvider.capabilityPrefix,
          publishToDiscovery: config.signerProvider.publishToDiscovery,
          quoteValiditySeconds: config.signerProvider.quoteValiditySeconds,
          quotePriceWei: config.signerProvider.quotePriceWei,
          submitPriceWei: config.signerProvider.submitPriceWei,
          requestTimeoutMs: config.signerProvider.requestTimeoutMs,
          maxDataBytes: config.signerProvider.maxDataBytes,
          policy: {
            trustTier: config.signerProvider.policy.trustTier,
            walletAddress:
              config.signerProvider.policy.walletAddress || config.walletAddress,
            policyId: config.signerProvider.policy.policyId,
            delegateIdentity:
              config.signerProvider.policy.delegateIdentity || null,
            allowedTargets: config.signerProvider.policy.allowedTargets,
            allowedFunctionSelectors:
              config.signerProvider.policy.allowedFunctionSelectors,
            maxValueWei: config.signerProvider.policy.maxValueWei,
            expiresAt: config.signerProvider.policy.expiresAt || null,
            allowSystemAction:
              config.signerProvider.policy.allowSystemAction === true,
          },
          recentQuotes: signerQuotes.map((item) => ({
            quoteId: item.quoteId,
            requesterAddress: item.requesterAddress,
            targetAddress: item.targetAddress,
            status: item.status,
            amountWei: item.amountWei,
            expiresAt: item.expiresAt,
          })),
          recentExecutions: signerExecutions.map((item) => ({
            executionId: item.executionId,
            quoteId: item.quoteId,
            status: item.status,
            requesterAddress: item.requesterAddress,
            targetAddress: item.targetAddress,
            submittedTxHash: item.submittedTxHash,
            paymentId: item.paymentId,
          })),
          pendingExecutions: pendingSignerExecutions,
        }
      : null,
    paymasterProvider: config.paymasterProvider
      ? {
          enabled: config.paymasterProvider.enabled,
          bind: `${config.paymasterProvider.bindHost}:${config.paymasterProvider.port}`,
          pathPrefix: config.paymasterProvider.pathPrefix,
          capabilityPrefix: config.paymasterProvider.capabilityPrefix,
          publishToDiscovery: config.paymasterProvider.publishToDiscovery,
          quoteValiditySeconds: config.paymasterProvider.quoteValiditySeconds,
          authorizationValiditySeconds:
            config.paymasterProvider.authorizationValiditySeconds,
          quotePriceWei: config.paymasterProvider.quotePriceWei,
          authorizePriceWei: config.paymasterProvider.authorizePriceWei,
          requestTimeoutMs: config.paymasterProvider.requestTimeoutMs,
          maxDataBytes: config.paymasterProvider.maxDataBytes,
          defaultGas: config.paymasterProvider.defaultGas,
          policy: {
            trustTier: config.paymasterProvider.policy.trustTier,
            sponsorAddress:
              config.paymasterProvider.policy.sponsorAddress || config.walletAddress,
            policyId: config.paymasterProvider.policy.policyId,
            delegateIdentity:
              config.paymasterProvider.policy.delegateIdentity || null,
            allowedWallets: config.paymasterProvider.policy.allowedWallets,
            allowedTargets: config.paymasterProvider.policy.allowedTargets,
            allowedFunctionSelectors:
              config.paymasterProvider.policy.allowedFunctionSelectors,
            maxValueWei: config.paymasterProvider.policy.maxValueWei,
            expiresAt: config.paymasterProvider.policy.expiresAt || null,
            allowSystemAction:
              config.paymasterProvider.policy.allowSystemAction === true,
          },
          recentQuotes: paymasterQuotes.map((item) => ({
            quoteId: item.quoteId,
            requesterAddress: item.requesterAddress,
            walletAddress: item.walletAddress,
            targetAddress: item.targetAddress,
            status: item.status,
            amountWei: item.amountWei,
            expiresAt: item.expiresAt,
          })),
          recentAuthorizations: paymasterAuthorizations.map((item) => ({
            authorizationId: item.authorizationId,
            quoteId: item.quoteId,
            status: item.status,
            requesterAddress: item.requesterAddress,
            walletAddress: item.walletAddress,
            targetAddress: item.targetAddress,
            submittedTxHash: item.submittedTxHash,
            paymentId: item.paymentId,
          })),
          pendingAuthorizations: pendingPaymasterAuthorizations,
        }
      : null,
    ownerReports: config.ownerReports?.enabled
      ? {
          enabled: config.ownerReports.enabled,
          generateWithInference: config.ownerReports.generateWithInference,
          autoDeliverChannels: config.ownerReports.autoDeliverChannels,
          webEnabled: config.ownerReports.web.enabled,
          emailEnabled: config.ownerReports.email.enabled,
          recentReports: ownerReports.map((item) => ({
            reportId: item.reportId,
            periodKind: item.periodKind,
            generationStatus: item.generationStatus,
            createdAt: item.createdAt,
          })),
          recentDeliveries: ownerReportDeliveries.map((item) => ({
            deliveryId: item.deliveryId,
            reportId: item.reportId,
            channel: item.channel,
            status: item.status,
            target: item.target,
            deliveredAt: item.deliveredAt,
          })),
          pendingDeliveries: pendingOwnerReportDeliveries,
          alertsEnabled: config.ownerReports.alerts?.enabled === true,
          actionExecutionEnabled:
            config.ownerReports.actionExecution?.enabled === true,
          actionExecutionAutoPursue:
            config.ownerReports.actionExecution?.autoExecutePursue === true,
          actionExecutionAutoDelegate:
            config.ownerReports.actionExecution?.autoExecuteDelegate === true,
          actionExecutionAutoFollowUps:
            config.ownerReports.actionExecution?.autoQueueFollowUps === true,
          actionExecutionMaxFollowUpDepth:
            config.ownerReports.actionExecution?.maxFollowUpDepth ?? 0,
          actionExecutionMaxFollowUpsPerRun:
            config.ownerReports.actionExecution?.maxFollowUpsPerRun ?? 0,
          actionExecutionCooldownSeconds:
            config.ownerReports.actionExecution?.executionCooldownSeconds ?? 0,
          recentAlerts: ownerOpportunityAlerts.map((item) => ({
            alertId: item.alertId,
            status: item.status,
            kind: item.kind,
            title: item.title,
            strategyScore: item.strategyScore,
            createdAt: item.createdAt,
          })),
          unreadAlerts: unreadOwnerOpportunityAlerts,
          recentActions: ownerOpportunityActions.map((item) => ({
            actionId: item.actionId,
            status: item.status,
            kind: item.kind,
            title: item.title,
            resolutionKind: item.resolutionKind,
            resolutionRef: item.resolutionRef,
            followUpDepth:
              typeof item.payload.followUpDepth === "number"
                ? item.payload.followUpDepth
                : 0,
            queuedAt: item.queuedAt,
          })),
          queuedActions: queuedOwnerOpportunityActions,
          queuedFollowUpActions,
          recentActionExecutions: ownerOpportunityActionExecutions.map(
            (item) => ({
              executionId: item.executionId,
              actionId: item.actionId,
              kind: item.kind,
              status: item.status,
              executionRef: item.executionRef,
              followUp: isFollowUpExecution(item),
              updatedAt: item.updatedAt,
            }),
          ),
          runningActionExecutions: runningOwnerOpportunityActionExecutions,
          recentFollowUpActionExecutions,
        }
      : null,
    providerReputation: {
      totalProviders: providerReputation.totalProviders,
      weakProviders: providerReputation.weakProviders,
      topProviders: providerReputation.entries.slice(0, 5).map((entry) => ({
        kind: entry.kind,
        providerAddress: entry.providerAddress,
        providerBaseUrl: entry.providerBaseUrl,
        score: entry.score,
        grade: entry.grade,
        successCount: entry.successCount,
        failureCount: entry.failureCount,
        pendingCount: entry.pendingCount,
      })),
    },
    storage: config.storage
      ? {
          enabled: config.storage.enabled,
          bind: `${config.storage.bindHost}:${config.storage.port}`,
          pathPrefix: config.storage.pathPrefix,
          capabilityPrefix: config.storage.capabilityPrefix,
          storageDir: config.storage.storageDir,
          publishToDiscovery: config.storage.publishToDiscovery,
          allowAnonymousGet: config.storage.allowAnonymousGet,
          leaseHealth: {
            autoAudit: config.storage.leaseHealth.autoAudit,
            auditIntervalSeconds: config.storage.leaseHealth.auditIntervalSeconds,
            autoRenew: config.storage.leaseHealth.autoRenew,
            renewalLeadSeconds: config.storage.leaseHealth.renewalLeadSeconds,
            autoReplicate: config.storage.leaseHealth.autoReplicate,
          },
          replication: {
            enabled: config.storage.replication.enabled,
            targetCopies: config.storage.replication.targetCopies,
            providerBaseUrls: config.storage.replication.providerBaseUrls,
          },
          anchor: {
            enabled: config.storage.anchor.enabled,
            sinkAddress: config.storage.anchor.sinkAddress || null,
          },
          activeLeaseCount: activeStorageLeaseCount,
          recentLeases: storageLeases.map((item) => ({
            leaseId: item.leaseId,
            cid: item.cid,
            bundleKind: item.bundleKind,
            status: item.status,
            expiresAt: item.receipt.expiresAt,
            providerBaseUrl: item.providerBaseUrl || null,
            anchorTxHash: item.anchorTxHash,
          })),
          recentRenewals: storageRenewals.map((item) => ({
            renewalId: item.renewalId,
            leaseId: item.leaseId,
            cid: item.cid,
            renewedExpiresAt: item.renewedExpiresAt,
            addedTtlSeconds: item.addedTtlSeconds,
            providerBaseUrl: item.providerBaseUrl || null,
          })),
          recentAudits: storageAudits.map((item) => ({
            auditId: item.auditId,
            leaseId: item.leaseId,
            status: item.status,
            checkedAt: item.checkedAt,
          })),
          leaseHealthReport: {
            totalLeases: storageLeaseHealth.totalLeases,
            healthy: storageLeaseHealth.healthy,
            warning: storageLeaseHealth.warning,
            critical: storageLeaseHealth.critical,
            dueRenewals: storageLeaseHealth.dueRenewals,
            dueAudits: storageLeaseHealth.dueAudits,
            underReplicated: storageLeaseHealth.underReplicated,
          },
          recentAnchors: storageAnchors.map((item) => ({
            anchorId: item.anchorId,
            leaseId: item.leaseId,
            summaryHash: item.summaryHash,
            anchorTxHash: item.anchorTxHash,
          })),
        }
      : null,
    artifacts: config.artifacts
      ? {
          enabled: config.artifacts.enabled,
          defaultProviderBaseUrl: config.artifacts.defaultProviderBaseUrl || null,
          defaultTtlSeconds: config.artifacts.defaultTtlSeconds,
          autoAnchorOnStore: config.artifacts.autoAnchorOnStore,
          captureCapability: config.artifacts.captureCapability,
          evidenceCapability: config.artifacts.evidenceCapability,
          aggregateCapability: config.artifacts.aggregateCapability,
          verificationCapability: config.artifacts.verificationCapability,
          anchor: {
            enabled: config.artifacts.anchor.enabled,
            sinkAddress: config.artifacts.anchor.sinkAddress || null,
          },
          verifiedCount: verifiedArtifactCount,
          anchoredCount: anchoredArtifactCount,
          recentArtifacts: artifacts.map((item) => ({
            artifactId: item.artifactId,
            kind: item.kind,
            status: item.status,
            cid: item.cid,
            title: item.title,
            anchorId: item.anchorId,
          })),
          recentAnchors: artifactAnchors.map((item) => ({
            anchorId: item.anchorId,
            artifactId: item.artifactId,
            summaryHash: item.summaryHash,
            anchorTxHash: item.anchorTxHash,
          })),
        }
      : null,
    settlement: config.settlement
      ? {
          enabled: config.settlement.enabled,
          sinkAddress: config.settlement.sinkAddress || null,
          waitForReceipt: config.settlement.waitForReceipt,
          gas: config.settlement.gas,
          publishBounties: config.settlement.publishBounties,
          publishObservations: config.settlement.publishObservations,
          publishOracleResults: config.settlement.publishOracleResults,
          callbacks: {
            enabled: config.settlement.callbacks.enabled,
            retryBatchSize: config.settlement.callbacks.retryBatchSize,
            retryAfterSeconds: config.settlement.callbacks.retryAfterSeconds,
            pendingCount: pendingSettlementCallbacks,
            recentCallbacks: settlementCallbacks.map((item) => ({
              callbackId: item.callbackId,
              receiptId: item.receiptId,
              kind: item.kind,
              status: item.status,
              callbackTxHash: item.callbackTxHash,
            })),
          },
          receiptCount: settlements.length,
          recentReceipts: settlements.map((item) => ({
            receiptId: item.receiptId,
            kind: item.kind,
            subjectId: item.subjectId,
            receiptHash: item.receiptHash,
            settlementTxHash: item.settlementTxHash,
          })),
        }
      : null,
    marketContracts: config.marketContracts
      ? {
          enabled: config.marketContracts.enabled,
          retryBatchSize: config.marketContracts.retryBatchSize,
          retryAfterSeconds: config.marketContracts.retryAfterSeconds,
          pendingCount: pendingMarketCallbacks,
          recentBindings: marketBindings.map((item) => ({
            bindingId: item.bindingId,
            kind: item.kind,
            subjectId: item.subjectId,
            receiptHash: item.receiptHash,
            callbackTxHash: item.callbackTxHash,
          })),
          recentCallbacks: marketCallbacks.map((item) => ({
            callbackId: item.callbackId,
            bindingId: item.bindingId,
            kind: item.kind,
            status: item.status,
            callbackTxHash: item.callbackTxHash,
            packageName: item.packageName,
            functionSignature: item.functionSignature,
          })),
        }
      : null,
    opportunityScout: config.opportunityScout
      ? {
          enabled: config.opportunityScout.enabled,
          maxItems: config.opportunityScout.maxItems,
          discoveryCapabilities: config.opportunityScout.discoveryCapabilities,
          remoteBaseUrls: config.opportunityScout.remoteBaseUrls,
        }
      : null,
    proofMarket:
      config.agentDiscovery?.newsFetchServer?.enabled ||
      config.agentDiscovery?.proofVerifyServer?.enabled ||
      zktlsSummary.totalBundles > 0 ||
      proofSummary.totalResults > 0 ||
      evidenceCommitteeSummary.totalRuns > 0 ||
      oracleCommitteeSummary.totalRuns > 0
        ? {
            zktlsBundles: zktlsSummary.totalBundles,
            proofVerifications: proofSummary.totalResults,
            cryptographicProofVerifications:
              proofSummary.realProofVerifications,
            fallbackVerifications: proofSummary.fallbackVerifications,
            evidenceCommitteeRuns: evidenceCommitteeSummary.totalRuns,
            evidenceCommitteeQuorumMet: evidenceCommitteeSummary.quorumMet,
            oracleCommitteeRuns: oracleCommitteeSummary.totalRuns,
            oracleCommitteeQuorumMet: oracleCommitteeSummary.quorumMet,
            oracleCommitteeDisagreements:
              oracleCommitteeSummary.disagreements,
            evidenceWorkflowRuns: evidenceWorkflowSummary.totalRuns,
            oracleResults: oracleSummary.totalResults,
          }
        : null,
    state,
    turns: turnCount,
    toolsInstalled: tools.length,
    activeSkills: skills.length,
    activeHeartbeats: heartbeats.filter((h) => h.enabled).length,
    heartbeatPaused,
    operatorDrained,
    pendingWakes: pendingWakes.length,
    control: {
      drained: control.drained,
      recentEvents: control.recentEvents.length,
      latestAction: control.recentEvents[0]?.action ?? null,
      latestStatus: control.recentEvents[0]?.status ?? null,
      summary: control.summary,
    },
    autopilot: {
      enabled: autopilot.enabled,
      pendingApprovals: autopilot.approvals.pending,
      quarantinedProviders: autopilot.quarantinedProviders.length,
      lastRunAt: autopilot.lastRunAt,
      summary: autopilot.summary,
    },
    children: {
      alive: children.filter((c) => c.status !== "dead").length,
      total: children.length,
    },
    model: config.inferenceModelRef || config.inferenceModel,
    version: config.version,
  };
}

export function buildRuntimeStatusReport(snapshot: RuntimeStatusSnapshot): string {
  const bounty = snapshot.bounty as
    | {
        enabled: boolean;
        role: string;
        defaultKind: string;
        bind: string;
        pathPrefix: string;
        autoOpenOnStartup: boolean;
        autoOpenWhenIdle: boolean;
        autoSolveOnStartup: boolean;
        autoSolveEnabled: boolean;
      }
    | null;
  const storage = snapshot.storage as
    | {
        enabled: boolean;
        activeLeaseCount: number;
        recentAnchors: unknown[];
        leaseHealthReport: { critical: number; warning: number };
      }
    | null;
  const artifacts = snapshot.artifacts as
    | { enabled: boolean; recentArtifacts: unknown[]; anchoredCount: number }
    | null;
  const x402 = snapshot.x402Payments as
    | { enabled: boolean; recentPayments: unknown[]; pendingCount: number; failedCount: number }
    | null;
  const signer = snapshot.signerProvider as
    | { enabled: boolean; recentQuotes: unknown[]; recentExecutions: unknown[]; pendingExecutions: number }
    | null;
  const paymaster = snapshot.paymasterProvider as
    | { enabled: boolean; recentQuotes: unknown[]; recentAuthorizations: unknown[]; pendingAuthorizations: number }
    | null;
  const ownerReports = snapshot.ownerReports as
    | {
        enabled: boolean;
        recentReports: unknown[];
        recentDeliveries: unknown[];
        pendingDeliveries: number;
        webEnabled: boolean;
        emailEnabled: boolean;
        queuedActions: number;
        queuedFollowUpActions: number;
        actionExecutionAutoDelegate: boolean;
        actionExecutionAutoFollowUps: boolean;
        actionExecutionMaxFollowUpDepth: number;
        recentActionExecutions: unknown[];
        recentFollowUpActionExecutions: number;
        runningActionExecutions: number;
      }
    | null;
  const providerReputation = snapshot.providerReputation as
    | { totalProviders: number; weakProviders: number }
    | null;
  const settlement = snapshot.settlement as
    | { enabled: boolean; receiptCount: number; callbacks: { pendingCount: number } }
    | null;
  const market = snapshot.marketContracts as
    | { enabled: boolean; recentBindings: unknown[]; pendingCount: number }
    | null;
  const proofMarket = snapshot.proofMarket as
    | {
        zktlsBundles: number;
        proofVerifications: number;
        cryptographicProofVerifications: number;
        fallbackVerifications: number;
        evidenceCommitteeRuns: number;
        evidenceCommitteeQuorumMet: number;
        oracleCommitteeRuns: number;
        oracleCommitteeQuorumMet: number;
        oracleCommitteeDisagreements: number;
        evidenceWorkflowRuns: number;
        oracleResults: number;
      }
    | null;

  return `
=== OPENFOX STATUS ===
Name:       ${snapshot.name}
Wallet:     ${snapshot.wallet}
Service:    ${snapshot.service.installed ? snapshot.service.active || "installed" : "not installed"}
Discovery:  ${snapshot.discovery.enabled ? "enabled" : "disabled"}
Gateway:    ${snapshot.discovery.gateway}
Operator API: ${snapshot.operatorApi?.enabled ? `${snapshot.operatorApi.bind}${snapshot.operatorApi.pathPrefix}` : "disabled"}
Bounty:     ${bounty?.enabled ? `${bounty.role}/${bounty.defaultKind} @ ${bounty.bind}${bounty.pathPrefix}` : "disabled"}
Bounty auto: ${bounty?.enabled ? `open=${bounty.autoOpenOnStartup || bounty.autoOpenWhenIdle ? "on" : "off"} solve=${bounty.autoSolveOnStartup || bounty.autoSolveEnabled ? "on" : "off"}` : "disabled"}
Storage:    ${storage?.enabled ? `enabled (${storage.activeLeaseCount} active lease${storage.activeLeaseCount === 1 ? "" : "s"}, ${storage.leaseHealthReport.critical} critical, ${storage.leaseHealthReport.warning} warning)` : "disabled"}
Artifacts:  ${artifacts?.enabled ? `enabled (${artifacts.recentArtifacts.length} recent, ${artifacts.anchoredCount} anchored)` : "disabled"}
x402:       ${x402?.enabled ? `enabled (${x402.recentPayments.length} recent payment${x402.recentPayments.length === 1 ? "" : "s"}, ${x402.pendingCount} pending, ${x402.failedCount} failed)` : "disabled"}
Signer:     ${signer?.enabled ? `enabled (${signer.recentQuotes.length} recent quote${signer.recentQuotes.length === 1 ? "" : "s"}, ${signer.recentExecutions.length} recent execution${signer.recentExecutions.length === 1 ? "" : "s"}, ${signer.pendingExecutions} pending)` : "disabled"}
Paymaster:  ${paymaster?.enabled ? `enabled (${paymaster.recentQuotes.length} recent quote${paymaster.recentQuotes.length === 1 ? "" : "s"}, ${paymaster.recentAuthorizations.length} recent authorization${paymaster.recentAuthorizations.length === 1 ? "" : "s"}, ${paymaster.pendingAuthorizations} pending)` : "disabled"}
Owner reports: ${ownerReports?.enabled ? `enabled (${ownerReports.recentReports.length} recent report${ownerReports.recentReports.length === 1 ? "" : "s"}, ${ownerReports.recentDeliveries.length} recent delivery${ownerReports.recentDeliveries.length === 1 ? "" : "s"}, ${ownerReports.pendingDeliveries} pending, actions=${ownerReports.queuedActions} queued/${ownerReports.queuedFollowUpActions} follow-up, executions=${ownerReports.runningActionExecutions} running/${ownerReports.recentActionExecutions.length} recent/${ownerReports.recentFollowUpActionExecutions} follow-up${ownerReports.actionExecutionAutoDelegate ? ", delegate auto=on" : ""}${ownerReports.actionExecutionAutoFollowUps ? `, follow-ups auto=on depth<=${ownerReports.actionExecutionMaxFollowUpDepth}` : ""}, web=${ownerReports.webEnabled ? "on" : "off"}, email=${ownerReports.emailEnabled ? "on" : "off"})` : "disabled"}
Providers:  ${providerReputation ? `${providerReputation.totalProviders} tracked (${providerReputation.weakProviders} weak)` : "none"}
Settlement: ${settlement?.enabled ? `enabled (${settlement.receiptCount} recent receipt${settlement.receiptCount === 1 ? "" : "s"}, ${settlement.callbacks.pendingCount} pending callback${settlement.callbacks.pendingCount === 1 ? "" : "s"})` : "disabled"}
Market:     ${market?.enabled ? `enabled (${market.recentBindings.length} recent binding${market.recentBindings.length === 1 ? "" : "s"}, ${market.pendingCount} pending callback${market.pendingCount === 1 ? "" : "s"})` : "disabled"}
Scout:      ${(snapshot.opportunityScout as { enabled?: boolean } | null)?.enabled ? "enabled" : "disabled"}
Proofs:     ${proofMarket ? `${proofMarket.zktlsBundles} zkTLS bundle${proofMarket.zktlsBundles === 1 ? "" : "s"}, ${proofMarket.proofVerifications} verification${proofMarket.proofVerifications === 1 ? "" : "s"} (${proofMarket.cryptographicProofVerifications} cryptographic / ${proofMarket.fallbackVerifications} fallback), committees=${proofMarket.evidenceCommitteeRuns + proofMarket.oracleCommitteeRuns}` : "disabled"}
Creator:    ${snapshot.creator}
Sandbox:    ${snapshot.sandboxId}
State:      ${snapshot.state}
Turns:      ${snapshot.turns}
Tools:      ${snapshot.toolsInstalled} installed
Skills:     ${snapshot.activeSkills} active
Heartbeats: ${snapshot.activeHeartbeats} active
Heartbeat paused: ${snapshot.heartbeatPaused ? "yes" : "no"}
Operator drained: ${snapshot.operatorDrained ? "yes" : "no"}
Pending wakes: ${snapshot.pendingWakes}
Control:    ${snapshot.control.summary}
Autopilot:  ${snapshot.autopilot.summary}
Children:   ${snapshot.children.alive} alive / ${snapshot.children.total} total
Agent ID:   ${snapshot.discovery.agentId || "not configured"}
Model:      ${snapshot.model}
Version:    ${snapshot.version}
`.trimStart();
}
