import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildServiceLogsReport } from "../service/logs.js";

let originalHome: string | undefined;
let tempHome: string;

beforeEach(() => {
  originalHome = process.env.HOME;
  tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "openfox-logs-"));
  process.env.HOME = tempHome;
});

afterEach(() => {
  if (originalHome === undefined) {
    delete process.env.HOME;
  } else {
    process.env.HOME = originalHome;
  }
  fs.rmSync(tempHome, { recursive: true, force: true });
});

describe("service logs", () => {
  it("reports when the managed service log file does not exist", () => {
    const report = buildServiceLogsReport();
    expect(report).toContain("Status: log file does not exist yet");
  });

  it("tails the requested number of log lines", () => {
    const logDir = path.join(tempHome, ".openfox");
    fs.mkdirSync(logDir, { recursive: true });
    const logPath = path.join(logDir, "openfox-service.log");
    fs.writeFileSync(logPath, ["one", "two", "three", "four"].join("\n"));

    const report = buildServiceLogsReport({ tail: 2 });
    expect(report).toContain("three");
    expect(report).toContain("four");
    expect(report).not.toContain("one");
  });
});
