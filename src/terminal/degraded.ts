/**
 * Degraded-Mode Handler
 *
 * GTOS 2046: Manages degraded-mode behavior for weak terminals
 * experiencing connectivity loss or provider unavailability.
 * Supports reject, queue, and bounded-preauth fallback modes.
 */

import { ulid } from "ulid";
import type { TerminalClass, TerminalRequest } from "./types.js";

// ── Types ────────────────────────────────────────────────────────

export type DegradedReason = "offline" | "high_latency" | "provider_unavailable" | "runtime_error";

export interface DegradedState {
  active: boolean;
  reason?: DegradedReason;
  since?: number;
  terminalClass: TerminalClass;
  fallbackMode: "reject" | "queue" | "bounded_preauth";
  maxQueueSize: number;
  maxPreauthValue: string;
}

export interface QueuedRequest {
  requestId: string;
  request: TerminalRequest;
  queuedAt: number;
  expiresAt: number;
  status: "queued" | "submitted" | "expired" | "failed";
}

// ── Default queue TTL: 5 minutes ─────────────────────────────────

const DEFAULT_QUEUE_TTL_SECONDS = 300;

// ── DegradedModeHandler ──────────────────────────────────────────

export class DegradedModeHandler {
  private state: Map<TerminalClass, DegradedState> = new Map();
  private queue: QueuedRequest[] = [];

  /** Enter degraded mode for a terminal class. */
  enterDegradedMode(terminalClass: TerminalClass, reason: DegradedReason): void {
    const existing = this.state.get(terminalClass);
    if (existing?.active) {
      // Update reason but keep the original timestamp
      existing.reason = reason;
      return;
    }

    const defaults = DegradedModeHandler.getDefaultDegradedMode(terminalClass);
    this.state.set(terminalClass, {
      ...defaults,
      active: true,
      reason,
      since: Math.floor(Date.now() / 1000),
    });
  }

  /** Exit degraded mode for a terminal class. */
  exitDegradedMode(terminalClass: TerminalClass): void {
    const existing = this.state.get(terminalClass);
    if (existing) {
      existing.active = false;
      existing.reason = undefined;
      existing.since = undefined;
    }
  }

  /** Check if a terminal class is currently in degraded mode. */
  isDegraded(terminalClass: TerminalClass): boolean {
    const s = this.state.get(terminalClass);
    return s?.active === true;
  }

  /** Handle a request while in degraded mode. Returns acceptance status and queue ID if queued. */
  handleDegradedRequest(request: TerminalRequest): {
    accepted: boolean;
    queueId?: string;
    reason: string;
  } {
    const s = this.state.get(request.terminalClass);

    // Not in degraded mode — accept normally
    if (!s || !s.active) {
      return { accepted: true, reason: "Terminal not in degraded mode" };
    }

    switch (s.fallbackMode) {
      case "reject":
        return {
          accepted: false,
          reason: `Request rejected: terminal ${request.terminalClass} is degraded (${s.reason ?? "unknown"})`,
        };

      case "queue": {
        // Check queue capacity
        const classQueueSize = this.queue.filter(
          (q) =>
            q.request.terminalClass === request.terminalClass &&
            q.status === "queued",
        ).length;

        if (classQueueSize >= s.maxQueueSize) {
          return {
            accepted: false,
            reason: `Queue full for ${request.terminalClass} (${classQueueSize}/${s.maxQueueSize})`,
          };
        }

        const now = Math.floor(Date.now() / 1000);
        const queued: QueuedRequest = {
          requestId: ulid(),
          request,
          queuedAt: now,
          expiresAt: now + DEFAULT_QUEUE_TTL_SECONDS,
          status: "queued",
        };
        this.queue.push(queued);

        return {
          accepted: true,
          queueId: queued.requestId,
          reason: `Request queued (position ${classQueueSize + 1}/${s.maxQueueSize})`,
        };
      }

      case "bounded_preauth": {
        // Accept only if the request value is within the preauth bound
        const requestValue = BigInt(
          (request.params["value"] as string | undefined) ?? "0",
        );
        const maxValue = BigInt(s.maxPreauthValue);

        if (requestValue > maxValue) {
          return {
            accepted: false,
            reason: `Request value ${requestValue} exceeds preauth limit ${maxValue} for degraded terminal ${request.terminalClass}`,
          };
        }

        // Queue the bounded request
        const now = Math.floor(Date.now() / 1000);
        const queued: QueuedRequest = {
          requestId: ulid(),
          request,
          queuedAt: now,
          expiresAt: now + DEFAULT_QUEUE_TTL_SECONDS,
          status: "queued",
        };
        this.queue.push(queued);

        return {
          accepted: true,
          queueId: queued.requestId,
          reason: `Bounded preauth accepted (value ${requestValue} <= limit ${maxValue})`,
        };
      }

      default:
        return {
          accepted: false,
          reason: `Unknown fallback mode: ${s.fallbackMode as string}`,
        };
    }
  }

  /** Process queued requests when connectivity is restored. Returns requests ready for submission. */
  processQueue(): QueuedRequest[] {
    const now = Math.floor(Date.now() / 1000);
    const ready: QueuedRequest[] = [];

    for (const item of this.queue) {
      if (item.status !== "queued") continue;

      // Check if the terminal class is still degraded
      if (this.isDegraded(item.request.terminalClass)) {
        continue;
      }

      // Expire stale requests
      if (item.expiresAt < now) {
        item.status = "expired";
        continue;
      }

      // Mark as submitted and collect
      item.status = "submitted";
      ready.push(item);
    }

    // Clean up completed/expired entries
    this.queue = this.queue.filter(
      (q) => q.status === "queued",
    );

    return ready;
  }

  /** Get the degraded state for a terminal class. */
  getDegradedState(terminalClass: TerminalClass): DegradedState | undefined {
    return this.state.get(terminalClass);
  }

  /** Get default degraded-mode behavior by terminal class. */
  static getDefaultDegradedMode(terminalClass: TerminalClass): DegradedState {
    switch (terminalClass) {
      // High-trust / high-value terminals: reject to avoid risk
      case "api":
        return {
          active: false,
          terminalClass,
          fallbackMode: "queue",
          maxQueueSize: 100,
          maxPreauthValue: "0",
        };

      // Interactive terminals with screens: queue for short periods
      case "app":
        return {
          active: false,
          terminalClass,
          fallbackMode: "queue",
          maxQueueSize: 20,
          maxPreauthValue: "0",
        };

      case "kiosk":
        return {
          active: false,
          terminalClass,
          fallbackMode: "queue",
          maxQueueSize: 10,
          maxPreauthValue: "0",
        };

      // POS terminals: bounded preauth for small amounts
      case "pos":
        return {
          active: false,
          terminalClass,
          fallbackMode: "bounded_preauth",
          maxQueueSize: 50,
          maxPreauthValue: "1000000000000000000", // 1 TOS equivalent
        };

      // Card terminals: bounded preauth with lower limits
      case "card":
        return {
          active: false,
          terminalClass,
          fallbackMode: "bounded_preauth",
          maxQueueSize: 30,
          maxPreauthValue: "500000000000000000", // 0.5 ETH equivalent
        };

      // Voice terminals: reject (no visual confirmation possible)
      case "voice":
        return {
          active: false,
          terminalClass,
          fallbackMode: "reject",
          maxQueueSize: 0,
          maxPreauthValue: "0",
        };

      // Robot terminals: reject (safety-critical)
      case "robot":
        return {
          active: false,
          terminalClass,
          fallbackMode: "reject",
          maxQueueSize: 0,
          maxPreauthValue: "0",
        };

      default:
        return {
          active: false,
          terminalClass,
          fallbackMode: "reject",
          maxQueueSize: 0,
          maxPreauthValue: "0",
        };
    }
  }
}
