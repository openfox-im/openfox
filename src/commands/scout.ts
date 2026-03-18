import { loadConfig, resolvePath } from "../config.js";
import { createDatabase } from "../state/database.js";
import { createLogger } from "../observability/logger.js";
import {
  buildOpportunityReport,
  buildRankedOpportunityReport,
  collectOpportunityItems,
  rankOpportunityItems,
} from "../opportunity/scout.js";
import {
  getCurrentStrategyProfile,
} from "../opportunity/strategy.js";

const logger = createLogger("main");

export async function handleScoutCommand(args: string[]): Promise<void> {
  const command = args[0] || "list";
  const asJson = args.includes("--json");
  if (args.includes("--help") || args.includes("-h") || command === "help") {
    logger.info(`
OpenFox scout

Usage:
  openfox scout list [--json]
  openfox scout rank [--json]
`);
    return;
  }

  if (command !== "list" && command !== "rank") {
    throw new Error(`Unknown scout command: ${command}`);
  }

  const config = loadConfig();
  if (!config) {
    throw new Error("OpenFox is not configured. Run openfox --setup first.");
  }
  const db = createDatabase(resolvePath(config.dbPath));
  try {
    const items = await collectOpportunityItems({ config, db });
    if (command === "rank") {
      const strategy = getCurrentStrategyProfile(db);
      const ranked = rankOpportunityItems({
        items,
        strategy,
        maxItems: config.opportunityScout?.maxItems,
      });
      if (asJson) {
        logger.info(JSON.stringify({ strategy, items: ranked }, null, 2));
        return;
      }
      logger.info(buildRankedOpportunityReport(ranked, strategy));
      return;
    }
    if (asJson) {
      logger.info(JSON.stringify({ items }, null, 2));
      return;
    }
    logger.info(buildOpportunityReport(items));
  } finally {
    db.close();
  }
}
