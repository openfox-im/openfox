/**
 * Terminal Management CLI Commands
 *
 * GTOS 2046: Inspect and manage terminal adapters, sessions, and policies.
 *
 * Usage:
 *   openfox terminal list          — list registered terminals and their policies
 *   openfox terminal sessions      — list active sessions
 *   openfox terminal revoke <id>   — revoke a session
 *   openfox terminal policy <class> — show policy for a terminal class
 */

import { createLogger } from "../observability/logger.js";
import { createTerminalRegistry } from "../pipeline/factory.js";
import { SessionStore } from "../terminal/session-store.js";
import type { OpenFoxDatabase } from "../types.js";
import type { TerminalClass } from "../terminal/types.js";

const logger = createLogger("terminal");

const TERMINAL_CLASSES: TerminalClass[] = ["app", "card", "pos", "voice", "kiosk", "robot", "api"];

export async function handleTerminalCommand(args: string[], db?: OpenFoxDatabase): Promise<void> {
  const subcommand = args[0];

  if (!subcommand || subcommand === "--help" || subcommand === "-h" || subcommand === "help") {
    printUsage();
    return;
  }

  switch (subcommand) {
    case "list":
      return handleList(db);
    case "sessions":
      return handleSessions(db);
    case "revoke":
      return handleRevoke(args.slice(1), db);
    case "policy":
      return handlePolicy(args.slice(1), db);
    default:
      logger.error(`Unknown terminal subcommand: ${subcommand}`);
      printUsage();
  }
}

// ── list ─────────────────────────────────────────────────────────

function handleList(db?: OpenFoxDatabase): void {
  const registry = createTerminalRegistry(db);

  logger.info("Registered Terminal Adapters:\n");

  for (const cls of TERMINAL_CLASSES) {
    const adapter = registry.getAdapter(cls);
    if (!adapter) continue;

    const caps = adapter.capabilities();
    const policy = registry.getPolicy(cls);

    logger.info(`  ${cls.toUpperCase()}`);
    logger.info(`    Default trust tier: ${adapter.defaultTrustTier}`);
    logger.info(`    Can sign: ${caps.canSign}`);
    logger.info(`    Secure element: ${caps.hasSecureElement}`);
    logger.info(`    Biometric: ${caps.hasBiometric}`);
    logger.info(`    Display approval: ${caps.canDisplayApproval}`);
    logger.info(`    Receive callbacks: ${caps.canReceiveCallbacks}`);
    if (caps.maxTransactionValue) {
      logger.info(`    Max transaction: ${caps.maxTransactionValue} tomi`);
    }
    logger.info(`    Supported actions: ${caps.supportedActions.join(", ")}`);

    if (policy) {
      logger.info(`    Policy: enabled=${policy.enabled}, requires_approval=${policy.requiresApproval}`);
      logger.info(`    Max single: ${policy.maxSingleValue} tomi, Max daily: ${policy.maxDailyValue} tomi`);
    } else {
      logger.info(`    Policy: (no custom policy set)`);
    }
    logger.info("");
  }
}

// ── sessions ────────────────────────────────────────────────────

function handleSessions(db?: OpenFoxDatabase): void {
  const registry = createTerminalRegistry(db);

  logger.info("Active Terminal Sessions:\n");

  // When a database is available, query persisted sessions via the store.
  if (db) {
    const rawDb = (db as unknown as { db?: import("better-sqlite3").Database }).db;
    if (rawDb) {
      const store = new SessionStore(rawDb);
      const sessions = store.listActive();
      if (sessions.length === 0) {
        logger.info("  (No active sessions.)");
      } else {
        for (const s of sessions) {
          logger.info(`  ${s.sessionId}  class=${s.terminalClass}  terminal=${s.terminalId}  trust=${s.trustTier}  expires=${new Date(s.expiresAt * 1000).toISOString()}`);
        }
        logger.info(`\n  Total: ${sessions.length} active session(s).`);
      }
      return;
    }
  }

  logger.info("  (No database available — sessions are in-memory only.)");
  logger.info("  Pass a database to enable persistent session storage.");
}

// ── revoke ──────────────────────────────────────────────────────

function handleRevoke(args: string[], db?: OpenFoxDatabase): void {
  const sessionId = args[0];
  if (!sessionId) {
    logger.error("Usage: openfox terminal revoke <sessionId>");
    return;
  }

  const registry = createTerminalRegistry(db);
  const revoked = registry.revokeSession(sessionId);

  if (revoked) {
    logger.info(`Session ${sessionId} revoked.`);
  } else {
    logger.info(`Session ${sessionId} not found (it may have expired or the registry was restarted).`);
  }
}

// ── policy ──────────────────────────────────────────────────────

function handlePolicy(args: string[], db?: OpenFoxDatabase): void {
  const cls = args[0] as TerminalClass | undefined;
  if (!cls) {
    logger.error("Usage: openfox terminal policy <class>");
    logger.error(`  Available classes: ${TERMINAL_CLASSES.join(", ")}`);
    return;
  }

  if (!TERMINAL_CLASSES.includes(cls)) {
    logger.error(`Unknown terminal class: ${cls}`);
    logger.error(`  Available classes: ${TERMINAL_CLASSES.join(", ")}`);
    return;
  }

  const registry = createTerminalRegistry(db);
  const adapter = registry.getAdapter(cls);

  if (!adapter) {
    logger.error(`No adapter registered for terminal class "${cls}".`);
    return;
  }

  const caps = adapter.capabilities();
  const policy = registry.getPolicy(cls);

  logger.info(`=== Terminal Policy: ${cls.toUpperCase()} ===\n`);

  logger.info("Capabilities:");
  logger.info(`  Can sign:            ${caps.canSign}`);
  logger.info(`  Secure element:      ${caps.hasSecureElement}`);
  logger.info(`  Biometric:           ${caps.hasBiometric}`);
  logger.info(`  Display approval:    ${caps.canDisplayApproval}`);
  logger.info(`  Receive callbacks:   ${caps.canReceiveCallbacks}`);
  if (caps.maxTransactionValue) {
    logger.info(`  Max transaction:     ${caps.maxTransactionValue} tomi`);
  }
  logger.info(`  Supported actions:   ${caps.supportedActions.join(", ")}`);
  logger.info("");

  if (policy) {
    logger.info("Policy:");
    logger.info(`  Enabled:             ${policy.enabled}`);
    logger.info(`  Min trust tier:      ${policy.minTrustTier}`);
    logger.info(`  Requires approval:   ${policy.requiresApproval}`);
    logger.info(`  Approval threshold:  ${policy.approvalThreshold} tomi`);
    logger.info(`  Max single value:    ${policy.maxSingleValue} tomi`);
    logger.info(`  Max daily value:     ${policy.maxDailyValue} tomi`);
    logger.info(`  Allowed actions:     ${policy.allowedActions.join(", ")}`);
  } else {
    logger.info("Policy: (none configured — using adapter defaults)");
  }
}

// ── Usage ───────────────────────────────────────────────────────

function printUsage(): void {
  logger.info(`
OpenFox terminal management

Usage:
  openfox terminal list              List registered terminals and their capabilities
  openfox terminal sessions          List active terminal sessions
  openfox terminal revoke <id>       Revoke a terminal session
  openfox terminal policy <class>    Show policy and capabilities for a terminal class

Terminal classes: ${TERMINAL_CLASSES.join(", ")}
`);
}
