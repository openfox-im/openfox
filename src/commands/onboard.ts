import { loadConfig } from "../config.js";
import { walletExists } from "../identity/wallet.js";
import { installManagedService } from "../service/daemon.js";
import { runSetupWizard } from "../setup/wizard.js";
import {
  fundWalletFromLocalDevnet,
  fundWalletFromTestnet,
} from "../wallet/operator.js";
import { readFlag } from "../cli/parse.js";
import { createLogger } from "../observability/logger.js";

const logger = createLogger("onboard");

export interface OnboardOptions {
  installDaemon?: boolean;
  forceSetup?: boolean;
  fundLocal?: boolean;
  fundTestnet?: boolean;
  waitForFundingReceipt?: boolean;
  faucetUrl?: string;
  fundingReason?: string;
}

export async function runOnboard(
  options: OnboardOptions = {},
): Promise<{
  configured: boolean;
  daemonInstalled: boolean;
  fundingPerformed: boolean;
}> {
  let config = loadConfig();
  if (options.forceSetup || !config || !walletExists()) {
    config = await runSetupWizard();
  }

  if (!config) {
    throw new Error("OpenFox onboarding failed to produce a config.");
  }

  let daemonInstalled = false;
  let fundingPerformed = false;
  if (options.fundLocal) {
    await fundWalletFromLocalDevnet({
      config,
      waitForReceipt: options.waitForFundingReceipt,
    });
    fundingPerformed = true;
  } else if (options.fundTestnet) {
    await fundWalletFromTestnet({
      config,
      faucetUrl: options.faucetUrl,
      reason: options.fundingReason,
      waitForReceipt: options.waitForFundingReceipt,
    });
    fundingPerformed = true;
  }

  if (options.installDaemon) {
    installManagedService({ force: false, start: true });
    daemonInstalled = true;
  }

  return {
    configured: true,
    daemonInstalled,
    fundingPerformed,
  };
}

export async function handleOnboardCommand(args: string[]): Promise<void> {
  if (args.includes("--help") || args.includes("-h") || args.includes("help")) {
    logger.info(`
OpenFox onboard

Usage:
  openfox onboard
  openfox onboard --install-daemon
  openfox onboard --force-setup
  openfox onboard --fund-local
  openfox onboard --fund-testnet
  openfox onboard --fund-testnet --faucet-url https://...
  openfox onboard --fund-local --wait
`);
    return;
  }

  const result = await runOnboard({
    installDaemon: args.includes("--install-daemon"),
    forceSetup: args.includes("--force-setup"),
    fundLocal: args.includes("--fund-local"),
    fundTestnet: args.includes("--fund-testnet"),
    waitForFundingReceipt: args.includes("--wait"),
    faucetUrl: readFlag(args, "--faucet-url"),
    fundingReason: readFlag(args, "--reason"),
  });

  logger.info(
    result.daemonInstalled
      ? result.fundingPerformed
        ? "OpenFox onboarding complete. Wallet funded and managed service installed."
        : "OpenFox onboarding complete. Managed service installed."
      : result.fundingPerformed
        ? "OpenFox onboarding complete. Wallet funding requested."
        : "OpenFox onboarding complete.",
  );
}
