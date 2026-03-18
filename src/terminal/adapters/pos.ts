import type {
  TerminalCapabilities,
  TerminalRequest,
  TerminalResponse,
  TerminalSession,
} from "../types.js";
import { BaseTerminalAdapter } from "../adapter.js";

export class POSTerminalAdapter extends BaseTerminalAdapter {
  readonly terminalClass = "pos" as const;
  readonly defaultTrustTier = 2 as const;

  capabilities(): TerminalCapabilities {
    return {
      canSign: false,
      canDisplayApproval: true,
      canReceiveCallbacks: false,
      hasSecureElement: false,
      hasBiometric: false,
      maxTransactionValue: "10000000000000000000000", // 10000 TOS
      supportedActions: ["transfer", "subscribe"],
    };
  }

  async handleRequest(
    _session: TerminalSession,
    request: TerminalRequest,
  ): Promise<TerminalResponse> {
    const supported = this.capabilities().supportedActions;
    if (!supported.includes(request.action)) {
      return {
        requestId: crypto.randomUUID(),
        status: "rejected",
        message: `POS terminals do not support: ${request.action}`,
      };
    }
    return {
      requestId: crypto.randomUUID(),
      status: "accepted",
      message: "POS transaction accepted",
    };
  }

  formatApproval(action: string, params: Record<string, unknown>): string {
    const amount = params.amount ?? "unknown";
    return `[POS] Approve ${action} for ${String(amount)}?`;
  }

  protected sessionTTL(): number {
    return 300;
  }
}
