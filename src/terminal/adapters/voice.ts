import type {
  TerminalCapabilities,
  TerminalRequest,
  TerminalResponse,
  TerminalSession,
} from "../types.js";
import { BaseTerminalAdapter } from "../adapter.js";

export class VoiceTerminalAdapter extends BaseTerminalAdapter {
  readonly terminalClass = "voice" as const;
  readonly defaultTrustTier = 1 as const;

  capabilities(): TerminalCapabilities {
    return {
      canSign: false,
      canDisplayApproval: false,
      canReceiveCallbacks: true,
      hasSecureElement: false,
      hasBiometric: false,
      maxTransactionValue: "100000000000000000000", // 100 TOS
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
        message: "Voice terminals only support transfers",
      };
    }
    return {
      requestId: crypto.randomUUID(),
      status: "accepted",
      message: "Voice transfer accepted",
    };
  }

  formatApproval(action: string, params: Record<string, unknown>): string {
    const amount = params.amount ?? "unknown amount";
    const to = params.to ?? "unknown recipient";
    return `Would you like to ${action} ${String(amount)} to ${String(to)}? Say yes to confirm.`;
  }

  formatReceipt(receiptData: Record<string, unknown>): string {
    const status = receiptData.status ?? "completed";
    const amount = receiptData.amount ?? "unknown";
    return `Transaction ${String(status)}. Amount: ${String(amount)}.`;
  }

  protected sessionTTL(): number {
    return 120;
  }
}
