/**
 * Hardware-backed voice terminal adapter.
 *
 * Wraps a VoiceIO to convert spoken input into intent-based requests
 * and speak responses back to the user.
 */

import { BaseTerminalAdapter } from "../adapter.js";
import type {
  TerminalCapabilities,
  TerminalRequest,
  TerminalResponse,
  TerminalSession,
} from "../types.js";
import type { VoiceIO, VoiceInput } from "./voice-io.js";

/** Minimal parsed intent extracted from a voice transcript. */
export interface VoiceIntent {
  action: string;
  params: Record<string, unknown>;
  rawTranscript: string;
  confidence: number;
}

export class HardwareVoiceTerminal extends BaseTerminalAdapter {
  readonly terminalClass = "voice" as const;
  readonly defaultTrustTier = 1 as const;

  constructor(private voiceIO: VoiceIO) {
    super();
  }

  // -----------------------------------------------------------------------
  // Capabilities
  // -----------------------------------------------------------------------

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

  // -----------------------------------------------------------------------
  // Voice-specific helpers
  // -----------------------------------------------------------------------

  /**
   * Listen for a voice command and parse it into an intent.
   * Returns null if no speech was detected within the timeout.
   */
  async listenForIntent(timeoutMs?: number): Promise<VoiceIntent | null> {
    const input = await this.voiceIO.listen(timeoutMs);
    if (!input) return null;
    return this.parseIntent(input);
  }

  /** Speak a message through the voice output device. */
  async speakResponse(text: string): Promise<void> {
    await this.voiceIO.speak(text);
  }

  /**
   * Run a confirmation flow: speak a prompt, listen for "yes"/"no".
   * Returns true if the user confirms.
   */
  async confirmVoice(prompt: string, timeoutMs = 10_000): Promise<boolean> {
    await this.voiceIO.speak(prompt);
    const input = await this.voiceIO.listen(timeoutMs);
    if (!input) return false;

    const normalized = input.transcript.toLowerCase().trim();
    return (
      normalized === "yes" ||
      normalized === "confirm" ||
      normalized === "approve" ||
      normalized === "yeah" ||
      normalized === "yep"
    );
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
      await this.voiceIO.speak(validation.reason ?? "Request is not valid.");
      return {
        requestId: crypto.randomUUID(),
        status: "rejected",
        message: validation.reason,
      };
    }

    if (request.action !== "transfer") {
      const msg = "Voice terminals only support transfers.";
      await this.voiceIO.speak(msg);
      return {
        requestId: crypto.randomUUID(),
        status: "rejected",
        message: msg,
      };
    }

    const amount = request.params["amount"] ?? "unknown amount";
    const to = request.params["to"] ?? "unknown recipient";

    // Ask for verbal confirmation.
    const confirmed = await this.confirmVoice(
      `Transfer ${String(amount)} to ${String(to)}. Do you confirm?`,
    );

    if (!confirmed) {
      await this.voiceIO.speak("Transfer cancelled.");
      return {
        requestId: crypto.randomUUID(),
        status: "rejected",
        message: "User declined via voice",
      };
    }

    await this.voiceIO.speak("Transfer confirmed. Processing.");
    return {
      requestId: crypto.randomUUID(),
      status: "accepted",
      message: "Voice transfer accepted",
      data: {
        amount,
        to,
        confirmedVia: "voice",
      },
    };
  }

  formatApproval(action: string, params: Record<string, unknown>): string {
    const amount = params["amount"] ?? "unknown amount";
    const to = params["to"] ?? "unknown recipient";
    return `Would you like to ${action} ${String(amount)} to ${String(to)}? Say yes to confirm.`;
  }

  formatReceipt(receiptData: Record<string, unknown>): string {
    const status = receiptData["status"] ?? "completed";
    const amount = receiptData["amount"] ?? "unknown";
    return `Transaction ${String(status)}. Amount: ${String(amount)}.`;
  }

  protected sessionTTL(): number {
    return 120;
  }

  // -----------------------------------------------------------------------
  // Private
  // -----------------------------------------------------------------------

  /**
   * Naive intent parser – matches common patterns in the transcript.
   * A production system would use an NLU model here.
   */
  private parseIntent(input: VoiceInput): VoiceIntent {
    const text = input.transcript.toLowerCase().trim();

    // Pattern: "send/transfer <amount> to <recipient>"
    const transferMatch = text.match(
      /(?:send|transfer|pay)\s+([\d.]+)\s+(?:to|for)\s+(.+)/,
    );
    if (transferMatch) {
      return {
        action: "transfer",
        params: {
          amount: transferMatch[1],
          to: transferMatch[2].trim(),
        },
        rawTranscript: input.transcript,
        confidence: input.confidence,
      };
    }

    // Fallback: return the raw transcript as an unknown action.
    return {
      action: "unknown",
      params: { raw: input.transcript },
      rawTranscript: input.transcript,
      confidence: input.confidence,
    };
  }
}
