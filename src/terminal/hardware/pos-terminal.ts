/**
 * Hardware-backed POS terminal adapter.
 *
 * Wraps a POSDevice to display transaction details, collect payment,
 * print receipts, and provide audible feedback.
 */

import { BaseTerminalAdapter } from "../adapter.js";
import type {
  TerminalCapabilities,
  TerminalRequest,
  TerminalResponse,
  TerminalSession,
} from "../types.js";
import type { POSDevice, POSTransactionRequest } from "./pos-device.js";

export class HardwarePOSTerminal extends BaseTerminalAdapter {
  readonly terminalClass = "pos" as const;
  readonly defaultTrustTier = 2 as const;

  constructor(private device: POSDevice) {
    super();
  }

  // -----------------------------------------------------------------------
  // Capabilities
  // -----------------------------------------------------------------------

  capabilities(): TerminalCapabilities {
    return {
      canSign: false,
      canDisplayApproval: true,
      canReceiveCallbacks: false,
      hasSecureElement: false,
      hasBiometric: false,
      maxTransactionValue: "10000000000000000000000", // 10 000 TOS
      supportedActions: ["transfer", "subscribe"],
    };
  }

  // -----------------------------------------------------------------------
  // Request handling
  // -----------------------------------------------------------------------

  async handleRequest(
    session: TerminalSession,
    request: TerminalRequest,
  ): Promise<TerminalResponse> {
    const validation = this.validateRequest(session, request);
    if (!validation.valid) {
      return {
        requestId: crypto.randomUUID(),
        status: "rejected",
        message: validation.reason,
      };
    }

    if (!this.device.isConnected()) {
      return {
        requestId: crypto.randomUUID(),
        status: "error",
        message: "POS device not connected",
      };
    }

    const amount = String(request.params["amount"] ?? "0");
    const currency = String(request.params["currency"] ?? "TOS");
    const merchantName = String(
      request.params["merchantName"] ?? session.metadata["merchantName"] ?? "Merchant",
    );
    const reference = crypto.randomUUID();

    // Show the transaction on device display.
    await this.device.display({
      line1: `${currency} ${amount}`,
      line2: "Processing...",
      showSpinner: true,
    });

    // Request payment from the device.
    const txRequest: POSTransactionRequest = {
      amount,
      currency,
      merchantName,
      reference,
    };

    const result = await this.device.requestPayment(txRequest);

    if (!result.approved) {
      await this.device.display({ line1: "DECLINED", line2: "", showSpinner: false });
      await this.device.beep("error");
      return {
        requestId: reference,
        status: "rejected",
        message: "Payment declined",
        data: { reference: result.reference },
      };
    }

    await this.device.display({ line1: "APPROVED", line2: `Ref: ${result.authCode ?? ""}`, showSpinner: false });
    await this.device.beep("success");

    // Print receipt.
    const receiptLines = [
      merchantName,
      "------------------------",
      `Amount: ${currency} ${amount}`,
      `Auth: ${result.authCode ?? "N/A"}`,
      `Ref: ${result.reference}`,
      `Date: ${new Date(result.timestamp).toISOString()}`,
      "------------------------",
      "Thank you!",
    ];
    await this.device.printReceipt(receiptLines);

    return {
      requestId: reference,
      status: "accepted",
      message: "POS transaction approved",
      data: {
        authCode: result.authCode,
        reference: result.reference,
      },
    };
  }

  formatApproval(action: string, params: Record<string, unknown>): string {
    const amount = params["amount"] ?? "unknown";
    return `[POS] Approve ${action} for ${String(amount)}?`;
  }

  formatReceipt(receiptData: Record<string, unknown>): string {
    const lines: string[] = [];
    for (const [key, value] of Object.entries(receiptData)) {
      lines.push(`${key}: ${String(value)}`);
    }
    return lines.join("\n");
  }

  protected sessionTTL(): number {
    return 300;
  }
}
