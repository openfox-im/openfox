import { loadConfig, resolvePath } from "../config.js";
import { createDatabase } from "../state/database.js";
import { createLogger } from "../observability/logger.js";
import {
  buildOperatorAutopilotReport,
  buildOperatorAutopilotSnapshot,
  decideOperatorApprovalRequest,
  createOperatorApprovalRequest,
  runOperatorAutopilot,
} from "../operator/autopilot.js";

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

export async function handleAutopilotCommand(args: string[]): Promise<void> {
  if (args.length === 0 || args[0] === "--help" || args[0] === "-h" || args[0] === "help") {
    logger.info(`
OpenFox autopilot

Usage:
  openfox autopilot status [--json]
  openfox autopilot run [--json]
  openfox autopilot approvals [--json] [--status <status>] [--kind <kind>] [--limit <n>]
  openfox autopilot request --kind <kind> --scope <scope> [--reason <text>] [--ttl-seconds <n>] [--json]
  openfox autopilot approve <request-id> [--note <text>] [--json]
  openfox autopilot reject <request-id> [--note <text>] [--json]
`);
    return;
  }

  const config = loadConfig();
  if (!config) {
    logger.error("OpenFox is not configured. Run openfox --setup first.");
    process.exit(1);
  }

  const db = createDatabase(resolvePath(config.dbPath));
  const asJson = args.includes("--json");
  const command = args[0] || "status";

  try {
    if (command === "status") {
      const snapshot = buildOperatorAutopilotSnapshot(config, db);
      if (asJson) {
        logger.info(JSON.stringify(snapshot, null, 2));
      } else {
        logger.info(buildOperatorAutopilotReport(snapshot));
      }
      return;
    }

    if (command === "run") {
      const result = await runOperatorAutopilot({
        config,
        db,
        actor: "cli",
        reason: "manual operator run",
      });
      logger.info(asJson ? JSON.stringify(result, null, 2) : result.summary);
      return;
    }

    if (command === "approvals") {
      const limit = readNumberOption(args, "--limit", 50);
      const status = readOption(args, "--status");
      const kind = readOption(args, "--kind");
      const items = db.listOperatorApprovalRequests(limit, {
        status:
          status === "pending" ||
          status === "approved" ||
          status === "rejected" ||
          status === "expired"
            ? status
            : undefined,
        kind:
          kind === "treasury_policy_change" ||
          kind === "spend_cap_change" ||
          kind === "signer_policy_change" ||
          kind === "paymaster_policy_change"
            ? kind
            : undefined,
      });
      if (asJson) {
        logger.info(JSON.stringify({ items }, null, 2));
      } else {
        logger.info("=== OPENFOX AUTOPILOT APPROVALS ===");
        for (const item of items) {
          logger.info(
            `${item.requestId}  [${item.status}]  ${item.kind}  scope=${item.scope}  requested_by=${item.requestedBy}`,
          );
        }
        if (!items.length) logger.info("(none)");
      }
      return;
    }

    if (command === "request") {
      const kind = readOption(args, "--kind");
      const scope = readOption(args, "--scope");
      if (
        !scope ||
        !(
          kind === "treasury_policy_change" ||
          kind === "spend_cap_change" ||
          kind === "signer_policy_change" ||
          kind === "paymaster_policy_change" ||
          kind === "opportunity_action"
        )
      ) {
        logger.error("Usage: openfox autopilot request --kind <kind> --scope <scope> [--reason <text>] [--ttl-seconds <n>] [--json]");
        process.exit(1);
      }
      const record = createOperatorApprovalRequest({
        db,
        config,
        kind,
        scope,
        requestedBy: "cli",
        reason: readOption(args, "--reason"),
        ttlSeconds: readOption(args, "--ttl-seconds")
          ? readNumberOption(args, "--ttl-seconds", 0)
          : undefined,
      });
      logger.info(asJson ? JSON.stringify(record, null, 2) : `Created approval request ${record.requestId}`);
      return;
    }

    if (command === "approve" || command === "reject") {
      const requestId = args[1]?.trim();
      if (!requestId) {
        logger.error(`Usage: openfox autopilot ${command} <request-id> [--note <text>] [--json]`);
        process.exit(1);
      }
      const record = decideOperatorApprovalRequest({
        db,
        requestId,
        status: command === "approve" ? "approved" : "rejected",
        decidedBy: "cli",
        decisionNote: readOption(args, "--note"),
      });
      logger.info(asJson ? JSON.stringify(record, null, 2) : `${command}d ${record.requestId}`);
      return;
    }

    logger.error(`Unknown autopilot command: ${command}`);
    process.exit(1);
  } finally {
    db.close();
  }
}
