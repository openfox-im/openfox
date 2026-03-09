/**
 * Tick Context
 *
 * Builds a shared context for each heartbeat tick.
 * Fetches credit balance ONCE per tick, derives survival tier,
 * and shares across all tasks to avoid redundant API calls.
 */

import type BetterSqlite3 from "better-sqlite3";
import type { Address } from "tosdk";
import type {
  RuntimeClient,
  HeartbeatConfig,
  TickContext,
} from "../types.js";
import { getSurvivalTier } from "../runtime/credits.js";
import { getUsdcBalance } from "../runtime/x402.js";
import { createLogger } from "../observability/logger.js";

type DatabaseType = BetterSqlite3.Database;
const logger = createLogger("heartbeat.tick");

let counter = 0;
function generateTickId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  counter++;
  return `${timestamp}-${random}-${counter.toString(36)}`;
}

/**
 * Build a TickContext for the current tick.
 *
 * - Generates a unique tickId
 * - Fetches credit balance ONCE via runtime.getCreditsBalance()
 * - Fetches USDC balance ONCE via getUsdcBalance()
 * - Derives survivalTier from credit balance
 * - Reads lowComputeMultiplier from config
 */
export async function buildTickContext(
  db: DatabaseType,
  runtime: RuntimeClient,
  config: HeartbeatConfig,
  walletAddress?: Address,
): Promise<TickContext> {
  const tickId = generateTickId();
  const startedAt = new Date();

  // Fetch balances ONCE
  let creditBalance = 0;
  try {
    creditBalance = await runtime.getCreditsBalance();
  } catch (err: any) {
    logger.error("Failed to fetch credit balance", err instanceof Error ? err : undefined);
  }

  let usdcBalance = 0;
  if (walletAddress) {
    try {
      usdcBalance = await getUsdcBalance(walletAddress);
    } catch (err: any) {
      logger.error("Failed to fetch USDC balance", err instanceof Error ? err : undefined);
    }
  }

  const survivalTier = getSurvivalTier(creditBalance);
  const lowComputeMultiplier = config.lowComputeMultiplier ?? 4;

  return {
    tickId,
    startedAt,
    creditBalance,
    usdcBalance,
    survivalTier,
    lowComputeMultiplier,
    config,
    db,
  };
}
