import { createLogger } from "../observability/logger.js";

const logger = createLogger("event-bus");

export type WorldEventKind =
  | "message.new"
  | "feed.item"
  | "presence.update"
  | "notification.new"
  | "proposal.update"
  | "intent.update"
  | "treasury.update"
  | "reputation.update";

export interface WorldEvent {
  kind: WorldEventKind;
  payload: Record<string, unknown>;
  timestamp: string;
}

interface Subscriber {
  clientId: string;
  kinds: WorldEventKind[] | null; // null means all events
  queue: WorldEvent[];
  resolve: ((value: WorldEvent) => void) | null;
}

export class WorldEventBus {
  private subscribers = new Map<string, Subscriber>();

  subscribe(clientId: string, kinds?: WorldEventKind[]): void {
    this.subscribers.set(clientId, {
      clientId,
      kinds: kinds ?? null,
      queue: [],
      resolve: null,
    });
    logger.debug(`Client ${clientId} subscribed${kinds ? ` to ${kinds.join(",")}` : " to all events"}`);
  }

  unsubscribe(clientId: string): void {
    const sub = this.subscribers.get(clientId);
    if (sub?.resolve) {
      sub.resolve(null as any); // unblock any waiting consumer
    }
    this.subscribers.delete(clientId);
    logger.debug(`Client ${clientId} unsubscribed`);
  }

  publish(event: WorldEvent): void {
    for (const sub of Array.from(this.subscribers.values())) {
      if (sub.kinds && !sub.kinds.includes(event.kind)) continue;
      if (sub.resolve) {
        // Consumer is waiting — deliver immediately
        sub.resolve(event);
        sub.resolve = null;
      } else {
        // Buffer the event
        sub.queue.push(event);
        // Cap queue size to prevent memory leaks
        if (sub.queue.length > 1000) {
          sub.queue.shift();
        }
      }
    }
  }

  async *getStream(clientId: string): AsyncGenerator<WorldEvent> {
    const sub = this.subscribers.get(clientId);
    if (!sub) return;

    while (this.subscribers.has(clientId)) {
      // Drain buffered events first
      while (sub.queue.length > 0) {
        const event = sub.queue.shift()!;
        yield event;
      }
      // Wait for next event
      const event = await new Promise<WorldEvent | null>((resolve) => {
        sub.resolve = resolve as (value: WorldEvent) => void;
      });
      if (!event) break; // unsubscribed
      yield event;
    }
  }

  getSubscriberCount(): number {
    return this.subscribers.size;
  }

  // For testing
  clear(): void {
    for (const sub of Array.from(this.subscribers.values())) {
      if (sub.resolve) sub.resolve(null as any);
    }
    this.subscribers.clear();
  }
}

// Singleton instance
export const worldEventBus = new WorldEventBus();
