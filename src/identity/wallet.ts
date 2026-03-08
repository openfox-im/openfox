/**
 * OpenFox Wallet Management
 *
 * Creates and manages the secp256k1 signer key used by OpenFox.
 * The user-facing wallet address is the derived 32-byte native address,
 * not the legacy 20-byte signer address.
 */

import type { PrivateKeyAccount } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import fs from "fs";
import path from "path";
import type { WalletData } from "../types.js";
import { deriveTOSAddressFromPrivateKey as deriveAddressFromPrivateKey } from "../tos/address.js";

const OPENFOX_DIR = path.join(
  process.env.HOME || "/root",
  ".openfox",
);
const WALLET_FILE = path.join(OPENFOX_DIR, "wallet.json");

export function getOpenFoxDir(): string {
  return OPENFOX_DIR;
}

export function getWalletPath(): string {
  return WALLET_FILE;
}

/**
 * Get or create the openfox's wallet.
 * The private key IS the openfox's identity -- protect it.
 */
export async function getWallet(): Promise<{
  account: PrivateKeyAccount;
  privateKey: `0x${string}`;
  isNew: boolean;
}> {
  if (!fs.existsSync(OPENFOX_DIR)) {
    fs.mkdirSync(OPENFOX_DIR, { recursive: true, mode: 0o700 });
  }

  if (fs.existsSync(WALLET_FILE)) {
    const walletData: WalletData = JSON.parse(
      fs.readFileSync(WALLET_FILE, "utf-8"),
    );
    const account = privateKeyToAccount(walletData.privateKey);
    return { account, privateKey: walletData.privateKey, isNew: false };
  } else {
    const privateKey = generatePrivateKey();
    const account = privateKeyToAccount(privateKey);

    const walletData: WalletData = {
      privateKey,
      createdAt: new Date().toISOString(),
    };

    fs.writeFileSync(WALLET_FILE, JSON.stringify(walletData, null, 2), {
      mode: 0o600,
    });

    return { account, privateKey, isNew: true };
  }
}

/**
 * Get the wallet address without loading the full account.
 */
export function getWalletAddress(): string | null {
  if (!fs.existsSync(WALLET_FILE)) {
    return null;
  }

  const walletData: WalletData = JSON.parse(
    fs.readFileSync(WALLET_FILE, "utf-8"),
  );
  return deriveAddressFromPrivateKey(walletData.privateKey);
}

/**
 * Load the full wallet account (needed for signing).
 */
export function loadWalletAccount(): PrivateKeyAccount | null {
  if (!fs.existsSync(WALLET_FILE)) {
    return null;
  }

  const walletData: WalletData = JSON.parse(
    fs.readFileSync(WALLET_FILE, "utf-8"),
  );
  return privateKeyToAccount(walletData.privateKey);
}

export function loadWalletPrivateKey(): `0x${string}` | null {
  if (!fs.existsSync(WALLET_FILE)) {
    return null;
  }

  const walletData: WalletData = JSON.parse(
    fs.readFileSync(WALLET_FILE, "utf-8"),
  );
  return walletData.privateKey;
}

export function walletExists(): boolean {
  return fs.existsSync(WALLET_FILE);
}
