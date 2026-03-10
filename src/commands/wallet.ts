import { loadConfig, resolvePath } from "../config.js";
import {
  bootstrapWalletSigner,
  buildWalletStatusSnapshot,
  formatWalletOperationError,
  formatWalletStatusReport,
  fundWalletFromLocalDevnet,
  fundWalletFromTestnet,
} from "../wallet/operator.js";
import { parseTOSAmount } from "../tos/client.js";

function readFlag(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function hasFlag(args: string[], name: string): boolean {
  return args.includes(name);
}

function parseAmount(args: string[], defaultWei?: string): bigint | undefined {
  const amountWei = readFlag(args, "--amount-wei");
  if (amountWei) return BigInt(amountWei);
  const amount = readFlag(args, "--amount");
  if (amount) return parseTOSAmount(amount);
  return defaultWei ? BigInt(defaultWei) : undefined;
}

function usage(): string {
  return `
OpenFox wallet

Usage:
  openfox wallet status [--json]
  openfox wallet fund local [--amount 5] [--amount-wei <wei>] [--from 0x...] [--password ...] [--wait]
  openfox wallet fund testnet [--amount 0.01] [--amount-wei <wei>] [--faucet-url <url>] [--reason "..."] [--wait]
  openfox wallet bootstrap-signer --type ed25519 [--generate] [--public-key 0x...] [--output <path>] [--overwrite] [--wait]

Notes:
  - local funding uses a local node-managed account via personal_sendTransaction
  - testnet funding first tries a configured faucet URL, then falls back to Agent Discovery
  - non-secp signer bootstrap is an advanced path; OpenFox local wallet flows still use the built-in secp256k1 wallet, while delegated and sponsored execution can follow on-chain signer metadata
`;
}

export async function runWalletCommand(args: string[]): Promise<void> {
  if (args.length === 0 || hasFlag(args, "--help") || hasFlag(args, "-h") || args[0] === "help") {
    console.log(usage());
    return;
  }

  const config = loadConfig();
  if (!config) {
    throw new Error("OpenFox is not configured. Run openfox --setup first.");
  }

  if (args[0] === "status") {
    try {
      const snapshot = await buildWalletStatusSnapshot(config);
      if (hasFlag(args, "--json")) {
        console.log(
          JSON.stringify(
            {
              address: snapshot.address,
              rpcUrl: snapshot.rpcUrl ?? null,
              chainId: snapshot.chainId?.toString() ?? null,
              balanceWei: snapshot.balanceWei?.toString() ?? null,
              nonce: snapshot.nonce?.toString() ?? null,
              signer: snapshot.signer ?? null,
            },
            null,
            2,
          ),
        );
        return;
      }
      console.log(formatWalletStatusReport(snapshot));
      return;
    } catch (error) {
      throw new Error(formatWalletOperationError(error));
    }
  }

  if (args[0] === "fund") {
    const mode = args[1];
    if (mode !== "local" && mode !== "testnet") {
      throw new Error("Specify `local` or `testnet` for `openfox wallet fund`.");
    }
    try {
      if (mode === "local") {
        const result = await fundWalletFromLocalDevnet({
          config,
          amountWei: parseAmount(args, config.walletFunding?.localDefaultAmountWei),
          from: readFlag(args, "--from"),
          password: readFlag(args, "--password"),
          waitForReceipt: hasFlag(args, "--wait"),
        });
        console.log(
          [
            "Local funding submitted.",
            `From: ${result.from}`,
            `To:   ${result.to}`,
            `Amount: ${result.amountWei.toString()} wei`,
            `Tx:   ${result.txHash}`,
          ].join("\n"),
        );
        return;
      }

      const result = await fundWalletFromTestnet({
        config,
        amountWei: parseAmount(args, config.walletFunding?.testnetDefaultAmountWei),
        faucetUrl: readFlag(args, "--faucet-url"),
        reason: readFlag(args, "--reason"),
        waitForReceipt: hasFlag(args, "--wait"),
      });
      console.log(
        [
          "Testnet funding requested.",
          `Provider: ${result.provider}`,
          `To: ${result.to}`,
          `Amount: ${result.amountWei.toString()} wei`,
          `Status: ${result.status}`,
          ...(result.txHash ? [`Tx: ${result.txHash}`] : []),
          ...(result.reason ? [`Reason: ${result.reason}`] : []),
        ].join("\n"),
      );
      return;
    } catch (error) {
      throw new Error(formatWalletOperationError(error));
    }
  }

  if (args[0] === "bootstrap-signer") {
    const signerType = readFlag(args, "--type") || "ed25519";
    if (signerType !== "ed25519") {
      throw new Error("Only ed25519 bootstrap is supported today.");
    }
    try {
      const result = await bootstrapWalletSigner({
        config,
        signerType: "ed25519",
        signerValue: readFlag(args, "--public-key") as `0x${string}` | undefined,
        generate: hasFlag(args, "--generate") || !readFlag(args, "--public-key"),
        outputPath: readFlag(args, "--output")
          ? resolvePath(readFlag(args, "--output")!)
          : undefined,
        overwrite: hasFlag(args, "--overwrite"),
        waitForReceipt: hasFlag(args, "--wait"),
      });
      console.log(
        [
          "Signer metadata bootstrap submitted.",
          `Signer type: ${result.signerType}`,
          `Signer value: ${result.signerValue}`,
          `Tx: ${result.txHash}`,
          ...(result.keyPath ? [`Key file: ${result.keyPath}`] : []),
          "Warning: OpenFox local wallet flows still use the built-in secp256k1 wallet. Use this advanced flow only if you understand the signer switch and delegated execution semantics.",
        ].join("\n"),
      );
      return;
    } catch (error) {
      throw new Error(formatWalletOperationError(error));
    }
  }

  throw new Error(`Unknown wallet command: ${args.join(" ")}`);
}
