import { loadConfig } from "../config.js";
import { createLogger } from "../observability/logger.js";
import {
  buildDoctorReport,
  buildHealthSnapshot,
  buildHealthSnapshotReport,
} from "../doctor/report.js";
import { buildModelStatusReport, buildModelStatusSnapshot } from "../models/status.js";

const logger = createLogger("main");

export async function handleHealthCommand(args: string[]): Promise<void> {
  const asJson = args.includes("--json");
  const snapshot = await buildHealthSnapshot();
  if (asJson) {
    logger.info(JSON.stringify(snapshot, null, 2));
    return;
  }
  logger.info(buildHealthSnapshotReport(snapshot));
}

export async function handleDoctorCommand(args: string[]): Promise<void> {
  const asJson = args.includes("--json");
  const snapshot = await buildHealthSnapshot();
  if (asJson) {
    logger.info(JSON.stringify(snapshot, null, 2));
    return;
  }
  logger.info(buildDoctorReport(snapshot));
}

export async function handleModelsCommand(args: string[]): Promise<void> {
  const command = args[0] || "status";
  if (command === "--help" || command === "-h" || command === "help") {
    logger.info(`
OpenFox models

Usage:
  openfox models status
  openfox models status --check
  openfox models status --json
`);
    return;
  }

  if (command !== "status") {
    throw new Error(`Unknown models command: ${command}`);
  }

  const config = loadConfig();
  if (!config) {
    throw new Error("OpenFox is not configured. Run openfox --setup first.");
  }

  const snapshot = await buildModelStatusSnapshot(config, {
    check: args.includes("--check"),
  });
  if (args.includes("--json")) {
    logger.info(JSON.stringify(snapshot, null, 2));
    return;
  }
  logger.info(buildModelStatusReport(snapshot));
}
