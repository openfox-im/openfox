import { loadConfig, resolvePath } from "../config.js";
import { createDatabase } from "../state/database.js";
import { createLogger } from "../observability/logger.js";
import {
  readOption,
  readNumberOption,
  collectRepeatedOption,
} from "../cli/parse.js";
import {
  buildCommitteeSummaryReport,
  createCommitteeManager,
} from "../committee/manager.js";
import fs from "fs/promises";

const logger = createLogger("main");

export async function handleCommitteeCommand(args: string[]): Promise<void> {
  const command = args[0] || "list";
  const asJson = args.includes("--json");
  if (args.includes("--help") || args.includes("-h") || command === "help") {
    logger.info(`
OpenFox committee

Usage:
  openfox committee list [--kind <evidence|oracle>] [--limit N] [--json]
  openfox committee get --run-id <id> [--json]
  openfox committee summary [--kind <evidence|oracle>] [--limit N] [--json]
  openfox committee create --kind <evidence|oracle> --title <text> --question <text> --committee-size N --threshold-m N --member <id>... [--payout-total-wei <wei>] [--max-reruns N] [--subject-ref <ref>] [--artifact-id <id>]... [--json]
  openfox committee vote --run-id <id> --member-id <id> --decision <accept|reject|inconclusive> [--result-hash <0x...>] [--reason-code <code>] [--signature <0x...>] [--payout-address <0x...>] [--metadata-file <path>] [--json]
  openfox committee mark-failed --run-id <id> --member-id <id> --reason <text> [--json]
  openfox committee rerun --run-id <id> [--json]
  openfox committee tally --run-id <id> [--json]
  openfox committee payout --run-id <id> [--json]
`);
    return;
  }

  const config = loadConfig();
  if (!config) {
    throw new Error("OpenFox is not configured. Run openfox --setup first.");
  }

  const db = createDatabase(resolvePath(config.dbPath));
  const manager = createCommitteeManager(db);
  try {
    const kind = readOption(args, "--kind") as "evidence" | "oracle" | undefined;

    if (command === "list") {
      const items = manager
        .list(readNumberOption(args, "--limit", 20))
        .filter((item) => !kind || item.kind === kind);
      if (asJson) {
        logger.info(JSON.stringify({ items }, null, 2));
        return;
      }
      if (!items.length) {
        logger.info("No committee runs found.");
        return;
      }
      logger.info("=== OPENFOX COMMITTEE RUNS ===");
      for (const item of items) {
        logger.info(
          `${item.runId}  kind=${item.kind}  status=${item.status}  quorum=${item.thresholdM}/${item.committeeSize}  reruns=${item.rerunCount}/${item.maxReruns}`,
        );
      }
      return;
    }

    if (command === "get") {
      const runId = readOption(args, "--run-id");
      if (!runId) throw new Error("Usage: openfox committee get --run-id <id> [--json]");
      const item = manager.get(runId);
      if (!item) throw new Error(`Committee run not found: ${runId}`);
      logger.info(JSON.stringify(item, null, 2));
      return;
    }

    if (command === "summary") {
      const snapshot = manager.buildSummary(readNumberOption(args, "--limit", 20), kind);
      if (asJson) {
        logger.info(JSON.stringify(snapshot, null, 2));
        return;
      }
      logger.info(buildCommitteeSummaryReport(snapshot));
      return;
    }

    if (command === "create") {
      const createKind = kind;
      const title = readOption(args, "--title");
      const question = readOption(args, "--question");
      const committeeSize = readNumberOption(args, "--committee-size", 0);
      const thresholdM = readNumberOption(args, "--threshold-m", 0);
      const memberIds = collectRepeatedOption(args, "--member");
      if (!createKind || !title || !question || committeeSize <= 0 || thresholdM <= 0 || memberIds.length === 0) {
        throw new Error(
          "Usage: openfox committee create --kind <evidence|oracle> --title <text> --question <text> --committee-size N --threshold-m N --member <id>... [--payout-total-wei <wei>] [--max-reruns N] [--subject-ref <ref>] [--artifact-id <id>]... [--json]",
        );
      }
      const item = manager.createRun({
        kind: createKind,
        title,
        question,
        subjectRef: readOption(args, "--subject-ref") || null,
        artifactIds: collectRepeatedOption(args, "--artifact-id"),
        committeeSize,
        thresholdM,
        payoutTotalWei: readOption(args, "--payout-total-wei") || "0",
        maxReruns: readNumberOption(args, "--max-reruns", 1),
        members: memberIds.map((memberId) => ({ memberId })),
      });
      logger.info(JSON.stringify(item, null, 2));
      return;
    }

    if (command === "vote") {
      const runId = readOption(args, "--run-id");
      const memberId = readOption(args, "--member-id");
      const decision = readOption(args, "--decision") as
        | "accept"
        | "reject"
        | "inconclusive"
        | undefined;
      if (!runId || !memberId || !decision) {
        throw new Error(
          "Usage: openfox committee vote --run-id <id> --member-id <id> --decision <accept|reject|inconclusive> [--result-hash <0x...>] [--reason-code <code>] [--signature <0x...>] [--payout-address <0x...>] [--metadata-file <path>] [--json]",
        );
      }
      const metadataFile = readOption(args, "--metadata-file");
      const metadata = metadataFile
        ? (JSON.parse(await fs.readFile(resolvePath(metadataFile), "utf8")) as Record<string, unknown>)
        : undefined;
      const item = manager.recordVote({
        runId,
        memberId,
        decision,
        resultHash: (readOption(args, "--result-hash") || null) as `0x${string}` | null,
        reasonCode: readOption(args, "--reason-code") || null,
        signature: (readOption(args, "--signature") || null) as `0x${string}` | null,
        payoutAddress: readOption(args, "--payout-address") || null,
        metadata,
      });
      logger.info(JSON.stringify(item, null, 2));
      return;
    }

    if (command === "mark-failed") {
      const runId = readOption(args, "--run-id");
      const memberId = readOption(args, "--member-id");
      const reason = readOption(args, "--reason");
      if (!runId || !memberId || !reason) {
        throw new Error("Usage: openfox committee mark-failed --run-id <id> --member-id <id> --reason <text> [--json]");
      }
      logger.info(JSON.stringify(manager.markMemberFailed({ runId, memberId, reason }), null, 2));
      return;
    }

    if (command === "rerun") {
      const runId = readOption(args, "--run-id");
      if (!runId) throw new Error("Usage: openfox committee rerun --run-id <id> [--json]");
      logger.info(JSON.stringify(manager.rerun(runId), null, 2));
      return;
    }

    if (command === "tally") {
      const runId = readOption(args, "--run-id");
      if (!runId) throw new Error("Usage: openfox committee tally --run-id <id> [--json]");
      logger.info(JSON.stringify(manager.tally(runId), null, 2));
      return;
    }

    if (command === "payout") {
      const runId = readOption(args, "--run-id");
      if (!runId) throw new Error("Usage: openfox committee payout --run-id <id> [--json]");
      logger.info(JSON.stringify(manager.markPaid(runId), null, 2));
      return;
    }

    throw new Error(`Unknown committee command: ${command}`);
  } finally {
    db.close();
  }
}
