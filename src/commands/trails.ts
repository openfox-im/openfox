import { loadConfig, resolvePath } from "../config.js";
import { createDatabase } from "../state/database.js";
import { createLogger } from "../observability/logger.js";

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

export async function handleTrailsCommand(args: string[]): Promise<void> {
  const command = args[0] || "list";
  const asJson = args.includes("--json");
  if (args.includes("--help") || args.includes("-h") || command === "help") {
    logger.info(`
OpenFox trails

Usage:
  openfox trails list [--subject-kind <storage_lease|storage_renewal|storage_audit|storage_anchor|artifact|artifact_verification|artifact_anchor>] [--subject-id <id>] [--execution-kind <signer_execution|paymaster_authorization>] [--limit N] [--json]
  openfox trails get --trail-id <id> [--json]
`);
    return;
  }

  const config = loadConfig();
  if (!config) {
    throw new Error("OpenFox is not configured. Run openfox --setup first.");
  }
  const db = createDatabase(resolvePath(config.dbPath));
  try {
    if (command === "get") {
      const trailId = readOption(args, "--trail-id");
      if (!trailId) throw new Error("Missing --trail-id <id>.");
      const item = db.getExecutionTrail(trailId);
      if (!item) throw new Error(`Execution trail not found: ${trailId}`);
      logger.info(JSON.stringify(item, null, 2));
      return;
    }

    if (command !== "list") {
      throw new Error(`Unknown trails command: ${command}`);
    }

    const subjectKind = readOption(args, "--subject-kind") as
      | "storage_lease"
      | "storage_renewal"
      | "storage_audit"
      | "storage_anchor"
      | "artifact"
      | "artifact_verification"
      | "artifact_anchor"
      | undefined;
    const executionKind = readOption(args, "--execution-kind") as
      | "signer_execution"
      | "paymaster_authorization"
      | undefined;
    const subjectId = readOption(args, "--subject-id");
    const items = db.listExecutionTrails(readNumberOption(args, "--limit", 50), {
      subjectKind,
      subjectId: subjectId || undefined,
      executionKind,
    });
    if (asJson) {
      logger.info(JSON.stringify({ items }, null, 2));
      return;
    }
    logger.info(
      [
        "=== OPENFOX EXECUTION TRAILS ===",
        `Trails: ${items.length}`,
        ...items.map(
          (item) =>
            `${item.trailId}  ${item.subjectKind}:${item.subjectId}  ${item.executionKind}:${item.executionRecordId}  mode=${item.linkMode}`,
        ),
        "================================",
      ].join("\n"),
    );
  } finally {
    db.close();
  }
}
