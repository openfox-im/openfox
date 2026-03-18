import { resolvePath } from "../config.js";
import { createLogger } from "../observability/logger.js";
import {
  buildFleetDashboardReport,
  buildFleetDashboardSnapshot,
  exportFleetDashboardBundle,
  exportFleetDashboard,
} from "../operator/dashboard.js";

const logger = createLogger("main");

function readOption(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index === -1) return undefined;
  return args[index + 1]?.trim() || undefined;
}

function readFlag(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

export async function handleDashboardCommand(args: string[]): Promise<void> {
  const command = args[0] || "show";
  const manifestPath = readFlag(args, "--manifest");
  const asJson = args.includes("--json");
  const helpRequested =
    command === "--help" || command === "-h" || command === "help" || args.includes("--help") || args.includes("-h");

  if (helpRequested || !manifestPath) {
    logger.info(`
OpenFox dashboard

Usage:
  openfox dashboard show --manifest <path> [--json]
  openfox dashboard export --manifest <path> [--format <json|html>] [--output <path>]
  openfox dashboard bundle --manifest <path> --output <dir> [--force] [--json]
`);
    if (!manifestPath && !helpRequested) {
      throw new Error("A fleet manifest is required. Use --manifest <path>.");
    }
    return;
  }

  if (command === "show") {
    const snapshot = await buildFleetDashboardSnapshot({ manifestPath });
    if (asJson) {
      logger.info(JSON.stringify(snapshot, null, 2));
      return;
    }
    logger.info(buildFleetDashboardReport(snapshot));
    return;
  }

  if (command === "export") {
    const formatRaw = readOption(args, "--format") || "json";
    const format =
      formatRaw === "json" || formatRaw === "html"
        ? formatRaw
        : null;
    if (!format) {
      throw new Error("Invalid --format value. Expected json or html.");
    }
    const defaultOutput =
      format === "html" ? "./openfox-dashboard.html" : "./openfox-dashboard.json";
    const outputPath = resolvePath(readOption(args, "--output") || defaultOutput);
    const snapshot = await exportFleetDashboard({
      manifestPath,
      outputPath,
      format,
    });
    if (asJson) {
      logger.info(
        JSON.stringify(
          {
            format,
            outputPath,
            snapshot,
          },
          null,
          2,
        ),
      );
      return;
    }
    logger.info(`Dashboard exported to ${outputPath}`);
    logger.info(buildFleetDashboardReport(snapshot));
    return;
  }

  if (command === "bundle") {
    const outputPath = resolvePath(
      readOption(args, "--output") || "./openfox-dashboard-bundle",
    );
    const result = await exportFleetDashboardBundle({
      manifestPath,
      outputPath,
      force: args.includes("--force"),
    });
    if (asJson) {
      logger.info(JSON.stringify(result, null, 2));
      return;
    }
    logger.info(`Dashboard bundle exported to ${result.outputPath}`);
    logger.info(buildFleetDashboardReport(result.snapshot));
    return;
  }

  throw new Error(`Unknown dashboard command: ${command}`);
}
