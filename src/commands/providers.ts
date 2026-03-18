import { loadConfig, resolvePath } from "../config.js";
import { createDatabase } from "../state/database.js";
import { createLogger } from "../observability/logger.js";
import {
  buildProviderReputationSnapshot,
  type ProviderReputationKind,
} from "../operator/provider-reputation.js";

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

export async function handleProvidersCommand(args: string[]): Promise<void> {
  const command = args[0] || "reputation";
  const asJson = args.includes("--json");
  if (args.includes("--help") || args.includes("-h") || command === "help") {
    logger.info(`
OpenFox providers

Usage:
  openfox providers reputation [--kind <storage|artifacts|signer|paymaster>] [--limit N] [--json]
`);
    return;
  }

  if (command !== "reputation") {
    throw new Error(`Unknown providers command: ${command}`);
  }

  const config = loadConfig();
  if (!config) {
    throw new Error("OpenFox is not configured. Run openfox --setup first.");
  }
  const db = createDatabase(resolvePath(config.dbPath));
  try {
    const kindValue = readOption(args, "--kind");
    const kind =
      kindValue === "storage" ||
      kindValue === "artifacts" ||
      kindValue === "signer" ||
      kindValue === "paymaster"
        ? (kindValue as ProviderReputationKind)
        : undefined;
    const snapshot = buildProviderReputationSnapshot({
      db,
      kind,
      limit: readNumberOption(args, "--limit", 25),
    });
    if (asJson) {
      logger.info(JSON.stringify(snapshot, null, 2));
      return;
    }
    logger.info(`
=== OPENFOX PROVIDER REPUTATION ===
Generated: ${snapshot.generatedAt}
Providers: ${snapshot.totalProviders}
Weak:      ${snapshot.weakProviders}
${snapshot.entries
  .map(
    (entry) =>
      `${entry.kind}  ${entry.providerAddress || entry.providerBaseUrl || entry.providerKey}  score=${entry.score}  grade=${entry.grade}  success=${entry.successCount}  failure=${entry.failureCount}  pending=${entry.pendingCount}`,
  )
  .join("\n")}
===================================
`);
  } finally {
    db.close();
  }
}
