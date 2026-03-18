/**
 * Hardware-backed card terminal adapter.
 *
 * Wraps an NFCReader to create sessions from card taps and process
 * transfer requests against the tapped card identity.
 */

import { BaseTerminalAdapter } from "../adapter.js";
import type {
  TerminalCapabilities,
  TerminalRequest,
  TerminalResponse,
  TerminalSession,
} from "../types.js";
import type { CardTapEvent, NFCReader } from "./nfc.js";

export class HardwareCardTerminal extends BaseTerminalAdapter {
  readonly terminalClass = "card" as const;
  readonly defaultTrustTier = 1 as const;

  constructor(private nfcReader: NFCReader) {
    super();
  }

  // -----------------------------------------------------------------------
  // Capabilities
  // -----------------------------------------------------------------------

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

  // -----------------------------------------------------------------------
  // Card-specific: wait for a tap, then create a session
  // -----------------------------------------------------------------------

  /**
   * Block until a card is tapped, then return a fresh session together
   * with the raw tap event.  Returns `null` if the reader times out or
   * is not connected.
   */
  async waitAndProcess(
    timeoutMs = 30_000,
  ): Promise<{ session: TerminalSession; tapEvent: CardTapEvent } | null> {
    if (!this.nfcReader.isConnected()) return null;

    const tapEvent = await this.nfcReader.waitForTap(timeoutMs);
    if (!tapEvent) return null;

    const session = this.createSession(tapEvent.terminalId, {
      cardUid: tapEvent.uid,
      protocol: tapEvent.protocol,
      atr: tapEvent.atr,
      tappedAt: tapEvent.timestamp,
    });

    return { session, tapEvent };
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
      data: {
        cardUid: session.metadata["cardUid"],
        terminalId: session.terminalId,
      },
    };
  }

  formatApproval(_action: string, _params: Record<string, unknown>): string {
    // Card terminals have no display; approval is implicit via tap.
    return "";
  }

  protected sessionTTL(): number {
    return 30;
  }
}
