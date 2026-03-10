import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { publicKeyToNativeAddress } from "tosdk";
import { createTestConfig } from "./mocks.js";

describe("wallet operator", () => {
  const originalHome = process.env.HOME;
  const originalFetch = global.fetch;
  let tempHome: string;

  beforeEach(() => {
    vi.resetModules();
    tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "openfox-wallet-"));
    process.env.HOME = tempHome;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
    fs.rmSync(tempHome, { recursive: true, force: true });
  });

  it("builds a local wallet status snapshot without rpc", async () => {
    const { getWallet } = await import("../identity/wallet.js");
    const { buildWalletStatusSnapshot } = await import("../wallet/operator.js");

    const { privateKey } = await getWallet();
    const config = createTestConfig({
      walletAddress: undefined,
      rpcUrl: undefined,
    });

    const snapshot = await buildWalletStatusSnapshot(config);
    expect(snapshot.address).toMatch(/^0x[0-9a-f]{64}$/);
    expect(snapshot.rpcUrl).toBeUndefined();
    void privateKey;
  });

  it.each([
    { signerType: "ed25519", expectedPublicKeyLength: 64 },
    { signerType: "secp256r1", expectedPublicKeyLength: 130 },
    { signerType: "bls12-381", expectedPublicKeyLength: 96 },
    { signerType: "elgamal", expectedPublicKeyLength: 64 },
  ])("generates and persists $signerType signer material", async ({ signerType, expectedPublicKeyLength }) => {
    const { generateSignerMaterial } = await import("../wallet/operator.js");
    const outputPath = path.join(tempHome, ".openfox", "signers", `${signerType}.json`);
    const result = generateSignerMaterial({
      signerType: signerType as "ed25519" | "secp256r1" | "bls12-381" | "elgamal",
      outputPath,
    });

    expect(result.signerType).toBe(signerType);
    expect(result.signerValue).toMatch(new RegExp(`^0x[0-9a-f]{${expectedPublicKeyLength}}$`));
    expect(result.privateKey).toMatch(/^0x[0-9a-f]{64}$/);
    expect(fs.existsSync(outputPath)).toBe(true);
  });

  it("requests testnet funding via a direct faucet url", async () => {
    const { getWallet } = await import("../identity/wallet.js");
    const { fundWalletFromTestnet } = await import("../wallet/operator.js");

    await getWallet();
    global.fetch = vi.fn().mockResolvedValue({
      json: async () => ({
        status: "approved",
        tx_hash: "0xfeed",
      }),
    } as unknown as Response);

    const config = createTestConfig({
      walletFunding: {
        localDefaultAmountWei: "5000000000000000000",
        testnetDefaultAmountWei: "10000000000000000",
        testnetFaucetUrl: "https://faucet.test/fund",
        testnetReason: "bootstrap openfox wallet",
      },
    });
    const result = await fundWalletFromTestnet({
      config,
      faucetUrl: "https://faucet.test/fund",
    });

    expect(result.mode).toBe("testnet");
    expect(result.provider).toBe("https://faucet.test/fund");
    expect(result.status).toBe("approved");
    expect(result.txHash).toBe("0xfeed");
  });

  it("funds the wallet from a local devnet via tos_accounts and tos_sendTransaction", async () => {
    const { getWallet } = await import("../identity/wallet.js");
    const { fundWalletFromLocalDevnet } = await import("../wallet/operator.js");

    await getWallet();
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          jsonrpc: "2.0",
          id: 1,
          result: [
            "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          ],
        }),
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ jsonrpc: "2.0", id: 2, result: "0xlocalfund" }),
      } as unknown as Response);

    const config = createTestConfig({
      rpcUrl: "http://127.0.0.1:8545",
    });
    const result = await fundWalletFromLocalDevnet({
      config,
      amountWei: 1_000_000_000_000_000n,
      waitForReceipt: false,
    });

    expect(result.mode).toBe("local");
    expect(result.from).toBe(
      "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    );
    expect(result.txHash).toBe("0xlocalfund");
    expect(global.fetch).toHaveBeenNthCalledWith(
      1,
      "http://127.0.0.1:8545",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tos_accounts",
          params: [],
        }),
      }),
    );
    expect(global.fetch).toHaveBeenNthCalledWith(
      2,
      "http://127.0.0.1:8545",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining("\"method\":\"tos_sendTransaction\""),
      }),
    );
  });

  it.each([
    "ed25519",
    "secp256r1",
    "bls12-381",
    "elgamal",
  ])("rejects bootstrap for generated %s material when the wallet address does not match", async (signerType) => {
    const { getWallet } = await import("../identity/wallet.js");
    const { bootstrapWalletSigner } = await import("../wallet/operator.js");

    await getWallet();
    const config = createTestConfig({
      rpcUrl: "http://127.0.0.1:8545",
    });
    await expect(
      bootstrapWalletSigner({
        config,
        signerType: signerType as "ed25519" | "secp256r1" | "bls12-381" | "elgamal",
        generate: true,
        waitForReceipt: false,
      }),
    ).rejects.toThrow(/already matches the signer-derived address/i);
  });

  it.each([
    { signerType: "ed25519", expectedPath: path.join(".openfox", "signers", "ed25519.json") },
    { signerType: "secp256r1", expectedPath: path.join(".openfox", "signers", "secp256r1.json") },
    { signerType: "bls12-381", expectedPath: path.join(".openfox", "signers", "bls12-381.json") },
    { signerType: "elgamal", expectedPath: path.join(".openfox", "signers", "elgamal.json") },
  ])("bootstraps signer metadata for matching $signerType wallet addresses", async ({ signerType, expectedPath }) => {
    const { getWallet } = await import("../identity/wallet.js");
    const { bootstrapWalletSigner, generateSignerMaterial } = await import("../wallet/operator.js");

    await getWallet();
    const material = generateSignerMaterial({
      signerType: signerType as "ed25519" | "secp256r1" | "bls12-381" | "elgamal",
    });
    const derivedAddress = publicKeyToNativeAddress({
      publicKey: material.signerValue,
      signerType,
    });

    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ jsonrpc: "2.0", id: 1, result: "0x682" }),
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ jsonrpc: "2.0", id: 2, result: "0x0" }),
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ jsonrpc: "2.0", id: 3, result: "0xbootstrap" }),
      } as unknown as Response);

    const config = createTestConfig({
      rpcUrl: "http://127.0.0.1:8545",
      walletAddress: derivedAddress,
    });
    const result = await bootstrapWalletSigner({
      config,
      signerType: signerType as "ed25519" | "secp256r1" | "bls12-381" | "elgamal",
      signerValue: material.signerValue,
      signerPrivateKey: material.privateKey,
      waitForReceipt: false,
    });

    expect(result.signerType).toBe(signerType);
    expect(result.signerValue).toBe(material.signerValue);
    expect(result.txHash).toBe("0xbootstrap");
    expect(material.keyPath).toContain(expectedPath);
  });
});
