import { loadConfig, resolvePath } from "../config.js";
import { createDatabase } from "../state/database.js";
import { createLogger } from "../observability/logger.js";
import {
  buildOperatorFinanceReport,
  buildOperatorFinanceSnapshot,
} from "../operator/wallet-finance.js";

const logger = createLogger("main");

export async function handleFinanceCommand(args: string[]): Promise<void> {
  const command = args[0] || "report";
  const asJson = args.includes("--json");
  if (command === "--help" || command === "-h" || command === "help") {
    logger.info(`
OpenFox finance

Usage:
  openfox finance report [--json]
`);
    return;
  }

  if (command !== "report") {
    throw new Error(`Unknown finance command: ${command}`);
  }

  const config = loadConfig();
  if (!config) {
    throw new Error("OpenFox is not configured. Run openfox --setup first.");
  }
  const db = createDatabase(resolvePath(config.dbPath));
  try {
    const snapshot = await buildOperatorFinanceSnapshot(config, db);
    if (asJson) {
      logger.info(JSON.stringify(snapshot, null, 2));
      return;
    }
    logger.info(buildOperatorFinanceReport(snapshot));
  } finally {
    db.close();
  }
}
