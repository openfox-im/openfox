/**
 * Degraded Mode Handler Tests
 *
 * Tests for DegradedModeHandler: entering/exiting degraded mode,
 * request handling under different fallback modes, queue processing,
 * and default degraded mode per terminal class.
 */

import { describe, it, expect, beforeEach } from "vitest";

import { DegradedModeHandler } from "../terminal/degraded.js";
import type { TerminalRequest } from "../terminal/types.js";

// ── Helpers ──────────────────────────────────────────────────────

function makeRequest(overrides?: Partial<TerminalRequest>): TerminalRequest {
  return {
    sessionId: "session-001",
    terminalClass: "app",
    trustTier: 1,
    terminalId: "terminal-001",
    action: "transfer",
    params: {},
    timestamp: Math.floor(Date.now() / 1000),
    ...overrides,
  };
}

// ── Tests ────────────────────────────────────────────────────────

describe("DegradedModeHandler", () => {
  let handler: DegradedModeHandler;

  beforeEach(() => {
    handler = new DegradedModeHandler();
  });

  it("starts in non-degraded state", () => {
    expect(handler.isDegraded("app")).toBe(false);
    expect(handler.isDegraded("pos")).toBe(false);
    expect(handler.isDegraded("voice")).toBe(false);
  });

  it("enters degraded mode", () => {
    handler.enterDegradedMode("app", "offline");

    expect(handler.isDegraded("app")).toBe(true);
    const state = handler.getDegradedState("app");
    expect(state).toBeDefined();
    expect(state!.active).toBe(true);
    expect(state!.reason).toBe("offline");
    expect(state!.since).toBeDefined();
  });

  it("exits degraded mode", () => {
    handler.enterDegradedMode("app", "offline");
    expect(handler.isDegraded("app")).toBe(true);

    handler.exitDegradedMode("app");
    expect(handler.isDegraded("app")).toBe(false);

    const state = handler.getDegradedState("app");
    expect(state).toBeDefined();
    expect(state!.active).toBe(false);
    expect(state!.reason).toBeUndefined();
    expect(state!.since).toBeUndefined();
  });

  it("rejects requests in reject fallback mode", () => {
    // Voice terminals default to "reject" mode
    handler.enterDegradedMode("voice", "provider_unavailable");

    const request = makeRequest({ terminalClass: "voice" });
    const result = handler.handleDegradedRequest(request);

    expect(result.accepted).toBe(false);
    expect(result.reason).toContain("rejected");
    expect(result.reason).toContain("voice");
    expect(result.queueId).toBeUndefined();
  });

  it("queues requests in queue fallback mode", () => {
    // App terminals default to "queue" mode
    handler.enterDegradedMode("app", "high_latency");

    const request = makeRequest({ terminalClass: "app" });
    const result = handler.handleDegradedRequest(request);

    expect(result.accepted).toBe(true);
    expect(result.queueId).toBeDefined();
    expect(result.reason).toContain("queued");
  });

  it("processes queue on recovery", () => {
    handler.enterDegradedMode("app", "offline");

    // Queue a request
    const request = makeRequest({ terminalClass: "app" });
    const queueResult = handler.handleDegradedRequest(request);
    expect(queueResult.accepted).toBe(true);

    // While still degraded, processQueue should not return the request
    const stillDegradedResult = handler.processQueue();
    expect(stillDegradedResult).toHaveLength(0);

    // Exit degraded mode (recovery)
    handler.exitDegradedMode("app");

    // Now processQueue should return the queued request
    const recovered = handler.processQueue();
    expect(recovered).toHaveLength(1);
    expect(recovered[0].request.sessionId).toBe("session-001");
    expect(recovered[0].status).toBe("submitted");
  });

  it("expires old queued requests", () => {
    handler.enterDegradedMode("app", "offline");

    // Queue a request
    const request = makeRequest({ terminalClass: "app" });
    handler.handleDegradedRequest(request);

    // Exit degraded mode and process the queue to drain the first request
    handler.exitDegradedMode("app");
    const first = handler.processQueue();
    expect(first).toHaveLength(1);
    expect(first[0].request.sessionId).toBe("session-001");
    expect(first[0].status).toBe("submitted");

    // Re-enter and queue another request
    handler.enterDegradedMode("app", "offline");
    const req2 = makeRequest({ terminalClass: "app", sessionId: "session-002" });
    handler.handleDegradedRequest(req2);
    handler.exitDegradedMode("app");

    // The first request was already submitted and cleaned up.
    // Only the second request should be in the queue now.
    const batch = handler.processQueue();
    expect(batch).toHaveLength(1);
    expect(batch[0].request.sessionId).toBe("session-002");
  });

  it("returns correct default degraded mode per terminal class", () => {
    // api: queue with 100 max
    const api = DegradedModeHandler.getDefaultDegradedMode("api");
    expect(api.fallbackMode).toBe("queue");
    expect(api.maxQueueSize).toBe(100);

    // app: queue with 20 max
    const app = DegradedModeHandler.getDefaultDegradedMode("app");
    expect(app.fallbackMode).toBe("queue");
    expect(app.maxQueueSize).toBe(20);

    // kiosk: queue with 10 max
    const kiosk = DegradedModeHandler.getDefaultDegradedMode("kiosk");
    expect(kiosk.fallbackMode).toBe("queue");
    expect(kiosk.maxQueueSize).toBe(10);

    // pos: bounded_preauth with 50 max queue
    const pos = DegradedModeHandler.getDefaultDegradedMode("pos");
    expect(pos.fallbackMode).toBe("bounded_preauth");
    expect(pos.maxQueueSize).toBe(50);
    expect(pos.maxPreauthValue).toBe("1000000000000000000");

    // card: bounded_preauth with 30 max queue
    const card = DegradedModeHandler.getDefaultDegradedMode("card");
    expect(card.fallbackMode).toBe("bounded_preauth");
    expect(card.maxQueueSize).toBe(30);
    expect(card.maxPreauthValue).toBe("500000000000000000");

    // voice: reject
    const voice = DegradedModeHandler.getDefaultDegradedMode("voice");
    expect(voice.fallbackMode).toBe("reject");
    expect(voice.maxQueueSize).toBe(0);

    // robot: reject
    const robot = DegradedModeHandler.getDefaultDegradedMode("robot");
    expect(robot.fallbackMode).toBe("reject");
    expect(robot.maxQueueSize).toBe(0);
  });
});
