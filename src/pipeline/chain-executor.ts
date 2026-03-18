/**
 * RPC Chain Executor
 *
 * GTOS 2046: Real chain executor that submits transactions to a GTOS node
 * via JSON-RPC, replacing simulated execution in the intent pipeline.
 *
 * Supports:
 *   - Direct transaction submission via tos_sendTransaction
 *   - Receipt polling with configurable timeout
 *   - Gas estimation
 *   - Health checks
 *   - Sponsored transaction envelopes (via SponsoredChainExecutor)
 */

import type { ChainExecutor } from "./executor.js";
import type { ChainReceiptData } from "../intent/receipt.js";
import { sanitizeRPCUrl } from "./validation.js";

export interface ChainExecutorConfig {
  /** GTOS node RPC endpoint. */
  rpcUrl: string;
  /** Optional signer provider URL for remote signing. */
  signerUrl?: string;
  /** Optional paymaster provider URL for sponsored transactions. */
  paymasterUrl?: string;
  /** Default gas limit for transactions. */
  defaultGasLimit: number;
  /** Milliseconds to wait for transaction confirmation. */
  confirmationTimeout: number;
  /** Maximum number of retry attempts for transient failures. */
  maxRetries: number;
  /** Poll interval in milliseconds when waiting for receipts. */
  pollIntervalMs?: number;
}

interface JsonRpcResponse<T> {
  jsonrpc: "2.0";
  id: number;
  result?: T;
  error?: { code: number; message: string };
}

/**
 * Execute a JSON-RPC call against the configured GTOS node.
 */
async function rpcCall<T>(
  rpcUrl: string,
  method: string,
  params: unknown[],
  fetchImpl: typeof globalThis.fetch = globalThis.fetch,
): Promise<T> {
  const response = await fetchImpl(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method,
      params,
    }),
  });

  if (!response.ok) {
    throw new Error(
      `RPC ${method} HTTP error: ${response.status} ${response.statusText}`,
    );
  }

  const body = (await response.json()) as JsonRpcResponse<T>;
  if (body.error) {
    throw new Error(
      `RPC ${method} error ${body.error.code}: ${body.error.message}`,
    );
  }

  return body.result as T;
}

export class RPCChainExecutor {
  private config: ChainExecutorConfig;
  private fetchImpl: typeof globalThis.fetch;

  constructor(
    config: ChainExecutorConfig,
    fetchImpl?: typeof globalThis.fetch,
  ) {
    // Validate RPC URL to prevent SSRF
    config.rpcUrl = sanitizeRPCUrl(config.rpcUrl);
    if (config.signerUrl) {
      config.signerUrl = sanitizeRPCUrl(config.signerUrl);
    }
    if (config.paymasterUrl) {
      config.paymasterUrl = sanitizeRPCUrl(config.paymasterUrl);
    }
    // Enforce bounds on configuration
    if (config.maxRetries < 0 || config.maxRetries > 10) {
      throw new Error(`maxRetries must be between 0 and 10, got ${config.maxRetries}`);
    }
    if (config.defaultGasLimit < 21_000 || config.defaultGasLimit > 30_000_000) {
      throw new Error(`defaultGasLimit must be between 21000 and 30000000, got ${config.defaultGasLimit}`);
    }
    this.config = config;
    this.fetchImpl = fetchImpl ?? globalThis.fetch;
  }

  /**
   * Create a ChainExecutor function compatible with the IntentPipeline.
   * This bridges the class-based executor into the function-based interface
   * expected by the pipeline.
   */
  toChainExecutor(): ChainExecutor {
    return async (params) => {
      return this.execute({
        from: params.requester,
        to: params.target,
        value: params.value,
        data: params.data,
        sponsor: params.sponsor?.sponsorAddress,
        policyHash: params.sponsor?.policyHash,
        intentMetadata: params.metadata,
      });
    };
  }

  /**
   * Execute a transaction against the GTOS node.
   *
   * Steps:
   *   1. Build transaction object
   *   2. If sponsor is set, build sponsored tx envelope
   *   3. Submit via RPC (tos_sendTransaction)
   *   4. Wait for receipt (poll with timeout)
   *   5. Return ChainReceiptData
   */
  async execute(params: {
    from: string;
    to: string;
    value: string;
    data?: string;
    gasLimit?: number;
    sponsor?: string;
    policyHash?: string;
    intentMetadata?: Record<string, string>;
  }): Promise<ChainReceiptData> {
    const gasLimit = params.gasLimit ?? this.config.defaultGasLimit;

    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      try {
        let txHash: string;

        if (params.sponsor) {
          // Sponsored transaction: build envelope and submit via tos_sendTransaction
          // The node handles signing; we pass the sponsor fields in the tx object.
          const envelope = this.buildSponsoredTx({
            from: params.from,
            to: params.to,
            value: params.value,
            data: params.data,
            gasLimit,
            sponsor: params.sponsor,
            policyHash: params.policyHash ?? "0x" + "0".repeat(64),
            metadata: params.intentMetadata,
          });
          txHash = await rpcCall<string>(
            this.config.rpcUrl,
            "tos_sendTransaction",
            [envelope.txObject],
            this.fetchImpl,
          );
        } else {
          // Standard managed transaction
          txHash = await rpcCall<string>(
            this.config.rpcUrl,
            "tos_sendTransaction",
            [
              {
                from: params.from,
                to: params.to,
                value: `0x${BigInt(params.value || "0").toString(16)}`,
                gas: `0x${gasLimit.toString(16)}`,
                ...(params.data ? { data: params.data } : {}),
                ...(params.intentMetadata
                  ? { metadata: params.intentMetadata }
                  : {}),
              },
            ],
            this.fetchImpl,
          );
        }

        // Wait for the receipt
        const receipt = await this.waitForReceipt(
          txHash,
          this.config.confirmationTimeout,
        );

        if (!receipt) {
          return {
            txHash,
            blockNumber: 0,
            blockHash: "0x" + "0".repeat(64),
            from: params.from,
            to: params.to,
            gasUsed: gasLimit,
            value: params.value,
            status: "failed",
          };
        }

        return {
          txHash,
          blockNumber: receipt.blockNumber,
          blockHash: receipt.blockHash,
          from: params.from,
          to: params.to,
          gasUsed: receipt.gasUsed,
          value: params.value,
          status: receipt.status === 1 ? "success" : "reverted",
        };
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        // Only retry on transient errors, not on logic errors
        const msg = lastError.message.toLowerCase();
        const isTransient =
          msg.includes("timeout") ||
          msg.includes("econnrefused") ||
          msg.includes("fetch failed") ||
          msg.includes("network");
        if (!isTransient || attempt >= this.config.maxRetries) {
          break;
        }
      }
    }

    return {
      txHash: "0x" + "0".repeat(64),
      blockNumber: 0,
      blockHash: "0x" + "0".repeat(64),
      from: params.from,
      to: params.to,
      gasUsed: 0,
      value: params.value,
      status: "failed",
    };
  }

  /**
   * Submit a raw signed transaction to the GTOS node.
   */
  async submitTransaction(signedTx: string): Promise<string> {
    return rpcCall<string>(
      this.config.rpcUrl,
      "tos_sendRawTransaction",
      [signedTx],
      this.fetchImpl,
    );
  }

  /**
   * Poll for a transaction receipt until it is available or timeout is reached.
   */
  async waitForReceipt(
    txHash: string,
    timeoutMs: number,
  ): Promise<{
    blockNumber: number;
    blockHash: string;
    gasUsed: number;
    status: number;
  } | null> {
    const pollInterval = this.config.pollIntervalMs ?? 1000;
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      const receipt = await rpcCall<Record<string, unknown> | null>(
        this.config.rpcUrl,
        "tos_getTransactionReceipt",
        [txHash],
        this.fetchImpl,
      );

      if (receipt) {
        return {
          blockNumber: parseHexOrNumber(receipt["blockNumber"]),
          blockHash: String(receipt["blockHash"] ?? "0x" + "0".repeat(64)),
          gasUsed: parseHexOrNumber(receipt["gasUsed"]),
          status: parseHexOrNumber(receipt["status"]),
        };
      }

      await sleep(pollInterval);
    }

    return null;
  }

  /**
   * Build a sponsored transaction object that includes sponsor fields.
   * Returns a structured object suitable for tos_sendTransaction (node-signed),
   * not a raw RLP-encoded transaction.
   */
  buildSponsoredTx(params: {
    from: string;
    to: string;
    value: string;
    data?: string;
    gasLimit: number;
    sponsor: string;
    policyHash: string;
    metadata?: Record<string, string>;
  }): { txObject: Record<string, unknown>; sponsor: string; policyHash: string } {
    return {
      txObject: {
        from: params.from,
        to: params.to,
        value: `0x${BigInt(params.value || "0").toString(16)}`,
        gas: `0x${params.gasLimit.toString(16)}`,
        ...(params.data ? { data: params.data } : {}),
        sponsor: params.sponsor,
        policyHash: params.policyHash,
        ...(params.metadata ? { metadata: params.metadata } : {}),
      },
      sponsor: params.sponsor,
      policyHash: params.policyHash,
    };
  }

  /**
   * Estimate gas for a transaction.
   */
  async estimateGas(params: {
    from: string;
    to: string;
    value: string;
    data?: string;
  }): Promise<number> {
    const result = await rpcCall<string>(
      this.config.rpcUrl,
      "tos_estimateGas",
      [
        {
          from: params.from,
          to: params.to,
          value: `0x${BigInt(params.value || "0").toString(16)}`,
          ...(params.data ? { data: params.data } : {}),
        },
      ],
      this.fetchImpl,
    );

    return parseHexOrNumber(result);
  }

  /**
   * Check connection to the GTOS node and return basic chain info.
   */
  async healthCheck(): Promise<{
    connected: boolean;
    blockNumber: number;
    chainId: number;
  }> {
    try {
      const [blockNumberHex, chainIdHex] = await Promise.all([
        rpcCall<string>(
          this.config.rpcUrl,
          "tos_blockNumber",
          [],
          this.fetchImpl,
        ),
        rpcCall<string>(
          this.config.rpcUrl,
          "tos_chainId",
          [],
          this.fetchImpl,
        ),
      ]);

      return {
        connected: true,
        blockNumber: parseHexOrNumber(blockNumberHex),
        chainId: parseHexOrNumber(chainIdHex),
      };
    } catch {
      return {
        connected: false,
        blockNumber: 0,
        chainId: 0,
      };
    }
  }
}

// ── Helpers ───────────────────────────────────────────────────────────

function parseHexOrNumber(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    if (value.startsWith("0x")) return Number(BigInt(value));
    return Number(value);
  }
  return 0;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
