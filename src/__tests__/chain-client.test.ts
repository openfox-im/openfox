import { afterEach, describe, expect, it, vi } from "vitest";
import {
  deriveAddressFromPrivateKey,
  normalizeAddress,
} from "../chain/address.js";
import {
  grantCapability,
  recordReputationScore,
  registerCapabilityName,
  signNativeTransfer,
  SYSTEM_ACTION_ADDRESS,
} from "../chain/client.js";

const TEST_PRIVATE_KEY =
  "0x45a915e4d060149eb4365960e6a7a45f334393093061116b197e3240065ff2d8" as const;

afterEach(() => {
  vi.restoreAllMocks();
});

describe("chain address", () => {
  it("derives 32-byte chain address from secp256k1 private key", () => {
    expect(deriveAddressFromPrivateKey(TEST_PRIVATE_KEY)).toBe(
      "0xfa7a3e1ddd55862136c8b192a94f5374fce5edbc8e2a8697c15331677e6ebf0b",
    );
  });

  it("normalizes short hex addresses by left-padding to 32 bytes", () => {
    expect(normalizeAddress("0x1234")).toBe(
      "0x0000000000000000000000000000000000000000000000000000000000000000000000000000000000001234",
    );
  });
});

describe("chain signer tx", () => {
  it("matches the chain golden vector for secp256k1", async () => {
    const signed = await signNativeTransfer(TEST_PRIVATE_KEY, {
      chainId: 1337n,
      nonce: 42n,
      gas: 50_000n,
      to: "0x752a3d0f953b4ae91fca3bf4c1b93863c1884902f778aa65ff6e3aa02f730d02",
      value: 12_345n,
      data: "0x11223344aabb",
    });

    expect(signed.from).toBe(
      "0xfa7a3e1ddd55862136c8b192a94f5374fce5edbc8e2a8697c15331677e6ebf0b",
    );
    expect(signed.signHash).toBe(
      "0x778fd048666a8350775cdc439f4c6d3560ad4b8f1d4cdf2d0018ef3152450ac5",
    );
    expect(signed.rawTransaction).toBe(
      "0x00f8a18205392a82c350a0752a3d0f953b4ae91fca3bf4c1b93863c1884902f778aa65ff6e3aa02f730d028230398611223344aabbc0a0fa7a3e1ddd55862136c8b192a94f5374fce5edbc8e2a8697c15331677e6ebf0b89736563703235366b3101a058a2e133e32e0e05987dec519426d9420e0572f77ae5253695b3d6c4db33ae78a029f7014b87e4bc512e1215f017e1e7863789e16cb67541477722df3c821d9aaf",
    );
    expect(signed.transactionHash).toBe(
      "0x0212f8771b1cfc88cd68d76163fa2ef5f4d0c14c8f87214c828cd95755eaaf97",
    );
  });

  it("builds and submits a reputation record system action", async () => {
    const originalFetch = global.fetch;
    let sendRawSeen = false;
    global.fetch = vi.fn(async (_input, init) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as {
        id: number;
        method: string;
        params: unknown[];
      };
      switch (body.method) {
        case "tos_chainId":
          return new Response(
            JSON.stringify({ jsonrpc: "2.0", id: body.id, result: "0x539" }),
            { status: 200 },
          );
        case "tos_getTransactionCount":
          return new Response(
            JSON.stringify({ jsonrpc: "2.0", id: body.id, result: "0x2a" }),
            { status: 200 },
          );
        case "tos_sendRawTransaction":
          sendRawSeen = true;
          return new Response(
            JSON.stringify({
              jsonrpc: "2.0",
              id: body.id,
              result:
                "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
            }),
            { status: 200 },
          );
        default:
          throw new Error(`unexpected rpc method ${body.method}`);
      }
    }) as typeof fetch;

    try {
      const result = await recordReputationScore({
        rpcUrl: "http://127.0.0.1:8545",
        privateKey: TEST_PRIVATE_KEY,
        who: normalizeAddress("0x42"),
        delta: "1",
        reason: "agent-discovery:success:sponsor.topup.testnet",
        refId: "agent-discovery:sponsor.topup.testnet:node-1:nonce-1",
        waitForReceipt: false,
      });

      expect(sendRawSeen).toBe(true);
      expect(result.signed.to).toBe(SYSTEM_ACTION_ADDRESS);
      expect(result.signed.value).toBe(0n);
      expect(result.signed.data.startsWith("0x")).toBe(true);
      expect(result.txHash).toBe(
        "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("builds and submits a capability register system action", async () => {
    const originalFetch = global.fetch;
    const methods: string[] = [];
    global.fetch = vi.fn(async (_input, init) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as {
        id: number;
        method: string;
        params: unknown[];
      };
      methods.push(body.method);
      switch (body.method) {
        case "tos_chainId":
          return new Response(
            JSON.stringify({ jsonrpc: "2.0", id: body.id, result: "0x539" }),
            { status: 200 },
          );
        case "tos_getTransactionCount":
          return new Response(
            JSON.stringify({ jsonrpc: "2.0", id: body.id, result: "0x1" }),
            { status: 200 },
          );
        case "tos_sendRawTransaction":
          return new Response(
            JSON.stringify({
              jsonrpc: "2.0",
              id: body.id,
              result:
                "0xabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcd",
            }),
            { status: 200 },
          );
        default:
          throw new Error(`unexpected rpc method ${body.method}`);
      }
    }) as typeof fetch;

    try {
      const result = await registerCapabilityName({
        rpcUrl: "http://127.0.0.1:8545",
        privateKey: TEST_PRIVATE_KEY,
        name: "gateway.relay",
        waitForReceipt: false,
      });

      expect(methods).toEqual([
        "tos_chainId",
        "tos_getTransactionCount",
        "tos_sendRawTransaction",
      ]);
      expect(result.signed.to).toBe(SYSTEM_ACTION_ADDRESS);
      expect(result.signed.value).toBe(0n);
      expect(Buffer.from(result.signed.data.slice(2), "hex").toString("utf8")).toContain(
        '"action":"CAPABILITY_REGISTER"',
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("builds and submits a capability grant system action", async () => {
    const originalFetch = global.fetch;
    global.fetch = vi.fn(async (_input, init) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as {
        id: number;
        method: string;
      };
      switch (body.method) {
        case "tos_chainId":
          return new Response(
            JSON.stringify({ jsonrpc: "2.0", id: body.id, result: "0x539" }),
            { status: 200 },
          );
        case "tos_getTransactionCount":
          return new Response(
            JSON.stringify({ jsonrpc: "2.0", id: body.id, result: "0x7" }),
            { status: 200 },
          );
        case "tos_sendRawTransaction":
          return new Response(
            JSON.stringify({
              jsonrpc: "2.0",
              id: body.id,
              result:
                "0x74ad93496274ddc81b6336c6fb3f32e17127f96a57dfafa05d87eadcb40b4d01",
            }),
            { status: 200 },
          );
        default:
          throw new Error(`unexpected rpc method ${body.method}`);
      }
    }) as typeof fetch;

    try {
      const result = await grantCapability({
        rpcUrl: "http://127.0.0.1:8545",
        privateKey: TEST_PRIVATE_KEY,
        target: normalizeAddress("0x42"),
        bit: 7,
        waitForReceipt: false,
      });

      expect(result.signed.to).toBe(SYSTEM_ACTION_ADDRESS);
      expect(Buffer.from(result.signed.data.slice(2), "hex").toString("utf8")).toContain(
        '"action":"CAPABILITY_GRANT"',
      );
    } finally {
      global.fetch = originalFetch;
    }
  });
});
