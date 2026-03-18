import { loadConfig, resolvePath } from "../config.js";
import { createDatabase } from "../state/database.js";
import { createLogger } from "../observability/logger.js";
import { getWallet } from "../identity/wallet.js";
import { loadApiKeyFromConfig } from "../identity/provision.js";
import {
  readOption,
  readNumberOption,
  collectRepeatedOption,
} from "../cli/parse.js";
import { createArtifactManager } from "../artifacts/manager.js";
import { createNativeArtifactAnchorPublisher } from "../artifacts/publisher.js";
import { runArtifactMaintenance } from "../operator/maintenance.js";
import fs from "fs/promises";

const logger = createLogger("main");

export async function handleArtifactCommand(args: string[]): Promise<void> {
  const command = args[0] || "list";
  const asJson = args.includes("--json");
  if (args.includes("--help") || args.includes("-h") || command === "help") {
    logger.info(`
OpenFox artifacts

Usage:
  openfox artifacts list [--kind <public_news.capture|oracle.evidence|oracle.aggregate|committee.vote>] [--status <stored|verified|anchored|failed>] [--source-url-prefix <url>] [--subject <text>] [--query <text>] [--anchored] [--verified] [--json]
  openfox artifacts get --artifact-id <id> [--json]
  openfox artifacts capture-news --title "<text>" --source-url <url> [--headline "<text>"] [--body-file <path> | --body-text <text>] [--provider <base-url>] [--ttl-seconds N] [--anchor] [--json]
  openfox artifacts oracle-evidence --title "<text>" --question "<text>" [--evidence-file <path> | --evidence-text <text>] [--source-url <url>] [--provider <base-url>] [--ttl-seconds N] [--anchor] [--json]
  openfox artifacts oracle-aggregate --title "<text>" --question "<text>" --result "<text>" [--votes-file <path>] [--evidence-artifact <id>]... [--provider <base-url>] [--ttl-seconds N] [--anchor] [--json]
  openfox artifacts committee-vote --title "<text>" --question "<text>" --voter-id "<id>" --vote "<text>" [--evidence-artifact <id>]... [--provider <base-url>] [--ttl-seconds N] [--anchor] [--json]
  openfox artifacts verify --artifact-id <id> [--json]
  openfox artifacts anchor --artifact-id <id> [--json]
  openfox artifacts maintain [--limit N] [--json]
`);
    return;
  }

  const config = loadConfig();
  if (!config) {
    throw new Error("OpenFox is not configured. Run openfox --setup first.");
  }
  const db = createDatabase(resolvePath(config.dbPath));
  try {
    if (command === "maintain") {
      const result = await runArtifactMaintenance({
        config,
        db,
        limit: readNumberOption(args, "--limit", 10),
      });
      logger.info(JSON.stringify(result, null, 2));
      return;
    }

    const { account, privateKey } = await getWallet();
    const anchorPublisher =
      config.artifacts?.anchor.enabled && config.rpcUrl
        ? createNativeArtifactAnchorPublisher({
            db,
            rpcUrl: config.rpcUrl,
            privateKey,
            config: config.artifacts.anchor,
            publisherAddress: config.walletAddress,
          })
        : undefined;
    const manager = createArtifactManager({
      identity: {
        name: config.name,
        address: config.walletAddress,
        account,
        creatorAddress: config.creatorAddress,
        sandboxId: config.sandboxId,
        apiKey: config.runtimeApiKey || loadApiKeyFromConfig() || "",
        createdAt: db.getIdentity("createdAt") || new Date().toISOString(),
      },
      requesterAccount: account,
      db,
      config: config.artifacts ?? {
        enabled: false,
        publishToDiscovery: true,
        defaultProviderBaseUrl: undefined,
        defaultTtlSeconds: 604800,
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
          gas: "180000",
          waitForReceipt: true,
          receiptTimeoutMs: 60000,
        },
      },
      anchorPublisher,
    });

    if (command === "list") {
      const kind = readOption(args, "--kind") as
        | "public_news.capture"
        | "oracle.evidence"
        | "oracle.aggregate"
        | "committee.vote"
        | undefined;
      const status = readOption(args, "--status") as
        | "stored"
        | "verified"
        | "anchored"
        | "failed"
        | undefined;
      const sourceUrlPrefix = readOption(args, "--source-url-prefix");
      const subjectContains = readOption(args, "--subject");
      const query = readOption(args, "--query");
      const anchoredOnly = args.includes("--anchored");
      const verifiedOnly = args.includes("--verified");
      const items = manager.listArtifacts(50, {
        kind,
        status,
        sourceUrlPrefix,
        subjectContains,
        query,
        anchoredOnly,
        verifiedOnly,
      });
      if (asJson) {
        logger.info(JSON.stringify({ items }, null, 2));
        return;
      }
      logger.info(
        [
          "=== OPENFOX ARTIFACTS ===",
          `Artifacts: ${items.length}`,
          ...items.map(
            (item) =>
              `${item.artifactId}  [${item.kind}]  status=${item.status}  cid=${item.cid}  title=${item.title}`,
          ),
          "=========================",
        ].join("\n"),
      );
      return;
    }

    if (command === "get") {
      const artifactId = readOption(args, "--artifact-id");
      if (!artifactId) throw new Error("Missing --artifact-id <id>.");
      const artifact = manager.getArtifact(artifactId);
      if (!artifact) throw new Error(`Artifact not found: ${artifactId}`);
      const verification = db.getArtifactVerificationByArtifactId(artifactId) ?? null;
      const anchor = db.getArtifactAnchorByArtifactId(artifactId) ?? null;
      logger.info(JSON.stringify({ artifact, verification, anchor }, null, 2));
      return;
    }

    if (command === "capture-news") {
      const title = readOption(args, "--title");
      const sourceUrl = readOption(args, "--source-url");
      const headline = readOption(args, "--headline") || title;
      const bodyFile = readOption(args, "--body-file");
      const bodyTextOption = readOption(args, "--body-text");
      if (!title || !sourceUrl || !headline || (!bodyFile && !bodyTextOption)) {
        throw new Error(
          "Usage: openfox artifacts capture-news --title <text> --source-url <url> [--headline <text>] [--body-file <path> | --body-text <text>] [--provider <base-url>] [--ttl-seconds N] [--anchor]",
        );
      }
      const bodyText = bodyTextOption ?? (await fs.readFile(resolvePath(bodyFile!), "utf8"));
      const result = await manager.capturePublicNews({
        providerBaseUrl: readOption(args, "--provider") || undefined,
        title,
        sourceUrl,
        headline,
        bodyText,
        ttlSeconds: readNumberOption(
          args,
          "--ttl-seconds",
          config.artifacts?.defaultTtlSeconds ?? 604800,
        ),
        autoAnchor: args.includes("--anchor"),
      });
      logger.info(JSON.stringify(result, null, 2));
      return;
    }

    if (command === "oracle-evidence") {
      const title = readOption(args, "--title");
      const question = readOption(args, "--question");
      const evidenceFile = readOption(args, "--evidence-file");
      const evidenceTextOption = readOption(args, "--evidence-text");
      if (!title || !question || (!evidenceFile && !evidenceTextOption)) {
        throw new Error(
          "Usage: openfox artifacts oracle-evidence --title <text> --question <text> [--evidence-file <path> | --evidence-text <text>] [--source-url <url>] [--provider <base-url>] [--ttl-seconds N] [--anchor]",
        );
      }
      const evidenceText =
        evidenceTextOption ?? (await fs.readFile(resolvePath(evidenceFile!), "utf8"));
      const result = await manager.createOracleEvidence({
        providerBaseUrl: readOption(args, "--provider") || undefined,
        title,
        question,
        evidenceText,
        sourceUrl: readOption(args, "--source-url") || undefined,
        ttlSeconds: readNumberOption(
          args,
          "--ttl-seconds",
          config.artifacts?.defaultTtlSeconds ?? 604800,
        ),
        autoAnchor: args.includes("--anchor"),
      });
      logger.info(JSON.stringify(result, null, 2));
      return;
    }

    if (command === "oracle-aggregate") {
      const title = readOption(args, "--title");
      const question = readOption(args, "--question");
      const resultText = readOption(args, "--result");
      if (!title || !question || !resultText) {
        throw new Error(
          "Usage: openfox artifacts oracle-aggregate --title <text> --question <text> --result <text> [--votes-file <path>] [--evidence-artifact <id>]... [--provider <base-url>] [--ttl-seconds N] [--anchor]",
        );
      }
      const evidenceArtifactIds = collectRepeatedOption(args, "--evidence-artifact");
      const votesFile = readOption(args, "--votes-file");
      const committeeVotes = votesFile
        ? (JSON.parse(await fs.readFile(resolvePath(votesFile), "utf8")) as Array<Record<string, unknown>>)
        : [];
      const result = await manager.createOracleAggregate({
        providerBaseUrl: readOption(args, "--provider") || undefined,
        title,
        question,
        resultText,
        committeeVotes,
        evidenceArtifactIds,
        ttlSeconds: readNumberOption(
          args,
          "--ttl-seconds",
          config.artifacts?.defaultTtlSeconds ?? 604800,
        ),
        autoAnchor: args.includes("--anchor"),
      });
      logger.info(JSON.stringify(result, null, 2));
      return;
    }

    if (command === "committee-vote") {
      const title = readOption(args, "--title");
      const question = readOption(args, "--question");
      const voterId = readOption(args, "--voter-id");
      const voteText = readOption(args, "--vote");
      if (!title || !question || !voterId || !voteText) {
        throw new Error(
          "Usage: openfox artifacts committee-vote --title <text> --question <text> --voter-id <id> --vote <text> [--evidence-artifact <id>]... [--provider <base-url>] [--ttl-seconds N] [--anchor]",
        );
      }
      const evidenceArtifactIds = collectRepeatedOption(args, "--evidence-artifact");
      const result = await manager.createCommitteeVote({
        providerBaseUrl: readOption(args, "--provider") || undefined,
        title,
        question,
        voterId,
        voteText,
        evidenceArtifactIds,
        ttlSeconds: readNumberOption(
          args,
          "--ttl-seconds",
          config.artifacts?.defaultTtlSeconds ?? 604800,
        ),
        autoAnchor: args.includes("--anchor"),
      });
      logger.info(JSON.stringify(result, null, 2));
      return;
    }

    if (command === "verify") {
      const artifactId = readOption(args, "--artifact-id");
      if (!artifactId) throw new Error("Missing --artifact-id <id>.");
      const result = await manager.verifyArtifact({ artifactId });
      logger.info(JSON.stringify(result, null, 2));
      return;
    }

    if (command === "anchor") {
      const artifactId = readOption(args, "--artifact-id");
      if (!artifactId) throw new Error("Missing --artifact-id <id>.");
      const result = await manager.anchorArtifact({ artifactId });
      logger.info(JSON.stringify(result, null, 2));
      return;
    }

    throw new Error(`Unknown artifacts command: ${command}`);
  } finally {
    db.close();
  }
}
