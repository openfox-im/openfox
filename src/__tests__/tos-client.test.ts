import { afterEach, describe, expect, it, vi } from "vitest";
import {
  deriveTOSAddressFromPrivateKey,
  normalizeTOSAddress,
} from "../tos/address.js";
import {
  recordTOSReputationScore,
  signTOSNativeTransfer,
  TOS_SYSTEM_ACTION_ADDRESS,
} from "../tos/client.js";

const TEST_PRIVATE_KEY =
  "0x45a915e4d060149eb4365960e6a7a45f334393093061116b197e3240065ff2d8" as const;

afterEach(() => {
  vi.restoreAllMocks();
});

describe("TOS address", () => {
  it("derives 32-byte TOS address from secp256k1 private key", () => {
    expect(deriveTOSAddressFromPrivateKey(TEST_PRIVATE_KEY)).toBe(
      "0xfa7a3e1ddd55862136c8b192a94f5374fce5edbc8e2a8697c15331677e6ebf0b",
    );
  });

  it("normalizes short hex addresses by left-padding to 32 bytes", () => {
    expect(normalizeTOSAddress("0x1234")).toBe(
      "0x0000000000000000000000000000000000000000000000000000000000001234",
    );
  });
});

describe("TOS signer tx", () => {
  it("matches the TOS golden vector for secp256k1", async () => {
    const signed = await signTOSNativeTransfer(TEST_PRIVATE_KEY, {
      chainId: 1337n,
      nonce: 42n,
      gas: 50_000n,
      to: "0x1111111111111111111111111111111111111111111111111111111111111111",
      value: 12_345n,
      data: "0x11223344aabb",
    });

    expect(signed.from).toBe(
      "0xfa7a3e1ddd55862136c8b192a94f5374fce5edbc8e2a8697c15331677e6ebf0b",
    );
    expect(signed.signHash).toBe(
      "0xe68ae0c80358ac0697df00251101167aea3c3d8019d72930f1c6a9314dc5ecb0",
    );
    expect(signed.rawTransaction).toBe(
      "0x00f8a18205392a82c350a011111111111111111111111111111111111111111111111111111111111111118230398611223344aabbc0a0fa7a3e1ddd55862136c8b192a94f5374fce5edbc8e2a8697c15331677e6ebf0b89736563703235366b3180a0b73152870204b00af67d5425a440e605d202090aa52ded6c52b38be889368edfa0736160d5066f1d853c7597fac8ba9c8670877041e77a5b420ca19d384c3ebd71",
    );
    expect(signed.transactionHash).toBe(
      "0x0e558f3142dd1941c13358fc738b9462db391ea5bc27ab4bbdd7f188e0da99c3",
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
      const result = await recordTOSReputationScore({
        rpcUrl: "http://127.0.0.1:8545",
        privateKey: TEST_PRIVATE_KEY,
        who: normalizeTOSAddress("0x42"),
        delta: "1",
        reason: "agent-discovery:success:sponsor.topup.testnet",
        refId: "agent-discovery:sponsor.topup.testnet:node-1:nonce-1",
        waitForReceipt: false,
      });

      expect(sendRawSeen).toBe(true);
      expect(result.signed.to).toBe(TOS_SYSTEM_ACTION_ADDRESS);
      expect(result.signed.value).toBe(0n);
      expect(result.signed.data.startsWith("0x")).toBe(true);
      expect(result.txHash).toBe(
        "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      );
    } finally {
      global.fetch = originalFetch;
    }
  });
});
