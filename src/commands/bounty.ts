import { loadConfig, resolvePath } from "../config.js";
import { createDatabase } from "../state/database.js";
import { createLogger } from "../observability/logger.js";
import { createBountyEngine } from "../bounty/engine.js";
import { createNativeBountyPayoutSender } from "../bounty/payout.js";
import {
  fetchRemoteBounties,
  fetchRemoteBounty,
  solveRemoteBounty,
  submitRemoteBountySubmission,
} from "../bounty/client.js";
import { getWallet } from "../identity/wallet.js";
import { loadApiKeyFromConfig } from "../identity/provision.js";
import { deriveAddressFromPrivateKey } from "../chain/address.js";
import { ModelRegistry } from "../inference/registry.js";
import { createInferenceClient } from "../runtime/inference.js";
import {
  readOption,
  readNumberOption,
} from "../cli/parse.js";
import { resolveBountySkillName } from "../runtime/inference-factory.js";

const logger = createLogger("main");

export async function handleBountyCommand(args: string[]): Promise<void> {
  const command = args[0] || "list";
  if (args.includes("--help") || args.includes("-h") || command === "help") {
    logger.info(`
OpenFox bounty

Usage:
  openfox bounty list [--url <base-url>]
  openfox bounty status <bounty-id> [--url <base-url>]
  openfox bounty open --kind <question|translation|social_proof|problem_solving|public_news_capture|oracle_evidence_capture|data_labeling> --title "<text>" --task "<prompt>" --reference "<canonical>" [--reward-tomi <tomi>] [--ttl-seconds <n>] [--skill <name>] [--campaign-id <id>]
  openfox bounty open --question "<text>" --answer "<canonical>" [--reward-tomi <tomi>] [--ttl-seconds <n>] [--campaign-id <id>]
  openfox bounty submit <bounty-id> --submission "<text>" [--proof-url <url>] [--url <base-url>]
  openfox bounty submit <bounty-id> --answer "<text>" [--url <base-url>]
  openfox bounty solve <bounty-id> --url <base-url>
`);
    return;
  }

  const config = loadConfig();
  if (!config) {
    throw new Error("OpenFox is not configured. Run openfox --setup first.");
  }
  if (!config.bounty?.enabled) {
    throw new Error("Bounty mode is not enabled in openfox.json");
  }

  const remoteBaseUrl = readOption(args, "--url");

  if (command === "list") {
    if (remoteBaseUrl) {
      logger.info(JSON.stringify(await fetchRemoteBounties(remoteBaseUrl), null, 2));
      return;
    }
    const db = createDatabase(resolvePath(config.dbPath));
    try {
      logger.info(JSON.stringify(db.listBounties(), null, 2));
      return;
    } finally {
      db.close();
    }
  }

  if (command === "status") {
    const bountyId = args[1];
    if (!bountyId) throw new Error("Usage: openfox bounty status <bounty-id> [--url <base-url>]");
    if (remoteBaseUrl) {
      logger.info(JSON.stringify(await fetchRemoteBounty(remoteBaseUrl, bountyId), null, 2));
      return;
    }
    const db = createDatabase(resolvePath(config.dbPath));
    try {
      const bounty = db.getBountyById(bountyId);
      if (!bounty) throw new Error(`Bounty not found: ${bountyId}`);
      logger.info(
        JSON.stringify(
          {
            bounty,
            submissions: db.listBountySubmissions(bountyId),
            result: db.getBountyResult(bountyId) ?? null,
          },
          null,
          2,
        ),
      );
      return;
    } finally {
      db.close();
    }
  }

  const db = createDatabase(resolvePath(config.dbPath));
  try {
    const { account, privateKey } = await getWallet();
    const apiKey = config.runtimeApiKey || loadApiKeyFromConfig() || "";
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
      ollamaBaseUrl: process.env.OLLAMA_BASE_URL || config.ollamaBaseUrl,
      getModelProvider: (modelId) => modelRegistry.get(modelId)?.provider,
    });
    const engine = createBountyEngine({
      identity: {
        name: config.name,
        address: config.walletAddress || deriveAddressFromPrivateKey(privateKey),
        account,
        creatorAddress: config.creatorAddress,
        sandboxId: config.sandboxId,
        apiKey,
        createdAt: db.getIdentity("createdAt") || new Date().toISOString(),
      },
      db,
      inference,
      bountyConfig: config.bounty,
      payoutSender:
        config.rpcUrl && config.bounty.role === "host"
          ? createNativeBountyPayoutSender({ rpcUrl: config.rpcUrl, privateKey })
          : undefined,
    });

    if (command === "open") {
      const kind = (readOption(args, "--kind") ||
        config.bounty.defaultKind) as typeof config.bounty.defaultKind;
      const taskPrompt = readOption(args, "--task") || readOption(args, "--question");
      const referenceOutput =
        readOption(args, "--reference") || readOption(args, "--answer");
      if (!taskPrompt || !referenceOutput) {
        throw new Error(
          'Usage: openfox bounty open --kind <question|translation|social_proof|problem_solving|public_news_capture|oracle_evidence_capture|data_labeling> --title "<text>" --task "<prompt>" --reference "<canonical>" [--reward-tomi <tomi>] [--ttl-seconds <n>] [--campaign-id <id>]',
        );
      }
      const ttlSeconds = readNumberOption(
        args,
        "--ttl-seconds",
        config.bounty.defaultSubmissionTtlSeconds,
      );
      const bounty = engine.openBounty({
        campaignId: readOption(args, "--campaign-id") || null,
        kind,
        title: readOption(args, "--title") || taskPrompt.slice(0, 160),
        taskPrompt,
        referenceOutput,
        rewardTomi: readOption(args, "--reward-tomi") || config.bounty.rewardTomi,
        submissionDeadline: new Date(Date.now() + ttlSeconds * 1000).toISOString(),
        skillName: readOption(args, "--skill") || resolveBountySkillName(config.bounty),
      });
      logger.info(JSON.stringify(bounty, null, 2));
      return;
    }

    if (command === "submit") {
      const bountyId = args[1];
      const submissionText =
        readOption(args, "--submission") || readOption(args, "--answer");
      if (!bountyId || !submissionText) {
        throw new Error(
          'Usage: openfox bounty submit <bounty-id> --submission "<text>" [--proof-url <url>] [--url <base-url>]',
        );
      }
      if (remoteBaseUrl) {
        logger.info(
          JSON.stringify(
            await submitRemoteBountySubmission({
              baseUrl: remoteBaseUrl,
              bountyId,
              solverAddress: config.walletAddress,
              submissionText,
              solverAgentId: config.agentId || null,
              proofUrl: readOption(args, "--proof-url") || null,
            }),
            null,
            2,
          ),
        );
        return;
      }
      logger.info(
        JSON.stringify(
          await engine.submitSubmission({
            bountyId,
            submissionText,
            solverAddress: config.walletAddress,
            solverAgentId: config.agentId || null,
            proofUrl: readOption(args, "--proof-url") || null,
          }),
          null,
          2,
        ),
      );
      return;
    }

    if (command === "solve") {
      const bountyId = args[1];
      if (!bountyId || !remoteBaseUrl) {
        throw new Error("Usage: openfox bounty solve <bounty-id> --url <base-url>");
      }
        logger.info(
          JSON.stringify(
            await solveRemoteBounty({
              baseUrl: remoteBaseUrl,
              bountyId,
              solverAddress: config.walletAddress,
              solverAgentId: config.agentId || null,
              inference,
              skillInstructions:
                db.getSkillByName(
                  resolveBountySkillName(config.bounty),
                )?.instructions,
            }),
            null,
            2,
        ),
      );
      return;
    }

    throw new Error(`Unknown bounty command: ${command}`);
  } finally {
    db.close();
  }
}
