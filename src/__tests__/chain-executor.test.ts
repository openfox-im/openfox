/**
 * Chain Executor Tests
 *
 * Tests the RPCChainExecutor and SponsoredChainExecutor with mocked HTTP/RPC
 * responses, verifying transaction submission, receipt polling, gas estimation,
 * health checks, and sponsored transaction flows.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { RPCChainExecutor, type ChainExecutorConfig } from "../pipeline/chain-executor.js";
import { SponsoredChainExecutor, type SponsorConfig } from "../pipeline/sponsored-executor.js";

// ── Helpers ─────────────────────────────────────────────────────────

function createConfig(overrides?: Partial<ChainExecutorConfig>): ChainExecutorConfig {
  return {
    rpcUrl: "http://localhost:8545",
    defaultGasLimit: 21_000,
    confirmationTimeout: 5_000,
    maxRetries: 0,
    pollIntervalMs: 10,
    ...overrides,
  };
}

function jsonRpcOk<T>(result: T): Response {
  return new Response(
    JSON.stringify({ jsonrpc: "2.0", id: 1, result }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

function jsonRpcError(code: number, message: string): Response {
  return new Response(
    JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code, message } }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

function httpError(status: number, statusText: string): Response {
  return new Response("error", { status, statusText });
}

function jsonOk<T>(body: T): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

// ── RPCChainExecutor ────────────────────────────────────────────────

describe("RPCChainExecutor", () => {
  let mockFetch: ReturnType<typeof vi.fn>;
  let executor: RPCChainExecutor;

  beforeEach(() => {
    mockFetch = vi.fn();
    executor = new RPCChainExecutor(createConfig(), mockFetch);
  });

  describe("healthCheck", () => {
    it("returns connected when RPC responds", async () => {
      mockFetch
        .mockResolvedValueOnce(jsonRpcOk("0xa")) // tos_blockNumber -> 10
        .mockResolvedValueOnce(jsonRpcOk("0x1")); // tos_chainId -> 1

      const result = await executor.healthCheck();

      expect(result).toEqual({
        connected: true,
        blockNumber: 10,
        chainId: 1,
      });
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it("returns disconnected when RPC fails", async () => {
      mockFetch.mockRejectedValue(new Error("fetch failed"));

      const result = await executor.healthCheck();

      expect(result).toEqual({
        connected: false,
        blockNumber: 0,
        chainId: 0,
      });
    });

    it("returns disconnected on HTTP error", async () => {
      mockFetch.mockResolvedValue(httpError(503, "Service Unavailable"));

      const result = await executor.healthCheck();

      expect(result).toEqual({
        connected: false,
        blockNumber: 0,
        chainId: 0,
      });
    });
  });

  describe("estimateGas", () => {
    it("returns gas estimate from RPC", async () => {
      mockFetch.mockResolvedValueOnce(jsonRpcOk("0x5208")); // 21000

      const gas = await executor.estimateGas({
        from: "0xabc",
        to: "0xdef",
        value: "1000",
      });

      expect(gas).toBe(21_000);

      // Verify the RPC call body
      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(callBody.method).toBe("tos_estimateGas");
      expect(callBody.params[0].from).toBe("0xabc");
      expect(callBody.params[0].to).toBe("0xdef");
    });

    it("throws on RPC error", async () => {
      mockFetch.mockResolvedValueOnce(
        jsonRpcError(-32000, "execution reverted"),
      );

      await expect(
        executor.estimateGas({ from: "0xabc", to: "0xdef", value: "0" }),
      ).rejects.toThrow("execution reverted");
    });
  });

  describe("execute", () => {
    it("builds and submits transaction, returns success on receipt", async () => {
      // tos_sendTransaction returns txHash
      mockFetch.mockResolvedValueOnce(jsonRpcOk("0xdeadbeef"));
      // tos_getTransactionReceipt returns receipt
      mockFetch.mockResolvedValueOnce(
        jsonRpcOk({
          blockNumber: "0x64",   // 100
          blockHash: "0xblockhash",
          gasUsed: "0x5208",     // 21000
          status: "0x1",         // success
        }),
      );

      const result = await executor.execute({
        from: "0xsender",
        to: "0xreceiver",
        value: "1000000000000000000",
      });

      expect(result.txHash).toBe("0xdeadbeef");
      expect(result.blockNumber).toBe(100);
      expect(result.blockHash).toBe("0xblockhash");
      expect(result.gasUsed).toBe(21_000);
      expect(result.status).toBe("success");
      expect(result.from).toBe("0xsender");
      expect(result.to).toBe("0xreceiver");

      // Verify the tos_sendTransaction call
      const sendBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(sendBody.method).toBe("tos_sendTransaction");
      expect(sendBody.params[0].from).toBe("0xsender");
      expect(sendBody.params[0].to).toBe("0xreceiver");
    });

    it("returns reverted status when receipt status is 0", async () => {
      mockFetch.mockResolvedValueOnce(jsonRpcOk("0xtxhash"));
      mockFetch.mockResolvedValueOnce(
        jsonRpcOk({
          blockNumber: "0x1",
          blockHash: "0xblock",
          gasUsed: "0x5208",
          status: "0x0",
        }),
      );

      const result = await executor.execute({
        from: "0xsender",
        to: "0xreceiver",
        value: "0",
      });

      expect(result.status).toBe("reverted");
    });

    it("returns failed when transaction submission fails", async () => {
      mockFetch.mockResolvedValueOnce(
        jsonRpcError(-32000, "insufficient funds"),
      );

      const result = await executor.execute({
        from: "0xsender",
        to: "0xreceiver",
        value: "999999999999999999999",
      });

      expect(result.status).toBe("failed");
      expect(result.txHash).toBe("0x" + "0".repeat(64));
    });

    it("passes intent metadata to the RPC call", async () => {
      mockFetch.mockResolvedValueOnce(jsonRpcOk("0xtx"));
      mockFetch.mockResolvedValueOnce(
        jsonRpcOk({
          blockNumber: "0x1",
          blockHash: "0xb",
          gasUsed: "0x5208",
          status: "0x1",
        }),
      );

      await executor.execute({
        from: "0xsender",
        to: "0xreceiver",
        value: "0",
        intentMetadata: { "x-openfox-intent-id": "INTENT_123" },
      });

      const sendBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(sendBody.params[0].metadata).toEqual({
        "x-openfox-intent-id": "INTENT_123",
      });
    });

    it("submits sponsored transaction when sponsor is set", async () => {
      // tos_sendTransaction for sponsored tx (node-signed with sponsor fields)
      mockFetch.mockResolvedValueOnce(jsonRpcOk("0xsponsored_tx"));
      // receipt
      mockFetch.mockResolvedValueOnce(
        jsonRpcOk({
          blockNumber: "0x5",
          blockHash: "0xsblock",
          gasUsed: "0x5208",
          status: "0x1",
        }),
      );

      const result = await executor.execute({
        from: "0xsender",
        to: "0xreceiver",
        value: "1000",
        sponsor: "0xsponsor",
        policyHash: "0xpolicy",
      });

      expect(result.txHash).toBe("0xsponsored_tx");
      expect(result.status).toBe("success");

      // Verify it used tos_sendTransaction for the sponsored path
      const sendBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(sendBody.method).toBe("tos_sendTransaction");
      expect(sendBody.params[0].sponsor).toBe("0xsponsor");
      expect(sendBody.params[0].policyHash).toBe("0xpolicy");
      expect(sendBody.params[0].from).toBe("0xsender");
    });
  });

  describe("waitForReceipt", () => {
    it("polls until receipt available", async () => {
      // First poll: no receipt
      mockFetch.mockResolvedValueOnce(jsonRpcOk(null));
      // Second poll: receipt available
      mockFetch.mockResolvedValueOnce(
        jsonRpcOk({
          blockNumber: "0xc8",   // 200
          blockHash: "0xfinalhash",
          gasUsed: "0x7530",     // 30000
          status: "0x1",
        }),
      );

      const receipt = await executor.waitForReceipt("0xtxhash", 5_000);

      expect(receipt).toEqual({
        blockNumber: 200,
        blockHash: "0xfinalhash",
        gasUsed: 30_000,
        status: 1,
      });
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it("times out correctly when receipt never arrives", async () => {
      // Return a fresh null response each time
      mockFetch.mockImplementation(() => Promise.resolve(jsonRpcOk(null)));

      // Use a very short timeout
      const shortExecutor = new RPCChainExecutor(
        createConfig({ confirmationTimeout: 50, pollIntervalMs: 10 }),
        mockFetch,
      );

      const receipt = await shortExecutor.waitForReceipt("0xtxhash", 50);

      expect(receipt).toBeNull();
    });

    it("returns receipt on first poll if immediately available", async () => {
      mockFetch.mockResolvedValueOnce(
        jsonRpcOk({
          blockNumber: "0x1",
          blockHash: "0xhash",
          gasUsed: "0x5208",
          status: "0x1",
        }),
      );

      const receipt = await executor.waitForReceipt("0xtxhash", 5_000);

      expect(receipt).not.toBeNull();
      expect(receipt!.blockNumber).toBe(1);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });

  describe("submitTransaction", () => {
    it("submits raw transaction via RPC", async () => {
      mockFetch.mockResolvedValueOnce(jsonRpcOk("0xtxhash"));

      const hash = await executor.submitTransaction("0xrawsigned");

      expect(hash).toBe("0xtxhash");
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.method).toBe("tos_sendRawTransaction");
      expect(body.params).toEqual(["0xrawsigned"]);
    });
  });

  describe("buildSponsoredTx", () => {
    it("includes sponsor and policyHash in the envelope", () => {
      const envelope = executor.buildSponsoredTx({
        from: "0xfrom",
        to: "0xto",
        value: "1000",
        gasLimit: 50_000,
        sponsor: "0xsponsor",
        policyHash: "0xpolicy",
      });

      expect(envelope.sponsor).toBe("0xsponsor");
      expect(envelope.policyHash).toBe("0xpolicy");

      expect(envelope.txObject.from).toBe("0xfrom");
      expect(envelope.txObject.to).toBe("0xto");
      expect(envelope.txObject.sponsor).toBe("0xsponsor");
      expect(envelope.txObject.policyHash).toBe("0xpolicy");
    });
  });

  describe("toChainExecutor", () => {
    it("returns a function compatible with the pipeline ChainExecutor type", async () => {
      mockFetch.mockResolvedValueOnce(jsonRpcOk("0xtx"));
      mockFetch.mockResolvedValueOnce(
        jsonRpcOk({
          blockNumber: "0x1",
          blockHash: "0xb",
          gasUsed: "0x5208",
          status: "0x1",
        }),
      );

      const chainExecutor = executor.toChainExecutor();
      const result = await chainExecutor({
        intentId: "INTENT_001",
        planId: "PLAN_001",
        requester: "0xsender",
        metadata: { key: "value" },
        target: "0xreceiver",
        value: "100",
        sponsor: {
          sponsorAddress: "0xsponsor",
          feeAmount: "1",
          feeCurrency: "TOS",
          gasLimit: 50_000,
          expiresAt: Math.floor(Date.now() / 1000) + 120,
          policyHash: "0xpolicy",
          trustTier: 2,
        },
      });

      expect(result.txHash).toBe("0xtx");
      expect(result.status).toBe("success");

      // Verify the from address comes from requester, not intentId
      const sendBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(sendBody.params[0].from).toBe("0xsender");
      expect(sendBody.params[0].sponsor).toBe("0xsponsor");
    });
  });
});

// ── SponsoredChainExecutor ──────────────────────────────────────────

describe("SponsoredChainExecutor", () => {
  let mockFetch: ReturnType<typeof vi.fn>;
  let baseExecutor: RPCChainExecutor;
  let sponsorConfig: SponsorConfig;

  beforeEach(() => {
    mockFetch = vi.fn();
    baseExecutor = new RPCChainExecutor(createConfig(), mockFetch);
    sponsorConfig = {
      sponsorAddress: "0xsponsor",
      sponsorPolicyHash: "0xpolicyhash",
      paymasterUrl: "http://localhost:9090",
    };
  });

  it("requests sponsor authorization and submits sponsored transaction", async () => {
    // Paymaster authorization response
    mockFetch.mockResolvedValueOnce(
      jsonOk({
        approved: true,
        sponsorSignature: "0xsig",
        sponsorNonce: "42",
        expiresAt: Math.floor(Date.now() / 1000) + 120,
      }),
    );
    // tos_sendTransaction (sponsored path via base executor, node-signed)
    mockFetch.mockResolvedValueOnce(jsonRpcOk("0xsponsored_hash"));
    // tos_getTransactionReceipt
    mockFetch.mockResolvedValueOnce(
      jsonRpcOk({
        blockNumber: "0xa",
        blockHash: "0xbhash",
        gasUsed: "0x5208",
        status: "0x1",
      }),
    );

    const sponsored = new SponsoredChainExecutor(
      baseExecutor,
      sponsorConfig,
      mockFetch,
    );

    const result = await sponsored.execute({
      from: "0xuser",
      to: "0xcontract",
      value: "0",
    });

    expect(result.txHash).toBe("0xsponsored_hash");
    expect(result.status).toBe("success");

    // Verify paymaster was called first
    const authCall = mockFetch.mock.calls[0];
    expect(authCall[0]).toBe("http://localhost:9090/authorize");
    const authBody = JSON.parse(authCall[1].body);
    expect(authBody.sponsor).toBe("0xsponsor");
    expect(authBody.policyHash).toBe("0xpolicyhash");

    // Verify tos_sendTransaction was used (not tos_sendRawTransaction)
    const txCall = JSON.parse(mockFetch.mock.calls[1][1].body);
    expect(txCall.method).toBe("tos_sendTransaction");
    expect(txCall.params[0].sponsor).toBe("0xsponsor");
  });

  it("returns failed when sponsor authorization is denied", async () => {
    mockFetch.mockResolvedValueOnce(jsonOk({ approved: false }));

    const sponsored = new SponsoredChainExecutor(
      baseExecutor,
      sponsorConfig,
      mockFetch,
    );

    const result = await sponsored.execute({
      from: "0xuser",
      to: "0xcontract",
      value: "0",
    });

    expect(result.status).toBe("failed");
    // No further RPC calls should have been made
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("propagates sponsor metadata to the base executor", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonOk({
        approved: true,
        sponsorSignature: "0xsig123",
        sponsorNonce: "7",
      }),
    );
    mockFetch.mockResolvedValueOnce(jsonRpcOk("0xtx"));
    mockFetch.mockResolvedValueOnce(
      jsonRpcOk({
        blockNumber: "0x1",
        blockHash: "0xb",
        gasUsed: "0x5208",
        status: "0x1",
      }),
    );

    const sponsored = new SponsoredChainExecutor(
      baseExecutor,
      sponsorConfig,
      mockFetch,
    );

    await sponsored.execute({
      from: "0xuser",
      to: "0xcontract",
      value: "100",
      intentMetadata: { "x-openfox-intent-id": "INTENT_XYZ" },
    });

    // The second call should be tos_sendTransaction with sponsor fields in the tx object
    const txBody = JSON.parse(mockFetch.mock.calls[1][1].body);
    expect(txBody.method).toBe("tos_sendTransaction");

    // The transaction object should include sponsor fields and metadata
    const txObj = txBody.params[0];
    expect(txObj.sponsor).toBe("0xsponsor");
    expect(txObj.policyHash).toBe("0xpolicyhash");
    expect(txObj.metadata["x-sponsor-signature"]).toBe("0xsig123");
    expect(txObj.metadata["x-sponsor-nonce"]).toBe("7");
    expect(txObj.metadata["x-openfox-intent-id"]).toBe("INTENT_XYZ");
  });

  it("throws when paymaster HTTP request fails", async () => {
    mockFetch.mockResolvedValueOnce(httpError(500, "Internal Server Error"));

    const sponsored = new SponsoredChainExecutor(
      baseExecutor,
      sponsorConfig,
      mockFetch,
    );

    await expect(
      sponsored.execute({
        from: "0xuser",
        to: "0xcontract",
        value: "0",
      }),
    ).rejects.toThrow("Paymaster authorization failed");
  });

  it("toChainExecutor returns a function compatible with the pipeline", async () => {
    mockFetch.mockResolvedValueOnce(jsonOk({ approved: true }));
    mockFetch.mockResolvedValueOnce(jsonRpcOk("0xtx"));
    mockFetch.mockResolvedValueOnce(
      jsonRpcOk({
        blockNumber: "0x1",
        blockHash: "0xb",
        gasUsed: "0x5208",
        status: "0x1",
      }),
    );

    const sponsored = new SponsoredChainExecutor(
      baseExecutor,
      sponsorConfig,
      mockFetch,
    );

    const chainExecutor = sponsored.toChainExecutor();
    const result = await chainExecutor({
      intentId: "INTENT_001",
      planId: "PLAN_001",
      requester: "0xuser",
      metadata: {},
      target: "0xreceiver",
      value: "0",
      sponsor: {
        sponsorAddress: "0xaltsponsor",
        feeAmount: "1",
        feeCurrency: "TOS",
        gasLimit: 50_000,
        expiresAt: Math.floor(Date.now() / 1000) + 120,
        policyHash: "0xaltpolicy",
        trustTier: 2,
      },
    });

    expect(result.status).toBe("success");
    const authorizeBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(authorizeBody.sponsor).toBe("0xaltsponsor");
  });
});
