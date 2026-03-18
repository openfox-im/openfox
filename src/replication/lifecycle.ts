/**
 * Child Lifecycle State Machine
 *
 * Manages child openfox lifecycle transitions with validation.
 * Every transition is recorded in the child_lifecycle_events table.
 */

import type { Database as DatabaseType } from "better-sqlite3";
import { ulid } from "ulid";
import type { ChildLifecycleState, ChildLifecycleEventRow } from "../types.js";
import { VALID_TRANSITIONS } from "../types.js";
import {
  lifecycleInsertEvent,
  lifecycleGetEvents,
  lifecycleGetLatestState,
  getChildrenByStatus,
  updateChildStatus as dbUpdateChildStatus,
} from "../state/database.js";

export class ChildLifecycle {
  constructor(private db: DatabaseType) {}

  /**
   * Initialize a child record and insert the first lifecycle event.
   */
  initChild(childId: string, name: string, sandboxId: string, genesisPrompt: string): void {
    // Insert child row into children table
    this.db.prepare(
      `INSERT INTO children (id, name, address, sandbox_id, genesis_prompt, status, created_at)
       VALUES (?, ?, '', ?, ?, 'requested', datetime('now'))`,
    ).run(childId, name, sandboxId, genesisPrompt);

    // Record initial event
    const event: ChildLifecycleEventRow = {
      id: ulid(),
      childId,
      fromState: "none",
      toState: "requested",
      reason: "child created",
      metadata: "{}",
      createdAt: new Date().toISOString(),
    };
    lifecycleInsertEvent(this.db, event);
    dbUpdateChildStatus(this.db, childId, "requested");
  }

  /**
   * Transition a child to a new state with validation.
   * Throws on invalid transitions.
   */
  transition(childId: string, toState: ChildLifecycleState, reason?: string, metadata?: Record<string, unknown>): void {
    const current = this.getCurrentState(childId);
    const allowed = VALID_TRANSITIONS[current];

    if (!allowed || !allowed.includes(toState)) {
      throw new Error(`Invalid lifecycle transition: ${current} → ${toState}`);
    }

    // Record transition event
    const event: ChildLifecycleEventRow = {
      id: ulid(),
      childId,
      fromState: current,
      toState,
      reason: reason ?? null,
      metadata: JSON.stringify(metadata ?? {}),
      createdAt: new Date().toISOString(),
    };
    lifecycleInsertEvent(this.db, event);

    // Update children table
    dbUpdateChildStatus(this.db, childId, toState);
  }

  /**
   * Get the current lifecycle state of a child.
   */
  getCurrentState(childId: string): ChildLifecycleState {
    const state = lifecycleGetLatestState(this.db, childId);
    if (!state) {
      throw new Error(`Child ${childId} not found in lifecycle events`);
    }
    return state;
  }

  /**
   * Get the full lifecycle event history for a child.
   */
  getHistory(childId: string): ChildLifecycleEventRow[] {
    return lifecycleGetEvents(this.db, childId);
  }

  /**
   * Get all children in a given lifecycle state.
   */
  getChildrenInState(state: ChildLifecycleState): Array<{ id: string; name: string; sandboxId: string; status: string; createdAt: string; lastChecked: string | null }> {
    const rows = getChildrenByStatus(this.db, state);
    return rows.map((row: any) => ({
      id: row.id,
      name: row.name,
      sandboxId: row.sandbox_id,
      status: row.status,
      createdAt: row.created_at,
      lastChecked: row.last_checked ?? null,
    }));
  }
}
