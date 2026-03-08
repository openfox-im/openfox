/**
 * OpenFox SIWE Provisioning
 *
 * Uses the openfox's wallet to authenticate via Sign-In With Ethereum (SIWE)
 * and create an API key for Runtime API access.
 * Adapted from runtime-mcp/src/cli/provision.ts
 */

import fs from "fs";
import path from "path";
import { SiweMessage } from "siwe";
import { getWallet, getOpenFoxDir } from "./wallet.js";
import type { ProvisionResult } from "../types.js";
import { ResilientHttpClient } from "../runtime/http-client.js";
import { deriveTOSAddressFromPrivateKey as deriveAddressFromPrivateKey } from "../tos/address.js";

const httpClient = new ResilientHttpClient();

const DEFAULT_API_URL = "https://api.openfox.ai";

/**
 * Load API key from ~/.openfox/config.json if it exists.
 */
export function loadApiKeyFromConfig(): string | null {
  const configPath = path.join(getOpenFoxDir(), "config.json");
  if (!fs.existsSync(configPath)) return null;
  try {
    const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    return config.apiKey || null;
  } catch {
    return null;
  }
}

/**
 * Save API key and wallet address to ~/.openfox/config.json
 */
function saveConfig(apiKey: string, walletAddress: string): void {
  const dir = getOpenFoxDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  const configPath = path.join(dir, "config.json");
  const config = {
    apiKey,
    walletAddress,
    provisionedAt: new Date().toISOString(),
  };
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), {
    mode: 0o600,
  });
}

/**
 * Run the full SIWE provisioning flow:
 * 1. Load wallet
 * 2. Get nonce from Runtime API
 * 3. Sign SIWE message
 * 4. Verify signature -> get JWT
 * 5. Create API key
 * 6. Save to config.json
 */
export async function provision(
  apiUrl?: string,
): Promise<ProvisionResult> {
  const url = apiUrl || process.env.OPENFOX_API_URL || DEFAULT_API_URL;

  // 1. Load wallet
  const { account, privateKey } = await getWallet();
  const walletAddress = deriveAddressFromPrivateKey(privateKey);
  const address = account.address;

  // 2. Get nonce
  const nonceResp = await httpClient.request(`${url}/v1/auth/nonce`, {
    method: "POST",
  });
  if (!nonceResp.ok) {
    throw new Error(
      `Failed to get nonce: ${nonceResp.status} ${await nonceResp.text()}`,
    );
  }
  const { nonce } = (await nonceResp.json()) as { nonce: string };

  // 3. Construct and sign SIWE message
  const siweMessage = new SiweMessage({
    domain: "openfox.ai",
    address,
    statement:
      "Sign in to Runtime as an OpenFox to provision an API key.",
    uri: `${url}/v1/auth/verify`,
    version: "1",
    chainId: 8453, // Base
    nonce,
    issuedAt: new Date().toISOString(),
  });

  const messageString = siweMessage.prepareMessage();
  const signature = await account.signMessage({ message: messageString });

  // 4. Verify signature -> get JWT
  const verifyResp = await httpClient.request(`${url}/v1/auth/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: messageString, signature }),
  });

  if (!verifyResp.ok) {
    throw new Error(
      `SIWE verification failed: ${verifyResp.status} ${await verifyResp.text()}`,
    );
  }

  const { access_token } = (await verifyResp.json()) as {
    access_token: string;
  };

  // 5. Create API key
  const keyResp = await httpClient.request(`${url}/v1/auth/api-keys`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${access_token}`,
    },
    body: JSON.stringify({ name: "openfox" }),
  });

  if (!keyResp.ok) {
    throw new Error(
      `Failed to create API key: ${keyResp.status} ${await keyResp.text()}`,
    );
  }

  const { key, key_prefix } = (await keyResp.json()) as {
    key: string;
    key_prefix: string;
  };

  // 6. Save to config
  saveConfig(key, walletAddress);

  return { apiKey: key, walletAddress, keyPrefix: key_prefix };
}

/**
 * Register the openfox's creator as its parent with Runtime.
 * This allows the creator to see openfox logs and inference calls.
 */
export async function registerParent(
  creatorAddress: string,
  apiUrl?: string,
): Promise<void> {
  const url = apiUrl || process.env.OPENFOX_API_URL || DEFAULT_API_URL;
  const apiKey = loadApiKeyFromConfig();
  if (!apiKey) {
    throw new Error("Must provision API key before registering parent");
  }

  const resp = await httpClient.request(`${url}/v1/openfox/register-parent`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: apiKey,
    },
    body: JSON.stringify({ creatorAddress }),
  });

  // Endpoint may not exist yet -- fail gracefully
  if (!resp.ok && resp.status !== 404) {
    throw new Error(
      `Failed to register parent: ${resp.status} ${await resp.text()}`,
    );
  }
}
