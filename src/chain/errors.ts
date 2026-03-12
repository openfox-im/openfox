export class ChainRpcError extends Error {
  readonly code?: number;

  constructor(message: string, code?: number) {
    super(message);
    this.name = "ChainRpcError";
    this.code = code;
  }
}

export type ChainRpcErrorKind =
  | "rpc_unreachable"
  | "insufficient_balance"
  | "nonce_conflict"
  | "signer_metadata_missing"
  | "invalid_sender"
  | "unsupported_signer"
  | "rpc_error"
  | "unknown";

export interface ChainRpcErrorExplanation {
  kind: ChainRpcErrorKind;
  summary: string;
  recommendation: string;
}

export function explainChainRpcError(error: unknown): ChainRpcErrorExplanation {
  const message =
    error instanceof Error ? error.message : typeof error === "string" ? error : String(error);
  const lower = message.toLowerCase();

  if (lower.includes("fetch failed") || lower.includes("ecconnrefused") || lower.includes("rpc") && lower.includes("failed")) {
    return {
      kind: "rpc_unreachable",
      summary: "Chain RPC is unreachable.",
      recommendation: "Check rpcUrl, node availability, and local network reachability.",
    };
  }

  if (lower.includes("insufficient funds") || lower.includes("insufficient balance")) {
    return {
      kind: "insufficient_balance",
      summary: "Wallet balance is too low for the requested transaction.",
      recommendation: "Fund the wallet with `openfox wallet fund ...` and retry.",
    };
  }

  if (lower.includes("nonce too low") || lower.includes("already known") || lower.includes("replacement transaction underpriced")) {
    return {
      kind: "nonce_conflict",
      summary: "Transaction nonce conflict detected.",
      recommendation: "Refresh the pending nonce with `openfox wallet status` and retry once the mempool settles.",
    };
  }

  if (lower.includes("account_set_signer") || lower.includes("signer metadata") || lower.includes("signer argument") || lower.includes("invalid signer")) {
    return {
      kind: "signer_metadata_missing",
      summary: "Signer metadata is missing or invalid for this account.",
      recommendation: "Publish signer metadata for the intended native signer type, or use the default secp256k1 recovery path when appropriate.",
    };
  }

  if (lower.includes("invalid sender")) {
    return {
      kind: "invalid_sender",
      summary: "The chain rejected the sender/signature combination.",
      recommendation: "Check the active signer type for the account and make sure signer metadata matches the intended signer.",
    };
  }

  if (lower.includes("unsupported signer type")) {
    return {
      kind: "unsupported_signer",
      summary: "This action used a signer type the current runtime does not support directly.",
      recommendation: "Use secp256k1 for native OpenFox transactions or bootstrap the alternate signer explicitly before relying on it.",
    };
  }

  if (error instanceof ChainRpcError) {
    return {
      kind: "rpc_error",
      summary: message,
      recommendation: "Inspect the RPC error and retry with corrected transaction parameters.",
    };
  }

  return {
    kind: "unknown",
    summary: message,
    recommendation: "Inspect the error details and retry with corrected RPC, wallet, or signer settings.",
  };
}
