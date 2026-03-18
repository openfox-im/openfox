import type { TerminalAdapter } from "./adapter.js";
import type {
  TerminalClass,
  TerminalPolicy,
  TerminalSession,
} from "./types.js";
import type { SessionStore } from "./session-store.js";
import { AppTerminalAdapter } from "./adapters/app.js";
import { CardTerminalAdapter } from "./adapters/card.js";
import { POSTerminalAdapter } from "./adapters/pos.js";
import { VoiceTerminalAdapter } from "./adapters/voice.js";
import { KioskTerminalAdapter } from "./adapters/kiosk.js";
import { RobotTerminalAdapter } from "./adapters/robot.js";

export class TerminalRegistry {
  private adapters: Map<TerminalClass, TerminalAdapter> = new Map();
  private policies: Map<TerminalClass, TerminalPolicy> = new Map();
  private sessions: Map<string, TerminalSession> = new Map();
  private store?: SessionStore;

  constructor(store?: SessionStore) {
    this.store = store;
    this.register(new AppTerminalAdapter());
    this.register(new CardTerminalAdapter());
    this.register(new POSTerminalAdapter());
    this.register(new VoiceTerminalAdapter());
    this.register(new KioskTerminalAdapter());
    this.register(new RobotTerminalAdapter());
  }

  register(adapter: TerminalAdapter): void {
    this.adapters.set(adapter.terminalClass, adapter);
  }

  getAdapter(terminalClass: TerminalClass): TerminalAdapter | undefined {
    return this.adapters.get(terminalClass);
  }

  setPolicy(policy: TerminalPolicy): void {
    this.policies.set(policy.terminalClass, policy);
  }

  getPolicy(terminalClass: TerminalClass): TerminalPolicy | undefined {
    return this.policies.get(terminalClass);
  }

  createSession(
    terminalClass: TerminalClass,
    terminalId: string,
    metadata?: Record<string, unknown>,
  ): TerminalSession | undefined {
    const adapter = this.adapters.get(terminalClass);
    if (!adapter) return undefined;
    const session = adapter.createSession(terminalId, metadata);
    this.sessions.set(session.sessionId, session);
    if (this.store) this.store.save(session);
    return session;
  }

  getSession(sessionId: string): TerminalSession | undefined {
    const mem = this.sessions.get(sessionId);
    if (mem) return mem;
    if (this.store) {
      const persisted = this.store.get(sessionId);
      if (persisted) {
        this.sessions.set(sessionId, persisted);
        return persisted;
      }
    }
    return undefined;
  }

  revokeSession(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) {
      // Try store fallback
      if (this.store) return this.store.revoke(sessionId);
      return false;
    }
    session.revoked = true;
    if (this.store) this.store.save(session);
    return true;
  }

  cleanExpiredSessions(): number {
    const now = Math.floor(Date.now() / 1000);
    let removed = 0;
    for (const [id, session] of this.sessions) {
      if (now > session.expiresAt || session.revoked) {
        this.sessions.delete(id);
        removed++;
      }
    }
    if (this.store) {
      this.store.cleanExpired();
    }
    return removed;
  }
}
