export type {
  TerminalClass,
  TrustTier,
  TerminalSession,
  TerminalCapabilities,
  TerminalRequest,
  TerminalResponse,
  TerminalPolicy,
} from "./types.js";

export type { TerminalAdapter } from "./adapter.js";
export { BaseTerminalAdapter } from "./adapter.js";

export { AppTerminalAdapter } from "./adapters/app.js";
export { CardTerminalAdapter } from "./adapters/card.js";
export { POSTerminalAdapter } from "./adapters/pos.js";
export { VoiceTerminalAdapter } from "./adapters/voice.js";
export { KioskTerminalAdapter } from "./adapters/kiosk.js";
export { RobotTerminalAdapter } from "./adapters/robot.js";

export { TerminalRegistry } from "./registry.js";
export { SessionStore } from "./session-store.js";

export type {
  DegradedReason,
  DegradedState,
  QueuedRequest,
} from "./degraded.js";
export { DegradedModeHandler } from "./degraded.js";

export type {
  RecoveryStep,
  RecoveryFlowState,
} from "./recovery-flow.js";
export { RecoveryFlowHandler } from "./recovery-flow.js";

export type {
  PublicTerminalStep,
  StepUpMethod,
  PublicTerminalFlowState,
} from "./public-terminal-flow.js";
export { PublicTerminalFlowHandler } from "./public-terminal-flow.js";

// Hardware terminal adapters & device interfaces
export * from "./hardware/index.js";
