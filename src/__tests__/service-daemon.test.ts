import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildManagedServiceStatusReport,
  getManagedServiceStatus,
  installManagedService,
  restartManagedService,
  startManagedService,
  stopManagedService,
  uninstallManagedService,
} from "../service/daemon.js";

type CommandCall = { command: string; args: string[] };

function createRunner(
  impl?: (command: string, args: string[]) => {
    ok: boolean;
    status: number | null;
    stdout: string;
    stderr: string;
  },
) {
  const calls: CommandCall[] = [];
  return {
    calls,
    runner: (command: string, args: string[]) => {
      calls.push({ command, args });
      if (impl) {
        return impl(command, args);
      }
      return { ok: true, status: 0, stdout: "", stderr: "" };
    },
  };
}

let originalHome: string | undefined;
let tempHome: string;

beforeEach(() => {
  originalHome = process.env.HOME;
  tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "openfox-service-"));
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

const isLinux = process.platform === "linux";

describe("managed service lifecycle", () => {
  it.skipIf(!isLinux)("installs a systemd user unit with a stable openfox exec path", () => {
    const { calls, runner } = createRunner((command, args) => {
      if (command === "systemctl" && args[1] === "--version") {
        return { ok: true, status: 0, stdout: "systemd 255", stderr: "" };
      }
      return { ok: true, status: 0, stdout: "", stderr: "" };
    });

    const plan = installManagedService({ force: true, start: false }, runner);
    const unit = fs.readFileSync(plan.unitPath, "utf8");

    expect(unit).toContain("Description=OpenFox Agent Runtime");
    expect(unit).toContain("ExecStart=/bin/bash -lc 'exec ");
    expect(unit).toContain("StandardOutput=append:%h/.openfox/openfox-service.log");
    expect(unit).toContain('Environment=HOME=%h');
    expect(calls.map((entry) => entry.args.join(" "))).toContain("--user daemon-reload");
    expect(calls.map((entry) => entry.args.join(" "))).toContain("--user enable openfox.service");
  });

  it.skipIf(!isLinux)("reports installed/enabled/active systemd user service state", () => {
    const unitDir = path.join(tempHome, ".config", "systemd", "user");
    fs.mkdirSync(unitDir, { recursive: true });
    fs.writeFileSync(path.join(unitDir, "openfox.service"), "[Unit]\nDescription=OpenFox\n");

    const { runner } = createRunner((command, args) => {
      if (command !== "systemctl") {
        return { ok: false, status: 1, stdout: "", stderr: "unexpected command" };
      }
      const joined = args.join(" ");
      if (joined === "--user --version") {
        return { ok: true, status: 0, stdout: "systemd 255", stderr: "" };
      }
      if (joined === "--user is-enabled openfox.service") {
        return { ok: true, status: 0, stdout: "enabled\n", stderr: "" };
      }
      if (joined === "--user is-active openfox.service") {
        return { ok: true, status: 0, stdout: "active\n", stderr: "" };
      }
      return { ok: true, status: 0, stdout: "", stderr: "" };
    });

    const status = getManagedServiceStatus(runner);
    expect(status.installed).toBe(true);
    expect(status.enabled).toBe(true);
    expect(status.active).toBe("active");

    const report = buildManagedServiceStatusReport(status);
    expect(report).toContain("Installed: yes");
    expect(report).toContain("Enabled: yes");
    expect(report).toContain("Active: active");
  });

  it.skipIf(!isLinux)("runs lifecycle commands and removes the installed unit", () => {
    const { calls, runner } = createRunner((command, args) => {
      if (command === "systemctl" && args[1] === "--version") {
        return { ok: true, status: 0, stdout: "systemd 255", stderr: "" };
      }
      return { ok: true, status: 0, stdout: "", stderr: "" };
    });

    const plan = installManagedService({ force: true, start: true }, runner);
    startManagedService(runner);
    stopManagedService(runner);
    restartManagedService(runner);
    uninstallManagedService(runner);

    expect(fs.existsSync(plan.unitPath)).toBe(false);
    expect(calls.map((entry) => entry.args.join(" "))).toContain("--user start openfox.service");
    expect(calls.map((entry) => entry.args.join(" "))).toContain("--user stop openfox.service");
    expect(calls.map((entry) => entry.args.join(" "))).toContain("--user restart openfox.service");
    expect(calls.map((entry) => entry.args.join(" "))).toContain(
      "--user disable --now openfox.service",
    );
  });
});
