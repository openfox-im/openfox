/**
 * CLI Command Exports and Pipeline Factory Tests
 *
 * Verifies that CLI command modules export the expected handler functions
 * and that the pipeline factory creates a configured IntentPipeline.
 */

import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";

import { createPipeline, createTerminalRegistry, createAuditJournal } from "../pipeline/factory.js";
import { TerminalRegistry } from "../terminal/registry.js";

// ── Pipeline Factory ─────────────────────────────────────────────

describe("Pipeline Factory", () => {
  it("createPipeline returns a configured IntentPipeline", () => {
    // Minimal mock config
    const config = {
      creatorAddress: "0x0000000000000000000000000000000000000001",
      dbPath: ":memory:",
      chainId: 1,
    };

    // Minimal mock db with a .db property that is null (no raw sqlite handle)
    const db = { db: undefined, close() {} };

    const pipeline = createPipeline(config as any, db as any, {
      autoApprove: true,
      auditEnabled: false,
    });

    expect(pipeline).toBeDefined();
    expect(typeof pipeline.transfer).toBe("function");
  });

  it("createTerminalRegistry returns a TerminalRegistry", () => {
    const registry = createTerminalRegistry();
    expect(registry).toBeInstanceOf(TerminalRegistry);
    // Should have default adapters registered
    expect(registry.getAdapter("app")).toBeDefined();
    expect(registry.getAdapter("card")).toBeDefined();
    expect(registry.getAdapter("pos")).toBeDefined();
    expect(registry.getAdapter("voice")).toBeDefined();
  });

  it("createAuditJournal returns null when no raw db handle", () => {
    const db = { db: undefined, close() {} };
    const journal = createAuditJournal(db as any);
    expect(journal).toBeNull();
  });

  it("createTerminalRegistry(db) creates a registry with persistent sessions", () => {
    const rawDb = new Database(":memory:");
    const db = { db: rawDb, close() { rawDb.close(); } };
    const registry = createTerminalRegistry(db as any);
    expect(registry).toBeInstanceOf(TerminalRegistry);

    // Create a session and verify it persists in the database
    const session = registry.createSession("app", "test-terminal-1");
    expect(session).toBeDefined();
    expect(session!.terminalClass).toBe("app");

    // Verify the session was written to the database
    const row = rawDb.prepare("SELECT * FROM terminal_sessions WHERE session_id = ?").get(session!.sessionId);
    expect(row).toBeDefined();

    rawDb.close();
  });

  it("sessions survive registry recreation with the same database", () => {
    const rawDb = new Database(":memory:");
    const db = { db: rawDb, close() { rawDb.close(); } };

    // Create a session with the first registry
    const registry1 = createTerminalRegistry(db as any);
    const session = registry1.createSession("card", "terminal-persist-test");
    expect(session).toBeDefined();
    const sessionId = session!.sessionId;

    // Create a new registry with the same database
    const registry2 = createTerminalRegistry(db as any);

    // The session should be retrievable from the new registry (via store fallback)
    const retrieved = registry2.getSession(sessionId);
    expect(retrieved).toBeDefined();
    expect(retrieved!.sessionId).toBe(sessionId);
    expect(retrieved!.terminalClass).toBe("card");
    expect(retrieved!.terminalId).toBe("terminal-persist-test");

    rawDb.close();
  });
});

// ── CLI Command Exports ──────────────────────────────────────────

describe("CLI Command Exports", () => {
  it("intent command exports handleIntentCommand", async () => {
    const mod = await import("../commands/intent.js");
    expect(typeof mod.handleIntentCommand).toBe("function");
  });

  it("terminal command exports handleTerminalCommand", async () => {
    const mod = await import("../commands/terminal.js");
    expect(typeof mod.handleTerminalCommand).toBe("function");
  });

  it("audit command exports handleAuditCommand", async () => {
    const mod = await import("../commands/audit.js");
    expect(typeof mod.handleAuditCommand).toBe("function");
  });
});
