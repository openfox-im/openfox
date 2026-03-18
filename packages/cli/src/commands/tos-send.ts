/**
 * openfox-cli tos-send <to-address> <amount> [--wait]
 *
 * Send a native transfer using the openfox wallet.
 * Amount is interpreted as whole TOS with up to 18 decimals.
 */

import { loadConfig } from "@openfox/openfox/config.js";
import { loadWalletPrivateKey } from "@openfox/openfox/identity/wallet.js";
import { normalizeTOSAddress as normalizeAddress } from "@openfox/openfox/tos/address.js";
import {
  parseTOSAmount as parseAmount,
  sendTOSNativeTransfer as sendNativeTransfer,
} from "@openfox/openfox/tos/client.js";

const args = process.argv.slice(3);
const toAddress = args[0];
const amount = args[1];
const waitForReceipt = args.includes("--wait");
const rpcFlagIndex = args.indexOf("--rpc");
const rpcFromFlag = rpcFlagIndex >= 0 ? args[rpcFlagIndex + 1] : undefined;

if (!toAddress || !amount) {
  console.log("Usage: openfox-cli tos-send <to-address> <amount> [--wait] [--rpc http://127.0.0.1:8545]");
  console.log("Example:");
  console.log("  openfox-cli tos-send 0xabc... 1.25 --wait");
  process.exit(1);
}

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

const rpcUrl = rpcFromFlag || config.rpcUrl || process.env.TOS_RPC_URL;
if (!rpcUrl) {
  console.log("No chain RPC URL configured. Set TOS_RPC_URL or add rpcUrl to openfox config.");
  process.exit(1);
}

try {
  const normalizedTo = normalizeAddress(toAddress);
  const amountWei = parseAmount(amount);
  const { signed, txHash, receipt } = await sendNativeTransfer({
    rpcUrl,
    privateKey,
    to: normalizedTo,
    amountWei,
    waitForReceipt,
  });

  console.log(`
Transfer submitted.
To:         ${normalizedTo}
Amount:     ${amount} TOS
Nonce:      ${signed.nonce.toString()}
Gas:        ${signed.gas.toString()}
Tx hash:    ${txHash}
Raw tx:     ${signed.rawTransaction}
${receipt ? `Receipt:    ${JSON.stringify(receipt, null, 2)}` : ""}
`);
} catch (error) {
  console.log(`Transfer failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
