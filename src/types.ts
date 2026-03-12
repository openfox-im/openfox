/**
 * OpenFox - Type Definitions
 *
 * All shared interfaces for the sovereign AI agent runtime.
 */

import type {
  Address,
  ArtifactAnchorSummary,
  ArtifactBundleKind as NativeArtifactBundleKind,
  ArtifactVerificationReceipt,
  Hex,
  MarketBindingKind as NativeMarketBindingKind,
  MarketBindingReceipt,
  PrivateKeyAccount,
  Signature,
  SettlementKind as NativeSettlementKind,
  SettlementReceipt,
  StorageAnchorSummary,
  StorageReceipt,
} from "tosdk";
import {
  cloneSkillBackendStages,
  DEFAULT_NEWS_FETCH_SKILL_STAGES,
  DEFAULT_PROOF_VERIFY_SKILL_STAGES,
  DEFAULT_PROVIDER_BACKEND_MODE,
  DEFAULT_STORAGE_GET_SKILL_STAGES,
  DEFAULT_STORAGE_PUT_SKILL_STAGES,
} from "./agent-discovery/provider-skill-spec.js";
import type {
  ProviderBackendMode,
  SkillBackendStageConfig,
} from "./agent-discovery/provider-skill-spec.js";

export type {
  ProviderBackendMode,
  SkillBackendStageConfig,
} from "./agent-discovery/provider-skill-spec.js";

export type HexAddress = `0x${string}`;
export type ArtifactBundleKind = NativeArtifactBundleKind;

// ─── Identity ────────────────────────────────────────────────────

export interface OpenFoxIdentity {
  name: string;
  address: Address;
  account: PrivateKeyAccount;
  creatorAddress: HexAddress;
  sandboxId: string;
  apiKey: string;
  createdAt: string;
}

export interface WalletData {
  privateKey: `0x${string}`;
  createdAt: string;
}

export interface ProvisionResult {
  apiKey: string;
  walletAddress: string;
  keyPrefix: string;
}

export type AgentDiscoveryCapabilityMode = "paid" | "sponsored" | "hybrid";
export type AgentDiscoveryEndpointKind = "http" | "https" | "ws";
export type AgentDiscoveryOnchainCapabilityMode =
  | "off"
  | "prefer_onchain"
  | "require_onchain";

export interface AgentDiscoveryEndpointConfig {
  kind: AgentDiscoveryEndpointKind;
  url: string;
  viaGateway?: string;
  role?: string;
}

export interface AgentDiscoveryCapabilityConfig {
  name: string;
  mode: AgentDiscoveryCapabilityMode;
  policyRef?: string;
  policy?: Record<string, unknown>;
  rateLimit?: string;
  maxAmount?: string;
  priceModel?: string;
  description?: string;
}

export interface AgentDiscoveryFaucetServerConfig {
  enabled: boolean;
  bindHost: string;
  port: number;
  path: string;
  capability: string;
  payoutAmountWei: string;
  maxAmountWei: string;
  cooldownSeconds: number;
  requireNativeIdentity: boolean;
}

export interface AgentDiscoveryObservationServerConfig {
  enabled: boolean;
  bindHost: string;
  port: number;
  path: string;
  capability: string;
  priceWei: string;
  requestTimeoutMs: number;
  maxResponseBytes: number;
  allowPrivateTargets: boolean;
}

export interface AgentDiscoveryOracleServerConfig {
  enabled: boolean;
  bindHost: string;
  port: number;
  path: string;
  capability: string;
  priceWei: string;
  maxQuestionChars: number;
  maxContextChars: number;
  maxOptions: number;
}

export interface AgentDiscoveryNewsFetchServerConfig {
  enabled: boolean;
  bindHost: string;
  port: number;
  path: string;
  capability: string;
  priceWei: string;
  maxSourceUrlChars: number;
  requestTimeoutMs: number;
  maxResponseBytes: number;
  allowPrivateTargets: boolean;
  maxArticleChars: number;
  backendMode: ProviderBackendMode;
  skillStages: SkillBackendStageConfig[];
  requireSourcePolicyId?: boolean;
  defaultSourcePolicyId?: string;
  sourcePolicies?: NewsFetchSourcePolicyConfig[];
  zktlsWorker?: ProviderCliWorkerConfig | null;
}

export type VerificationSurfaceMode =
  | "fallback_integrity"
  | "native_attestation"
  | "committee_verified";

export type ProofVerifierClass =
  | "structural_verification"
  | "bundle_integrity_verification"
  | "tlsnotary_attestation_verification"
  | "m_of_n_consensus_verification";

export interface AgentDiscoveryProofVerifyServerConfig {
  enabled: boolean;
  bindHost: string;
  port: number;
  path: string;
  capability: string;
  priceWei: string;
  maxPayloadChars: number;
  requestTimeoutMs: number;
  maxFetchBytes: number;
  allowPrivateTargets: boolean;
  backendMode: ProviderBackendMode;
  skillStages: SkillBackendStageConfig[];
  supportedVerifierClasses?: ProofVerifierClass[];
  verifierWorker?: ProviderCliWorkerConfig | null;
}

export interface NewsFetchSourcePolicyConfig {
  id: string;
  allowHosts: string[];
  pathPrefixes?: string[];
  description?: string;
}

export interface AgentDiscoveryStorageServerConfig {
  enabled: boolean;
  bindHost: string;
  port: number;
  path: string;
  putCapability: string;
  getCapability: string;
  putPriceWei: string;
  getPriceWei: string;
  maxObjectBytes: number;
  storageDir: string;
  defaultTtlSeconds: number;
  maxTtlSeconds: number;
  pruneExpiredOnRead: boolean;
  putBackendMode: ProviderBackendMode;
  getBackendMode: ProviderBackendMode;
  putSkillStages: SkillBackendStageConfig[];
  getSkillStages: SkillBackendStageConfig[];
}

export interface AgentDiscoverySentimentAnalysisServerConfig {
  enabled: boolean;
  bindHost: string;
  port: number;
  path: string;
  capability: string;
  priceWei: string;
  maxTextChars: number;
  requestTimeoutMs: number;
}

export interface AgentGatewayBootnodeConfig {
  agentId: string;
  url: string;
  payToAddress?: `0x${string}`;
  paymentDirection?: "provider_pays" | "requester_pays" | "split";
  sessionFeeWei?: string;
  perRequestFeeWei?: string;
}

export interface AgentGatewaySignedBootnodeListPayload {
  version: number;
  networkId: number;
  entries: AgentGatewayBootnodeConfig[];
  issuedAt: number;
}

export interface AgentGatewaySignedBootnodeList
  extends AgentGatewaySignedBootnodeListPayload {
  signer: Address;
  signature: `0x${string}`;
}

export interface AgentGatewayServerConfig {
  enabled: boolean;
  bindHost: string;
  port: number;
  sessionPath: string;
  publicPathPrefix: string;
  publicBaseUrl: string;
  capability: string;
  mode: AgentDiscoveryCapabilityMode;
  priceModel?: string;
  sessionTtlSeconds: number;
  requestTimeoutMs: number;
  maxRoutesPerSession: number;
  maxRequestBodyBytes: number;
  relayPaymentEnabled?: boolean;
  relayPriceWei?: string;
  relayPaymentDescription?: string;
  relayPaymentRequiredDeadlineSeconds?: number;
  registerCapabilityOnStartup?: boolean;
  grantCapabilityBit?: number;
  paymentDirection?: "provider_pays" | "requester_pays" | "split";
  sessionFeeWei?: string;
  perRequestFeeWei?: string;
  maxSessions?: number;
  maxBandwidthKbps?: number;
  supportedTransports?: string[];
  latencySloMs?: number;
  availabilitySlo?: string;
}

export interface AgentGatewayClientRouteConfig {
  path: string;
  capability: string;
  mode: AgentDiscoveryCapabilityMode;
  targetUrl: string;
  stream?: boolean;
}

export interface AgentGatewayFeedbackConfig {
  enabled: boolean;
  successDelta: string;
  failureDelta: string;
  timeoutDelta: string;
  malformedDelta: string;
  gas: string;
  reasonPrefix: string;
}

export interface AgentGatewayClientConfig {
  enabled: boolean;
  gatewayAgentId?: string;
  gatewayUrl?: string;
  gatewayBootnodes: AgentGatewayBootnodeConfig[];
  gatewayBootnodeList?: AgentGatewaySignedBootnodeList;
  requireSignedBootnodeList?: boolean;
  sessionTtlSeconds: number;
  requestTimeoutMs: number;
  maxGatewaySessions: number;
  enableE2E?: boolean;
  feedback?: AgentGatewayFeedbackConfig;
  routes: AgentGatewayClientRouteConfig[];
}

export interface AgentDiscoveryReputationUpdateConfig {
  enabled: boolean;
  successDelta: string;
  failureDelta: string;
  timeoutDelta: string;
  malformedDelta: string;
  gas: string;
  reasonPrefix: string;
}

export interface AgentDiscoverySelectionPolicy {
  requireRegistered: boolean;
  excludeSuspended: boolean;
  onchainCapabilityMode: AgentDiscoveryOnchainCapabilityMode;
  minimumStakeWei: string;
  minimumReputation: string;
  preferHigherStake: boolean;
  preferHigherReputation: boolean;
}

export interface AgentDiscoveryPolicyProfiles {
  sponsor: AgentDiscoverySelectionPolicy;
  observation: AgentDiscoverySelectionPolicy;
  oracle: AgentDiscoverySelectionPolicy;
  news: AgentDiscoverySelectionPolicy;
  proof: AgentDiscoverySelectionPolicy;
  storage: AgentDiscoverySelectionPolicy;
  gateway: AgentDiscoverySelectionPolicy;
}

export interface AgentDiscoveryConfig {
  enabled: boolean;
  publishCard: boolean;
  displayName?: string;
  cardTtlSeconds: number;
  endpoints: AgentDiscoveryEndpointConfig[];
  capabilities: AgentDiscoveryCapabilityConfig[];
  directoryNodeRecords?: string[];
  selectionPolicy?: AgentDiscoverySelectionPolicy;
  policyProfiles?: Partial<AgentDiscoveryPolicyProfiles>;
  reputationUpdates?: AgentDiscoveryReputationUpdateConfig;
  faucetServer?: AgentDiscoveryFaucetServerConfig;
  observationServer?: AgentDiscoveryObservationServerConfig;
  oracleServer?: AgentDiscoveryOracleServerConfig;
  newsFetchServer?: AgentDiscoveryNewsFetchServerConfig;
  proofVerifyServer?: AgentDiscoveryProofVerifyServerConfig;
  storageServer?: AgentDiscoveryStorageServerConfig;
  sentimentAnalysisServer?: AgentDiscoverySentimentAnalysisServerConfig;
  gatewayServer?: AgentGatewayServerConfig;
  gatewayClient?: AgentGatewayClientConfig;
}

export const DEFAULT_AGENT_DISCOVERY_FAUCET_SERVER_CONFIG: AgentDiscoveryFaucetServerConfig =
  {
    enabled: false,
    bindHost: "127.0.0.1",
    port: 4877,
    path: "/agent-discovery/faucet",
    capability: "sponsor.topup.testnet",
    payoutAmountWei: "10000000000000000",
    maxAmountWei: "10000000000000000",
    cooldownSeconds: 86400,
    requireNativeIdentity: true,
  };

export const DEFAULT_AGENT_DISCOVERY_OBSERVATION_SERVER_CONFIG: AgentDiscoveryObservationServerConfig =
  {
    enabled: false,
    bindHost: "127.0.0.1",
    port: 4878,
    path: "/agent-discovery/observe-once",
    capability: "observation.once",
    priceWei: "1000000000000000",
    requestTimeoutMs: 10_000,
    maxResponseBytes: 131072,
    allowPrivateTargets: false,
  };

export const DEFAULT_AGENT_DISCOVERY_ORACLE_SERVER_CONFIG: AgentDiscoveryOracleServerConfig =
  {
    enabled: false,
    bindHost: "127.0.0.1",
    port: 4879,
    path: "/agent-discovery/oracle-resolve",
    capability: "oracle.resolve",
    priceWei: "2000000000000000",
    maxQuestionChars: 1024,
    maxContextChars: 8192,
    maxOptions: 16,
  };

export const DEFAULT_AGENT_DISCOVERY_NEWS_FETCH_SERVER_CONFIG: AgentDiscoveryNewsFetchServerConfig =
  {
    enabled: false,
    bindHost: "127.0.0.1",
    port: 4881,
    path: "/agent-discovery/news-fetch",
    capability: "news.fetch",
    priceWei: "3000000000000000",
    maxSourceUrlChars: 2048,
    requestTimeoutMs: 10_000,
    maxResponseBytes: 262144,
    allowPrivateTargets: false,
    maxArticleChars: 12000,
    backendMode: DEFAULT_PROVIDER_BACKEND_MODE,
    skillStages: cloneSkillBackendStages(DEFAULT_NEWS_FETCH_SKILL_STAGES),
    requireSourcePolicyId: false,
    defaultSourcePolicyId: undefined,
    sourcePolicies: [],
    zktlsWorker: null,
  };

export const DEFAULT_AGENT_DISCOVERY_PROOF_VERIFY_SERVER_CONFIG: AgentDiscoveryProofVerifyServerConfig =
  {
    enabled: false,
    bindHost: "127.0.0.1",
    port: 4882,
    path: "/agent-discovery/proof-verify",
    capability: "proof.verify",
    priceWei: "2000000000000000",
    maxPayloadChars: 16384,
    requestTimeoutMs: 10_000,
    maxFetchBytes: 262144,
    allowPrivateTargets: false,
    backendMode: DEFAULT_PROVIDER_BACKEND_MODE,
    skillStages: cloneSkillBackendStages(DEFAULT_PROOF_VERIFY_SKILL_STAGES),
    supportedVerifierClasses: [
      "structural_verification",
      "bundle_integrity_verification",
      "tlsnotary_attestation_verification",
      "m_of_n_consensus_verification",
    ],
    verifierWorker: null,
  };

export const DEFAULT_AGENT_DISCOVERY_STORAGE_SERVER_CONFIG: AgentDiscoveryStorageServerConfig =
  {
    enabled: false,
    bindHost: "127.0.0.1",
    port: 4883,
    path: "/agent-discovery/storage",
    putCapability: "storage.put",
    getCapability: "storage.get",
    putPriceWei: "1000000000000000",
    getPriceWei: "500000000000000",
    maxObjectBytes: 262144,
    storageDir: "~/.openfox/storage-provider",
    defaultTtlSeconds: 86_400,
    maxTtlSeconds: 2_592_000,
    pruneExpiredOnRead: true,
    putBackendMode: DEFAULT_PROVIDER_BACKEND_MODE,
    getBackendMode: DEFAULT_PROVIDER_BACKEND_MODE,
    putSkillStages: cloneSkillBackendStages(DEFAULT_STORAGE_PUT_SKILL_STAGES),
    getSkillStages: cloneSkillBackendStages(DEFAULT_STORAGE_GET_SKILL_STAGES),
  };

export const DEFAULT_AGENT_DISCOVERY_SENTIMENT_ANALYSIS_SERVER_CONFIG: AgentDiscoverySentimentAnalysisServerConfig =
  {
    enabled: false,
    bindHost: "127.0.0.1",
    port: 4884,
    path: "/agent-discovery/sentiment-analyze",
    capability: "sentiment.analyze",
    priceWei: "1500000000000000",
    maxTextChars: 4096,
    requestTimeoutMs: 10_000,
  };

export const DEFAULT_AGENT_GATEWAY_SERVER_CONFIG: AgentGatewayServerConfig = {
  enabled: false,
  bindHost: "127.0.0.1",
  port: 4880,
  sessionPath: "/agent-gateway/session",
  publicPathPrefix: "/a",
  publicBaseUrl: "http://127.0.0.1:4880",
  capability: "gateway.relay",
  mode: "sponsored",
  priceModel: "sponsored",
  sessionTtlSeconds: 3600,
  requestTimeoutMs: 15_000,
  maxRoutesPerSession: 16,
  maxRequestBodyBytes: 131072,
  relayPaymentEnabled: false,
  relayPriceWei: "1000000000000000",
  relayPaymentDescription: "OpenFox gateway relay payment",
  relayPaymentRequiredDeadlineSeconds: 300,
  registerCapabilityOnStartup: false,
  grantCapabilityBit: undefined,
  paymentDirection: "requester_pays",
  sessionFeeWei: "0",
  perRequestFeeWei: "0",
  maxSessions: 200,
  maxBandwidthKbps: 10000,
  supportedTransports: ["wss"],
  latencySloMs: 1000,
  availabilitySlo: "best-effort",
};

export const DEFAULT_AGENT_GATEWAY_FEEDBACK_CONFIG: AgentGatewayFeedbackConfig = {
  enabled: false,
  successDelta: "1",
  failureDelta: "-1",
  timeoutDelta: "-2",
  malformedDelta: "-2",
  gas: "120000",
  reasonPrefix: "agent-gateway",
};

export const DEFAULT_AGENT_GATEWAY_CLIENT_CONFIG: AgentGatewayClientConfig = {
  enabled: false,
  gatewayAgentId: undefined,
  gatewayUrl: undefined,
  gatewayBootnodes: [],
  gatewayBootnodeList: undefined,
  requireSignedBootnodeList: false,
  sessionTtlSeconds: 3600,
  requestTimeoutMs: 15_000,
  maxGatewaySessions: 1,
  enableE2E: false,
  feedback: DEFAULT_AGENT_GATEWAY_FEEDBACK_CONFIG,
  routes: [],
};

export const DEFAULT_AGENT_DISCOVERY_SELECTION_POLICY: AgentDiscoverySelectionPolicy =
  {
    requireRegistered: true,
    excludeSuspended: true,
    onchainCapabilityMode: "off",
    minimumStakeWei: "0",
    minimumReputation: "0",
    preferHigherStake: true,
    preferHigherReputation: true,
  };

export const DEFAULT_AGENT_DISCOVERY_POLICY_PROFILES: AgentDiscoveryPolicyProfiles =
  {
    sponsor: {
      ...DEFAULT_AGENT_DISCOVERY_SELECTION_POLICY,
      minimumStakeWei: "1",
      onchainCapabilityMode: "prefer_onchain",
    },
    observation: {
      ...DEFAULT_AGENT_DISCOVERY_SELECTION_POLICY,
      minimumStakeWei: "1",
      onchainCapabilityMode: "prefer_onchain",
    },
    oracle: {
      ...DEFAULT_AGENT_DISCOVERY_SELECTION_POLICY,
      minimumStakeWei: "1",
      minimumReputation: "1",
      onchainCapabilityMode: "require_onchain",
    },
    news: {
      ...DEFAULT_AGENT_DISCOVERY_SELECTION_POLICY,
      minimumStakeWei: "1",
      minimumReputation: "1",
      onchainCapabilityMode: "prefer_onchain",
    },
    proof: {
      ...DEFAULT_AGENT_DISCOVERY_SELECTION_POLICY,
      minimumStakeWei: "1",
      minimumReputation: "1",
      onchainCapabilityMode: "require_onchain",
    },
    storage: {
      ...DEFAULT_AGENT_DISCOVERY_SELECTION_POLICY,
      minimumStakeWei: "1",
      onchainCapabilityMode: "prefer_onchain",
    },
    gateway: {
      ...DEFAULT_AGENT_DISCOVERY_SELECTION_POLICY,
      minimumStakeWei: "1",
      onchainCapabilityMode: "prefer_onchain",
    },
  };

export const DEFAULT_AGENT_DISCOVERY_REPUTATION_UPDATE_CONFIG: AgentDiscoveryReputationUpdateConfig =
  {
    enabled: false,
    successDelta: "1",
    failureDelta: "-1",
    timeoutDelta: "-2",
    malformedDelta: "-2",
    gas: "120000",
    reasonPrefix: "agent-discovery",
  };

export const DEFAULT_AGENT_DISCOVERY_CONFIG: AgentDiscoveryConfig = {
  enabled: false,
  publishCard: false,
  cardTtlSeconds: 3600,
  endpoints: [],
  capabilities: [],
  directoryNodeRecords: [],
  selectionPolicy: DEFAULT_AGENT_DISCOVERY_SELECTION_POLICY,
  policyProfiles: DEFAULT_AGENT_DISCOVERY_POLICY_PROFILES,
  reputationUpdates: DEFAULT_AGENT_DISCOVERY_REPUTATION_UPDATE_CONFIG,
  faucetServer: DEFAULT_AGENT_DISCOVERY_FAUCET_SERVER_CONFIG,
  observationServer: DEFAULT_AGENT_DISCOVERY_OBSERVATION_SERVER_CONFIG,
  oracleServer: DEFAULT_AGENT_DISCOVERY_ORACLE_SERVER_CONFIG,
  newsFetchServer: DEFAULT_AGENT_DISCOVERY_NEWS_FETCH_SERVER_CONFIG,
  proofVerifyServer: DEFAULT_AGENT_DISCOVERY_PROOF_VERIFY_SERVER_CONFIG,
  storageServer: DEFAULT_AGENT_DISCOVERY_STORAGE_SERVER_CONFIG,
  gatewayServer: DEFAULT_AGENT_GATEWAY_SERVER_CONFIG,
  gatewayClient: DEFAULT_AGENT_GATEWAY_CLIENT_CONFIG,
};

// ─── Configuration ───────────────────────────────────────────────

export interface OpenFoxConfig {
  name: string;
  genesisPrompt: string;
  creatorMessage?: string;
  creatorAddress: HexAddress;
  registeredRemotely: boolean;
  sandboxId: string;
  runtimeApiUrl?: string;
  runtimeApiKey?: string;
  openaiApiKey?: string;
  anthropicApiKey?: string;
  ollamaBaseUrl?: string;
  inferenceModel: string;
  inferenceModelRef?: string;
  maxTokensPerTurn: number;
  heartbeatConfigPath: string;
  dbPath: string;
  logLevel: "debug" | "info" | "warn" | "error";
  walletAddress: HexAddress;
  rpcUrl?: string;
  chainId?: number;
  walletFunding?: WalletFundingConfig;
  version: string;
  skillsDir: string;
  agentId?: string;
  maxChildren: number;
  maxTurnsPerCycle?: number;
  /** 子沙盒内存配置 (MB)，默认 1024 */
  childSandboxMemoryMb?: number;
  parentAddress?: Address;
  socialRelayUrl?: string;
  treasuryPolicy?: TreasuryPolicy;
  // Phase 2 config additions
  soulConfig?: SoulConfig;
  modelStrategy?: ModelStrategyConfig;
  agentDiscovery?: AgentDiscoveryConfig;
  bounty?: BountyConfig;
  opportunityScout?: OpportunityScoutConfig;
  ownerReports?: OwnerReportsConfig;
  settlement?: SettlementConfig;
  marketContracts?: MarketContractConfig;
  x402Server?: X402ServerConfig;
  operatorApi?: OperatorApiConfig;
  operatorAutopilot?: OperatorAutopilotConfig;
  signerProvider?: SignerProviderConfig;
  paymasterProvider?: PaymasterProviderConfig;
  storage?: StorageMarketConfig;
  artifacts?: ArtifactPipelineConfig;
}

export interface WalletFundingConfig {
  localDefaultAmountWei: string;
  localFunderAddress?: HexAddress;
  localFunderPassword?: string;
  testnetDefaultAmountWei: string;
  testnetFaucetUrl?: string;
  testnetReason: string;
}

export type BountyRole = "host" | "solver";
export type BountyKind =
  | "question"
  | "translation"
  | "social_proof"
  | "problem_solving"
  | "public_news_capture"
  | "oracle_evidence_capture"
  | "data_labeling";
export type CampaignStatus =
  | "open"
  | "paused"
  | "exhausted"
  | "completed";
export type BountyStatus =
  | "open"
  | "submitted"
  | "under_review"
  | "approved"
  | "rejected"
  | "paid"
  | "expired";
export type BountySubmissionStatus = "submitted" | "accepted" | "rejected";
export type BountyJudgeMode = "local_model";
export type BountyDecision = "accepted" | "rejected";

export interface BountyPolicy {
  maxSubmissionsPerSolver: number;
  solverCooldownSeconds: number;
  maxAutoPayPerSolverPerDayWei: string;
  trustedProofUrlPrefixes: string[];
}

export interface CampaignRecord {
  campaignId: string;
  hostAgentId: string;
  hostAddress: Address;
  title: string;
  description: string;
  budgetWei: string;
  maxOpenBounties: number;
  allowedKinds: BountyKind[];
  metadata?: Record<string, unknown>;
  status: CampaignStatus;
  createdAt: string;
  updatedAt: string;
}

export interface CampaignCreateInput {
  title: string;
  description: string;
  budgetWei: string;
  maxOpenBounties?: number;
  allowedKinds?: BountyKind[];
  metadata?: Record<string, unknown>;
}

export interface CampaignProgress {
  totalBudgetWei: string;
  allocatedWei: string;
  remainingWei: string;
  bountyCount: number;
  openBountyCount: number;
  paidBountyCount: number;
  submissionCount: number;
}

export interface BountyConfig {
  enabled: boolean;
  role: BountyRole;
  skill: string;
  defaultKind: BountyKind;
  bindHost: string;
  port: number;
  pathPrefix: string;
  remoteBaseUrl?: string;
  discoveryCapability: string;
  rewardWei: string;
  autoPayConfidenceThreshold: number;
  defaultSubmissionTtlSeconds: number;
  pollIntervalSeconds: number;
  maxOpenBounties: number;
  judgeMode: BountyJudgeMode;
  autoOpenOnStartup: boolean;
  autoOpenWhenIdle: boolean;
  autoSolveOnStartup: boolean;
  autoSolveEnabled: boolean;
  openingPrompt?: string;
  policy: BountyPolicy;
}

export interface BountyRecord {
  bountyId: string;
  campaignId?: string | null;
  hostAgentId: string;
  hostAddress: Address;
  kind: BountyKind;
  title: string;
  taskPrompt: string;
  referenceOutput: string;
  skillName?: string | null;
  metadata?: Record<string, unknown>;
  policy?: BountyPolicy;
  rewardWei: string;
  submissionDeadline: string;
  judgeMode: BountyJudgeMode;
  status: BountyStatus;
  createdAt: string;
  updatedAt: string;
}

export interface BountySubmissionRecord {
  submissionId: string;
  bountyId: string;
  solverAgentId?: string | null;
  solverAddress: Address;
  submissionText: string;
  proofUrl?: string | null;
  metadata?: Record<string, unknown>;
  status: BountySubmissionStatus;
  submittedAt: string;
  updatedAt: string;
}

export interface BountyResultRecord {
  bountyId: string;
  winningSubmissionId?: string | null;
  decision: BountyDecision;
  confidence: number;
  judgeReason: string;
  payoutTxHash?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BountyJudgeResult {
  decision: BountyDecision;
  confidence: number;
  reason: string;
}

export interface BountyCreateInput {
  campaignId?: string | null;
  kind: BountyKind;
  title: string;
  taskPrompt: string;
  referenceOutput: string;
  rewardWei: string;
  submissionDeadline: string;
  skillName?: string | null;
  metadata?: Record<string, unknown>;
  policy?: Partial<BountyPolicy>;
}

export interface BountySubmissionInput {
  bountyId: string;
  solverAgentId?: string | null;
  solverAddress: Address;
  submissionText: string;
  proofUrl?: string | null;
  metadata?: Record<string, unknown>;
}

export interface OpportunityScoutConfig {
  enabled: boolean;
  discoveryCapabilities: string[];
  remoteBaseUrls: string[];
  maxItems: number;
  minRewardWei: string;
}

export type OpportunityKind = "bounty" | "campaign" | "provider";

export type OpportunityProviderClass =
  | "task_market"
  | "observation"
  | "oracle"
  | "sponsored_execution"
  | "storage_artifacts"
  | "general_provider";

export type OpportunityTrustTier =
  | "self_hosted"
  | "org_trusted"
  | "public_low_trust"
  | "unknown";

export type OpportunityAutomationLevel =
  | "manual"
  | "assisted"
  | "bounded_auto";

export type OpportunityReportCadence = "on_demand" | "daily" | "weekly";

export interface OpportunityStrategyProfile {
  profileId: string;
  name: string;
  revenueTargetWei: string;
  maxSpendPerOpportunityWei: string;
  minMarginBps: number;
  enabledOpportunityKinds: OpportunityKind[];
  enabledProviderClasses: OpportunityProviderClass[];
  allowedTrustTiers: OpportunityTrustTier[];
  automationLevel: OpportunityAutomationLevel;
  reportCadence: OpportunityReportCadence;
  maxDeadlineHours: number;
  createdAt: string;
  updatedAt: string;
}

export type OwnerReportPeriodKind = "daily" | "weekly";
export type OwnerReportChannel = "web" | "email";
export type OwnerReportGenerationStatus = "generated" | "deterministic_only";
export type OwnerReportDeliveryStatus =
  | "pending"
  | "delivered"
  | "failed";
export type OwnerOpportunityAlertStatus = "unread" | "read" | "dismissed";
export type OwnerOpportunityActionKind = "review" | "pursue" | "delegate";
export type OwnerFinanceAttributionKind =
  | "x402_revenue"
  | "x402_cost"
  | "bounty_reward"
  | "bounty_payout"
  | "operating_cost";

export interface OwnerFinanceAttributionEntry {
  attributionId: string;
  kind: OwnerFinanceAttributionKind;
  title: string;
  amountWei: string;
  amountCents?: number;
  sourceId?: string | null;
  sourceKind?: string | null;
  counterparty?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface OwnerFinanceSnapshotData {
  snapshotId: string;
  periodKind: OwnerReportPeriodKind;
  periodStart: string;
  periodEnd: string;
  generatedAt: string;
  address: Address;
  realizedRevenueWei: string;
  realizedCostWei: string;
  realizedNetWei: string;
  pendingReceivablesWei: string;
  pendingPayablesWei: string;
  pendingNetWei: string;
  revenueEvents: number;
  costEvents: number;
  inferenceCostCents: number;
  spendCostCents: number;
  operatingCostCents: number;
  retryableFailedItems: number;
  pendingOnchainTransactions: number;
  failedOnchainTransactions: number;
  majorCategories: {
    x402RevenueWei: string;
    bountySolverRewardsWei: string;
    x402CostWei: string;
    bountyHostPayoutsWei: string;
  };
  topGains: OwnerFinanceAttributionEntry[];
  topLosses: OwnerFinanceAttributionEntry[];
  anomalies: string[];
  summary: string;
}

export interface OwnerFinanceSnapshotRecord {
  snapshotId: string;
  periodKind: OwnerReportPeriodKind;
  periodStart: string;
  periodEnd: string;
  payload: OwnerFinanceSnapshotData;
  createdAt: string;
  updatedAt: string;
}

export interface OwnerReportInput {
  generatedAt: string;
  periodKind: OwnerReportPeriodKind;
  finance: OwnerFinanceSnapshotData;
  strategy: OpportunityStrategyProfile | null;
  strategyExecution: OwnerStrategyExecutionSummary;
  evidenceOracle:
    | {
        evidence: {
          totalRuns: number;
          completedRuns: number;
          failedRuns: number;
          validSources: number;
          attemptedSources: number;
          aggregatePublished: number;
          estimatedCostWei: string;
          zktlsBundles?: number;
          proofVerifications?: number;
          nativeAttestedVerifications?: number;
          committeeVerifiedResults?: number;
          fallbackOnlyVerifications?: number;
          committeeRuns?: number;
          committeeQuorumMet?: number;
          summary: string;
        };
        oracle: {
          totalResults: number;
          queryKinds: Record<string, number>;
          settledResults: number;
          marketBoundResults: number;
          averageConfidence: number;
          estimatedCostWei: string;
          committeeRuns?: number;
          committeeQuorumMet?: number;
          committeeDisagreements?: number;
          committeePayoutWei?: string;
          summary: string;
        };
        summary: string;
      }
    | null;
  opportunities: Array<Record<string, unknown>>;
}

export interface OwnerGeneratedNarrative {
  overview: string;
  gains: string;
  losses: string;
  opportunityDigest: string;
  anomalies: string;
  recommendations: string[];
}

export interface OwnerReportData {
  reportId: string;
  periodKind: OwnerReportPeriodKind;
  financeSnapshotId: string;
  generatedAt: string;
  generationStatus: OwnerReportGenerationStatus;
  inputHash: Hex;
  provider: string | null;
  model: string | null;
  input: OwnerReportInput;
  narrative: OwnerGeneratedNarrative | null;
}

export interface OwnerReportRecord {
  reportId: string;
  periodKind: OwnerReportPeriodKind;
  financeSnapshotId: string;
  provider?: string | null;
  model?: string | null;
  inputHash: Hex;
  generationStatus: OwnerReportGenerationStatus;
  payload: OwnerReportData;
  createdAt: string;
  updatedAt: string;
}

export interface OwnerReportDeliveryRecord {
  deliveryId: string;
  reportId: string;
  channel: OwnerReportChannel;
  status: OwnerReportDeliveryStatus;
  target: string;
  renderedPath?: string | null;
  metadata?: Record<string, unknown> | null;
  lastError?: string | null;
  deliveredAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface OwnerOpportunityAlertRecord {
  alertId: string;
  opportunityHash: Hex;
  kind: OpportunityKind;
  providerClass: OpportunityProviderClass;
  trustTier: OpportunityTrustTier;
  title: string;
  summary: string;
  suggestedAction: string;
  capability?: string | null;
  baseUrl?: string | null;
  rewardWei?: string | null;
  estimatedCostWei: string;
  marginWei: string;
  marginBps: number;
  strategyScore?: number | null;
  strategyMatched: boolean;
  strategyReasons: string[];
  payload: Record<string, unknown>;
  status: OwnerOpportunityAlertStatus;
  actionKind?: OwnerOpportunityActionKind | null;
  actionRequestId?: string | null;
  actionRequestedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  readAt?: string | null;
  dismissedAt?: string | null;
}

export type OwnerOpportunityActionStatus =
  | "queued"
  | "completed"
  | "cancelled";

export type OwnerOpportunityActionExecutionStatus =
  | "running"
  | "completed"
  | "failed"
  | "skipped";

export type OwnerOpportunityActionExecutionKind =
  | "remote_bounty_solve"
  | "remote_campaign_solve"
  | "remote_observation_request"
  | "remote_oracle_request";

export type OwnerOpportunityActionResolutionKind =
  | "note"
  | "bounty"
  | "campaign"
  | "provider_call"
  | "artifact"
  | "report"
  | "other";

export interface OwnerOpportunityExecutionTemplate {
  executionCapable: boolean;
  ready: boolean;
  actionKind: OwnerOpportunityActionKind;
  executionKind?: OwnerOpportunityActionExecutionKind;
  targetKind?: "bounty" | "campaign" | "provider";
  targetRef?: string | null;
  capability?: string | null;
  remoteBaseUrl?: string | null;
  reason?: string | null;
  followUpEligible: boolean;
  requiresOperatorInput: boolean;
  inputHint?: string | null;
}

export interface OwnerOpportunityActionRecord {
  actionId: string;
  alertId: string;
  requestId: string;
  kind: OwnerOpportunityActionKind;
  title: string;
  summary: string;
  capability?: string | null;
  baseUrl?: string | null;
  requestedBy: string;
  approvedBy?: string | null;
  approvedAt?: string | null;
  decisionNote?: string | null;
  payload: Record<string, unknown>;
  status: OwnerOpportunityActionStatus;
  resolutionKind?: OwnerOpportunityActionResolutionKind | null;
  resolutionRef?: string | null;
  resolutionNote?: string | null;
  queuedAt: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string | null;
  cancelledAt?: string | null;
}

export interface OwnerOpportunityActionExecutionRecord {
  executionId: string;
  actionId: string;
  kind: OwnerOpportunityActionExecutionKind;
  targetKind: "bounty" | "campaign" | "provider";
  targetRef: string;
  remoteBaseUrl: string;
  status: OwnerOpportunityActionExecutionStatus;
  requestPayload: Record<string, unknown>;
  resultPayload?: Record<string, unknown> | null;
  executionRef?: string | null;
  errorMessage?: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt?: string | null;
  failedAt?: string | null;
}

export interface OwnerStrategyExecutionSummary {
  autoExecutePursue: boolean;
  autoExecuteDelegate: boolean;
  autoQueueFollowUps: boolean;
  maxFollowUpDepth: number;
  maxFollowUpsPerRun: number;
  queuedActions: number;
  runningExecutions: number;
  recentActions: Array<Record<string, unknown>>;
  recentExecutions: Array<Record<string, unknown>>;
  recentFollowUpActions: number;
  queuedFollowUpActions: number;
  recentFollowUpExecutions: number;
}

export interface OwnerReportWebConfig {
  enabled: boolean;
  bindHost: string;
  port: number;
  pathPrefix: string;
  authToken?: string;
  outputDir: string;
}

export interface OwnerReportEmailConfig {
  enabled: boolean;
  mode: "outbox" | "sendmail";
  from: string;
  to: string;
  outboxDir: string;
  sendmailPath: string;
}

export interface OwnerReportScheduleConfig {
  enabled: boolean;
  morningHourUtc: number;
  endOfDayHourUtc: number;
  weeklyDayUtc: number;
  weeklyHourUtc: number;
  anomalyDeliveryEnabled: boolean;
}

export interface OwnerOpportunityAlertsConfig {
  enabled: boolean;
  minStrategyScore: number;
  minMarginBps: number;
  maxItemsPerRun: number;
  requireStrategyMatched: boolean;
  dedupeHours: number;
}

export interface OwnerOpportunityActionExecutionConfig {
  enabled: boolean;
  autoExecutePursue: boolean;
  autoExecuteDelegate: boolean;
  autoQueueFollowUps: boolean;
  maxFollowUpDepth: number;
  maxFollowUpsPerRun: number;
  maxExecutionsPerRun: number;
  executionCooldownSeconds: number;
}

export interface OwnerReportsConfig {
  enabled: boolean;
  generateWithInference: boolean;
  persistSnapshots: boolean;
  autoDeliverChannels: OwnerReportChannel[];
  web: OwnerReportWebConfig;
  email: OwnerReportEmailConfig;
  schedule: OwnerReportScheduleConfig;
  alerts?: OwnerOpportunityAlertsConfig;
  actionExecution?: OwnerOpportunityActionExecutionConfig;
}

export interface OperatorApiConfig {
  enabled: boolean;
  bindHost: string;
  port: number;
  pathPrefix: string;
  authToken?: string;
  exposeDoctor: boolean;
  exposeServiceStatus: boolean;
}

export type OperatorControlAction =
  | "pause"
  | "resume"
  | "drain"
  | "maintain_storage"
  | "maintain_artifacts"
  | "quarantine_provider"
  | "retry_payments"
  | "retry_settlement"
  | "retry_market"
  | "retry_signer"
  | "retry_paymaster";

export type OperatorControlEventStatus = "applied" | "noop" | "failed";

export interface OperatorControlEventRecord {
  eventId: string;
  action: OperatorControlAction;
  status: OperatorControlEventStatus;
  actor: string;
  reason?: string | null;
  summary?: string | null;
  result?: unknown;
  createdAt: string;
}

export type OperatorApprovalKind =
  | "treasury_policy_change"
  | "spend_cap_change"
  | "signer_policy_change"
  | "paymaster_policy_change"
  | "opportunity_action";

export type OperatorApprovalStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "expired";

export interface OperatorApprovalRequestRecord {
  requestId: string;
  kind: OperatorApprovalKind;
  scope: string;
  requestedBy: string;
  reason?: string | null;
  payload?: unknown;
  status: OperatorApprovalStatus;
  expiresAt?: string | null;
  createdAt: string;
  decidedAt?: string | null;
  decidedBy?: string | null;
  decisionNote?: string | null;
}

export interface OperatorAutopilotQueuePolicy {
  enabled: boolean;
  pendingThreshold: number;
  limit: number;
  cooldownSeconds: number;
}

export interface OperatorAutopilotMaintenancePolicy {
  enabled: boolean;
  triggerThreshold: number;
  limit: number;
  cooldownSeconds: number;
}

export interface OperatorAutopilotProviderPolicy {
  enabled: boolean;
  quarantineScoreThreshold: number;
  quarantineMinEvents: number;
  maxProvidersPerRun: number;
  cooldownSeconds: number;
}

export interface OperatorAutopilotApprovalPolicy {
  enabled: boolean;
  defaultTtlSeconds: number;
}

export interface OperatorAutopilotConfig {
  enabled: boolean;
  queuePolicies: {
    payments: OperatorAutopilotQueuePolicy;
    settlement: OperatorAutopilotQueuePolicy;
    market: OperatorAutopilotQueuePolicy;
    signer: OperatorAutopilotQueuePolicy;
    paymaster: OperatorAutopilotQueuePolicy;
  };
  storageMaintenance: OperatorAutopilotMaintenancePolicy;
  artifactMaintenance: OperatorAutopilotMaintenancePolicy;
  providerQuarantine: OperatorAutopilotProviderPolicy;
  approvals: OperatorAutopilotApprovalPolicy;
}

export type SignerProviderTrustTier =
  | "self_hosted"
  | "org_trusted"
  | "public_low_trust";

export interface SignerProviderPolicyConfig {
  trustTier: SignerProviderTrustTier;
  walletAddress?: Address;
  policyId: string;
  delegateIdentity?: string;
  allowedTargets: Address[];
  allowedFunctionSelectors: Hex[];
  maxValueWei: string;
  expiresAt?: string;
  allowSystemAction?: boolean;
}

export interface SignerProviderConfig {
  enabled: boolean;
  bindHost: string;
  port: number;
  pathPrefix: string;
  capabilityPrefix: string;
  publishToDiscovery: boolean;
  quoteValiditySeconds: number;
  quotePriceWei: string;
  submitPriceWei: string;
  requestTimeoutMs: number;
  maxDataBytes: number;
  defaultGas: string;
  policy: SignerProviderPolicyConfig;
}

export type SignerQuoteStatus = "quoted" | "used" | "expired";
export type SignerExecutionStatus =
  | "pending"
  | "submitted"
  | "confirmed"
  | "failed"
  | "rejected";

export interface SignerQuoteRecord {
  quoteId: string;
  providerAddress: Address;
  walletAddress: Address;
  requesterAddress: Address;
  targetAddress: Address;
  valueWei: string;
  dataHex: Hex;
  gas: string;
  policyId: string;
  policyHash: Hex;
  scopeHash: Hex;
  delegateIdentity?: string | null;
  trustTier: SignerProviderTrustTier;
  amountWei: string;
  status: SignerQuoteStatus;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface SignerExecutionRecord {
  executionId: string;
  quoteId: string;
  requestKey: string;
  requestHash: Hex;
  providerAddress: Address;
  walletAddress: Address;
  requesterAddress: Address;
  targetAddress: Address;
  valueWei: string;
  dataHex: Hex;
  gas: string;
  policyId: string;
  policyHash: Hex;
  scopeHash: Hex;
  delegateIdentity?: string | null;
  trustTier: SignerProviderTrustTier;
  requestNonce: string;
  requestExpiresAt: number;
  reason?: string | null;
  paymentId?: Hex | null;
  submittedTxHash?: Hex | null;
  submittedReceipt?: Record<string, unknown> | null;
  receiptHash?: Hex | null;
  status: SignerExecutionStatus;
  lastError?: string | null;
  createdAt: string;
  updatedAt: string;
}

export type PaymasterProviderTrustTier = SignerProviderTrustTier;

export interface PaymasterProviderPolicyConfig {
  trustTier: PaymasterProviderTrustTier;
  sponsorAddress?: Address;
  policyId: string;
  delegateIdentity?: string;
  allowedWallets: Address[];
  allowedTargets: Address[];
  allowedFunctionSelectors: Hex[];
  maxValueWei: string;
  expiresAt?: string;
  allowSystemAction?: boolean;
}

export interface PaymasterProviderConfig {
  enabled: boolean;
  bindHost: string;
  port: number;
  pathPrefix: string;
  capabilityPrefix: string;
  publishToDiscovery: boolean;
  quoteValiditySeconds: number;
  authorizationValiditySeconds: number;
  quotePriceWei: string;
  authorizePriceWei: string;
  requestTimeoutMs: number;
  maxDataBytes: number;
  defaultGas: string;
  policy: PaymasterProviderPolicyConfig;
}

export type PaymasterQuoteStatus = "quoted" | "used" | "expired";
export type PaymasterAuthorizationStatus =
  | "authorized"
  | "submitted"
  | "confirmed"
  | "failed"
  | "rejected"
  | "expired";

export interface PaymasterQuoteRecord {
  quoteId: string;
  chainId: string;
  providerAddress: Address;
  sponsorAddress: Address;
  sponsorSignerType: string;
  walletAddress: Address;
  requesterAddress: Address;
  requesterSignerType: string;
  targetAddress: Address;
  valueWei: string;
  dataHex: Hex;
  gas: string;
  policyId: string;
  policyHash: Hex;
  scopeHash: Hex;
  delegateIdentity?: string | null;
  trustTier: PaymasterProviderTrustTier;
  amountWei: string;
  sponsorNonce: string;
  sponsorExpiry: number;
  status: PaymasterQuoteStatus;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface PaymasterAuthorizationRecord {
  authorizationId: string;
  quoteId: string;
  chainId: string;
  requestKey: string;
  requestHash: Hex;
  providerAddress: Address;
  sponsorAddress: Address;
  sponsorSignerType: string;
  walletAddress: Address;
  requesterAddress: Address;
  requesterSignerType: string;
  targetAddress: Address;
  valueWei: string;
  dataHex: Hex;
  gas: string;
  policyId: string;
  policyHash: Hex;
  scopeHash: Hex;
  delegateIdentity?: string | null;
  trustTier: PaymasterProviderTrustTier;
  requestNonce: string;
  requestExpiresAt: number;
  executionNonce: string;
  sponsorNonce: string;
  sponsorExpiry: number;
  reason?: string | null;
  paymentId?: Hex | null;
  executionSignature?: Signature | null;
  sponsorSignature?: Signature | null;
  submittedTxHash?: Hex | null;
  submittedReceipt?: Record<string, unknown> | null;
  receiptHash?: Hex | null;
  status: PaymasterAuthorizationStatus;
  lastError?: string | null;
  createdAt: string;
  updatedAt: string;
}

export type StorageLeaseStatus = "quoted" | "active" | "expired" | "released";
export type StorageAuditStatus = "verified" | "failed";
export type ArtifactRecordStatus = "stored" | "verified" | "anchored" | "failed";

export interface StorageAnchorConfig {
  enabled: boolean;
  sinkAddress?: Address;
  gas: string;
  waitForReceipt: boolean;
  receiptTimeoutMs: number;
}

export interface StorageLeaseHealthConfig {
  autoAudit: boolean;
  auditIntervalSeconds: number;
  autoRenew: boolean;
  renewalLeadSeconds: number;
  autoReplicate: boolean;
}

export interface StorageReplicationConfig {
  enabled: boolean;
  targetCopies: number;
  providerBaseUrls: string[];
}

export interface StorageMarketConfig {
  enabled: boolean;
  bindHost: string;
  port: number;
  pathPrefix: string;
  capabilityPrefix: string;
  storageDir: string;
  quoteValiditySeconds: number;
  defaultTtlSeconds: number;
  maxTtlSeconds: number;
  maxBundleBytes: number;
  minimumPriceWei: string;
  pricePerMiBWei: string;
  publishToDiscovery: boolean;
  allowAnonymousGet: boolean;
  leaseHealth: StorageLeaseHealthConfig;
  replication: StorageReplicationConfig;
  anchor: StorageAnchorConfig;
}

export interface StorageQuoteRecord {
  quoteId: string;
  requesterAddress: Address;
  providerAddress: Address;
  cid: string;
  bundleKind: string;
  sizeBytes: number;
  ttlSeconds: number;
  amountWei: string;
  status: "quoted" | "used" | "expired";
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface StorageLeaseRecord {
  leaseId: string;
  quoteId?: string | null;
  cid: string;
  bundleHash: Hex;
  bundleKind: string;
  requesterAddress: Address;
  providerAddress: Address;
  providerBaseUrl?: string | null;
  sizeBytes: number;
  ttlSeconds: number;
  amountWei: string;
  status: StorageLeaseStatus;
  storagePath: string;
  requestKey: string;
  paymentId?: Hex | null;
  receipt: StorageReceipt;
  receiptHash: Hex;
  anchorTxHash?: Hex | null;
  anchorReceipt?: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export interface StorageRenewalRecord {
  renewalId: string;
  leaseId: string;
  cid: string;
  requesterAddress: Address;
  providerAddress: Address;
  providerBaseUrl?: string | null;
  previousExpiresAt: string;
  renewedExpiresAt: string;
  addedTtlSeconds: number;
  amountWei: string;
  paymentId?: Hex | null;
  receipt: StorageReceipt;
  receiptHash: Hex;
  createdAt: string;
  updatedAt: string;
}

export interface StorageAuditRecord {
  auditId: string;
  leaseId: string;
  cid: string;
  status: StorageAuditStatus;
  challengeNonce: string;
  responseHash: Hex;
  details?: Record<string, unknown> | null;
  checkedAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface StorageAnchorRecord {
  anchorId: string;
  leaseId: string;
  summary: StorageAnchorSummary;
  summaryHash: Hex;
  anchorTxHash?: Hex | null;
  anchorReceipt?: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export interface ArtifactAnchorConfig {
  enabled: boolean;
  sinkAddress?: Address;
  gas: string;
  waitForReceipt: boolean;
  receiptTimeoutMs: number;
}

export interface ArtifactCaptureServerConfig {
  enabled: boolean;
  bindHost: string;
  port: number;
  pathPrefix: string;
  requireNativeIdentity: boolean;
  maxBodyBytes: number;
  maxTextChars: number;
}

export interface ArtifactPipelineConfig {
  enabled: boolean;
  publishToDiscovery: boolean;
  defaultProviderBaseUrl?: string;
  defaultTtlSeconds: number;
  autoAnchorOnStore: boolean;
  captureCapability: string;
  evidenceCapability: string;
  aggregateCapability: string;
  verificationCapability: string;
  service: ArtifactCaptureServerConfig;
  anchor: ArtifactAnchorConfig;
}

export interface ArtifactRecord {
  artifactId: string;
  kind: ArtifactBundleKind;
  title: string;
  leaseId: string;
  quoteId?: string | null;
  cid: string;
  bundleHash: Hex;
  providerBaseUrl: string;
  providerAddress: Address;
  requesterAddress: Address;
  sourceUrl?: string | null;
  subjectId?: string | null;
  summaryText?: string | null;
  resultDigest?: Hex | null;
  metadata?: Record<string, unknown> | null;
  status: ArtifactRecordStatus;
  verificationId?: string | null;
  anchorId?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ArtifactSearchFilters {
  kind?: ArtifactBundleKind;
  status?: ArtifactRecordStatus;
  query?: string;
  sourceUrlPrefix?: string;
  subjectContains?: string;
  anchoredOnly?: boolean;
  verifiedOnly?: boolean;
}

export interface ArtifactVerificationRecord {
  verificationId: string;
  artifactId: string;
  receipt: ArtifactVerificationReceipt;
  receiptHash: Hex;
  createdAt: string;
  updatedAt: string;
}

export interface ArtifactAnchorRecord {
  anchorId: string;
  artifactId: string;
  summary: ArtifactAnchorSummary;
  summaryHash: Hex;
  anchorTxHash?: Hex | null;
  anchorReceipt?: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export type ExecutionTrailSubjectKind =
  | "storage_lease"
  | "storage_renewal"
  | "storage_audit"
  | "storage_anchor"
  | "artifact"
  | "artifact_verification"
  | "artifact_anchor";

export type ExecutionTrailExecutionKind =
  | "signer_execution"
  | "paymaster_authorization";

export type ExecutionTrailLinkMode = "direct" | "derived";

export interface ExecutionTrailRecord {
  trailId: string;
  subjectKind: ExecutionTrailSubjectKind;
  subjectId: string;
  executionKind: ExecutionTrailExecutionKind;
  executionRecordId: string;
  executionTxHash?: Hex | null;
  executionReceiptHash?: Hex | null;
  linkMode: ExecutionTrailLinkMode;
  sourceSubjectKind?: ExecutionTrailSubjectKind | null;
  sourceSubjectId?: string | null;
  metadata?: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export type SettlementKind = NativeSettlementKind;
export type MarketBindingKind = NativeMarketBindingKind;

export interface SettlementConfig {
  enabled: boolean;
  sinkAddress?: Address;
  gas: string;
  waitForReceipt: boolean;
  receiptTimeoutMs: number;
  publishBounties: boolean;
  publishObservations: boolean;
  publishOracleResults: boolean;
  callbacks: SettlementCallbackConfig;
}

export interface SettlementRecord {
  receiptId: string;
  kind: SettlementKind;
  subjectId: string;
  receipt: SettlementReceipt;
  receiptHash: Hex;
  artifactUrl?: string | null;
  paymentTxHash?: Hex | null;
  payoutTxHash?: Hex | null;
  settlementTxHash?: Hex | null;
  settlementReceipt?: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export type SettlementCallbackPayloadMode =
  | "canonical_receipt"
  | "receipt_hash";
export type SettlementCallbackStatus = "pending" | "confirmed" | "failed";

export interface SettlementCallbackTargetConfig {
  enabled: boolean;
  contractAddress?: Address;
  gas: string;
  valueWei: string;
  waitForReceipt: boolean;
  receiptTimeoutMs: number;
  payloadMode: SettlementCallbackPayloadMode;
  prefixHex?: Hex;
  maxAttempts: number;
}

export interface SettlementCallbackConfig {
  enabled: boolean;
  retryBatchSize: number;
  retryAfterSeconds: number;
  bounty: SettlementCallbackTargetConfig;
  observation: SettlementCallbackTargetConfig;
  oracle: SettlementCallbackTargetConfig;
}

export interface SettlementCallbackRecord {
  callbackId: string;
  receiptId: string;
  kind: SettlementKind;
  subjectId: string;
  contractAddress: Address;
  payloadMode: SettlementCallbackPayloadMode;
  payloadHex: Hex;
  payloadHash: Hex;
  status: SettlementCallbackStatus;
  attemptCount: number;
  maxAttempts: number;
  callbackTxHash?: Hex | null;
  callbackReceipt?: Record<string, unknown> | null;
  lastError?: string | null;
  nextAttemptAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export type MarketContractPayloadMode =
  | "canonical_binding"
  | "binding_hash";
export type MarketContractStatus = "pending" | "confirmed" | "failed";

export interface MarketContractTargetConfig {
  enabled: boolean;
  contractAddress?: Address;
  packageName?: string;
  functionSignature?: string;
  gas: string;
  valueWei: string;
  waitForReceipt: boolean;
  receiptTimeoutMs: number;
  payloadMode: MarketContractPayloadMode;
  maxAttempts: number;
}

export interface MarketContractConfig {
  enabled: boolean;
  retryBatchSize: number;
  retryAfterSeconds: number;
  bounty: MarketContractTargetConfig;
  observation: MarketContractTargetConfig;
  oracle: MarketContractTargetConfig;
}

export interface MarketBindingRecord {
  bindingId: string;
  kind: MarketBindingKind;
  subjectId: string;
  receipt: MarketBindingReceipt;
  receiptHash: Hex;
  callbackTarget?: Address | null;
  callbackTxHash?: Hex | null;
  callbackReceipt?: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export interface MarketContractCallbackRecord {
  callbackId: string;
  bindingId: string;
  kind: MarketBindingKind;
  subjectId: string;
  contractAddress: Address;
  packageName: string;
  functionSignature: string;
  payloadMode: MarketContractPayloadMode;
  payloadHex: Hex;
  payloadHash: Hex;
  status: MarketContractStatus;
  attemptCount: number;
  maxAttempts: number;
  callbackTxHash?: Hex | null;
  callbackReceipt?: Record<string, unknown> | null;
  lastError?: string | null;
  nextAttemptAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export type X402PaymentServiceKind =
  | "observation"
  | "oracle"
  | "sentiment"
  | "signer"
  | "paymaster"
  | "storage"
  | "gateway_request"
  | "gateway_session";
export type X402ConfirmationPolicy = "broadcast" | "receipt";
export type X402PaymentStatus =
  | "verified"
  | "submitted"
  | "confirmed"
  | "failed"
  | "replaced";

export interface X402ServerConfig {
  enabled: boolean;
  confirmationPolicy: X402ConfirmationPolicy;
  receiptTimeoutMs: number;
  receiptPollIntervalMs: number;
  retryBatchSize: number;
  retryAfterSeconds: number;
  maxAttempts: number;
}

export interface X402PaymentRecord {
  paymentId: Hex;
  serviceKind: X402PaymentServiceKind;
  requestKey: string;
  requestHash: Hex;
  payerAddress: Address;
  providerAddress: Address;
  chainId: string;
  txNonce: string;
  txHash: Hex;
  rawTransaction: Hex;
  amountWei: string;
  confirmationPolicy: X402ConfirmationPolicy;
  status: X402PaymentStatus;
  attemptCount: number;
  maxAttempts: number;
  receipt?: Record<string, unknown> | null;
  lastError?: string | null;
  nextAttemptAt?: string | null;
  boundKind?: string | null;
  boundSubjectId?: string | null;
  artifactUrl?: string | null;
  createdAt: string;
  updatedAt: string;
}

export const DEFAULT_STORAGE_MARKET_CONFIG: StorageMarketConfig = {
  enabled: false,
  bindHost: "127.0.0.1",
  port: 4895,
  pathPrefix: "/storage",
  capabilityPrefix: "storage.ipfs",
  storageDir: "~/.openfox/storage",
  quoteValiditySeconds: 300,
  defaultTtlSeconds: 86400,
  maxTtlSeconds: 2592000,
  maxBundleBytes: 8 * 1024 * 1024,
  minimumPriceWei: "1000000000000000",
  pricePerMiBWei: "1000000000000000",
  publishToDiscovery: true,
  allowAnonymousGet: true,
  leaseHealth: {
    autoAudit: true,
    auditIntervalSeconds: 6 * 60 * 60,
    autoRenew: true,
    renewalLeadSeconds: 6 * 60 * 60,
    autoReplicate: false,
  },
  replication: {
    enabled: false,
    targetCopies: 1,
    providerBaseUrls: [],
  },
  anchor: {
    enabled: false,
    sinkAddress: undefined,
    gas: "180000",
    waitForReceipt: true,
    receiptTimeoutMs: 60000,
  },
};

export const DEFAULT_ARTIFACT_PIPELINE_CONFIG: ArtifactPipelineConfig = {
  enabled: false,
  publishToDiscovery: true,
  defaultProviderBaseUrl: undefined,
  defaultTtlSeconds: 7 * 24 * 60 * 60,
  autoAnchorOnStore: false,
  captureCapability: "public_news.capture",
  evidenceCapability: "oracle.evidence",
  aggregateCapability: "oracle.aggregate",
  verificationCapability: "artifact.verify",
  service: {
    enabled: false,
    bindHost: "127.0.0.1",
    port: 4896,
    pathPrefix: "/artifacts",
    requireNativeIdentity: true,
    maxBodyBytes: 256 * 1024,
    maxTextChars: 32 * 1024,
  },
  anchor: {
    enabled: false,
    sinkAddress: undefined,
    gas: "180000",
    waitForReceipt: true,
    receiptTimeoutMs: 60000,
  },
};

export const DEFAULT_BOUNTY_POLICY: BountyPolicy = {
  maxSubmissionsPerSolver: 1,
  solverCooldownSeconds: 3600,
  maxAutoPayPerSolverPerDayWei: "1000000000000000000",
  trustedProofUrlPrefixes: [
    "https://x.com/",
    "https://twitter.com/",
    "https://www.x.com/",
    "https://www.twitter.com/",
  ],
};

export const DEFAULT_BOUNTY_CONFIG: BountyConfig = {
  enabled: false,
  role: "host",
  skill: "question-bounty-host",
  defaultKind: "question",
  bindHost: "127.0.0.1",
  port: 4891,
  pathPrefix: "/bounty",
  remoteBaseUrl: undefined,
  discoveryCapability: "task.submit",
  rewardWei: "10000000000000000",
  autoPayConfidenceThreshold: 0.9,
  defaultSubmissionTtlSeconds: 3600,
  pollIntervalSeconds: 30,
  maxOpenBounties: 10,
  judgeMode: "local_model",
  autoOpenOnStartup: false,
  autoOpenWhenIdle: false,
  autoSolveOnStartup: false,
  autoSolveEnabled: false,
  policy: DEFAULT_BOUNTY_POLICY,
};

export const DEFAULT_OPPORTUNITY_SCOUT_CONFIG: OpportunityScoutConfig = {
  enabled: false,
  discoveryCapabilities: [
    "task.submit",
    "task.solve",
    "sponsor.topup.testnet",
    "observation.once",
    "public_news.capture",
    "oracle.evidence",
  ],
  remoteBaseUrls: [],
  maxItems: 25,
  minRewardWei: "0",
};

export const DEFAULT_OWNER_REPORTS_CONFIG: OwnerReportsConfig = {
  enabled: false,
  generateWithInference: true,
  persistSnapshots: true,
  autoDeliverChannels: ["web"],
  web: {
    enabled: false,
    bindHost: "127.0.0.1",
    port: 4904,
    pathPrefix: "/owner",
    authToken: undefined,
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
    enabled: false,
    morningHourUtc: 8,
    endOfDayHourUtc: 18,
    weeklyDayUtc: 1,
    weeklyHourUtc: 8,
    anomalyDeliveryEnabled: true,
  },
  alerts: {
    enabled: false,
    minStrategyScore: 1000,
    minMarginBps: 500,
    maxItemsPerRun: 5,
    requireStrategyMatched: true,
    dedupeHours: 24,
  },
  actionExecution: {
    enabled: false,
    autoExecutePursue: true,
    autoExecuteDelegate: false,
    autoQueueFollowUps: false,
    maxFollowUpDepth: 2,
    maxFollowUpsPerRun: 1,
    maxExecutionsPerRun: 2,
    executionCooldownSeconds: 300,
  },
};

export const DEFAULT_OPERATOR_API_CONFIG: OperatorApiConfig = {
  enabled: false,
  bindHost: "127.0.0.1",
  port: 4903,
  pathPrefix: "/operator",
  authToken: undefined,
  exposeDoctor: true,
  exposeServiceStatus: true,
};

export const DEFAULT_OPERATOR_AUTOPILOT_QUEUE_POLICY: OperatorAutopilotQueuePolicy =
  {
    enabled: true,
    pendingThreshold: 5,
    limit: 25,
    cooldownSeconds: 300,
  };

export const DEFAULT_OPERATOR_AUTOPILOT_MAINTENANCE_POLICY: OperatorAutopilotMaintenancePolicy =
  {
    enabled: true,
    triggerThreshold: 1,
    limit: 10,
    cooldownSeconds: 1800,
  };

export const DEFAULT_OPERATOR_AUTOPILOT_PROVIDER_POLICY: OperatorAutopilotProviderPolicy =
  {
    enabled: true,
    quarantineScoreThreshold: 45,
    quarantineMinEvents: 3,
    maxProvidersPerRun: 5,
    cooldownSeconds: 1800,
  };

export const DEFAULT_OPERATOR_AUTOPILOT_APPROVAL_POLICY: OperatorAutopilotApprovalPolicy =
  {
    enabled: true,
    defaultTtlSeconds: 86400,
  };

export const DEFAULT_OPERATOR_AUTOPILOT_CONFIG: OperatorAutopilotConfig = {
  enabled: false,
  queuePolicies: {
    payments: { ...DEFAULT_OPERATOR_AUTOPILOT_QUEUE_POLICY },
    settlement: { ...DEFAULT_OPERATOR_AUTOPILOT_QUEUE_POLICY },
    market: { ...DEFAULT_OPERATOR_AUTOPILOT_QUEUE_POLICY },
    signer: { ...DEFAULT_OPERATOR_AUTOPILOT_QUEUE_POLICY },
    paymaster: { ...DEFAULT_OPERATOR_AUTOPILOT_QUEUE_POLICY },
  },
  storageMaintenance: { ...DEFAULT_OPERATOR_AUTOPILOT_MAINTENANCE_POLICY },
  artifactMaintenance: { ...DEFAULT_OPERATOR_AUTOPILOT_MAINTENANCE_POLICY },
  providerQuarantine: { ...DEFAULT_OPERATOR_AUTOPILOT_PROVIDER_POLICY },
  approvals: { ...DEFAULT_OPERATOR_AUTOPILOT_APPROVAL_POLICY },
};

export const DEFAULT_SIGNER_PROVIDER_CONFIG: SignerProviderConfig = {
  enabled: false,
  bindHost: "127.0.0.1",
  port: 4898,
  pathPrefix: "/signer",
  capabilityPrefix: "signer",
  publishToDiscovery: true,
  quoteValiditySeconds: 300,
  quotePriceWei: "0",
  submitPriceWei: "1000000000000000",
  requestTimeoutMs: 15000,
  maxDataBytes: 16384,
  defaultGas: "180000",
  policy: {
    trustTier: "self_hosted",
    policyId: "default",
    allowedTargets: [],
    allowedFunctionSelectors: [],
    maxValueWei: "0",
    allowSystemAction: false,
  },
};

export const DEFAULT_PAYMASTER_PROVIDER_CONFIG: PaymasterProviderConfig = {
  enabled: false,
  bindHost: "127.0.0.1",
  port: 4899,
  pathPrefix: "/paymaster",
  capabilityPrefix: "paymaster",
  publishToDiscovery: true,
  quoteValiditySeconds: 300,
  authorizationValiditySeconds: 300,
  quotePriceWei: "0",
  authorizePriceWei: "1000000000000000",
  requestTimeoutMs: 15000,
  maxDataBytes: 16384,
  defaultGas: "180000",
  policy: {
    trustTier: "self_hosted",
    policyId: "default",
    allowedWallets: [],
    allowedTargets: [],
    allowedFunctionSelectors: [],
    maxValueWei: "0",
    allowSystemAction: false,
  },
};

export const DEFAULT_SETTLEMENT_CONFIG: SettlementConfig = {
  enabled: false,
  sinkAddress: undefined,
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
      contractAddress: undefined,
      gas: "220000",
      valueWei: "0",
      waitForReceipt: true,
      receiptTimeoutMs: 60000,
      payloadMode: "canonical_receipt",
      prefixHex: undefined,
      maxAttempts: 3,
    },
    observation: {
      enabled: false,
      contractAddress: undefined,
      gas: "220000",
      valueWei: "0",
      waitForReceipt: true,
      receiptTimeoutMs: 60000,
      payloadMode: "canonical_receipt",
      prefixHex: undefined,
      maxAttempts: 3,
    },
    oracle: {
      enabled: false,
      contractAddress: undefined,
      gas: "220000",
      valueWei: "0",
      waitForReceipt: true,
      receiptTimeoutMs: 60000,
      payloadMode: "canonical_receipt",
      prefixHex: undefined,
      maxAttempts: 3,
    },
  },
};

export const DEFAULT_MARKET_CONTRACT_CONFIG: MarketContractConfig = {
  enabled: false,
  retryBatchSize: 10,
  retryAfterSeconds: 120,
  bounty: {
    enabled: false,
    contractAddress: undefined,
    packageName: undefined,
    functionSignature: undefined,
    gas: "260000",
    valueWei: "0",
    waitForReceipt: true,
    receiptTimeoutMs: 60000,
    payloadMode: "canonical_binding",
    maxAttempts: 3,
  },
  observation: {
    enabled: false,
    contractAddress: undefined,
    packageName: undefined,
    functionSignature: undefined,
    gas: "260000",
    valueWei: "0",
    waitForReceipt: true,
    receiptTimeoutMs: 60000,
    payloadMode: "canonical_binding",
    maxAttempts: 3,
  },
  oracle: {
    enabled: false,
    contractAddress: undefined,
    packageName: undefined,
    functionSignature: undefined,
    gas: "260000",
    valueWei: "0",
    waitForReceipt: true,
    receiptTimeoutMs: 60000,
    payloadMode: "canonical_binding",
    maxAttempts: 3,
  },
};

export const DEFAULT_X402_SERVER_CONFIG: X402ServerConfig = {
  enabled: true,
  confirmationPolicy: "broadcast",
  receiptTimeoutMs: 15000,
  receiptPollIntervalMs: 1000,
  retryBatchSize: 10,
  retryAfterSeconds: 30,
  maxAttempts: 5,
};

export const DEFAULT_WALLET_FUNDING_CONFIG: WalletFundingConfig = {
  localDefaultAmountWei: "5000000000000000000",
  localFunderAddress: undefined,
  localFunderPassword: undefined,
  testnetDefaultAmountWei: "10000000000000000",
  testnetFaucetUrl: undefined,
  testnetReason: "bootstrap openfox wallet",
};

export const DEFAULT_CONFIG: Partial<OpenFoxConfig> = {
  inferenceModel: "gpt-5.2",
  maxTokensPerTurn: 4096,
  heartbeatConfigPath: "~/.openfox/heartbeat.yml",
  dbPath: "~/.openfox/state.db",
  logLevel: "info",
  version: "0.2.1",
  skillsDir: "~/.openfox/skills",
  maxChildren: 3,
  maxTurnsPerCycle: 25,
  childSandboxMemoryMb: 1024,
  rpcUrl: process.env.TOS_RPC_URL,
  walletFunding: DEFAULT_WALLET_FUNDING_CONFIG,
  agentDiscovery: DEFAULT_AGENT_DISCOVERY_CONFIG,
  bounty: DEFAULT_BOUNTY_CONFIG,
  opportunityScout: DEFAULT_OPPORTUNITY_SCOUT_CONFIG,
  ownerReports: DEFAULT_OWNER_REPORTS_CONFIG,
  operatorApi: DEFAULT_OPERATOR_API_CONFIG,
  operatorAutopilot: DEFAULT_OPERATOR_AUTOPILOT_CONFIG,
  settlement: DEFAULT_SETTLEMENT_CONFIG,
  marketContracts: DEFAULT_MARKET_CONTRACT_CONFIG,
  x402Server: DEFAULT_X402_SERVER_CONFIG,
  signerProvider: DEFAULT_SIGNER_PROVIDER_CONFIG,
  paymasterProvider: DEFAULT_PAYMASTER_PROVIDER_CONFIG,
  storage: DEFAULT_STORAGE_MARKET_CONFIG,
  artifacts: DEFAULT_ARTIFACT_PIPELINE_CONFIG,
};

// ─── Agent State ─────────────────────────────────────────────────

export type AgentState =
  | "setup"
  | "waking"
  | "running"
  | "sleeping"
  | "low_compute"
  | "critical"
  | "dead";

export interface AgentTurn {
  id: string;
  timestamp: string;
  state: AgentState;
  input?: string;
  inputSource?: InputSource;
  thinking: string;
  toolCalls: ToolCallResult[];
  tokenUsage: TokenUsage;
  costCents: number;
}

export type InputSource =
  | "heartbeat"
  | "creator"
  | "agent"
  | "system"
  | "wakeup";

export interface ToolCallResult {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  result: string;
  durationMs: number;
  error?: string;
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

// ─── Tool System ─────────────────────────────────────────────────

export interface OpenFoxTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute: (
    args: Record<string, unknown>,
    context: ToolContext,
  ) => Promise<string>;
  riskLevel: RiskLevel;
  category: ToolCategory;
}

export type ToolCategory =
  | "vm"
  | "runtime"
  | "self_mod"
  | "financial"
  | "survival"
  | "skills"
  | "git"
  | "registry"
  | "replication"
  | "memory";

export interface ToolContext {
  identity: OpenFoxIdentity;
  config: OpenFoxConfig;
  db: OpenFoxDatabase;
  runtime: RuntimeClient;
  inference: InferenceClient;
  social?: SocialClientInterface;
}

export interface SocialClientInterface {
  send(to: string, content: string, replyTo?: string): Promise<{ id: string }>;
  poll(
    cursor?: string,
    limit?: number,
  ): Promise<{ messages: InboxMessage[]; nextCursor?: string }>;
  unreadCount(): Promise<number>;
}

export interface InboxMessage {
  id: string;
  from: string;
  to: string;
  content: string;
  signedAt: string;
  createdAt: string;
  replyTo?: string;
}

// ─── Heartbeat ───────────────────────────────────────────────────

export interface HeartbeatEntry {
  name: string;
  schedule: string;
  task: string;
  enabled: boolean;
  lastRun?: string;
  nextRun?: string;
  params?: Record<string, unknown>;
}

export interface HeartbeatConfig {
  entries: HeartbeatEntry[];
  defaultIntervalMs: number;
  lowComputeMultiplier: number;
}

export interface HeartbeatPingPayload {
  name: string;
  address: Address;
  state: AgentState;
  creditsCents: number;
  walletBalance: number;
  uptimeSeconds: number;
  version: string;
  sandboxId: string;
  timestamp: string;
}

// ─── Financial ───────────────────────────────────────────────────

export interface FinancialState {
  creditsCents: number;
  walletBalance: number;
  lastChecked: string;
}

export type SurvivalTier =
  | "dead"
  | "critical"
  | "low_compute"
  | "normal"
  | "high";

export const SURVIVAL_THRESHOLDS = {
  high: 500, // > $5.00 in cents
  normal: 50, // > $0.50 in cents
  low_compute: 10, // $0.10 - $0.50
  critical: 0, // >= $0.00 (zero credits = critical, agent stays alive)
  dead: -1, // negative balance = truly dead
} as const;

export interface Transaction {
  id: string;
  type: TransactionType;
  amountCents?: number;
  balanceAfterCents?: number;
  description: string;
  timestamp: string;
}

export type TransactionType =
  | "credit_check"
  | "credit_purchase"
  | "inference"
  | "tool_use"
  | "transfer_in"
  | "transfer_out"
  | "funding_request";

// ─── Self-Modification ───────────────────────────────────────────

export interface ModificationEntry {
  id: string;
  timestamp: string;
  type: ModificationType;
  description: string;
  filePath?: string;
  diff?: string;
  reversible: boolean;
}

export type ModificationType =
  | "code_edit"
  | "code_revert"
  | "tool_install"
  | "mcp_install"
  | "config_change"
  | "port_expose"
  | "vm_deploy"
  | "heartbeat_change"
  | "prompt_change"
  | "skill_install"
  | "skill_remove"
  | "soul_update"
  | "registry_update"
  | "child_spawn"
  | "upstream_pull"
  | "upstream_reset";

// ─── Injection Defense ───────────────────────────────────────────

export type ThreatLevel = "low" | "medium" | "high" | "critical";

export type SanitizationMode =
  | "social_message" // Full injection defense
  | "social_address" // Alphanumeric + 0x prefix only
  | "tool_result" // Strip prompt boundaries, limit size
  | "skill_instruction"; // Strip tool call syntax, add framing

export interface SanitizedInput {
  content: string;
  blocked: boolean;
  threatLevel: ThreatLevel;
  checks: InjectionCheck[];
}

export interface InjectionCheck {
  name: string;
  detected: boolean;
  details?: string;
}

// ─── Inference ───────────────────────────────────────────────────

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  name?: string;
  tool_calls?: InferenceToolCall[];
  tool_call_id?: string;
}

export interface InferenceToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

export interface InferenceResponse {
  id: string;
  model: string;
  message: ChatMessage;
  toolCalls?: InferenceToolCall[];
  usage: TokenUsage;
  finishReason: string;
}

export interface InferenceOptions {
  model?: string;
  maxTokens?: number;
  temperature?: number;
  tools?: InferenceToolDefinition[];
  stream?: boolean;
}

export interface InferenceToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

// ─── Runtime Client ───────────────────────────────────────────────

export interface RuntimeClient {
  exec(command: string, timeout?: number): Promise<ExecResult>;
  writeFile(path: string, content: string): Promise<void>;
  readFile(path: string): Promise<string>;
  exposePort(port: number): Promise<PortInfo>;
  removePort(port: number): Promise<void>;
  createSandbox(options: CreateSandboxOptions): Promise<SandboxInfo>;
  deleteSandbox(sandboxId: string): Promise<void>;
  listSandboxes(): Promise<SandboxInfo[]>;
  getCreditsBalance(): Promise<number>;
  getCreditsPricing(): Promise<PricingTier[]>;
  transferCredits(
    toAddress: string,
    amountCents: number,
    note?: string,
  ): Promise<CreditTransferResult>;
  registerOpenFox(params: {
    openfoxId: string;
    openfoxAddress: Address;
    creatorAddress: HexAddress;
    name: string;
    bio?: string;
    genesisPromptHash?: `0x${string}`;
    account: PrivateKeyAccount;
    nonce?: string;
  }): Promise<{ openfox: Record<string, unknown> }>;
  // Domain operations
  searchDomains(query: string, tlds?: string): Promise<DomainSearchResult[]>;
  registerDomain(domain: string, years?: number): Promise<DomainRegistration>;
  listDnsRecords(domain: string): Promise<DnsRecord[]>;
  addDnsRecord(
    domain: string,
    type: string,
    host: string,
    value: string,
    ttl?: number,
  ): Promise<DnsRecord>;
  deleteDnsRecord(domain: string, recordId: string): Promise<void>;
  // Model discovery
  listModels(): Promise<ModelInfo[]>;
  /** Create a new client scoped to a specific sandbox ID. */
  createScopedClient(targetSandboxId: string): RuntimeClient;
}

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface PortInfo {
  port: number;
  publicUrl: string;
  sandboxId: string;
}

export interface CreateSandboxOptions {
  name?: string;
  vcpu?: number;
  memoryMb?: number;
  diskGb?: number;
  region?: string;
}

export interface SandboxInfo {
  id: string;
  status: string;
  region: string;
  vcpu: number;
  memoryMb: number;
  diskGb: number;
  terminalUrl?: string;
  createdAt: string;
}

export interface PricingTier {
  name: string;
  vcpu: number;
  memoryMb: number;
  diskGb: number;
  monthlyCents: number;
}

export interface CreditTransferResult {
  transferId: string;
  status: string;
  toAddress: string;
  amountCents: number;
  balanceAfterCents?: number;
}

// ─── Domains ──────────────────────────────────────────────────────

export interface DomainSearchResult {
  domain: string;
  available: boolean;
  registrationPrice?: number;
  renewalPrice?: number;
  currency?: string;
}

export interface DomainRegistration {
  domain: string;
  status: string;
  expiresAt?: string;
  transactionId?: string;
}

export interface DnsRecord {
  id: string;
  type: string;
  host: string;
  value: string;
  ttl?: number;
  distance?: number;
}

export interface ModelInfo {
  id: string;
  provider: string;
  pricing: {
    inputPerMillion: number;
    outputPerMillion: number;
  };
}

// ─── Policy Engine ───────────────────────────────────────────────

// Risk level for tool classification — replaces `dangerous?: boolean`
export type RiskLevel = "safe" | "caution" | "dangerous" | "forbidden";

// Policy evaluation result action
export type PolicyAction = "allow" | "deny" | "quarantine";

// Who initiated the action
export type AuthorityLevel = "system" | "agent" | "external";

// Spend categories
export type SpendCategory = "transfer" | "x402" | "inference" | "other";

export type ToolSelector =
  | { by: "name"; names: string[] }
  | { by: "category"; categories: ToolCategory[] }
  | { by: "risk"; levels: RiskLevel[] }
  | { by: "all" };

export interface PolicyRule {
  id: string;
  description: string;
  priority: number;
  appliesTo: ToolSelector;
  evaluate(request: PolicyRequest): PolicyRuleResult | null;
}

export interface PolicyRequest {
  tool: OpenFoxTool;
  args: Record<string, unknown>;
  context: ToolContext;
  turnContext: {
    inputSource: InputSource | undefined;
    turnToolCallCount: number;
    sessionSpend: SpendTrackerInterface;
  };
}

export interface PolicyRuleResult {
  rule: string;
  action: PolicyAction;
  reasonCode: string;
  humanMessage: string;
}

export interface PolicyDecision {
  action: PolicyAction;
  reasonCode: string;
  humanMessage: string;
  riskLevel: RiskLevel;
  authorityLevel: AuthorityLevel;
  toolName: string;
  argsHash: string;
  rulesEvaluated: string[];
  rulesTriggered: string[];
  timestamp: string;
}

export interface SpendTrackerInterface {
  recordSpend(entry: SpendEntry): void;
  getHourlySpend(category: SpendCategory): number;
  getDailySpend(category: SpendCategory): number;
  getTotalSpend(category: SpendCategory, since: Date): number;
  checkLimit(
    amount: number,
    category: SpendCategory,
    limits: TreasuryPolicy,
  ): LimitCheckResult;
  pruneOldRecords(retentionDays: number): number;
}

export interface SpendEntry {
  toolName: string;
  amountCents: number;
  recipient?: string;
  domain?: string;
  category: SpendCategory;
}

export interface LimitCheckResult {
  allowed: boolean;
  reason?: string;
  currentHourlySpend: number;
  currentDailySpend: number;
  limitHourly: number;
  limitDaily: number;
}

export interface TreasuryPolicy {
  maxSingleTransferCents: number;
  maxHourlyTransferCents: number;
  maxDailyTransferCents: number;
  minimumReserveCents: number;
  maxX402PaymentCents: number;
  x402AllowedDomains: string[];
  transferCooldownMs: number;
  maxTransfersPerTurn: number;
  maxInferenceDailyCents: number;
  requireConfirmationAboveCents: number;
}

export const DEFAULT_TREASURY_POLICY: TreasuryPolicy = {
  maxSingleTransferCents: 5000,
  maxHourlyTransferCents: 10000,
  maxDailyTransferCents: 25000,
  minimumReserveCents: 1000,
  maxX402PaymentCents: 100,
  x402AllowedDomains: ["openfox.ai"],
  transferCooldownMs: 0,
  maxTransfersPerTurn: 2,
  maxInferenceDailyCents: 50000,
  requireConfirmationAboveCents: 1000,
};

// ─── Phase 1: Inbox Message Status ──────────────────────────────

export type InboxMessageStatus =
  | "received"
  | "in_progress"
  | "processed"
  | "failed";

// ─── Phase 1: Runtime Reliability ────────────────────────────────

export interface HttpClientConfig {
  baseTimeout: number; // default: 30_000ms
  maxRetries: number; // default: 3
  retryableStatuses: number[]; // default: [429, 500, 502, 503, 504]
  backoffBase: number; // default: 1_000ms
  backoffMax: number; // default: 30_000ms
  circuitBreakerThreshold: number; // default: 5
  circuitBreakerResetMs: number; // default: 60_000ms
}

export const DEFAULT_HTTP_CLIENT_CONFIG: HttpClientConfig = {
  baseTimeout: 30_000,
  maxRetries: 3,
  retryableStatuses: [429, 500, 502, 503, 504],
  backoffBase: 1_000,
  backoffMax: 30_000,
  circuitBreakerThreshold: 5,
  circuitBreakerResetMs: 60_000,
};

// ─── Database ────────────────────────────────────────────────────

export interface OpenFoxDatabase {
  // Identity
  getIdentity(key: string): string | undefined;
  setIdentity(key: string, value: string): void;

  // Turns
  insertTurn(turn: AgentTurn): void;
  getRecentTurns(limit: number): AgentTurn[];
  getTurnById(id: string): AgentTurn | undefined;
  getTurnCount(): number;

  // Tool calls
  insertToolCall(turnId: string, call: ToolCallResult): void;
  getToolCallsForTurn(turnId: string): ToolCallResult[];

  // Heartbeat
  getHeartbeatEntries(): HeartbeatEntry[];
  upsertHeartbeatEntry(entry: HeartbeatEntry): void;
  deleteHeartbeatEntry(name: string): void;
  updateHeartbeatLastRun(name: string, timestamp: string): void;

  // Transactions
  insertTransaction(txn: Transaction): void;
  getRecentTransactions(limit: number): Transaction[];

  // Installed tools
  getInstalledTools(): InstalledTool[];
  installTool(tool: InstalledTool): void;
  removeTool(id: string): void;

  // Modifications
  insertModification(mod: ModificationEntry): void;
  getRecentModifications(limit: number): ModificationEntry[];

  // Operator control audit
  insertOperatorControlEvent(event: OperatorControlEventRecord): void;
  getOperatorControlEvent(eventId: string): OperatorControlEventRecord | undefined;
  listOperatorControlEvents(
    limit: number,
    filters?: {
      action?: OperatorControlAction;
      status?: OperatorControlEventStatus;
    },
  ): OperatorControlEventRecord[];
  insertOperatorApprovalRequest(record: OperatorApprovalRequestRecord): void;
  getOperatorApprovalRequest(requestId: string): OperatorApprovalRequestRecord | undefined;
  listOperatorApprovalRequests(
    limit: number,
    filters?: {
      kind?: OperatorApprovalKind;
      status?: OperatorApprovalStatus;
    },
  ): OperatorApprovalRequestRecord[];
  updateOperatorApprovalRequest(
    requestId: string,
    updates: Pick<
      OperatorApprovalRequestRecord,
      "status" | "decidedAt" | "decidedBy" | "decisionNote"
    >,
  ): void;

  // Key-value store
  getKV(key: string): string | undefined;
  setKV(key: string, value: string): void;
  deleteKV(key: string): void;

  // Skills
  getSkills(enabledOnly?: boolean): Skill[];
  getSkillByName(name: string): Skill | undefined;
  upsertSkill(skill: Skill): void;
  setSkillEnabled(name: string, enabled: boolean): void;
  removeSkill(name: string): void;

  // Children
  getChildren(): ChildOpenFox[];
  getChildById(id: string): ChildOpenFox | undefined;
  insertChild(child: ChildOpenFox): void;
  updateChildStatus(id: string, status: ChildStatus): void;

  // Reputation
  insertReputation(entry: ReputationEntry): void;
  getReputation(agentAddress?: string): ReputationEntry[];

  // Inbox
  insertInboxMessage(msg: InboxMessage): void;
  getUnprocessedInboxMessages(limit: number): InboxMessage[];
  markInboxMessageProcessed(id: string): void;

  // Campaigns
  insertCampaign(campaign: CampaignRecord): void;
  listCampaigns(status?: CampaignStatus): CampaignRecord[];
  getCampaignById(campaignId: string): CampaignRecord | undefined;
  updateCampaignStatus(campaignId: string, status: CampaignStatus): void;

  // Bounties
  insertBounty(bounty: BountyRecord): void;
  listBounties(status?: BountyStatus): BountyRecord[];
  listBountiesByCampaign(campaignId: string): BountyRecord[];
  getBountyById(bountyId: string): BountyRecord | undefined;
  updateBountyStatus(bountyId: string, status: BountyStatus): void;
  insertBountySubmission(submission: BountySubmissionRecord): void;
  listBountySubmissions(bountyId: string): BountySubmissionRecord[];
  getBountySubmission(submissionId: string): BountySubmissionRecord | undefined;
  updateBountySubmissionStatus(
    submissionId: string,
    status: BountySubmissionStatus,
  ): void;
  upsertBountyResult(result: BountyResultRecord): void;
  getBountyResult(bountyId: string): BountyResultRecord | undefined;

  // Settlement receipts
  upsertSettlementReceipt(receipt: SettlementRecord): void;
  getSettlementReceipt(
    kind: SettlementKind,
    subjectId: string,
  ): SettlementRecord | undefined;
  getSettlementReceiptById(receiptId: string): SettlementRecord | undefined;
  listSettlementReceipts(
    limit: number,
    kind?: SettlementKind,
  ): SettlementRecord[];
  upsertSettlementCallback(callback: SettlementCallbackRecord): void;
  getSettlementCallbackById(
    callbackId: string,
  ): SettlementCallbackRecord | undefined;
  getSettlementCallbackByReceiptId(
    receiptId: string,
  ): SettlementCallbackRecord | undefined;
  listSettlementCallbacks(
    limit: number,
    filters?: {
      status?: SettlementCallbackStatus;
      kind?: SettlementKind;
    },
  ): SettlementCallbackRecord[];
  listPendingSettlementCallbacks(
    limit: number,
    nowIso?: string,
  ): SettlementCallbackRecord[];
  upsertMarketBinding(binding: MarketBindingRecord): void;
  getMarketBinding(
    kind: MarketBindingKind,
    subjectId: string,
  ): MarketBindingRecord | undefined;
  getMarketBindingById(bindingId: string): MarketBindingRecord | undefined;
  listMarketBindings(
    limit: number,
    kind?: MarketBindingKind,
  ): MarketBindingRecord[];
  upsertMarketContractCallback(callback: MarketContractCallbackRecord): void;
  getMarketContractCallbackById(
    callbackId: string,
  ): MarketContractCallbackRecord | undefined;
  getMarketContractCallbackByBindingId(
    bindingId: string,
  ): MarketContractCallbackRecord | undefined;
  listMarketContractCallbacks(
    limit: number,
    filters?: {
      status?: MarketContractStatus;
      kind?: MarketBindingKind;
    },
  ): MarketContractCallbackRecord[];
  listPendingMarketContractCallbacks(
    limit: number,
    nowIso?: string,
  ): MarketContractCallbackRecord[];
  upsertX402Payment(payment: X402PaymentRecord): void;
  getX402Payment(paymentId: Hex): X402PaymentRecord | undefined;
  getLatestX402PaymentByRequestKey(
    serviceKind: X402PaymentServiceKind,
    requestKey: string,
  ): X402PaymentRecord | undefined;
  listX402Payments(
    limit: number,
    filters?: {
      serviceKind?: X402PaymentServiceKind;
      status?: X402PaymentStatus;
      bound?: boolean;
    },
  ): X402PaymentRecord[];
  listPendingX402Payments(limit: number, nowIso?: string): X402PaymentRecord[];

  // Owner finance snapshots and reports
  upsertOwnerFinanceSnapshot(record: OwnerFinanceSnapshotRecord): void;
  getOwnerFinanceSnapshot(snapshotId: string): OwnerFinanceSnapshotRecord | undefined;
  getLatestOwnerFinanceSnapshot(
    periodKind: OwnerReportPeriodKind,
  ): OwnerFinanceSnapshotRecord | undefined;
  listOwnerFinanceSnapshots(
    limit: number,
    filters?: { periodKind?: OwnerReportPeriodKind },
  ): OwnerFinanceSnapshotRecord[];
  upsertOwnerReport(record: OwnerReportRecord): void;
  getOwnerReport(reportId: string): OwnerReportRecord | undefined;
  getLatestOwnerReport(periodKind: OwnerReportPeriodKind): OwnerReportRecord | undefined;
  listOwnerReports(
    limit: number,
    filters?: { periodKind?: OwnerReportPeriodKind },
  ): OwnerReportRecord[];
  upsertOwnerReportDelivery(record: OwnerReportDeliveryRecord): void;
  getOwnerReportDelivery(deliveryId: string): OwnerReportDeliveryRecord | undefined;
  listOwnerReportDeliveries(
    limit: number,
    filters?: {
      channel?: OwnerReportChannel;
      status?: OwnerReportDeliveryStatus;
      reportId?: string;
    },
  ): OwnerReportDeliveryRecord[];
  upsertOwnerOpportunityAlert(record: OwnerOpportunityAlertRecord): void;
  getOwnerOpportunityAlert(
    alertId: string,
  ): OwnerOpportunityAlertRecord | undefined;
  getLatestOwnerOpportunityAlertByOpportunityHash(
    opportunityHash: Hex,
  ): OwnerOpportunityAlertRecord | undefined;
  listOwnerOpportunityAlerts(
    limit: number,
    filters?: {
      status?: OwnerOpportunityAlertStatus;
      kind?: OpportunityKind;
    },
  ): OwnerOpportunityAlertRecord[];
  updateOwnerOpportunityAlertStatus(
    alertId: string,
    status: OwnerOpportunityAlertStatus,
    decidedAt?: string,
  ): OwnerOpportunityAlertRecord | undefined;
  linkOwnerOpportunityAlertActionRequest(
    alertId: string,
    actionKind: OwnerOpportunityActionKind,
    requestId: string,
    requestedAt?: string,
  ): OwnerOpportunityAlertRecord | undefined;
  upsertOwnerOpportunityAction(record: OwnerOpportunityActionRecord): void;
  getOwnerOpportunityAction(
    actionId: string,
  ): OwnerOpportunityActionRecord | undefined;
  getOwnerOpportunityActionByRequestId(
    requestId: string,
  ): OwnerOpportunityActionRecord | undefined;
  listOwnerOpportunityActions(
    limit: number,
    filters?: {
      status?: OwnerOpportunityActionStatus;
      kind?: OwnerOpportunityActionKind;
    },
  ): OwnerOpportunityActionRecord[];
  updateOwnerOpportunityActionStatus(
    actionId: string,
    status: OwnerOpportunityActionStatus,
    decidedAt?: string,
    resolution?: {
      kind?: OwnerOpportunityActionResolutionKind | null;
      ref?: string | null;
      note?: string | null;
    },
  ): OwnerOpportunityActionRecord | undefined;
  upsertOwnerOpportunityActionExecution(
    record: OwnerOpportunityActionExecutionRecord,
  ): void;
  getOwnerOpportunityActionExecution(
    executionId: string,
  ): OwnerOpportunityActionExecutionRecord | undefined;
  listOwnerOpportunityActionExecutions(
    limit: number,
    filters?: {
      actionId?: string;
      status?: OwnerOpportunityActionExecutionStatus;
    },
  ): OwnerOpportunityActionExecutionRecord[];

  // Signer provider
  upsertSignerQuote(record: SignerQuoteRecord): void;
  getSignerQuote(quoteId: string): SignerQuoteRecord | undefined;
  listSignerQuotes(
    limit: number,
    filters?: { status?: SignerQuoteStatus; requesterAddress?: Address; walletAddress?: Address },
  ): SignerQuoteRecord[];
  upsertSignerExecution(record: SignerExecutionRecord): void;
  getSignerExecution(executionId: string): SignerExecutionRecord | undefined;
  getLatestSignerExecutionByRequestKey(
    requestKey: string,
  ): SignerExecutionRecord | undefined;
  listSignerExecutions(
    limit: number,
    filters?: {
      status?: SignerExecutionStatus;
      requesterAddress?: Address;
      walletAddress?: Address;
    },
  ): SignerExecutionRecord[];

  // Paymaster provider
  upsertPaymasterQuote(record: PaymasterQuoteRecord): void;
  getPaymasterQuote(quoteId: string): PaymasterQuoteRecord | undefined;
  listPaymasterQuotes(
    limit: number,
    filters?: {
      status?: PaymasterQuoteStatus;
      requesterAddress?: Address;
      walletAddress?: Address;
      sponsorAddress?: Address;
    },
  ): PaymasterQuoteRecord[];
  upsertPaymasterAuthorization(record: PaymasterAuthorizationRecord): void;
  getPaymasterAuthorization(
    authorizationId: string,
  ): PaymasterAuthorizationRecord | undefined;
  getLatestPaymasterAuthorizationByRequestKey(
    requestKey: string,
  ): PaymasterAuthorizationRecord | undefined;
  listPaymasterAuthorizations(
    limit: number,
    filters?: {
      status?: PaymasterAuthorizationStatus;
      requesterAddress?: Address;
      walletAddress?: Address;
      sponsorAddress?: Address;
    },
  ): PaymasterAuthorizationRecord[];

  // Storage market
  upsertStorageQuote(record: StorageQuoteRecord): void;
  getStorageQuote(quoteId: string): StorageQuoteRecord | undefined;
  listStorageQuotes(limit: number, filters?: { status?: StorageQuoteRecord["status"] }): StorageQuoteRecord[];
  upsertStorageLease(record: StorageLeaseRecord): void;
  getStorageLease(leaseId: string): StorageLeaseRecord | undefined;
  getStorageLeaseByCid(cid: string): StorageLeaseRecord | undefined;
  listStorageLeases(
    limit: number,
    filters?: {
      status?: StorageLeaseStatus;
      cid?: string;
      providerAddress?: Address;
      requesterAddress?: Address;
    },
  ): StorageLeaseRecord[];
  upsertStorageRenewal(record: StorageRenewalRecord): void;
  getStorageRenewal(renewalId: string): StorageRenewalRecord | undefined;
  listStorageRenewals(
    limit: number,
    filters?: {
      leaseId?: string;
      cid?: string;
    },
  ): StorageRenewalRecord[];
  upsertStorageAudit(record: StorageAuditRecord): void;
  getStorageAudit(auditId: string): StorageAuditRecord | undefined;
  listStorageAudits(limit: number, filters?: { leaseId?: string; status?: StorageAuditStatus }): StorageAuditRecord[];
  upsertStorageAnchor(record: StorageAnchorRecord): void;
  getStorageAnchor(anchorId: string): StorageAnchorRecord | undefined;
  getStorageAnchorByLeaseId(leaseId: string): StorageAnchorRecord | undefined;
  listStorageAnchors(limit: number): StorageAnchorRecord[];
  upsertArtifact(record: ArtifactRecord): void;
  getArtifact(artifactId: string): ArtifactRecord | undefined;
  getArtifactByLeaseId(leaseId: string): ArtifactRecord | undefined;
  listArtifacts(
    limit: number,
    filters?: ArtifactSearchFilters,
  ): ArtifactRecord[];
  upsertArtifactVerification(record: ArtifactVerificationRecord): void;
  getArtifactVerification(verificationId: string): ArtifactVerificationRecord | undefined;
  getArtifactVerificationByArtifactId(artifactId: string): ArtifactVerificationRecord | undefined;
  listArtifactVerifications(limit: number): ArtifactVerificationRecord[];
  upsertArtifactAnchor(record: ArtifactAnchorRecord): void;
  getArtifactAnchor(anchorId: string): ArtifactAnchorRecord | undefined;
  getArtifactAnchorByArtifactId(artifactId: string): ArtifactAnchorRecord | undefined;
  listArtifactAnchors(limit: number): ArtifactAnchorRecord[];
  upsertExecutionTrail(record: ExecutionTrailRecord): void;
  getExecutionTrail(trailId: string): ExecutionTrailRecord | undefined;
  listExecutionTrails(
    limit: number,
    filters?: {
      subjectKind?: ExecutionTrailSubjectKind;
      subjectId?: string;
      executionKind?: ExecutionTrailExecutionKind;
    },
  ): ExecutionTrailRecord[];
  listExecutionTrailsForSubject(
    subjectKind: ExecutionTrailSubjectKind,
    subjectId: string,
  ): ExecutionTrailRecord[];
  findSignerExecutionBySubmittedTxHash(txHash: Hex): SignerExecutionRecord | undefined;
  findPaymasterAuthorizationBySubmittedTxHash(
    txHash: Hex,
  ): PaymasterAuthorizationRecord | undefined;
  findSignerExecutionByReceiptHash(receiptHash: Hex): SignerExecutionRecord | undefined;
  findPaymasterAuthorizationByReceiptHash(
    receiptHash: Hex,
  ): PaymasterAuthorizationRecord | undefined;

  // Key-value atomic delete
  deleteKVReturning(key: string): string | undefined;

  // State
  getAgentState(): AgentState;
  setAgentState(state: AgentState): void;

  // Transaction helper
  runTransaction<T>(fn: () => T): T;

  close(): void;

  // Raw better-sqlite3 instance for direct DB access (Phase 1.1)
  raw: import("better-sqlite3").Database;
}

export interface InstalledTool {
  id: string;
  name: string;
  type: "builtin" | "mcp" | "custom";
  config?: Record<string, unknown>;
  installedAt: string;
  enabled: boolean;
}

// ─── Inference Client Interface ──────────────────────────────────

export interface InferenceClient {
  chat(
    messages: ChatMessage[],
    options?: InferenceOptions,
  ): Promise<InferenceResponse>;
  setLowComputeMode(enabled: boolean): void;
  getDefaultModel(): string;
}

// ─── Skills ─────────────────────────────────────────────────────

export interface Skill {
  name: string;
  skillKey?: string;
  description: string;
  autoActivate: boolean;
  always?: boolean;
  homepage?: string;
  primaryEnv?: string;
  os?: string[];
  requires?: SkillRequirements;
  install?: SkillInstallSpec[];
  providerBackends?: Record<string, SkillProviderBackendSpec>;
  instructions: string;
  source: SkillSource;
  path: string;
  baseDir: string;
  enabled: boolean;
  installedAt: string;
  license?: string;
  compatibility?: string;
  allowedTools?: string[];
  invocation?: SkillInvocationPolicy;
}

export interface SkillInvocationPolicy {
  userInvocable: boolean;
  disableModelInvocation: boolean;
}

export interface SkillRequirements {
  bins?: string[];
  anyBins?: string[];
  env?: string[];
  config?: string[];
}

export interface SkillInstallSpec {
  id?: string;
  kind: "brew" | "node" | "go" | "uv" | "download";
  label?: string;
  bins?: string[];
  os?: string[];
  formula?: string;
  package?: string;
  module?: string;
  url?: string;
  archive?: string;
  extract?: boolean;
  stripComponents?: number;
  targetDir?: string;
}

export interface SkillProviderBackendSpec {
  entry: string;
  description?: string;
}

export interface ProviderCliWorkerConfig {
  command: string;
  args?: string[];
  timeoutMs?: number;
  maxStdinBytes?: number;
  maxStdoutBytes?: number;
  env?: Record<string, string>;
  cwd?: string;
}

export interface SkillPromptEntry {
  name: string;
  description: string;
  location: string;
  source: SkillSource;
}

export interface SkillSnapshot {
  prompt: string;
  skills: SkillPromptEntry[];
  resolvedSkills: Skill[];
  skillFilter?: string[];
  version?: number;
}

export interface SkillStatusEntry {
  name: string;
  description: string;
  source: SkillSource;
  path: string;
  enabled: boolean;
  eligible: boolean;
  always: boolean;
  homepage?: string;
  primaryEnv?: string;
  os?: string[];
  missingBins: string[];
  missingAnyBins: string[];
  missingEnv: string[];
  missingConfig: string[];
  install: SkillInstallSpec[];
  preferredInstall?: SkillInstallSpec;
  license?: string;
}

export type SkillSource =
  | "bundled"
  | "managed"
  | "workspace"
  | "builtin"
  | "git"
  | "url"
  | "self"
  | "agents-personal"
  | "agents-project"
  | "extra";

export interface SkillFrontmatter {
  // agentskills.io standard fields
  name?: string;
  description?: string;
  license?: string;
  compatibility?: string;
  metadata?: Record<string, unknown>;
  "allowed-tools"?: string;
  // Invocation policy (per agentskills.io / Claude Code convention)
  "user-invocable"?: boolean;
  "disable-model-invocation"?: boolean;
  // Platform fields (top-level, per agentskills.io convention)
  "skill-key"?: string;
  "auto-activate"?: boolean;
  always?: boolean;
  homepage?: string;
  "primary-env"?: string;
  os?: string[];
  requires?: SkillRequirements;
  install?: SkillInstallSpec[];
  "provider-backends"?: Record<
    string,
    | string
    | {
        entry?: string;
        description?: string;
      }
  >;
}

// ─── Skills Configuration ────────────────────────────────────────

export interface SkillConfig {
  enabled?: boolean;
  apiKey?: string;
  env?: Record<string, string>;
  config?: Record<string, unknown>;
}

export interface SkillsLoadConfig {
  extraDirs?: string[];
  watch?: boolean;
  watchDebounceMs?: number;
}

export interface SkillsInstallConfig {
  preferBrew?: boolean;
  nodeManager?: "npm" | "pnpm" | "yarn" | "bun";
}

export interface SkillsLimitsConfig {
  maxCandidatesPerRoot?: number;
  maxSkillsLoadedPerSource?: number;
  maxSkillsInPrompt?: number;
  maxSkillsPromptChars?: number;
  maxSkillFileBytes?: number;
}

export interface SkillsConfig {
  allowBundled?: string[];
  load?: SkillsLoadConfig;
  install?: SkillsInstallConfig;
  limits?: SkillsLimitsConfig;
  entries?: Record<string, SkillConfig>;
}

// ─── Git ────────────────────────────────────────────────────────

export interface GitStatus {
  branch: string;
  staged: string[];
  modified: string[];
  untracked: string[];
  clean: boolean;
}

export interface GitLogEntry {
  hash: string;
  message: string;
  author: string;
  date: string;
}

// ─── Agent Feedback ────────────────────────────────────────────

export interface ReputationEntry {
  id: string;
  fromAgent: string;
  toAgent: string;
  score: number;
  comment: string;
  txHash?: string;
  timestamp: string;
}

// ─── Replication ────────────────────────────────────────────────

export interface ChildOpenFox {
  id: string;
  name: string;
  address: Address;
  sandboxId: string;
  genesisPrompt: string;
  creatorMessage?: string;
  fundedAmountCents: number;
  status: ChildStatus;
  createdAt: string;
  lastChecked?: string;
}

export type ChildStatus =
  | "spawning"
  | "running"
  | "sleeping"
  | "dead"
  | "unknown"
  // Phase 3.1 lifecycle states
  | "requested"
  | "sandbox_created"
  | "runtime_ready"
  | "wallet_verified"
  | "funded"
  | "starting"
  | "healthy"
  | "unhealthy"
  | "stopped"
  | "failed"
  | "cleaned_up";

export interface GenesisConfig {
  name: string;
  genesisPrompt: string;
  creatorMessage?: string;
  creatorAddress: HexAddress;
  parentAddress: HexAddress;
}

export const MAX_CHILDREN = 3;

// ─── Token Budget ───────────────────────────────────────────────

export interface TokenBudget {
  total: number; // default: 100_000
  systemPrompt: number; // default: 20_000 (20%)
  recentTurns: number; // default: 50_000 (50%)
  toolResults: number; // default: 20_000 (20%)
  memoryRetrieval: number; // default: 10_000 (10%)
}

export const DEFAULT_TOKEN_BUDGET: TokenBudget = {
  total: 100_000,
  systemPrompt: 20_000,
  recentTurns: 50_000,
  toolResults: 20_000,
  memoryRetrieval: 10_000,
};

// ─── Phase 1: Runtime Reliability ───────────────────────────────

export interface TickContext {
  tickId: string; // ULID, unique per tick
  startedAt: Date;
  creditBalance: number; // fetched once per tick (cents)
  walletBalance: number; // fetched once per tick
  survivalTier: SurvivalTier;
  lowComputeMultiplier: number; // from config
  config: HeartbeatConfig;
  db: import("better-sqlite3").Database;
}

export type HeartbeatTaskFn = (
  ctx: TickContext,
  taskCtx: HeartbeatLegacyContext,
) => Promise<{ shouldWake: boolean; message?: string }>;

export interface HeartbeatLegacyContext {
  identity: OpenFoxIdentity;
  config: OpenFoxConfig;
  db: OpenFoxDatabase;
  runtime: RuntimeClient;
  social?: SocialClientInterface;
}

export interface HeartbeatScheduleRow {
  taskName: string; // PK
  cronExpression: string;
  intervalMs: number | null;
  enabled: number; // 0 or 1
  priority: number; // lower = higher priority
  timeoutMs: number; // default 30000
  maxRetries: number; // default 1
  tierMinimum: string; // minimum tier to run this task
  lastRunAt: string | null; // ISO-8601
  nextRunAt: string | null; // ISO-8601
  lastResult: "success" | "failure" | "timeout" | "skipped" | null;
  lastError: string | null;
  runCount: number;
  failCount: number;
  leaseOwner: string | null;
  leaseExpiresAt: string | null;
}

export interface HeartbeatHistoryRow {
  id: string; // ULID
  taskName: string;
  startedAt: string; // ISO-8601
  completedAt: string | null;
  result: "success" | "failure" | "timeout" | "skipped";
  durationMs: number | null;
  error: string | null;
  idempotencyKey: string | null;
}

export interface WakeEventRow {
  id: number; // AUTOINCREMENT
  source: string; // e.g., 'heartbeat', 'inbox', 'manual'
  reason: string;
  payload: string; // JSON, default '{}'
  consumedAt: string | null;
  createdAt: string;
}

export interface HeartbeatDedupRow {
  dedupKey: string; // PK
  taskName: string;
  expiresAt: string; // ISO-8601
}

// === Phase 2.1: Soul System Types ===

export interface SoulModel {
  format: "soul/v1";
  version: number;
  updatedAt: string; // ISO 8601
  // Immutable frontmatter
  name: string;
  address: string;
  creator: string;
  bornAt: string;
  constitutionHash: string;
  genesisPromptOriginal: string;
  genesisAlignment: number; // 0.0-1.0
  lastReflected: string; // ISO 8601
  // Mutable body sections
  corePurpose: string; // max 2000 chars
  values: string[]; // max 20 items
  behavioralGuidelines: string[]; // max 30 items
  personality: string; // max 1000 chars
  boundaries: string[]; // max 20 items
  strategy: string; // max 3000 chars
  capabilities: string; // auto-populated
  relationships: string; // auto-populated
  financialCharacter: string; // auto-populated + agent-set
  // Metadata
  rawContent: string; // original SOUL.md content
  contentHash: string; // SHA-256 of rawContent
}

export interface SoulValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  sanitized: SoulModel;
}

export interface SoulHistoryRow {
  id: string; // ULID
  version: number;
  content: string; // full SOUL.md content
  contentHash: string; // SHA-256
  changeSource: "agent" | "human" | "system" | "genesis" | "reflection";
  changeReason: string | null;
  previousVersionId: string | null;
  approvedBy: string | null;
  createdAt: string;
}

export interface SoulReflection {
  currentAlignment: number;
  suggestedUpdates: Array<{
    section: string;
    reason: string;
    suggestedContent: string;
  }>;
  autoUpdated: string[]; // sections auto-updated (capabilities, relationships, financial)
}

export interface SoulConfig {
  soulAlignmentThreshold: number; // default: 0.5
  requireCreatorApprovalForPurposeChange: boolean; // default: false
  enableSoulReflection: boolean; // default: true
}

export const DEFAULT_SOUL_CONFIG: SoulConfig = {
  soulAlignmentThreshold: 0.5,
  requireCreatorApprovalForPurposeChange: false,
  enableSoulReflection: true,
};

// === Phase 2.2: Memory System Types ===

export type WorkingMemoryType =
  | "goal"
  | "observation"
  | "plan"
  | "reflection"
  | "task"
  | "decision"
  | "note"
  | "summary";

export interface WorkingMemoryEntry {
  id: string; // ULID
  sessionId: string;
  content: string;
  contentType: WorkingMemoryType;
  priority: number; // 0.0-1.0
  tokenCount: number;
  expiresAt: string | null; // ISO 8601 or null
  sourceTurn: string | null; // turn_id
  createdAt: string;
}

export type TurnClassification =
  | "strategic"
  | "productive"
  | "communication"
  | "maintenance"
  | "idle"
  | "error";

export interface EpisodicMemoryEntry {
  id: string; // ULID
  sessionId: string;
  eventType: string;
  summary: string;
  detail: string | null;
  outcome: "success" | "failure" | "partial" | "neutral" | null;
  importance: number; // 0.0-1.0
  embeddingKey: string | null;
  tokenCount: number;
  accessedCount: number;
  lastAccessedAt: string | null;
  classification: TurnClassification;
  createdAt: string;
}

export type SemanticCategory =
  | "self"
  | "environment"
  | "financial"
  | "agent"
  | "domain"
  | "procedural_ref"
  | "creator";

export interface SemanticMemoryEntry {
  id: string; // ULID
  category: SemanticCategory;
  key: string;
  value: string;
  confidence: number; // 0.0-1.0
  source: string; // session_id or turn_id
  embeddingKey: string | null;
  lastVerifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProceduralStep {
  order: number;
  description: string;
  tool: string | null;
  argsTemplate: Record<string, string> | null;
  expectedOutcome: string | null;
  onFailure: string | null;
}

export interface ProceduralMemoryEntry {
  id: string; // ULID
  name: string; // unique
  description: string;
  steps: ProceduralStep[];
  successCount: number;
  failureCount: number;
  lastUsedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RelationshipMemoryEntry {
  id: string; // ULID
  entityAddress: string; // unique
  entityName: string | null;
  relationshipType: string;
  trustScore: number; // 0.0-1.0
  interactionCount: number;
  lastInteractionAt: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SessionSummaryEntry {
  id: string; // ULID
  sessionId: string; // unique
  summary: string;
  keyDecisions: string[]; // JSON-serialized
  toolsUsed: string[]; // JSON-serialized
  outcomes: string[]; // JSON-serialized
  turnCount: number;
  totalTokens: number;
  totalCostCents: number;
  createdAt: string;
}

export interface MemoryRetrievalResult {
  workingMemory: WorkingMemoryEntry[];
  episodicMemory: EpisodicMemoryEntry[];
  semanticMemory: SemanticMemoryEntry[];
  proceduralMemory: ProceduralMemoryEntry[];
  relationships: RelationshipMemoryEntry[];
  totalTokens: number;
}

export interface MemoryBudget {
  workingMemoryTokens: number; // default: 1500
  episodicMemoryTokens: number; // default: 3000
  semanticMemoryTokens: number; // default: 3000
  proceduralMemoryTokens: number; // default: 1500
  relationshipMemoryTokens: number; // default: 1000
}

export const DEFAULT_MEMORY_BUDGET: MemoryBudget = {
  workingMemoryTokens: 1500,
  episodicMemoryTokens: 3000,
  semanticMemoryTokens: 3000,
  proceduralMemoryTokens: 1500,
  relationshipMemoryTokens: 1000,
};

// === Phase 2.3: Inference & Model Strategy Types ===

export type ModelProvider =
  | "openai"
  | "anthropic"
  | "runtime"
  | "ollama"
  | "other";

export type InferenceTaskType =
  | "agent_turn"
  | "heartbeat_triage"
  | "safety_check"
  | "summarization"
  | "planning";

export interface ModelEntry {
  modelId: string; // e.g. "gpt-4.1", "claude-sonnet-4-6"
  provider: ModelProvider;
  displayName: string;
  tierMinimum: SurvivalTier; // minimum tier to use this model
  costPer1kInput: number; // hundredths of cents
  costPer1kOutput: number; // hundredths of cents
  maxTokens: number;
  contextWindow: number;
  supportsTools: boolean;
  supportsVision: boolean;
  parameterStyle: "max_tokens" | "max_completion_tokens";
  enabled: boolean;
  lastSeen: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ModelPreference {
  candidates: string[]; // model IDs in preference order
  maxTokens: number;
  ceilingCents: number; // max cost per call (-1 = no limit)
}

export type RoutingMatrix = Record<
  SurvivalTier,
  Record<InferenceTaskType, ModelPreference>
>;

export interface InferenceRequest {
  messages: ChatMessage[];
  taskType: InferenceTaskType;
  tier: SurvivalTier;
  sessionId: string;
  turnId?: string;
  maxTokens?: number; // override
  tools?: unknown[];
}

export interface InferenceResult {
  content: string;
  model: string;
  provider: ModelProvider;
  inputTokens: number;
  outputTokens: number;
  costCents: number;
  latencyMs: number;
  toolCalls?: unknown[];
  finishReason: string;
}

export interface InferenceCostRow {
  id: string; // ULID
  sessionId: string;
  turnId: string | null;
  model: string;
  provider: string;
  inputTokens: number;
  outputTokens: number;
  costCents: number;
  latencyMs: number;
  tier: string;
  taskType: string;
  cacheHit: boolean;
  createdAt: string;
}

export interface ModelRegistryRow {
  modelId: string;
  provider: string;
  displayName: string;
  tierMinimum: string;
  costPer1kInput: number;
  costPer1kOutput: number;
  maxTokens: number;
  contextWindow: number;
  supportsTools: boolean;
  supportsVision: boolean;
  parameterStyle: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ModelStrategyConfig {
  inferenceModel: string;
  lowComputeModel: string;
  criticalModel: string;
  maxTokensPerTurn: number;
  hourlyBudgetCents: number; // default: 0 (no limit)
  sessionBudgetCents: number; // default: 0 (no limit)
  perCallCeilingCents: number; // default: 0 (no limit)
  enableModelFallback: boolean; // default: true
  anthropicApiVersion: string; // default: "2023-06-01"
}

export const DEFAULT_MODEL_STRATEGY_CONFIG: ModelStrategyConfig = {
  inferenceModel: "gpt-5.2",
  lowComputeModel: "gpt-5-mini",
  criticalModel: "gpt-5-mini",
  maxTokensPerTurn: 4096,
  hourlyBudgetCents: 0,
  sessionBudgetCents: 0,
  perCallCeilingCents: 0,
  enableModelFallback: true,
  anthropicApiVersion: "2023-06-01",
};

// === Phase 3.1: Replication & Lifecycle Types ===

export type ChildLifecycleState =
  | "requested"
  | "sandbox_created"
  | "runtime_ready"
  | "wallet_verified"
  | "funded"
  | "starting"
  | "healthy"
  | "unhealthy"
  | "stopped"
  | "failed"
  | "cleaned_up";

export const VALID_TRANSITIONS: Record<
  ChildLifecycleState,
  ChildLifecycleState[]
> = {
  requested: ["sandbox_created", "failed"],
  sandbox_created: ["runtime_ready", "failed"],
  runtime_ready: ["wallet_verified", "failed"],
  wallet_verified: ["funded", "failed"],
  funded: ["starting", "failed"],
  starting: ["healthy", "failed"],
  healthy: ["unhealthy", "stopped"],
  unhealthy: ["healthy", "stopped", "failed"],
  stopped: ["cleaned_up"],
  failed: ["cleaned_up"],
  cleaned_up: [], // terminal
};

export interface ChildLifecycleEventRow {
  id: string; // ULID
  childId: string;
  fromState: string;
  toState: string;
  reason: string | null;
  metadata: string; // JSON
  createdAt: string;
}

export interface HealthCheckResult {
  childId: string;
  healthy: boolean;
  lastSeen: string | null;
  uptime: number | null;
  creditBalance: number | null;
  issues: string[];
}

export interface ChildHealthConfig {
  checkIntervalMs: number; // default: 300000 (5 min)
  unhealthyThresholdMs: number; // default: 900000 (15 min)
  deadThresholdMs: number; // default: 3600000 (1 hour)
  maxConcurrentChecks: number; // default: 3
}

export const DEFAULT_CHILD_HEALTH_CONFIG: ChildHealthConfig = {
  checkIntervalMs: 300_000,
  unhealthyThresholdMs: 900_000,
  deadThresholdMs: 3_600_000,
  maxConcurrentChecks: 3,
};

export interface GenesisLimits {
  maxNameLength: number; // default: 64
  maxSpecializationLength: number; // default: 2000
  maxTaskLength: number; // default: 4000
  maxMessageLength: number; // default: 2000
  maxGenesisPromptLength: number; // default: 16000
}

export const DEFAULT_GENESIS_LIMITS: GenesisLimits = {
  maxNameLength: 64,
  maxSpecializationLength: 2000,
  maxTaskLength: 4000,
  maxMessageLength: 2000,
  maxGenesisPromptLength: 16000,
};

export interface ParentChildMessage {
  id: string;
  from: string;
  to: string;
  content: string;
  type: string;
  sentAt: string;
}

export const MESSAGE_LIMITS = {
  maxContentLength: 64_000, // 64KB
  maxTotalSize: 128_000, // 128KB
  replayWindowMs: 300_000, // 5 minutes
  maxOutboundPerHour: 100,
} as const;

// === Phase 3.2: Social & Registry Types ===

export interface SignedMessagePayload {
  from: string;
  to: string;
  content: string;
  signed_at: string;
  signature: string;
  reply_to?: string;
}

export interface MessageValidationResult {
  valid: boolean;
  errors: string[];
}

export interface OnchainTransactionRow {
  id: string; // ULID
  txHash: string;
  chain: string;
  operation: string;
  status: "pending" | "confirmed" | "failed";
  gasUsed: number | null;
  metadata: string; // JSON
  createdAt: string;
}

// === Phase 4.1: Observability Types ===

export type LogLevel = "debug" | "info" | "warn" | "error" | "fatal";

export const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  fatal: 4,
};

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  module: string;
  message: string;
  context?: Record<string, unknown>;
  error?: { message: string; stack?: string; code?: string };
}

export type MetricType = "counter" | "gauge" | "histogram";

export interface MetricEntry {
  name: string;
  value: number;
  type: MetricType;
  labels: Record<string, string>;
  timestamp: string;
}

export interface MetricSnapshotRow {
  id: string; // ULID
  snapshotAt: string;
  metricsJson: string; // JSON array of MetricEntry
  alertsJson: string; // JSON array of fired alert names
  createdAt: string;
}

export type AlertSeverity = "warning" | "critical";

export interface AlertRule {
  name: string;
  severity: AlertSeverity;
  message: string;
  cooldownMs: number; // minimum ms between firings
  condition: (metrics: MetricSnapshot) => boolean;
}

export interface MetricSnapshot {
  counters: Map<string, number>;
  gauges: Map<string, number>;
  histograms: Map<string, number[]>;
}

export interface AlertEvent {
  rule: string;
  severity: AlertSeverity;
  message: string;
  firedAt: string;
  metricValues: Record<string, number>;
}
