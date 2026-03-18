import { loadConfig, resolvePath } from "../config.js";
import { createDatabase } from "../state/database.js";
import { createLogger } from "../observability/logger.js";
import {
  buildRuntimeStatusReport,
  buildRuntimeStatusSnapshot,
} from "../operator/status.js";

const logger = createLogger("main");

export async function showStatus(options: { asJson?: boolean } = {}): Promise<void> {
  const config = loadConfig();
  if (!config) {
    if (options.asJson) {
      logger.info(
        JSON.stringify({ configured: false, message: "OpenFox is not configured." }, null, 2),
      );
    } else {
      logger.info("OpenFox is not configured. Run the setup script first.");
    }
    return;
  }

  const dbPath = resolvePath(config.dbPath);
  const db = createDatabase(dbPath);
  try {
    const snapshot = buildRuntimeStatusSnapshot(config, db);
    if (options.asJson) {
      logger.info(JSON.stringify(snapshot, null, 2));
      return;
    }
    logger.info(buildRuntimeStatusReport(snapshot));
  } finally {
    db.close();
  }
}

export async function handleStatusCommand(args: string[]): Promise<void> {
  await showStatus({ asJson: args.includes("--json") });
}
