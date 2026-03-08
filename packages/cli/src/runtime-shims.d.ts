declare module "@openfox/openfox/config.js" {
  export interface OpenFoxCliConfig {
    name: string;
    walletAddress: string;
    rpcUrl?: string;
    chainId?: number;
    baseRpcUrl?: string;
    creatorAddress: string;
    sandboxId: string;
    dbPath: string;
    inferenceModel: string;
    inferenceModelRef?: string;
    runtimeApiUrl?: string;
    runtimeApiKey?: string;
    openaiApiKey?: string;
    anthropicApiKey?: string;
    ollamaBaseUrl?: string;
    socialRelayUrl?: string;
  }

  export function loadConfig(): OpenFoxCliConfig | null;
  export function resolvePath(p: string): string;
}

declare module "@openfox/openfox/identity/wallet.js" {
  export function loadWalletPrivateKey(): `0x${string}` | null;
}

declare module "@openfox/openfox/tos/address.js" {
  export type TOSAddress = `0x${string}`;

  export function deriveTOSAddressFromPrivateKey(privateKey: `0x${string}`): TOSAddress;
  export function normalizeTOSAddress(value: string): TOSAddress;
}

declare module "@openfox/openfox/tos/client.js" {
  import type { TOSAddress } from "@openfox/openfox/tos/address.js";

  export class TOSRpcClient {
    constructor(options: { rpcUrl: string });
    getChainId(): Promise<bigint>;
    getBalance(address: TOSAddress, blockTag?: string): Promise<bigint>;
    getTransactionCount(address: TOSAddress, blockTag?: string): Promise<bigint>;
  }

  export function formatTOSNetwork(chainId: bigint | number): string;
  export function parseTOSAmount(amount: string): bigint;
  export function sendTOSNativeTransfer(params: {
    rpcUrl: string;
    privateKey: `0x${string}`;
    to: TOSAddress | string;
    amountWei: bigint;
    gas?: bigint;
    data?: `0x${string}`;
    waitForReceipt?: boolean;
    receiptTimeoutMs?: number;
    pollIntervalMs?: number;
  }): Promise<{
    signed: {
      nonce: bigint;
      gas: bigint;
      rawTransaction: `0x${string}`;
    };
    txHash: `0x${string}`;
    receipt?: Record<string, unknown> | null;
  }>;
}

declare module "@openfox/openfox/state/database.js" {
  export interface CliToolCall {
    name: string;
    result: string;
    error?: string;
  }

  export interface CliTurn {
    id: string;
    timestamp: string;
    state: string;
    input?: string;
    inputSource?: string;
    thinking: string;
    toolCalls: CliToolCall[];
    tokenUsage: { totalTokens: number };
    costCents: number;
  }

  export interface CliHeartbeatEntry {
    enabled: boolean;
  }

  export interface CliInstalledTool {
    id: string;
    name: string;
  }

  export interface OpenFoxCliDatabase {
    getAgentState(): string;
    getTurnCount(): number;
    getInstalledTools(): CliInstalledTool[];
    getHeartbeatEntries(): CliHeartbeatEntry[];
    getRecentTurns(limit: number): CliTurn[];
    close(): void;
  }

  export function createDatabase(path: string): OpenFoxCliDatabase;
}
