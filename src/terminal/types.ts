export type TerminalClass = "app" | "card" | "pos" | "voice" | "kiosk" | "robot" | "api";

export type TrustTier = 0 | 1 | 2 | 3 | 4;

export interface TerminalSession {
  sessionId: string;
  terminalClass: TerminalClass;
  trustTier: TrustTier;
  terminalId: string;
  connectedAt: number;
  lastActiveAt: number;
  expiresAt: number;
  metadata: Record<string, unknown>;
  revoked: boolean;
}

export interface TerminalCapabilities {
  canSign: boolean;
  canDisplayApproval: boolean;
  canReceiveCallbacks: boolean;
  hasSecureElement: boolean;
  hasBiometric: boolean;
  maxTransactionValue?: string;
  supportedActions: string[];
}

export interface TerminalRequest {
  sessionId: string;
  terminalClass: TerminalClass;
  trustTier: TrustTier;
  terminalId: string;
  action: string;
  params: Record<string, unknown>;
  timestamp: number;
}

export interface TerminalResponse {
  requestId: string;
  status: "accepted" | "rejected" | "pending_approval" | "error";
  intentId?: string;
  message?: string;
  data?: Record<string, unknown>;
}

export interface TerminalPolicy {
  terminalClass: TerminalClass;
  maxSingleValue: string;
  maxDailyValue: string;
  minTrustTier: TrustTier;
  requiresApproval: boolean;
  approvalThreshold: string;
  allowedActions: string[];
  enabled: boolean;
}
