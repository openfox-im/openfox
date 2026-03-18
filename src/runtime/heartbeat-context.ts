/**
 * Heartbeat context and task runner utilities.
 */
import { loadConfig, resolvePath } from "../config.js";
import { createDatabase } from "../state/database.js";
import {
  loadHeartbeatConfig,
  syncHeartbeatToDb,
  syncHeartbeatScheduleToDb,
} from "../heartbeat/config.js";
import { getWallet } from "../identity/wallet.js";
import { loadApiKeyFromConfig } from "../identity/provision.js";
import { createRuntimeClient } from "../runtime/client.js";
import { createHeartbeatDaemon } from "../heartbeat/daemon.js";
import { createSocialClient } from "../social/client.js";
import {
  deriveAddressFromPrivateKey,
} from "../chain/address.js";
import type {
  OpenFoxIdentity,
  Skill,
  SocialClientInterface,
} from "../types.js";

export async function withHeartbeatContext<T>(
  fn: (params: {
    config: NonNullable<ReturnType<typeof loadConfig>>;
    db: ReturnType<typeof createDatabase>;
    heartbeatConfigPath: string;
    heartbeatConfig: ReturnType<typeof loadHeartbeatConfig>;
  }) => Promise<T> | T,
): Promise<T> {
  const config = loadConfig();
  if (!config) {
    throw new Error("OpenFox is not configured. Run openfox --setup first.");
  }

  const db = createDatabase(resolvePath(config.dbPath));
  const heartbeatConfigPath = resolvePath(config.heartbeatConfigPath);
  const heartbeatConfig = loadHeartbeatConfig(heartbeatConfigPath);
  syncHeartbeatToDb(heartbeatConfig, db);
  syncHeartbeatScheduleToDb(heartbeatConfig, db.raw);

  try {
    return await fn({ config, db, heartbeatConfigPath, heartbeatConfig });
  } finally {
    db.close();
  }
}

export async function runHeartbeatTaskNow(
  config: NonNullable<ReturnType<typeof loadConfig>>,
  taskName: string,
): Promise<void> {
  const { account, privateKey } = await getWallet();
  const apiKey = config.runtimeApiKey || loadApiKeyFromConfig() || "";
  const db = createDatabase(resolvePath(config.dbPath));
  const heartbeatConfigPath = resolvePath(config.heartbeatConfigPath);
  const heartbeatConfig = loadHeartbeatConfig(heartbeatConfigPath);
  syncHeartbeatToDb(heartbeatConfig, db);
  syncHeartbeatScheduleToDb(heartbeatConfig, db.raw);

  const createdAt = db.getIdentity("createdAt") || new Date().toISOString();
  const identity: OpenFoxIdentity = {
    name: config.name,
    address: config.walletAddress || deriveAddressFromPrivateKey(privateKey),
    account,
    creatorAddress: config.creatorAddress,
    sandboxId: config.sandboxId,
    apiKey,
    createdAt,
  };

  const runtime = createRuntimeClient({
    apiUrl: config.runtimeApiUrl,
    apiKey,
    sandboxId: config.sandboxId,
  });
  const skillsDir = config.skillsDir || "~/.openfox/skills";
  let skills: Skill[] = [];

  let social: SocialClientInterface | undefined;
  if (config.socialRelayUrl) {
    social = createSocialClient(config.socialRelayUrl, account);
  }

  const heartbeat = createHeartbeatDaemon({
    identity,
    config,
    heartbeatConfig,
    db,
    rawDb: db.raw,
    runtime,
    social,
  });

  try {
    await heartbeat.forceRun(taskName);
  } finally {
    heartbeat.stop();
    db.close();
  }
}
