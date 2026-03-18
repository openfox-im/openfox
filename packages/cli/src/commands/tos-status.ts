/**
 * openfox-cli tos-status
 *
 * Show the native wallet address, configured RPC, and current on-chain balance if available.
 */

import { loadConfig } from "@openfox/openfox/config.js";
import { loadWalletPrivateKey } from "@openfox/openfox/identity/wallet.js";
import { deriveTOSAddressFromPrivateKey as deriveAddressFromPrivateKey } from "@openfox/openfox/tos/address.js";
import {
  TOSRpcClient as RpcClient,
  formatTOSNetwork as formatNetwork,
} from "@openfox/openfox/tos/client.js";

const config = loadConfig();
if (!config) {
  console.log("No openfox configuration found.");
  process.exit(1);
}

const privateKey = loadWalletPrivateKey();
if (!privateKey) {
  console.log("No openfox wallet found.");
  process.exit(1);
}

const address = deriveAddressFromPrivateKey(privateKey);
const rpcUrl = config.rpcUrl || process.env.TOS_RPC_URL;

console.log(`
=== ${config.name} Wallet ===
Address:      ${address}
RPC URL:      ${rpcUrl || "not configured"}
`);

if (!rpcUrl) {
  process.exit(0);
}

try {
  const client = new RpcClient({ rpcUrl });
  const [chainId, balanceWei, nonce] = await Promise.all([
    client.getChainId(),
    client.getBalance(address, "latest"),
    client.getTransactionCount(address, "pending"),
  ]);

  const balance = Number(balanceWei) / 1e18;

  console.log(`Network:      ${formatNetwork(chainId)}`);
  console.log(`Balance:      ${balance.toFixed(6)} TOS`);
  console.log(`Pending nonce:${nonce.toString()}`);
} catch (error) {
  console.log(`RPC check failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
