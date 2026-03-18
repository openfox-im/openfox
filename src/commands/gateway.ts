import { createLogger } from "../observability/logger.js";
import {
  withHeartbeatContext,
} from "../runtime/heartbeat-context.js";
import {
  buildGatewayBootnodesSnapshot,
  buildGatewayStatusSnapshot,
  buildGatewayBootnodesReport,
  buildGatewayStatusReport,
  buildServiceHealthSnapshot,
  runServiceHealthChecks,
} from "../service/operator.js";

const logger = createLogger("main");

export async function handleGatewayCommand(args: string[]): Promise<void> {
  const command = args[0] || "status";
  const asJson = args.includes("--json");
  if (command === "--help" || command === "-h" || command === "help") {
    logger.info(`
OpenFox gateway

Usage:
  openfox gateway status [--json]
  openfox gateway bootnodes [--json]
  openfox gateway check [--json]
`);
    return;
  }

  await withHeartbeatContext(async ({ config, db }) => {
    if (command === "status") {
      if (asJson) {
        logger.info(JSON.stringify(await buildGatewayStatusSnapshot(config, db.raw), null, 2));
        return;
      }
      logger.info(await buildGatewayStatusReport(config, db.raw));
      return;
    }

    if (command === "bootnodes") {
      if (asJson) {
        logger.info(JSON.stringify(await buildGatewayBootnodesSnapshot(config), null, 2));
        return;
      }
      logger.info(await buildGatewayBootnodesReport(config));
      return;
    }

    if (command === "check") {
      if (asJson) {
        logger.info(JSON.stringify(await buildServiceHealthSnapshot(config), null, 2));
        return;
      }
      logger.info(await runServiceHealthChecks(config));
      return;
    }

    throw new Error(`Unknown gateway command: ${command}`);
  });
}
