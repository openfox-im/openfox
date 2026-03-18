/**
 * P2P Agent Mail — TNS Address Resolution
 *
 * Resolves human-readable TNS names (e.g. "alice" or "alice@tos.network")
 * to 0x addresses via the on-chain TOS Name Service.
 */

import { createPublicClient, http } from "tosdk";
import { createLogger } from "../observability/logger.js";

const logger = createLogger("mail.tns");

const TNS_DOMAIN_SUFFIX = "@tos.network";

/**
 * Check if an address looks like a TNS name rather than a raw 0x address.
 *
 * TNS names:
 *   - "alice"
 *   - "alice@tos.network"
 *
 * Raw addresses:
 *   - "0x1234..."
 */
export function isTnsName(address: string): boolean {
  if (address.startsWith("0x") || address.startsWith("0X")) {
    return false;
  }
  return true;
}

/**
 * Extract the bare TNS name from an address string.
 * "alice@tos.network" → "alice"
 * "alice" → "alice"
 */
export function parseTnsName(address: string): string {
  const lower = address.toLowerCase().trim();
  if (lower.endsWith(TNS_DOMAIN_SUFFIX)) {
    return lower.slice(0, -TNS_DOMAIN_SUFFIX.length);
  }
  return lower;
}

/**
 * Resolve a TNS name to a 0x address via RPC.
 * Returns the resolved address, or null if not found.
 */
export async function resolveTnsAddress(
  name: string,
  rpcUrl: string,
): Promise<string | null> {
  const bareName = parseTnsName(name);
  try {
    const client = createPublicClient({
      transport: http(rpcUrl),
    });
    const result = await client.tnsResolve({ name: bareName });
    if (!result.found) {
      logger.warn(`TNS name "${bareName}" not found`);
      return null;
    }
    return result.address;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(`TNS resolution failed for "${bareName}": ${message}`);
    return null;
  }
}

/**
 * Resolve an address that may be a TNS name or a raw 0x address.
 * If it's a TNS name, resolve it via RPC. Otherwise return as-is.
 */
export async function resolveMailAddress(
  address: string,
  rpcUrl?: string,
): Promise<string | null> {
  if (!isTnsName(address)) {
    return address.toLowerCase();
  }
  if (!rpcUrl) {
    logger.error(
      `Cannot resolve TNS name "${address}": no RPC URL configured`,
    );
    return null;
  }
  return resolveTnsAddress(address, rpcUrl);
}

/**
 * Resolve an array of addresses, replacing TNS names with 0x addresses.
 * Returns null entries for names that couldn't be resolved.
 */
export async function resolveMailAddresses(
  addresses: string[],
  rpcUrl?: string,
): Promise<{ resolved: string[]; errors: string[] }> {
  const resolved: string[] = [];
  const errors: string[] = [];

  for (const addr of addresses) {
    const result = await resolveMailAddress(addr, rpcUrl);
    if (result) {
      resolved.push(result);
    } else {
      errors.push(addr);
    }
  }

  return { resolved, errors };
}
