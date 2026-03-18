import type {
  TerminalCapabilities,
  TerminalRequest,
  TerminalResponse,
  TerminalSession,
} from "../types.js";
import { BaseTerminalAdapter } from "../adapter.js";

export class CardTerminalAdapter extends BaseTerminalAdapter {
  readonly terminalClass = "card" as const;
  readonly defaultTrustTier = 1 as const;

  capabilities(): TerminalCapabilities {
    return {
      canSign: false,
      canDisplayApproval: false,
      canReceiveCallbacks: false,
      hasSecureElement: true,
      hasBiometric: false,
      maxTransactionValue: "1000000000000000000000", // 1000 TOS
      supportedActions: ["transfer"],
    };
  }

  async handleRequest(
    _session: TerminalSession,
    request: TerminalRequest,
  ): Promise<TerminalResponse> {
    if (request.action !== "transfer") {
      return {
        requestId: crypto.randomUUID(),
        status: "rejected",
        message: "Card terminals only support transfers",
      };
    }
    return {
      requestId: crypto.randomUUID(),
      status: "accepted",
      message: "Card payment accepted",
    };
  }

  formatApproval(_action: string, _params: Record<string, unknown>): string {
    return "";
  }

  protected sessionTTL(): number {
    return 30;
  }
}
