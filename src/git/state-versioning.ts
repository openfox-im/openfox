/**
 * State Versioning
 *
 * Version control the openfox's own state files (~/.openfox/).
 * Every self-modification triggers a git commit with a descriptive message.
 * The openfox's entire identity history is version-controlled and replayable.
 */

import type { RuntimeClient, OpenFoxDatabase } from "../types.js";
import { gitInit, gitCommit, gitStatus, gitLog } from "./tools.js";

const OPENFOX_DIR = "~/.openfox";

function resolveHome(p: string): string {
  const home = process.env.HOME || "/root";
  if (p.startsWith("~")) {
    return `${home}${p.slice(1)}`;
  }
  return p;
}

/**
 * Initialize git repo for the openfox's state directory.
 * Creates .gitignore to exclude sensitive files.
 */
export async function initStateRepo(
  runtime: RuntimeClient,
): Promise<void> {
  const dir = resolveHome(OPENFOX_DIR);

  // Check if already initialized
  const checkResult = await runtime.exec(
    `test -d ${dir}/.git && echo "exists" || echo "nope"`,
    5000,
  );

  if (checkResult.stdout.trim() === "exists") {
    return;
  }

  // Initialize
  await gitInit(runtime, dir);

  // Create .gitignore for sensitive files
  const gitignore = `# Sensitive files - never commit
wallet.json
config.json
state.db
state.db-wal
state.db-shm
logs/
*.log
*.err
`;

  await runtime.writeFile(`${dir}/.gitignore`, gitignore);

  // Configure git user
  await runtime.exec(
    `cd ${dir} && git config user.name "OpenFox" && git config user.email "openfox@openfox.ai"`,
    5000,
  );

  // Initial commit
  await gitCommit(runtime, dir, "genesis: openfox state repository initialized");
}

/**
 * Commit a state change with a descriptive message.
 * Called after any self-modification.
 */
export async function commitStateChange(
  runtime: RuntimeClient,
  description: string,
  category: string = "state",
): Promise<string> {
  const dir = resolveHome(OPENFOX_DIR);

  // Check if there are changes
  const status = await gitStatus(runtime, dir);
  if (status.clean) {
    return "No changes to commit";
  }

  const message = `${category}: ${description}`;
  const result = await gitCommit(runtime, dir, message);
  return result;
}

/**
 * Commit after a SOUL.md update.
 */
export async function commitSoulUpdate(
  runtime: RuntimeClient,
  description: string,
): Promise<string> {
  return commitStateChange(runtime, description, "soul");
}

/**
 * Commit after a skill installation or removal.
 */
export async function commitSkillChange(
  runtime: RuntimeClient,
  skillName: string,
  action: "install" | "remove" | "update",
): Promise<string> {
  return commitStateChange(
    runtime,
    `${action} skill: ${skillName}`,
    "skill",
  );
}

/**
 * Commit after heartbeat config change.
 */
export async function commitHeartbeatChange(
  runtime: RuntimeClient,
  description: string,
): Promise<string> {
  return commitStateChange(runtime, description, "heartbeat");
}

/**
 * Commit after config change.
 */
export async function commitConfigChange(
  runtime: RuntimeClient,
  description: string,
): Promise<string> {
  return commitStateChange(runtime, description, "config");
}

/**
 * Get the state repo history.
 */
export async function getStateHistory(
  runtime: RuntimeClient,
  limit: number = 20,
) {
  const dir = resolveHome(OPENFOX_DIR);
  return gitLog(runtime, dir, limit);
}
