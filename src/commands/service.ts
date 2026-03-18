import { createLogger } from "../observability/logger.js";
import {
  withHeartbeatContext,
} from "../runtime/heartbeat-context.js";
import {
  buildCombinedServiceStatusSnapshot,
  buildServiceHealthSnapshot,
  buildServiceStatusReport,
  runServiceHealthChecks,
} from "../service/operator.js";
import {
  buildManagedServiceStatusReport,
  getManagedServiceStatus,
  installManagedService,
  restartManagedService,
  startManagedService,
  stopManagedService,
  uninstallManagedService,
} from "../service/daemon.js";

const logger = createLogger("main");

export async function handleServiceCommand(args: string[]): Promise<void> {
  const command = args[0] || "status";
  const asJson = args.includes("--json");
  if (command === "--help" || command === "-h" || command === "help") {
    logger.info(`
OpenFox service

Usage:
  openfox service status [--json]
  openfox service roles [--json]
  openfox service check [--json]
  openfox service install [--force] [--no-start]
  openfox service uninstall
  openfox service start
  openfox service stop
  openfox service restart
`);
    return;
  }

  if (command === "install") {
    const force = args.includes("--force");
    const start = !args.includes("--no-start");
    const plan = installManagedService({ force, start });
    logger.info(`Installed managed service: ${plan.unitPath}`);
    logger.info(start ? "Service enabled and started." : "Service enabled.");
    return;
  }

  if (command === "uninstall") {
    const plan = uninstallManagedService();
    logger.info(`Removed managed service: ${plan.unitPath}`);
    return;
  }

  if (command === "start") {
    const plan = startManagedService();
    logger.info(`Started managed service: ${plan.unitName}`);
    return;
  }

  if (command === "stop") {
    const plan = stopManagedService();
    logger.info(`Stopped managed service: ${plan.unitName}`);
    return;
  }

  if (command === "restart") {
    const plan = restartManagedService();
    logger.info(`Restarted managed service: ${plan.unitName}`);
    return;
  }

  await withHeartbeatContext(async ({ config, db }) => {
    if (command === "status" || command === "roles") {
      if (asJson) {
        logger.info(
          JSON.stringify(
            buildCombinedServiceStatusSnapshot(getManagedServiceStatus(), config, db.raw),
            null,
            2,
          ),
        );
        return;
      }
      logger.info(buildManagedServiceStatusReport(getManagedServiceStatus()));
      logger.info(buildServiceStatusReport(config, db.raw));
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

    throw new Error(`Unknown service command: ${command}`);
  });
}
