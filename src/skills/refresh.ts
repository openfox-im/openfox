/**
 * Skills Refresh & File Watching
 *
 * Watches SKILL.md files for changes and bumps snapshot versions so that
 * consumers (system prompt, status reports) know to reload. Inspired by
 * OpenClaw's refresh.ts. Uses fs.watch (no chokidar dependency) with
 * debouncing.
 */

import fs from "fs";
import os from "os";
import path from "path";
import { createLogger } from "../observability/logger.js";

const logger = createLogger("skills.refresh");

// ─── Types ───────────────────────────────────────────────────────

export type SkillsChangeEvent = {
  workspaceDir?: string;
  reason: "watch" | "manual" | "remote";
  changedPath?: string;
};

type WatchState = {
  watchers: fs.FSWatcher[];
  pathsKey: string;
  debounceMs: number;
  timer?: ReturnType<typeof setTimeout>;
  pendingPath?: string;
};

// ─── State ───────────────────────────────────────────────────────

const listeners = new Set<(event: SkillsChangeEvent) => void>();
const workspaceVersions = new Map<string, number>();
const watchStates = new Map<string, WatchState>();
let globalVersion = 0;

const WATCH_IGNORED = new Set([
  ".git", "node_modules", "dist", "build", ".cache",
  ".venv", "venv", "__pycache__",
]);

// ─── Public API ──────────────────────────────────────────────────

export function registerSkillsChangeListener(
  listener: (event: SkillsChangeEvent) => void,
): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function bumpSkillsSnapshotVersion(params?: {
  workspaceDir?: string;
  reason?: SkillsChangeEvent["reason"];
  changedPath?: string;
}): number {
  const reason = params?.reason ?? "manual";
  const changedPath = params?.changedPath;
  if (params?.workspaceDir) {
    const current = workspaceVersions.get(params.workspaceDir) ?? 0;
    const next = bumpVersion(current);
    workspaceVersions.set(params.workspaceDir, next);
    emit({ workspaceDir: params.workspaceDir, reason, changedPath });
    return next;
  }
  globalVersion = bumpVersion(globalVersion);
  emit({ reason, changedPath });
  return globalVersion;
}

export function getSkillsSnapshotVersion(workspaceDir?: string): number {
  if (!workspaceDir) return globalVersion;
  const local = workspaceVersions.get(workspaceDir) ?? 0;
  return Math.max(globalVersion, local);
}

/**
 * Start watching skill directories for SKILL.md changes.
 * Debounces notifications by `debounceMs` (default 250ms).
 */
export function ensureSkillsWatcher(params: {
  workspaceDir: string;
  managedSkillsDir: string;
  debounceMs?: number;
  enabled?: boolean;
}): void {
  const workspaceDir = params.workspaceDir.trim();
  if (!workspaceDir) return;

  const enabled = params.enabled !== false;
  const debounceMs = params.debounceMs ?? 250;
  const existing = watchStates.get(workspaceDir);

  if (!enabled) {
    if (existing) {
      closeWatchState(existing);
      watchStates.delete(workspaceDir);
    }
    return;
  }

  const watchPaths = resolveWatchPaths(workspaceDir, params.managedSkillsDir);
  const pathsKey = watchPaths.join("|");

  if (existing && existing.pathsKey === pathsKey && existing.debounceMs === debounceMs) {
    return;
  }
  if (existing) {
    closeWatchState(existing);
    watchStates.delete(workspaceDir);
  }

  const watchers: fs.FSWatcher[] = [];
  for (const dir of watchPaths) {
    if (!fs.existsSync(dir)) continue;
    try {
      const watcher = fs.watch(dir, { recursive: true }, (eventType, filename) => {
        if (filename && (filename.endsWith("SKILL.md") || filename.endsWith("skill.md"))) {
          const fullPath = path.join(dir, filename);
          scheduleRefresh(state, workspaceDir, debounceMs, fullPath);
        }
      });
      watcher.on("error", (err) => {
        logger.warn(`Skills watcher error for ${dir}: ${String(err)}`);
      });
      watchers.push(watcher);
    } catch {
      // Directory may not be watchable
    }
  }

  const state: WatchState = { watchers, pathsKey, debounceMs };
  watchStates.set(workspaceDir, state);
}

export function closeAllSkillsWatchers(): void {
  for (const [key, state] of watchStates) {
    closeWatchState(state);
    watchStates.delete(key);
  }
}

// ─── Internals ───────────────────────────────────────────────────

function bumpVersion(current: number): number {
  const now = Date.now();
  return now <= current ? current + 1 : now;
}

function emit(event: SkillsChangeEvent) {
  for (const listener of listeners) {
    try {
      listener(event);
    } catch (err) {
      logger.warn(`Skills change listener failed: ${String(err)}`);
    }
  }
}

function resolveWatchPaths(workspaceDir: string, managedSkillsDir: string): string[] {
  return [
    path.join(workspaceDir, "skills"),
    path.join(workspaceDir, ".agents", "skills"),
    managedSkillsDir,
    path.join(os.homedir(), ".agents", "skills"),
  ];
}

function scheduleRefresh(
  state: WatchState,
  workspaceDir: string,
  debounceMs: number,
  changedPath?: string,
) {
  state.pendingPath = changedPath ?? state.pendingPath;
  if (state.timer) clearTimeout(state.timer);
  state.timer = setTimeout(() => {
    const pending = state.pendingPath;
    state.pendingPath = undefined;
    state.timer = undefined;
    bumpSkillsSnapshotVersion({
      workspaceDir,
      reason: "watch",
      changedPath: pending,
    });
  }, debounceMs);
}

function closeWatchState(state: WatchState) {
  if (state.timer) clearTimeout(state.timer);
  for (const w of state.watchers) {
    try { w.close(); } catch { /* ignore */ }
  }
}
