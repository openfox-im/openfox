import type {
  TerminalCapabilities,
  TerminalRequest,
  TerminalResponse,
  TerminalSession,
} from "../types.js";
import { BaseTerminalAdapter } from "../adapter.js";

export class AppTerminalAdapter extends BaseTerminalAdapter {
  readonly terminalClass = "app" as const;
  readonly defaultTrustTier = 4 as const;

  capabilities(): TerminalCapabilities {
    return {
      canSign: true,
      canDisplayApproval: true,
      canReceiveCallbacks: true,
      hasSecureElement: false,
      hasBiometric: false,
      supportedActions: [
        "transfer",
        "swap",
        "subscribe",
        "delegate",
        "policy_update",
        "recovery",
      ],
    };
  }

  async handleRequest(
    _session: TerminalSession,
    _request: TerminalRequest,
  ): Promise<TerminalResponse> {
    return {
      requestId: crypto.randomUUID(),
      status: "accepted",
      message: "Request accepted",
    };
  }

  protected sessionTTL(): number {
    return 86400;
  }
}
