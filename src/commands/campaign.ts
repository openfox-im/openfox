import { loadConfig, resolvePath } from "../config.js";
import { createDatabase } from "../state/database.js";
import { createLogger } from "../observability/logger.js";
import { loadApiKeyFromConfig } from "../identity/provision.js";
import { createBountyEngine } from "../bounty/engine.js";
import {
  fetchRemoteCampaign,
  fetchRemoteCampaigns,
} from "../bounty/client.js";
import { NoopInferenceClient, resolveBountySkillName } from "../runtime/inference-factory.js";

const logger = createLogger("main");

function readOption(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index === -1) return undefined;
  return args[index + 1]?.trim() || undefined;
}

function readNumberOption(args: string[], flag: string, fallback: number): number {
  const raw = readOption(args, flag);
  if (!raw) return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`Invalid numeric value for ${flag}: ${raw}`);
  }
  return value;
}

export async function handleCampaignCommand(args: string[]): Promise<void> {
  const command = args[0] || "list";
  if (args.includes("--help") || args.includes("-h") || command === "help") {
    logger.info(`
OpenFox campaign

Usage:
  openfox campaign list [--url <base-url>]
  openfox campaign status <campaign-id> [--url <base-url>]
  openfox campaign open --title "<text>" --description "<text>" --budget-wei <wei> [--max-open-bounties <n>] [--allowed-kinds <csv>]
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
      logger.info(JSON.stringify(await fetchRemoteCampaigns(remoteBaseUrl), null, 2));
      return;
    }
    const db = createDatabase(resolvePath(config.dbPath));
    try {
      const engine = createBountyEngine({
        identity: {
          name: config.name,
          address: config.walletAddress,
          account: {} as any,
          creatorAddress: config.creatorAddress,
          sandboxId: config.sandboxId,
          apiKey: config.runtimeApiKey || loadApiKeyFromConfig() || "",
          createdAt: db.getIdentity("createdAt") || new Date().toISOString(),
        },
        db,
        inference: new NoopInferenceClient(),
        bountyConfig: config.bounty,
      });
      logger.info(JSON.stringify(engine.listCampaigns(), null, 2));
      return;
    } finally {
      db.close();
    }
  }

  if (command === "status") {
    const campaignId = args[1];
    if (!campaignId) {
      throw new Error("Usage: openfox campaign status <campaign-id> [--url <base-url>]");
    }
    if (remoteBaseUrl) {
      logger.info(JSON.stringify(await fetchRemoteCampaign(remoteBaseUrl, campaignId), null, 2));
      return;
    }
    const db = createDatabase(resolvePath(config.dbPath));
    try {
      const engine = createBountyEngine({
        identity: {
          name: config.name,
          address: config.walletAddress,
          account: {} as any,
          creatorAddress: config.creatorAddress,
          sandboxId: config.sandboxId,
          apiKey: config.runtimeApiKey || loadApiKeyFromConfig() || "",
          createdAt: db.getIdentity("createdAt") || new Date().toISOString(),
        },
        db,
        inference: new NoopInferenceClient(),
        bountyConfig: config.bounty,
      });
      const details = engine.getCampaignDetails(campaignId);
      if (!details) throw new Error(`Campaign not found: ${campaignId}`);
      logger.info(JSON.stringify(details, null, 2));
      return;
    } finally {
      db.close();
    }
  }

  if (command !== "open") {
    throw new Error(`Unknown campaign command: ${command}`);
  }

  const title = readOption(args, "--title");
  const description = readOption(args, "--description");
  const budgetWei = readOption(args, "--budget-wei");
  if (!title || !description || !budgetWei) {
    throw new Error(
      'Usage: openfox campaign open --title "<text>" --description "<text>" --budget-wei <wei> [--max-open-bounties <n>] [--allowed-kinds <csv>]',
    );
  }

  const db = createDatabase(resolvePath(config.dbPath));
  try {
    const engine = createBountyEngine({
      identity: {
        name: config.name,
        address: config.walletAddress,
        account: {} as any,
        creatorAddress: config.creatorAddress,
        sandboxId: config.sandboxId,
        apiKey: config.runtimeApiKey || loadApiKeyFromConfig() || "",
        createdAt: db.getIdentity("createdAt") || new Date().toISOString(),
      },
      db,
      inference: new NoopInferenceClient(),
      bountyConfig: config.bounty,
    });
    const allowedKinds = readOption(args, "--allowed-kinds")
      ?.split(",")
      .map((item) => item.trim())
      .filter(Boolean) as
      | Array<
          | "question"
          | "translation"
          | "social_proof"
          | "problem_solving"
          | "public_news_capture"
          | "oracle_evidence_capture"
        >
      | undefined;
    const campaign = engine.createCampaign({
      title,
      description,
      budgetWei,
      maxOpenBounties: readNumberOption(args, "--max-open-bounties", config.bounty.maxOpenBounties),
      allowedKinds,
    });
    logger.info(JSON.stringify(campaign, null, 2));
  } finally {
    db.close();
  }
}
