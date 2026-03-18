import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

export interface ManagedServicePlan {
  unitName: string;
  unitDir: string;
  unitPath: string;
  logPath: string;
  packageRoot: string;
  entryPath: string;
  nodePath: string;
  workingDirectory: string;
}

export interface ManagedServiceStatus {
  manager: "systemd-user";
  available: boolean;
  installed: boolean;
  enabled: boolean | null;
  active: "active" | "inactive" | "failed" | "unknown" | null;
  unitName: string;
  unitPath: string;
  workingDirectory: string | null;
  entryPath: string | null;
  details?: string;
}

export interface InstallManagedServiceOptions {
  force?: boolean;
  start?: boolean;
}

export interface CommandResult {
  ok: boolean;
  status: number | null;
  stdout: string;
  stderr: string;
}

export type CommandRunner = (command: string, args: string[]) => CommandResult;

function defaultRunner(command: string, args: string[]): CommandResult {
  try {
    const stdout = execFileSync(command, args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { ok: true, status: 0, stdout, stderr: "" };
  } catch (error: any) {
    return {
      ok: false,
      status:
        typeof error?.status === "number"
          ? error.status
          : typeof error?.code === "number"
            ? error.code
            : null,
      stdout: typeof error?.stdout === "string" ? error.stdout : "",
      stderr: typeof error?.stderr === "string" ? error.stderr : String(error?.message || error),
    };
  }
}

function resolveSystemdUserDir(): string {
  return path.join(os.homedir(), ".config", "systemd", "user");
}

export function resolveManagedLogPath(): string {
  return path.join(os.homedir(), ".openfox", "openfox-service.log");
}

function findPackageRoot(start: string): string | null {
  let current = path.resolve(start);
  while (true) {
    const packageJsonPath = path.join(current, "package.json");
    if (fs.existsSync(packageJsonPath)) {
      try {
        const raw = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
        if (raw?.name === "@openfox/openfox") {
          return current;
        }
      } catch {
        // ignore invalid package.json while walking upward
      }
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}

export function resolveManagedServicePlan(): ManagedServicePlan {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const packageRoot =
    findPackageRoot(process.cwd()) ||
    findPackageRoot(moduleDir) ||
    (() => {
      throw new Error("Could not locate the OpenFox package root.");
    })();
  const entryPath = path.join(packageRoot, "dist", "index.js");
  if (!fs.existsSync(entryPath)) {
    throw new Error("OpenFox dist entry was not found. Run pnpm build first.");
  }

  const unitName = "openfox.service";
  const unitDir = resolveSystemdUserDir();
  const unitPath = path.join(unitDir, unitName);
  const logPath = resolveManagedLogPath();

  return {
    unitName,
    unitDir,
    unitPath,
    logPath,
    packageRoot,
    entryPath,
    nodePath: process.execPath,
    workingDirectory: packageRoot,
  };
}

function toSystemdHomePath(value: string): string {
  const home = os.homedir();
  if (value === home) {
    return "%h";
  }
  if (value.startsWith(`${home}${path.sep}`)) {
    return `%h/${path.relative(home, value).split(path.sep).join("/")}`;
  }
  return value;
}

function toShellPath(value: string): string {
  const home = os.homedir();
  if (value === home) {
    return "$HOME";
  }
  if (value.startsWith(`${home}${path.sep}`)) {
    return `$HOME/${path.relative(home, value).split(path.sep).join("/")}`;
  }
  return value;
}

function escapeForDoubleQuotes(value: string): string {
  return value.replace(/(["\\`$])/g, "\\$1");
}

function buildExecStart(plan: ManagedServicePlan): string {
  const nodePath = escapeForDoubleQuotes(toShellPath(plan.nodePath));
  const entryPath = escapeForDoubleQuotes(toShellPath(plan.entryPath));
  return `/bin/bash -lc 'exec "${nodePath}" "${entryPath}" --run'`;
}

export function renderManagedServiceUnit(plan: ManagedServicePlan): string {
  return `[Unit]
Description=OpenFox Agent Runtime
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
Environment=HOME=%h
Environment=NODE_ENV=production
WorkingDirectory=${toSystemdHomePath(plan.workingDirectory)}
ExecStart=${buildExecStart(plan)}
Restart=always
RestartSec=5
StandardOutput=append:${toSystemdHomePath(plan.logPath)}
StandardError=append:${toSystemdHomePath(plan.logPath)}

[Install]
WantedBy=default.target
`;
}

function ensureSystemdAvailable(runner: CommandRunner): void {
  const probe = runner("systemctl", ["--user", "--version"]);
  if (!probe.ok) {
    throw new Error(`systemd user service management is unavailable: ${probe.stderr || probe.stdout || "systemctl probe failed"}`);
  }
}

export function installManagedService(
  options: InstallManagedServiceOptions = {},
  runner: CommandRunner = defaultRunner,
): ManagedServicePlan {
  if (process.platform !== "linux") {
    throw new Error("Managed OpenFox service install currently supports Linux user-systemd only.");
  }
  ensureSystemdAvailable(runner);
  const plan = resolveManagedServicePlan();

  fs.mkdirSync(plan.unitDir, { recursive: true });
  fs.mkdirSync(path.dirname(plan.logPath), { recursive: true });
  if (fs.existsSync(plan.unitPath) && !options.force) {
    throw new Error(`Service unit already exists at ${plan.unitPath}. Use --force to overwrite it.`);
  }

  fs.writeFileSync(plan.unitPath, renderManagedServiceUnit(plan), "utf8");
  runner("systemctl", ["--user", "daemon-reload"]);
  runner("systemctl", ["--user", "enable", plan.unitName]);
  if (options.start !== false) {
    runner("systemctl", ["--user", "restart", plan.unitName]);
  }
  return plan;
}

export function uninstallManagedService(
  runner: CommandRunner = defaultRunner,
): ManagedServicePlan {
  ensureSystemdAvailable(runner);
  const plan = resolveManagedServicePlan();
  if (fs.existsSync(plan.unitPath)) {
    runner("systemctl", ["--user", "disable", "--now", plan.unitName]);
    fs.unlinkSync(plan.unitPath);
    runner("systemctl", ["--user", "daemon-reload"]);
  }
  return plan;
}

export function startManagedService(runner: CommandRunner = defaultRunner): ManagedServicePlan {
  ensureSystemdAvailable(runner);
  const plan = resolveManagedServicePlan();
  runner("systemctl", ["--user", "start", plan.unitName]);
  return plan;
}

export function stopManagedService(runner: CommandRunner = defaultRunner): ManagedServicePlan {
  ensureSystemdAvailable(runner);
  const plan = resolveManagedServicePlan();
  runner("systemctl", ["--user", "stop", plan.unitName]);
  return plan;
}

export function restartManagedService(
  runner: CommandRunner = defaultRunner,
): ManagedServicePlan {
  ensureSystemdAvailable(runner);
  const plan = resolveManagedServicePlan();
  runner("systemctl", ["--user", "restart", plan.unitName]);
  return plan;
}

function normalizeActiveState(raw: string): ManagedServiceStatus["active"] {
  const value = raw.trim();
  if (value === "active" || value === "inactive" || value === "failed") {
    return value;
  }
  return value ? "unknown" : null;
}

function buildFallbackStatus(details: string): ManagedServiceStatus {
  const unitName = "openfox.service";
  const unitPath = path.join(resolveSystemdUserDir(), unitName);
  return {
    manager: "systemd-user",
    available: false,
    installed: fs.existsSync(unitPath),
    enabled: null,
    active: null,
    unitName,
    unitPath,
    workingDirectory: null,
    entryPath: null,
    details,
  };
}

export function getManagedServiceStatus(
  runner: CommandRunner = defaultRunner,
): ManagedServiceStatus {
  let plan: ManagedServicePlan;
  try {
    plan = resolveManagedServicePlan();
  } catch (error) {
    return buildFallbackStatus(error instanceof Error ? error.message : String(error));
  }
  const availability = runner("systemctl", ["--user", "--version"]);
  if (!availability.ok) {
    return {
      manager: "systemd-user",
      available: false,
      installed: fs.existsSync(plan.unitPath),
      enabled: null,
      active: null,
      unitName: plan.unitName,
      unitPath: plan.unitPath,
      workingDirectory: plan.workingDirectory,
      entryPath: plan.entryPath,
      details: availability.stderr || availability.stdout || "systemctl unavailable",
    };
  }

  const installed = fs.existsSync(plan.unitPath);
  const enabled = installed
    ? runner("systemctl", ["--user", "is-enabled", plan.unitName])
    : null;
  const active = installed
    ? runner("systemctl", ["--user", "is-active", plan.unitName])
    : null;

  return {
    manager: "systemd-user",
    available: true,
    installed,
    enabled: enabled ? enabled.ok && enabled.stdout.trim() === "enabled" : null,
    active: active ? normalizeActiveState(active.stdout || active.stderr) : null,
    unitName: plan.unitName,
    unitPath: plan.unitPath,
    workingDirectory: plan.workingDirectory,
    entryPath: plan.entryPath,
    details: installed ? undefined : "service unit not installed",
  };
}

export function buildManagedServiceStatusReport(status: ManagedServiceStatus): string {
  return [
    "=== OPENFOX MANAGED SERVICE ===",
    `Manager: ${status.manager}`,
    `Available: ${status.available ? "yes" : "no"}`,
    `Installed: ${status.installed ? "yes" : "no"}`,
    `Enabled: ${status.enabled === null ? "(unknown)" : status.enabled ? "yes" : "no"}`,
    `Active: ${status.active || "(unknown)"}`,
    `Unit: ${status.unitName}`,
    `Unit file: ${status.unitPath}`,
    `Working directory: ${status.workingDirectory || "(unknown)"}`,
    `Entry: ${status.entryPath || "(unknown)"}`,
    ...(status.details ? [`Details: ${status.details}`] : []),
    "================================",
  ].join("\n");
}
