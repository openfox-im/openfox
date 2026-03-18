/**
 * Main runtime initialization and run loop.
 */
import { getWallet } from "../identity/wallet.js";
import { loadApiKeyFromConfig } from "../identity/provision.js";
import { loadConfig, resolvePath } from "../config.js";
import { createDatabase } from "../state/database.js";
import { createRuntimeClient } from "./client.js";
import { createInferenceClient } from "./inference.js";
import { createHeartbeatDaemon } from "../heartbeat/daemon.js";
import {
  loadHeartbeatConfig,
  syncHeartbeatToDb,
} from "../heartbeat/config.js";
import {
  consumeNextWakeEvent,
  insertWakeEvent,
} from "../state/database.js";
import { runAgentLoop } from "../agent/loop.js";
import { ModelRegistry } from "../inference/registry.js";
import { loadSkills } from "../skills/loader.js";
import { initStateRepo } from "../git/state-versioning.js";
import { createSocialClient } from "../social/client.js";
import { PolicyEngine } from "../agent/policy-engine.js";
import { SpendTracker } from "../agent/spend-tracker.js";
import { createDefaultRules } from "../agent/policy-rules/index.js";
import type {
  OpenFoxIdentity,
  AgentState,
  Skill,
  SocialClientInterface,
} from "../types.js";
import { DEFAULT_TREASURY_POLICY } from "../types.js";
import { createLogger } from "../observability/logger.js";
import {
  clearLocalAgentDiscoveryCard,
  discoverCapabilityProviders,
  publishLocalAgentDiscoveryCard,
} from "../agent-discovery/client.js";
import { startAgentDiscoveryFaucetServer } from "../agent-discovery/faucet-server.js";
import { startAgentDiscoveryNewsFetchServer } from "../agent-discovery/news-fetch-server.js";
import { startAgentDiscoveryObservationServer } from "../agent-discovery/observation-server.js";
import { startAgentDiscoveryOracleServer } from "../agent-discovery/oracle-server.js";
import { startAgentDiscoveryProofVerifyServer } from "../agent-discovery/proof-verify-server.js";
import { startAgentDiscoverySentimentAnalysisServer } from "../agent-discovery/sentiment-analysis-server.js";
import { startMailServer } from "../mail/server.js";
import { startAgentDiscoveryStorageServer } from "../agent-discovery/storage-server.js";
import { normalizeAgentDiscoveryConfig } from "../agent-discovery/types.js";
import { startAgentGatewayServer } from "../agent-gateway/server.js";
import { startAgentGatewayProviderSessions } from "../agent-gateway/client.js";
import {
  buildGatewayProviderRoutes,
  buildPublishedAgentDiscoveryConfig,
} from "../agent-gateway/publish.js";
import {
  deriveAddressFromPrivateKey,
} from "../chain/address.js";
import {
  grantCapability,
  registerCapabilityName,
} from "../chain/client.js";
import { randomUUID } from "crypto";
import { keccak256, toHex } from "tosdk";
import { createNativeSettlementPublisher } from "../settlement/publisher.js";
import { createNativeSettlementCallbackDispatcher } from "../settlement/callbacks.js";
import { createMarketBindingPublisher } from "../market/publisher.js";
import { createMarketContractDispatcher } from "../market/contracts.js";
import { startStorageProviderServer } from "../storage/http.js";
import { createArtifactManager } from "../artifacts/manager.js";
import { createNativeArtifactAnchorPublisher } from "../artifacts/publisher.js";
import { startArtifactCaptureServer } from "../artifacts/server.js";
import { startSignerProviderServer } from "../signer/http.js";
import { startPaymasterProviderServer } from "../paymaster/http.js";
import { hashSignerPolicy } from "../signer/policy.js";
import { hashPaymasterPolicy } from "../paymaster/policy.js";
import { startOperatorApiServer } from "../operator/api.js";
import { startOwnerReportServer } from "../reports/server.js";
import { createBountyEngine } from "../bounty/engine.js";
import { startBountyHttpServer } from "../bounty/http.js";
import { createNativeBountyPayoutSender } from "../bounty/payout.js";
import { startBountyAutomation } from "../bounty/automation.js";
import { resolveBountySkillName, hasConfiguredInference } from "./inference-factory.js";
import { sleep } from "./agent-loop.js";

const logger = createLogger("main");
const VERSION = "0.2.1";

export async function run(): Promise<void> {
  logger.info(`[${new Date().toISOString()}] OpenFox v${VERSION} starting...`);

  // Load config — first run triggers interactive setup wizard
  let config = loadConfig();
  if (!config) {
    const { runSetupWizard } = await import("../setup/wizard.js");
    config = await runSetupWizard();
  }

  // Load wallet
  const { account, privateKey } = await getWallet();
  const apiKey = config.runtimeApiKey || loadApiKeyFromConfig() || "";
  if (!hasConfiguredInference(config)) {
    logger.error(
      "No inference provider configured. Set OpenAI/Anthropic API keys or OLLAMA_BASE_URL, then run openfox --setup or --configure.",
    );
    process.exit(1);
  }

  // Initialize database
  const dbPath = resolvePath(config.dbPath);
  const db = createDatabase(dbPath);

  // Persist createdAt: only set if not already stored (never overwrite)
  const existingCreatedAt = db.getIdentity("createdAt");
  const createdAt = existingCreatedAt || new Date().toISOString();
  if (!existingCreatedAt) {
    db.setIdentity("createdAt", createdAt);
  }

  // Build identity
  const address = config.walletAddress || deriveAddressFromPrivateKey(privateKey);

  const identity: OpenFoxIdentity = {
    name: config.name,
    address,
    account,
    creatorAddress: config.creatorAddress,
    sandboxId: config.sandboxId,
    apiKey,
    createdAt,
  };

  // Store identity in DB
  db.setIdentity("name", config.name);
  db.setIdentity("address", address);
  db.setIdentity("creator", config.creatorAddress);
  db.setIdentity("sandbox", config.sandboxId);
  const storedOpenFoxId = db.getIdentity("openfoxId");
  const openfoxId = storedOpenFoxId || config.sandboxId || randomUUID();
  if (!storedOpenFoxId) {
    db.setIdentity("openfoxId", openfoxId);
  }

  // Create Runtime client
  const runtime = createRuntimeClient({
    apiUrl: config.runtimeApiUrl,
    apiKey,
    sandboxId: config.sandboxId,
  });
  const skillsDir = config.skillsDir || "~/.openfox/skills";
  let skills: Skill[] = [];
  const ollamaBaseUrl = process.env.OLLAMA_BASE_URL || config.ollamaBaseUrl;
  const modelRegistry = new ModelRegistry(db.raw);
  modelRegistry.initialize();
  const inference = createInferenceClient({
    apiUrl: config.runtimeApiUrl || "",
    apiKey,
    defaultModel: config.inferenceModelRef || config.inferenceModel,
    maxTokens: config.maxTokensPerTurn,
    lowComputeModel: config.modelStrategy?.lowComputeModel || "gpt-5-mini",
    openaiApiKey: config.openaiApiKey,
    anthropicApiKey: config.anthropicApiKey,
    ollamaBaseUrl,
    getModelProvider: (modelId) => modelRegistry.get(modelId)?.provider,
  });

  if (ollamaBaseUrl) {
    logger.info(`[${new Date().toISOString()}] Ollama backend: ${ollamaBaseUrl}`);
  }

  let faucetServer:
    | Awaited<ReturnType<typeof startAgentDiscoveryFaucetServer>>
    | undefined;
  let observationServer:
    | Awaited<ReturnType<typeof startAgentDiscoveryObservationServer>>
    | undefined;
  let oracleServer:
    | Awaited<ReturnType<typeof startAgentDiscoveryOracleServer>>
    | undefined;
  let newsFetchServer:
    | Awaited<ReturnType<typeof startAgentDiscoveryNewsFetchServer>>
    | undefined;
  let proofVerifyServer:
    | Awaited<ReturnType<typeof startAgentDiscoveryProofVerifyServer>>
    | undefined;
  let discoveryStorageServer:
    | Awaited<ReturnType<typeof startAgentDiscoveryStorageServer>>
    | undefined;
  let sentimentAnalysisServer:
    | Awaited<ReturnType<typeof startAgentDiscoverySentimentAnalysisServer>>
    | undefined;
  let mailServer:
    | Awaited<ReturnType<typeof startMailServer>>
    | undefined;
  let storageServer:
    | Awaited<ReturnType<typeof startStorageProviderServer>>
    | undefined;
  let artifactServer:
    | Awaited<ReturnType<typeof startArtifactCaptureServer>>
    | undefined;
  let signerProviderServer:
    | Awaited<ReturnType<typeof startSignerProviderServer>>
    | undefined;
  let paymasterProviderServer:
    | Awaited<ReturnType<typeof startPaymasterProviderServer>>
    | undefined;
  let bountyServer:
    | Awaited<ReturnType<typeof startBountyHttpServer>>
    | undefined;
  let bountyAutomation:
    | Awaited<ReturnType<typeof startBountyAutomation>>
    | undefined;
  let runtimeArtifactManager: ReturnType<typeof createArtifactManager> | undefined;
  let gatewayServer:
    | Awaited<ReturnType<typeof startAgentGatewayServer>>
    | undefined;
  let operatorApiServer:
    | Awaited<ReturnType<typeof startOperatorApiServer>>
    | undefined;
  let ownerReportServer:
    | Awaited<ReturnType<typeof startOwnerReportServer>>
    | undefined;
  let gatewayProviderSessions:
    | Awaited<ReturnType<typeof startAgentGatewayProviderSessions>>
    | undefined;
  let liveGatewayProviderSessions: NonNullable<
    Awaited<ReturnType<typeof startAgentGatewayProviderSessions>>
  >["sessions"] = [];
  const settlementPublisher =
    config.settlement?.enabled && config.rpcUrl
      ? createNativeSettlementPublisher({
          db,
          rpcUrl: config.rpcUrl,
          privateKey,
          config: config.settlement,
          publisherAddress: address,
        })
      : undefined;
  const settlementCallbacks =
    config.settlement?.enabled &&
    config.settlement.callbacks.enabled &&
    config.rpcUrl
      ? createNativeSettlementCallbackDispatcher({
          db,
          rpcUrl: config.rpcUrl,
          privateKey,
          config: config.settlement.callbacks,
        })
      : undefined;
  const marketBindingPublisher = config.marketContracts?.enabled
    ? createMarketBindingPublisher({ db })
    : undefined;
  const marketContracts =
    config.marketContracts?.enabled && config.rpcUrl
      ? createMarketContractDispatcher({
          db,
          rpcUrl: config.rpcUrl,
          privateKey,
          config: config.marketContracts,
        })
      : undefined;

  if (config.agentDiscovery?.faucetServer?.enabled) {
    try {
      faucetServer = await startAgentDiscoveryFaucetServer({
        identity,
        config,
        address,
        privateKey,
        db,
        faucetConfig: config.agentDiscovery.faucetServer,
      });
      logger.info(`Agent Discovery faucet provider enabled at ${faucetServer.url}`);
    } catch (error) {
      logger.warn(
        `Agent Discovery faucet server failed to start: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  if (config.agentDiscovery?.observationServer?.enabled) {
    try {
      observationServer = await startAgentDiscoveryObservationServer({
        identity,
        config,
        address,
        db,
        observationConfig: config.agentDiscovery.observationServer,
        marketBindingPublisher,
        marketContracts,
        settlementPublisher: config.settlement?.publishObservations
          ? settlementPublisher
          : undefined,
        settlementCallbacks,
      });
      logger.info(`Agent Discovery observation provider enabled at ${observationServer.url}`);
    } catch (error) {
      logger.warn(
        `Agent Discovery observation server failed to start: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  if (config.agentDiscovery?.oracleServer?.enabled) {
    try {
      oracleServer = await startAgentDiscoveryOracleServer({
        identity,
        config,
        address,
        db,
        inference,
        oracleConfig: config.agentDiscovery.oracleServer,
        marketBindingPublisher,
        marketContracts,
        settlementPublisher: config.settlement?.publishOracleResults
          ? settlementPublisher
          : undefined,
        settlementCallbacks,
      });
      logger.info(`Agent Discovery oracle provider enabled at ${oracleServer.url}`);
    } catch (error) {
      logger.warn(
        `Agent Discovery oracle server failed to start: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  if (config.agentDiscovery?.newsFetchServer?.enabled) {
    try {
      newsFetchServer = await startAgentDiscoveryNewsFetchServer({
        identity,
        config,
        address,
        db,
        newsFetchConfig: config.agentDiscovery.newsFetchServer,
      });
      logger.info(`Agent Discovery news.fetch provider enabled at ${newsFetchServer.url}`);
    } catch (error) {
      logger.warn(
        `Agent Discovery news.fetch server failed to start: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  if (config.agentDiscovery?.proofVerifyServer?.enabled) {
    try {
      proofVerifyServer = await startAgentDiscoveryProofVerifyServer({
        identity,
        config,
        address,
        db,
        proofVerifyConfig: config.agentDiscovery.proofVerifyServer,
      });
      logger.info(`Agent Discovery proof.verify provider enabled at ${proofVerifyServer.url}`);
    } catch (error) {
      logger.warn(
        `Agent Discovery proof.verify server failed to start: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  if (config.agentDiscovery?.sentimentAnalysisServer?.enabled) {
    try {
      sentimentAnalysisServer = await startAgentDiscoverySentimentAnalysisServer({
        identity,
        config,
        address,
        db,
        inference,
        sentimentConfig: config.agentDiscovery.sentimentAnalysisServer,
      });
      logger.info(`Agent Discovery sentiment.analyze provider enabled at ${sentimentAnalysisServer.url}`);
    } catch (error) {
      logger.warn(
        `Agent Discovery sentiment analysis server failed to start: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  if (config.agentDiscovery?.mailServer?.enabled) {
    try {
      mailServer = await startMailServer({
        identity,
        config,
        db,
        mailConfig: config.agentDiscovery.mailServer,
        privateKey,
      });
      logger.info(`P2P Agent Mail server enabled at ${mailServer.url}`);
    } catch (error) {
      logger.warn(
        `Mail server failed to start: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  if (config.agentDiscovery?.storageServer?.enabled) {
    try {
      discoveryStorageServer = await startAgentDiscoveryStorageServer({
        identity,
        config,
        address,
        db,
        storageConfig: config.agentDiscovery.storageServer,
      });
      logger.info(`Agent Discovery storage provider enabled at ${discoveryStorageServer.url}`);
    } catch (error) {
      logger.warn(
        `Agent Discovery storage server failed to start: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  if (config.storage?.enabled) {
    try {
      storageServer = await startStorageProviderServer({
        identity,
        config,
        address,
        privateKey,
        db,
        storageConfig: config.storage,
      });
      logger.info(`Storage provider enabled at ${storageServer.url}`);
    } catch (error) {
      logger.warn(
        `Storage provider failed to start: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  if (config.artifacts?.enabled) {
    try {
      const artifactAnchorPublisher =
        config.artifacts.anchor.enabled && config.rpcUrl
          ? createNativeArtifactAnchorPublisher({
              db,
              rpcUrl: config.rpcUrl,
              privateKey,
              config: config.artifacts.anchor,
              publisherAddress: config.walletAddress,
            })
          : undefined;
      runtimeArtifactManager = createArtifactManager({
        identity,
        requesterAccount: account,
        db,
        config: {
          ...config.artifacts,
          defaultProviderBaseUrl:
            config.artifacts.defaultProviderBaseUrl || storageServer?.url,
        },
        anchorPublisher: artifactAnchorPublisher,
      });
      if (config.artifacts.service.enabled) {
        artifactServer = await startArtifactCaptureServer({
          identity,
          db,
          manager: runtimeArtifactManager,
          config: config.artifacts.service,
          captureCapability: config.artifacts.captureCapability,
          evidenceCapability: config.artifacts.evidenceCapability,
        });
        logger.info(`Artifact capture service enabled at ${artifactServer.url}`);
      }
    } catch (error) {
      logger.warn(
        `Artifact pipeline startup failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  if (config.signerProvider?.enabled) {
    try {
      signerProviderServer = await startSignerProviderServer({
        identity,
        config,
        db,
        address,
        privateKey,
        signerConfig: config.signerProvider,
      });
      logger.info(`Signer provider enabled at ${signerProviderServer.url}`);
    } catch (error) {
      logger.warn(
        `Signer provider failed to start: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  if (config.paymasterProvider?.enabled) {
    try {
      paymasterProviderServer = await startPaymasterProviderServer({
        identity,
        config,
        db,
        address,
        privateKey,
        paymasterConfig: config.paymasterProvider,
      });
      logger.info(`Paymaster provider enabled at ${paymasterProviderServer.url}`);
    } catch (error) {
      logger.warn(
        `Paymaster provider failed to start: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  if (config.agentDiscovery?.gatewayServer?.enabled) {
    try {
      if (
        config.agentDiscovery.gatewayServer.registerCapabilityOnStartup &&
        config.rpcUrl
      ) {
        try {
          await registerCapabilityName({
            rpcUrl: config.rpcUrl,
            privateKey,
            name: config.agentDiscovery.gatewayServer.capability,
            waitForReceipt: false,
          });
        } catch (error) {
          logger.warn(
            `Gateway capability registration skipped: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
      if (
        config.agentDiscovery.gatewayServer.grantCapabilityBit !== undefined &&
        config.rpcUrl
      ) {
        try {
          await grantCapability({
            rpcUrl: config.rpcUrl,
            privateKey,
            target: address,
            bit: config.agentDiscovery.gatewayServer.grantCapabilityBit,
            waitForReceipt: false,
          });
        } catch (error) {
          logger.warn(
            `Gateway capability grant skipped: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
      gatewayServer = await startAgentGatewayServer({
        identity,
        config,
        db,
        gatewayConfig: config.agentDiscovery.gatewayServer,
      });
      logger.info(`Agent Gateway relay enabled at ${gatewayServer.sessionUrl}`);
    } catch (error) {
      logger.warn(
        `Agent Gateway server failed to start: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  const basePublishedAgentDiscoveryConfig =
    normalizeAgentDiscoveryConfig(config.agentDiscovery) ??
    (config.agentDiscovery?.enabled &&
    config.agentDiscovery.publishCard &&
    config.agentDiscovery.gatewayServer?.enabled
      ? {
          ...config.agentDiscovery,
          endpoints: [],
          capabilities: [],
          faucetServer: config.agentDiscovery.faucetServer
            ? { ...config.agentDiscovery.faucetServer, enabled: false }
            : undefined,
          observationServer: config.agentDiscovery.observationServer
            ? { ...config.agentDiscovery.observationServer, enabled: false }
            : undefined,
          oracleServer: config.agentDiscovery.oracleServer
            ? { ...config.agentDiscovery.oracleServer, enabled: false }
            : undefined,
          newsFetchServer: config.agentDiscovery.newsFetchServer
            ? { ...config.agentDiscovery.newsFetchServer, enabled: false }
            : undefined,
          proofVerifyServer: config.agentDiscovery.proofVerifyServer
            ? { ...config.agentDiscovery.proofVerifyServer, enabled: false }
            : undefined,
          storageServer: config.agentDiscovery.storageServer
            ? { ...config.agentDiscovery.storageServer, enabled: false }
            : undefined,
        }
      : null);

  const buildCurrentPublishedAgentDiscoveryConfig = () => {
    let current = basePublishedAgentDiscoveryConfig;
    if (liveGatewayProviderSessions.length && current) {
      const routes = buildGatewayProviderRoutes({
        config,
        faucetUrl: faucetServer?.url,
        observationUrl: observationServer?.url,
        oracleUrl: oracleServer?.url,
        newsFetchUrl: newsFetchServer?.url,
        proofVerifyUrl: proofVerifyServer?.url,
        signerUrl: signerProviderServer?.url,
        paymasterUrl: paymasterProviderServer?.url,
        storageUrl: storageServer?.url,
        discoveryStorageUrl: discoveryStorageServer?.url,
        artifactUrl: artifactServer?.url,
        mailUrl: mailServer?.url,
      });
      current = buildPublishedAgentDiscoveryConfig({
        baseConfig: current,
        gatewayServer,
        gatewayServerConfig: config.agentDiscovery?.gatewayServer,
        providerSessions: liveGatewayProviderSessions,
        providerRoutes: routes,
      });
    } else if (current && gatewayServer) {
      current = buildPublishedAgentDiscoveryConfig({
        baseConfig: current,
        gatewayServer,
        gatewayServerConfig: config.agentDiscovery?.gatewayServer,
      });
    }
    if (current && bountyServer && config.bounty?.enabled && config.bounty.role === "host") {
      const endpointUrl = bountyServer.url;
      current = {
        ...current,
        endpoints: [
          ...current.endpoints,
          {
            kind: "http",
            url: endpointUrl,
            role: "requester_invocation",
          },
        ],
        capabilities: [
          ...current.capabilities,
          {
            name: "bounty.list",
            mode: "sponsored",
            description: "List currently open task bounties",
          },
          {
            name: "bounty.get",
            mode: "sponsored",
            description: "Fetch a task bounty and its current status",
          },
          {
            name: "bounty.submit",
            mode: "sponsored",
            description: "Submit a solution to an open bounty",
          },
          {
            name: "bounty.result",
            mode: "sponsored",
            description: "Read the latest bounty result",
          },
          {
            name: "task.list",
            mode: "sponsored",
            description: "List currently open task marketplace items",
          },
          {
            name: "task.get",
            mode: "sponsored",
            description: "Fetch a task and its current status",
          },
          {
            name: "task.submit",
            mode: "sponsored",
            description: "Submit a solution to an open task",
          },
          {
            name: "task.result",
            mode: "sponsored",
            description: "Read the latest task result",
          },
          {
            name: "translation.submit",
            mode: "sponsored",
            description: "Submit an answer to an open translation task",
          },
          {
            name: "social.submit",
            mode: "sponsored",
            description: "Submit a proof to an open social task",
          },
          {
            name: "task.solve",
            mode: "sponsored",
            description: "Submit a solution to an open third-party problem-solving task",
          },
        ],
      };
    }
    if (
      current &&
      signerProviderServer &&
      config.signerProvider?.enabled &&
      config.signerProvider.publishToDiscovery
    ) {
      const signerPolicyHash = hashSignerPolicy({
        providerAddress: address,
        policy: config.signerProvider.policy,
      });
      const signerPolicy = {
        trust_tier: config.signerProvider.policy.trustTier,
        wallet_address:
          config.signerProvider.policy.walletAddress || address,
        policy_id: config.signerProvider.policy.policyId,
        policy_hash: signerPolicyHash,
        delegate_identity:
          config.signerProvider.policy.delegateIdentity || null,
        expires_at: config.signerProvider.policy.expiresAt || null,
      };
      current = {
        ...current,
        endpoints: [
          ...current.endpoints,
          {
            kind: "http",
            url: signerProviderServer.url,
            role: "requester_invocation",
          },
        ],
        capabilities: [
          ...current.capabilities,
          {
            name: `${config.signerProvider.capabilityPrefix}.quote`,
            mode: "sponsored",
            policy: signerPolicy,
            description: "Request one bounded signer-provider execution quote",
          },
          {
            name: `${config.signerProvider.capabilityPrefix}.submit`,
            mode: "paid",
            priceModel: "x402-exact",
            policy: signerPolicy,
            description: "Submit one bounded signer-provider execution request",
          },
          {
            name: `${config.signerProvider.capabilityPrefix}.status`,
            mode: "sponsored",
            policy: signerPolicy,
            description: "Fetch signer-provider execution status",
          },
          {
            name: `${config.signerProvider.capabilityPrefix}.receipt`,
            mode: "sponsored",
            policy: signerPolicy,
            description: "Fetch signer-provider execution receipt",
          },
        ],
      };
    }
    if (
      current &&
      paymasterProviderServer &&
      config.paymasterProvider?.enabled &&
      config.paymasterProvider.publishToDiscovery
    ) {
      const paymasterPolicyHash = hashPaymasterPolicy({
        providerAddress: address,
        policy: config.paymasterProvider.policy,
      });
      const paymasterPolicy = {
        trust_tier: config.paymasterProvider.policy.trustTier,
        sponsor_address:
          config.paymasterProvider.policy.sponsorAddress || address,
        policy_id: config.paymasterProvider.policy.policyId,
        policy_hash: paymasterPolicyHash,
        delegate_identity:
          config.paymasterProvider.policy.delegateIdentity || null,
        expires_at: config.paymasterProvider.policy.expiresAt || null,
      };
      current = {
        ...current,
        endpoints: [
          ...current.endpoints,
          {
            kind: "http",
            url: paymasterProviderServer.url,
            role: "requester_invocation",
          },
        ],
        capabilities: [
          ...current.capabilities,
          {
            name: `${config.paymasterProvider.capabilityPrefix}.quote`,
            mode: "sponsored",
            policy: paymasterPolicy,
            description: "Request one bounded paymaster-provider sponsorship quote",
          },
          {
            name: `${config.paymasterProvider.capabilityPrefix}.authorize`,
            mode: "paid",
            priceModel: "x402-exact",
            policy: paymasterPolicy,
            description: "Authorize one bounded sponsored execution through a paymaster-provider",
          },
          {
            name: `${config.paymasterProvider.capabilityPrefix}.status`,
            mode: "sponsored",
            policy: paymasterPolicy,
            description: "Fetch paymaster-provider authorization status",
          },
          {
            name: `${config.paymasterProvider.capabilityPrefix}.receipt`,
            mode: "sponsored",
            policy: paymasterPolicy,
            description: "Fetch paymaster-provider authorization receipt",
          },
        ],
      };
    }
    if (current && storageServer && config.storage?.enabled && config.storage.publishToDiscovery) {
      current = {
        ...current,
        endpoints: [
          ...current.endpoints,
          {
            kind: "http",
            url: storageServer.url,
            role: "requester_invocation",
          },
        ],
        capabilities: [
          ...current.capabilities,
          {
            name: `${config.storage.capabilityPrefix}.quote`,
            mode: "sponsored",
            description: "Quote immutable bundle storage leases",
          },
          {
            name: `${config.storage.capabilityPrefix}.put`,
            mode: "paid",
            priceModel: "x402-exact",
            description: "Store an immutable bundle by CID and receive a signed lease receipt",
          },
          {
            name: `${config.storage.capabilityPrefix}.head`,
            mode: "sponsored",
            description: "Read metadata for a stored bundle lease",
          },
          {
            name: `${config.storage.capabilityPrefix}.get`,
            mode: config.storage.allowAnonymousGet ? "sponsored" : "paid",
            priceModel: config.storage.allowAnonymousGet ? undefined : "x402-exact",
            description: "Retrieve a stored bundle by CID",
          },
          {
            name: `${config.storage.capabilityPrefix}.audit`,
            mode: "sponsored",
            description: "Audit whether a provider still holds a leased bundle",
          },
        ],
      };
    }
    if (current && artifactServer && config.artifacts?.enabled && config.artifacts.publishToDiscovery) {
      current = {
        ...current,
        endpoints: [
          ...current.endpoints,
          {
            kind: "http",
            url: artifactServer.url,
            role: "requester_invocation",
          },
        ],
        capabilities: [
          ...current.capabilities,
          {
            name: config.artifacts.captureCapability,
            mode: "sponsored",
            description: "Capture public news into immutable artifact bundles",
          },
          {
            name: config.artifacts.evidenceCapability,
            mode: "sponsored",
            description: "Capture oracle evidence into immutable artifact bundles",
          },
          {
            name: config.artifacts.aggregateCapability,
            mode: "paid",
            priceModel: "x402-exact",
            description: "Build aggregate oracle artifact bundles from stored evidence",
          },
          {
            name: config.artifacts.verificationCapability,
            mode: "sponsored",
            description: "Verify stored artifact bundles and publish verification receipts",
          },
        ],
      };
    }
    return current;
  };

  const syncPublishedAgentDiscoveryCard = async (reason: string) => {
    if (!(config.agentDiscovery?.enabled && config.agentDiscovery.publishCard)) {
      return;
    }
    const publishedAgentDiscoveryConfig = buildCurrentPublishedAgentDiscoveryConfig();
    if (
      !publishedAgentDiscoveryConfig ||
      !publishedAgentDiscoveryConfig.endpoints.length ||
      !publishedAgentDiscoveryConfig.capabilities.length
    ) {
      await clearLocalAgentDiscoveryCard({
        config,
        db,
      });
      logger.info(`Cleared Agent Discovery card because ${reason}`);
      return;
    }
    const published = await publishLocalAgentDiscoveryCard({
      identity,
      config,
      address,
      db,
      agentDiscoveryOverride: publishedAgentDiscoveryConfig,
      overrideIsNormalized: true,
    });
    if (published) {
      logger.info(
        `Published Agent Discovery card seq=${published.card.card_seq} on ${published.info.nodeId || "local node"} (${reason})`,
      );
    }
  };

  if (config.agentDiscovery?.gatewayClient?.enabled) {
    try {
      const routes = buildGatewayProviderRoutes({
        config,
        faucetUrl: faucetServer?.url,
        observationUrl: observationServer?.url,
        oracleUrl: oracleServer?.url,
        newsFetchUrl: newsFetchServer?.url,
        proofVerifyUrl: proofVerifyServer?.url,
        signerUrl: signerProviderServer?.url,
        paymasterUrl: paymasterProviderServer?.url,
        storageUrl: storageServer?.url,
        discoveryStorageUrl: discoveryStorageServer?.url,
        artifactUrl: artifactServer?.url,
        mailUrl: mailServer?.url,
      });
      if (!routes.length) {
        logger.warn(
          "Agent Gateway client enabled but no local provider routes were available",
        );
      } else {
        gatewayProviderSessions = await startAgentGatewayProviderSessions({
          identity,
          config,
          address,
          routes,
          db,
          privateKey,
        });
        logger.info(
          `Agent Gateway provider sessions opened via ${gatewayProviderSessions.sessions
            .map((session) => session.gatewayUrl)
            .join(", ")}`,
        );
        liveGatewayProviderSessions = [...gatewayProviderSessions.sessions];
        for (const session of gatewayProviderSessions.sessions) {
          void session.closed.then(async () => {
            liveGatewayProviderSessions = liveGatewayProviderSessions.filter(
              (entry) => entry !== session,
            );
            try {
              await syncPublishedAgentDiscoveryCard(
                liveGatewayProviderSessions.length
                  ? "gateway session changed"
                  : "all gateway sessions closed",
              );
            } catch (error) {
              logger.warn(
                `Agent Discovery sync after gateway session close failed: ${error instanceof Error ? error.message : String(error)}`,
              );
            }
          });
        }
      }
    } catch (error) {
      logger.warn(
        `Agent Gateway provider session failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  if (config.agentDiscovery?.enabled && config.agentDiscovery.publishCard) {
    try {
      await syncPublishedAgentDiscoveryCard("startup");
    } catch (error) {
      logger.warn(
        `Agent Discovery publish skipped: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  // Register openfox identity (one-time, immutable)
  const registrationState = db.getIdentity("remoteRegistrationStatus");
  if (registrationState !== "registered" && config.runtimeApiUrl && apiKey) {
    try {
      const genesisPromptHash = config.genesisPrompt
        ? keccak256(toHex(config.genesisPrompt))
        : undefined;
        await runtime.registerOpenFox({
          openfoxId,
          openfoxAddress: address,
          creatorAddress: config.creatorAddress,
          name: config.name,
        bio: config.creatorMessage || "",
        genesisPromptHash,
        account,
      });
      db.setIdentity("remoteRegistrationStatus", "registered");
      logger.info(`[${new Date().toISOString()}] OpenFox identity registered.`);
    } catch (err: any) {
      const status = err?.status;
      if (status === 409) {
        db.setIdentity("remoteRegistrationStatus", "conflict");
        logger.warn(`[${new Date().toISOString()}] OpenFox identity conflict: ${err.message}`);
      } else {
        db.setIdentity("remoteRegistrationStatus", "failed");
        logger.warn(`[${new Date().toISOString()}] OpenFox identity registration failed: ${err.message}`);
      }
    }
  }

  try {
    skills = loadSkills(skillsDir, db);
    logger.info(`[${new Date().toISOString()}] Loaded ${skills.length} skills.`);
  } catch (err: any) {
    logger.warn(`[${new Date().toISOString()}] Skills loading failed: ${err.message}`);
  }

  if (config.bounty?.enabled && config.bounty.role === "host") {
    try {
      const bountyEngine = createBountyEngine({
        identity,
        db,
        inference,
        bountyConfig: config.bounty,
        skillInstructions:
          db.getSkillByName(resolveBountySkillName(config.bounty))
            ?.instructions,
        payoutSender: config.rpcUrl
          ? createNativeBountyPayoutSender({
              rpcUrl: config.rpcUrl,
              privateKey,
            })
          : undefined,
        artifactManager: runtimeArtifactManager,
        marketBindingPublisher,
        marketContractDispatcher: marketContracts,
        settlementPublisher: config.settlement?.publishBounties
          ? settlementPublisher
          : undefined,
        settlementCallbacks,
      });
      bountyServer = await startBountyHttpServer({
        bountyConfig: config.bounty,
        engine: bountyEngine,
      });
      bountyAutomation = startBountyAutomation({
        identity,
        config,
        db,
        inference,
        engine: bountyEngine,
        onEvent: (message) => logger.info(`[bounty] ${message}`),
      });
      logger.info(`Bounty host server enabled at ${bountyServer.url}`);
      if (config.agentDiscovery?.enabled && config.agentDiscovery.publishCard) {
        await syncPublishedAgentDiscoveryCard("bounty server startup");
      }
    } catch (error) {
      logger.warn(
        `Bounty host server failed to start: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  } else if (config.bounty?.enabled && config.bounty.role === "solver") {
    try {
      bountyAutomation = startBountyAutomation({
        identity,
        config,
        db,
        inference,
        onEvent: (message) => logger.info(`[bounty] ${message}`),
      });
      logger.info("Bounty solver automation enabled");
    } catch (error) {
      logger.warn(
        `Bounty solver automation failed to start: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  // Create social client
  let social: SocialClientInterface | undefined;
  if (config.socialRelayUrl) {
    social = createSocialClient(config.socialRelayUrl, account);
    logger.info(`[${new Date().toISOString()}] Social relay: ${config.socialRelayUrl}`);
  }

  // Initialize PolicyEngine + SpendTracker (Phase 1.4)
  const treasuryPolicy = config.treasuryPolicy ?? DEFAULT_TREASURY_POLICY;
  const rules = createDefaultRules(treasuryPolicy);
  const policyEngine = new PolicyEngine(db.raw, rules);
  const spendTracker = new SpendTracker(db.raw);

  // Load and sync heartbeat config
  const heartbeatConfigPath = resolvePath(config.heartbeatConfigPath);
  const heartbeatConfig = loadHeartbeatConfig(heartbeatConfigPath);
  syncHeartbeatToDb(heartbeatConfig, db);

  // Initialize state repo (git)
  try {
    await initStateRepo(runtime);
    logger.info(`[${new Date().toISOString()}] State repo initialized.`);
  } catch (err: any) {
    logger.warn(`[${new Date().toISOString()}] State repo init failed: ${err.message}`);
  }

  // Start heartbeat daemon (Phase 1.1: DurableScheduler)
  const heartbeat = createHeartbeatDaemon({
    identity,
    config,
    heartbeatConfig,
    db,
    rawDb: db.raw,
    runtime,
    social,
    onWakeRequest: (reason) => {
      logger.info(`[HEARTBEAT] Wake request: ${reason}`);
      // Phase 1.1: Use wake_events table instead of KV wake_request
      insertWakeEvent(db.raw, 'heartbeat', reason);
    },
  });

  heartbeat.start();
  logger.info(`[${new Date().toISOString()}] Heartbeat daemon started.`);

  if (config.operatorApi?.enabled) {
    try {
      operatorApiServer = await startOperatorApiServer({
        config,
        db,
      });
    } catch (error) {
      logger.warn(
        `Operator API failed to start: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  if (config.ownerReports?.enabled && config.ownerReports.web.enabled) {
    try {
      ownerReportServer = await startOwnerReportServer({
        config,
        db,
      });
      if (ownerReportServer) {
        logger.info(`Owner report server enabled at ${ownerReportServer.url}`);
      }
    } catch (error) {
      logger.warn(
        `Owner report server failed to start: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  // Handle graceful shutdown
  const shutdown = () => {
    logger.info(`[${new Date().toISOString()}] Shutting down...`);
    heartbeat.stop();
    db.setAgentState("sleeping");
    Promise.allSettled([
      bountyServer?.close(),
      bountyAutomation?.close(),
      signerProviderServer?.close(),
      paymasterProviderServer?.close(),
      storageServer?.close(),
      artifactServer?.close(),
      gatewayProviderSessions?.close(),
      gatewayServer?.close(),
      operatorApiServer?.close(),
      ownerReportServer?.close(),
      faucetServer?.close(),
      observationServer?.close(),
      oracleServer?.close(),
      newsFetchServer?.close(),
      proofVerifyServer?.close(),
      discoveryStorageServer?.close(),
      mailServer?.close(),
    ]).finally(() => {
      db.close();
      process.exit(0);
    });
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);

  // ─── Main Run Loop ──────────────────────────────────────────
  // The openfox alternates between running and sleeping.
  // The heartbeat can wake it up.

  while (true) {
    try {
      // Reload skills (may have changed since last loop)
      try {
        skills = loadSkills(skillsDir, db);
      } catch (error) {
        logger.error("Skills reload failed", error instanceof Error ? error : undefined);
      }

      // Run the agent loop
      await runAgentLoop({
        identity,
        config,
        db,
        runtime,
        inference,
        social,
        skills,
        policyEngine,
        spendTracker,
        ollamaBaseUrl,
        onStateChange: (state: AgentState) => {
          logger.info(`[${new Date().toISOString()}] State: ${state}`);
        },
        onTurnComplete: (turn) => {
          logger.info(
            `[${new Date().toISOString()}] Turn ${turn.id}: ${turn.toolCalls.length} tools, ${turn.tokenUsage.totalTokens} tokens`,
          );
        },
      });

      // Agent loop exited (sleeping or dead)
      const state = db.getAgentState();

      if (state === "dead") {
        logger.info(`[${new Date().toISOString()}] OpenFox is dead. Heartbeat will continue.`);
        // In dead state, we just wait for funding
        // The heartbeat will keep checking and broadcasting distress
        await sleep(300_000); // Check every 5 minutes
        continue;
      }

      if (state === "sleeping") {
        const sleepUntilStr = db.getKV("sleep_until");
        const sleepUntil = sleepUntilStr
          ? new Date(sleepUntilStr).getTime()
          : Date.now() + 60_000;
        const sleepMs = Math.max(sleepUntil - Date.now(), 10_000);
        logger.info(
          `[${new Date().toISOString()}] Sleeping for ${Math.round(sleepMs / 1000)}s`,
        );

        // Sleep, but check for wake requests periodically
        const checkInterval = Math.min(sleepMs, 30_000);
        let slept = 0;
        while (slept < sleepMs) {
          await sleep(checkInterval);
          slept += checkInterval;

          // Phase 1.1: Check for wake events from wake_events table (atomic consume)
          const wakeEvent = consumeNextWakeEvent(db.raw);
          if (wakeEvent) {
            logger.info(
              `[${new Date().toISOString()}] Woken by ${wakeEvent.source}: ${wakeEvent.reason}`,
            );
            db.deleteKV("sleep_until");
            break;
          }
        }

        // Clear sleep state
        db.deleteKV("sleep_until");
        continue;
      }
    } catch (err: any) {
      logger.error(
        `[${new Date().toISOString()}] Fatal error in run loop: ${err.message}`,
      );
      // Wait before retrying
      await sleep(30_000);
    }
  }
}
