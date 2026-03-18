import type {
  TerminalClass,
  TrustTier,
  TerminalSession,
  TerminalCapabilities,
  TerminalRequest,
  TerminalResponse,
} from "./types.js";

export interface TerminalAdapter {
  readonly terminalClass: TerminalClass;
  readonly defaultTrustTier: TrustTier;

  capabilities(): TerminalCapabilities;

  createSession(
    terminalId: string,
    metadata?: Record<string, unknown>,
  ): TerminalSession;

  validateRequest(
    session: TerminalSession,
    request: TerminalRequest,
  ): { valid: boolean; reason?: string };

  handleRequest(
    session: TerminalSession,
    request: TerminalRequest,
  ): Promise<TerminalResponse>;

  formatApproval(action: string, params: Record<string, unknown>): string;

  formatReceipt(receiptData: Record<string, unknown>): string;
}

export abstract class BaseTerminalAdapter implements TerminalAdapter {
  abstract readonly terminalClass: TerminalClass;
  abstract readonly defaultTrustTier: TrustTier;
  abstract capabilities(): TerminalCapabilities;

  createSession(
    terminalId: string,
    metadata?: Record<string, unknown>,
  ): TerminalSession {
    const now = Math.floor(Date.now() / 1000);
    return {
      sessionId: crypto.randomUUID(),
      terminalClass: this.terminalClass,
      trustTier: this.defaultTrustTier,
      terminalId,
      connectedAt: now,
      lastActiveAt: now,
      expiresAt: now + this.sessionTTL(),
      metadata: metadata ?? {},
      revoked: false,
    };
  }

  validateRequest(
    session: TerminalSession,
    request: TerminalRequest,
  ): { valid: boolean; reason?: string } {
    if (session.revoked) return { valid: false, reason: "Session revoked" };
    const now = Math.floor(Date.now() / 1000);
    if (now > session.expiresAt)
      return { valid: false, reason: "Session expired" };
    if (request.terminalClass !== this.terminalClass)
      return { valid: false, reason: "Terminal class mismatch" };
    const caps = this.capabilities();
    if (!caps.supportedActions.includes(request.action))
      return {
        valid: false,
        reason: `Action not supported: ${request.action}`,
      };
    return { valid: true };
  }

  abstract handleRequest(
    session: TerminalSession,
    request: TerminalRequest,
  ): Promise<TerminalResponse>;

  formatApproval(action: string, _params: Record<string, unknown>): string {
    return `Approve ${action}?`;
  }

  formatReceipt(receiptData: Record<string, unknown>): string {
    return JSON.stringify(receiptData, null, 2);
  }

  protected sessionTTL(): number {
    return 3600;
  }
}
