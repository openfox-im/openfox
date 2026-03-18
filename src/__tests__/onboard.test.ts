import { describe, expect, it, vi, beforeEach } from "vitest";

const loadConfig = vi.fn();
const walletExists = vi.fn();
const runSetupWizard = vi.fn();
const installManagedService = vi.fn();
const fundWalletFromLocalDevnet = vi.fn();
const fundWalletFromTestnet = vi.fn();

vi.mock("../config.js", () => ({
  loadConfig,
}));

vi.mock("../identity/wallet.js", () => ({
  walletExists,
}));

vi.mock("../setup/wizard.js", () => ({
  runSetupWizard,
}));

vi.mock("../service/daemon.js", () => ({
  installManagedService,
}));

vi.mock("../wallet/operator.js", () => ({
  fundWalletFromLocalDevnet,
  fundWalletFromTestnet,
}));

describe("runOnboard", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("can setup, fund locally, and install the daemon in one flow", async () => {
    const config = {
      name: "test-openfox",
      walletAddress:
        "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
    };
    loadConfig.mockReturnValue(null);
    walletExists.mockReturnValue(false);
    runSetupWizard.mockResolvedValue(config);

    const { runOnboard } = await import("../commands/onboard.js");
    const result = await runOnboard({
      installDaemon: true,
      fundLocal: true,
      waitForFundingReceipt: true,
    });

    expect(runSetupWizard).toHaveBeenCalled();
    expect(fundWalletFromLocalDevnet).toHaveBeenCalledWith({
      config,
      waitForReceipt: true,
    });
    expect(installManagedService).toHaveBeenCalledWith({
      force: false,
      start: true,
    });
    expect(result.fundingPerformed).toBe(true);
    expect(result.daemonInstalled).toBe(true);
  });

  it("can request testnet funding after reusing an existing config", async () => {
    const config = {
      name: "test-openfox",
      walletAddress:
        "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
    };
    loadConfig.mockReturnValue(config);
    walletExists.mockReturnValue(true);

    const { runOnboard } = await import("../commands/onboard.js");
    const result = await runOnboard({
      fundTestnet: true,
      faucetUrl: "https://faucet.test/fund",
      fundingReason: "bootstrap openfox wallet",
    });

    expect(runSetupWizard).not.toHaveBeenCalled();
    expect(fundWalletFromTestnet).toHaveBeenCalledWith({
      config,
      faucetUrl: "https://faucet.test/fund",
      reason: "bootstrap openfox wallet",
      waitForReceipt: undefined,
    });
    expect(result.fundingPerformed).toBe(true);
    expect(result.daemonInstalled).toBe(false);
  });
});
