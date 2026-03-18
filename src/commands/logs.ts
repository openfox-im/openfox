import { createLogger } from "../observability/logger.js";
import { buildServiceLogsReport } from "../service/logs.js";

const logger = createLogger("main");

function readNumberOption(args: string[], flag: string, fallback: number): number {
  const index = args.indexOf(flag);
  if (index === -1) return fallback;
  const raw = args[index + 1]?.trim();
  if (!raw) return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`Invalid numeric value for ${flag}: ${raw}`);
  }
  return value;
}

export async function handleLogsCommand(args: string[]): Promise<void> {
  if (args.includes("--help") || args.includes("-h") || args.includes("help")) {
    logger.info(`
OpenFox logs

Usage:
  openfox logs
  openfox logs --tail 200
`);
    return;
  }

  const tail = readNumberOption(args, "--tail", 200);
  logger.info(buildServiceLogsReport({ tail }));
}
