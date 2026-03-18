import type {
  TerminalCapabilities,
  TerminalRequest,
  TerminalResponse,
  TerminalSession,
} from "../types.js";
import { BaseTerminalAdapter } from "../adapter.js";

export class RobotTerminalAdapter extends BaseTerminalAdapter {
  readonly terminalClass = "robot" as const;
  readonly defaultTrustTier = 2 as const;

  capabilities(): TerminalCapabilities {
    return {
      canSign: true,
      canDisplayApproval: false,
      canReceiveCallbacks: true,
      hasSecureElement: false,
      hasBiometric: false,
      supportedActions: ["transfer", "swap", "delegate"],
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
        message: `Robot terminals do not support: ${request.action}`,
      };
    }
    return {
      requestId: crypto.randomUUID(),
      status: "accepted",
      message: "Robot request accepted",
    };
  }

  formatReceipt(receiptData: Record<string, unknown>): string {
    return JSON.stringify(receiptData);
  }

  protected sessionTTL(): number {
    return 3600;
  }
}
