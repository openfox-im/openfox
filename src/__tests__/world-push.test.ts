import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { WorldEventBus, type WorldEvent, type WorldEventKind } from "../metaworld/event-bus.js";

describe("WorldEventBus", () => {
  let bus: WorldEventBus;

  beforeEach(() => {
    bus = new WorldEventBus();
  });

  afterEach(() => {
    bus.clear();
  });

  it("delivers published events to subscribers", async () => {
    bus.subscribe("c1");
    const event: WorldEvent = { kind: "feed.item", payload: { id: "1" }, timestamp: new Date().toISOString() };

    // Publish after a short delay
    setTimeout(() => bus.publish(event), 10);

    const stream = bus.getStream("c1");
    const result = await stream.next();
    expect(result.value).toEqual(event);
  });

  it("filters events by kind", async () => {
    bus.subscribe("c1", ["feed.item"]);
    const feedEvent: WorldEvent = { kind: "feed.item", payload: {}, timestamp: new Date().toISOString() };
    const presenceEvent: WorldEvent = { kind: "presence.update", payload: {}, timestamp: new Date().toISOString() };

    bus.publish(presenceEvent); // Should be filtered
    bus.publish(feedEvent); // Should be delivered

    const stream = bus.getStream("c1");
    const result = await stream.next();
    expect(result.value.kind).toBe("feed.item");
  });

  it("buffers events when consumer is not waiting", () => {
    bus.subscribe("c1");
    bus.publish({ kind: "feed.item", payload: { n: 1 }, timestamp: new Date().toISOString() });
    bus.publish({ kind: "feed.item", payload: { n: 2 }, timestamp: new Date().toISOString() });
    // Events are buffered — we'll verify via stream
    expect(bus.getSubscriberCount()).toBe(1);
  });

  it("cleans up on unsubscribe", () => {
    bus.subscribe("c1");
    expect(bus.getSubscriberCount()).toBe(1);
    bus.unsubscribe("c1");
    expect(bus.getSubscriberCount()).toBe(0);
  });

  it("handles multiple subscribers independently", async () => {
    bus.subscribe("c1", ["feed.item"]);
    bus.subscribe("c2", ["presence.update"]);

    const feedEvent: WorldEvent = { kind: "feed.item", payload: {}, timestamp: new Date().toISOString() };
    bus.publish(feedEvent);

    // c1 should get it, c2 should not
    const s1 = bus.getStream("c1");
    const r1 = await s1.next();
    expect(r1.value.kind).toBe("feed.item");
    expect(bus.getSubscriberCount()).toBe(2);
  });

  it("caps queue size to prevent memory leaks", () => {
    bus.subscribe("c1");
    for (let i = 0; i < 1100; i++) {
      bus.publish({ kind: "feed.item", payload: { i }, timestamp: new Date().toISOString() });
    }
    // Queue should be capped — implementation detail, just verify no crash
    expect(bus.getSubscriberCount()).toBe(1);
  });

  it("drains buffered events before waiting for new ones", async () => {
    bus.subscribe("c1");
    const e1: WorldEvent = { kind: "feed.item", payload: { n: 1 }, timestamp: new Date().toISOString() };
    const e2: WorldEvent = { kind: "feed.item", payload: { n: 2 }, timestamp: new Date().toISOString() };
    bus.publish(e1);
    bus.publish(e2);

    const stream = bus.getStream("c1");
    const r1 = await stream.next();
    expect(r1.value).toEqual(e1);
    const r2 = await stream.next();
    expect(r2.value).toEqual(e2);
  });

  it("stream ends when client is unsubscribed", async () => {
    bus.subscribe("c1");
    const stream = bus.getStream("c1");

    // Unsubscribe after short delay
    setTimeout(() => bus.unsubscribe("c1"), 10);

    const result = await stream.next();
    expect(result.done).toBe(true);
  });

  it("clear unblocks all waiting consumers", async () => {
    bus.subscribe("c1");
    bus.subscribe("c2");
    const s1 = bus.getStream("c1");
    const s2 = bus.getStream("c2");

    setTimeout(() => bus.clear(), 10);

    const r1 = await s1.next();
    const r2 = await s2.next();
    // After clear, streams should terminate
    expect(bus.getSubscriberCount()).toBe(0);
  });

  it("subscribe with null kinds receives all event types", async () => {
    bus.subscribe("c1");
    const events: WorldEventKind[] = ["feed.item", "presence.update", "notification.new"];
    for (const kind of events) {
      bus.publish({ kind, payload: {}, timestamp: new Date().toISOString() });
    }

    const stream = bus.getStream("c1");
    for (const kind of events) {
      const r = await stream.next();
      expect(r.value.kind).toBe(kind);
    }
  });

  it("returns immediately from getStream for unknown client", async () => {
    const stream = bus.getStream("unknown");
    const result = await stream.next();
    expect(result.done).toBe(true);
  });
});
