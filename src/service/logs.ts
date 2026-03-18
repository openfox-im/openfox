import fs from "fs";
import { resolveManagedLogPath } from "./daemon.js";

function readLastLines(content: string, tail: number): string {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const trimmed = lines[lines.length - 1] === "" ? lines.slice(0, -1) : lines;
  return trimmed.slice(-tail).join("\n");
}

export function buildServiceLogsReport(options: { tail?: number } = {}): string {
  const logPath = resolveManagedLogPath();
  const tail = Math.max(1, options.tail ?? 200);

  if (!fs.existsSync(logPath)) {
    return [
      "=== OPENFOX LOGS ===",
      `Log file: ${logPath}`,
      "Status: log file does not exist yet",
      "Hint: start OpenFox with `openfox --run` or install the managed service with `openfox service install`.",
      "====================",
    ].join("\n");
  }

  const content = fs.readFileSync(logPath, "utf8");
  const body = readLastLines(content, tail);

  return [
    "=== OPENFOX LOGS ===",
    `Log file: ${logPath}`,
    `Tail: ${tail} line(s)`,
    "",
    body || "(log file is empty)",
    "====================",
  ].join("\n");
}
