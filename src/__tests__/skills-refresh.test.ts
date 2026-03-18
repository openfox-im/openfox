/**
 * Skills Refresh & Snapshot Versioning Tests
 */

import { describe, it, expect } from "vitest";
import {
  bumpSkillsSnapshotVersion,
  getSkillsSnapshotVersion,
  registerSkillsChangeListener,
} from "../skills/refresh.js";

describe("skills refresh & snapshot versioning", () => {
  it("bumps global version", () => {
    const v1 = getSkillsSnapshotVersion();
    const v2 = bumpSkillsSnapshotVersion({ reason: "manual" });
    expect(v2).toBeGreaterThan(v1);
  });

  it("bumps workspace-scoped version", () => {
    const v = bumpSkillsSnapshotVersion({ workspaceDir: "/tmp/test-ws", reason: "manual" });
    expect(v).toBeGreaterThan(0);
    expect(getSkillsSnapshotVersion("/tmp/test-ws")).toBeGreaterThanOrEqual(v);
  });

  it("notifies registered listeners on bump", () => {
    const events: { reason: string }[] = [];
    const unsubscribe = registerSkillsChangeListener((e) => events.push(e));
    bumpSkillsSnapshotVersion({ reason: "manual" });
    expect(events.length).toBe(1);
    expect(events[0].reason).toBe("manual");
    unsubscribe();
    bumpSkillsSnapshotVersion({ reason: "manual" });
    expect(events.length).toBe(1);
  });
});
