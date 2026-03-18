import type {
  TerminalCapabilities,
  TerminalRequest,
  TerminalResponse,
  TerminalSession,
} from "../types.js";
import { BaseTerminalAdapter } from "../adapter.js";

export class KioskTerminalAdapter extends BaseTerminalAdapter {
  readonly terminalClass = "kiosk" as const;
  readonly defaultTrustTier = 0 as const;

  capabilities(): TerminalCapabilities {
    return {
      canSign: false,
      canDisplayApproval: true,
      canReceiveCallbacks: false,
      hasSecureElement: false,
      hasBiometric: false,
      maxTransactionValue: "50000000000000000000", // 50 TOS
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
        message: "Kiosk terminals only support transfers",
      };
    }
    return {
      requestId: crypto.randomUUID(),
      status: "pending_approval",
      message: "Step-up authentication required",
    };
  }

  formatApproval(action: string, params: Record<string, unknown>): string {
    const amount = params.amount ?? "unknown";
    return `[KIOSK] Confirm ${action} of ${String(amount)}. Please authenticate to proceed.`;
  }

  protected sessionTTL(): number {
    return 60;
  }
}
