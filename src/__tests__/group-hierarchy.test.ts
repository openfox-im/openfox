import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { privateKeyToAccount } from "tosdk/accounts";
import { createDatabase } from "../state/database.js";
import type { OpenFoxDatabase } from "../types.js";
import { createGroup } from "../group/store.js";
import {
  listChannelTree,
  createNestedChannel,
  getChannelPath,
  createSubgroup,
  listSubgroups,
  getParentGroup,
  removeSubgroup,
  getEffectiveGovernancePolicy,
} from "../group/hierarchy.js";
import { setGovernancePolicy } from "../group/governance.js";

const TEST_PRIVATE_KEY =
  "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef" as const;

function makeTmpDbPath(): string {
  const tmpDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "openfox-hierarchy-test-"),
  );
  return path.join(tmpDir, "test.db");
}

describe("group hierarchy", () => {
  let db: OpenFoxDatabase;
  const account = privateKeyToAccount(TEST_PRIVATE_KEY);

  beforeEach(() => {
    db = createDatabase(makeTmpDbPath());
  });

  afterEach(() => {
    try {
      db.close();
    } catch {
      // ignore
    }
  });

  async function makeGroup(name: string) {
    return createGroup({
      db,
      account,
      input: {
        name,
        actorAddress: account.address,
      },
    });
  }

  // ─── Nested Channels ───────────────────────────────────────────

  it("create nested channel with valid parent succeeds", async () => {
    const group = await makeGroup("test-group");
    const channels = group.channels;
    const generalChannel = channels.find((c) => c.name === "general");
    expect(generalChannel).toBeDefined();

    const nested = createNestedChannel(
      db,
      group.group.groupId,
      "bounties",
      "Bounty discussions",
      generalChannel!.channelId,
      account.address,
    );

    expect(nested.channelId).toMatch(/^chn_/);
    expect(nested.name).toBe("bounties");
    expect(nested.parentChannelId).toBe(generalChannel!.channelId);
    expect(nested.groupId).toBe(group.group.groupId);
  });

  it("create nested channel with invalid parent throws", async () => {
    const group = await makeGroup("test-group");

    expect(() =>
      createNestedChannel(
        db,
        group.group.groupId,
        "orphan",
        null,
        "chn_NONEXISTENT",
        account.address,
      ),
    ).toThrow("Parent channel not found");
  });

  it("create nested channel with parent from different group throws", async () => {
    const group1 = await makeGroup("group-one");
    const group2 = await makeGroup("group-two");
    const g1Channel = group1.channels.find((c) => c.name === "general")!;

    expect(() =>
      createNestedChannel(
        db,
        group2.group.groupId,
        "cross-group",
        null,
        g1Channel.channelId,
        account.address,
      ),
    ).toThrow("does not belong to group");
  });

  it("list channel tree returns correctly nested structure", async () => {
    const group = await makeGroup("tree-group");
    const generalChannel = group.channels.find((c) => c.name === "general")!;

    createNestedChannel(
      db,
      group.group.groupId,
      "work",
      "Work stuff",
      generalChannel.channelId,
      account.address,
    );

    const workChannel = db.raw
      .prepare(
        "SELECT channel_id FROM group_channels WHERE group_id = ? AND name = 'work'",
      )
      .get(group.group.groupId) as { channel_id: string };

    createNestedChannel(
      db,
      group.group.groupId,
      "bounties",
      "Bounty tasks",
      workChannel.channel_id,
      account.address,
    );

    const tree = listChannelTree(db, group.group.groupId);
    // Root channels should include general and announcements (defaults)
    expect(tree.length).toBeGreaterThanOrEqual(1);

    const generalNode = tree.find((n) => n.name === "general");
    expect(generalNode).toBeDefined();
    expect(generalNode!.depth).toBe(0);
    expect(generalNode!.children.length).toBe(1);

    const workNode = generalNode!.children[0];
    expect(workNode.name).toBe("work");
    expect(workNode.depth).toBe(1);
    expect(workNode.children.length).toBe(1);

    const bountyNode = workNode.children[0];
    expect(bountyNode.name).toBe("bounties");
    expect(bountyNode.depth).toBe(2);
  });

  it("get channel path returns #parent/child format", async () => {
    const group = await makeGroup("path-group");
    const generalChannel = group.channels.find((c) => c.name === "general")!;

    const workChannel = createNestedChannel(
      db,
      group.group.groupId,
      "work",
      null,
      generalChannel.channelId,
      account.address,
    );

    const bountiesChannel = createNestedChannel(
      db,
      group.group.groupId,
      "bounties",
      null,
      workChannel.channelId,
      account.address,
    );

    const pathStr = getChannelPath(db, bountiesChannel.channelId);
    expect(pathStr).toBe("#general/work/bounties");

    const rootPath = getChannelPath(db, generalChannel.channelId);
    expect(rootPath).toBe("#general");
  });

  // ─── Subgroups ────────────────────────────────────────────────

  it("create subgroup creates child Group and relationship record", async () => {
    const parent = await makeGroup("parent-group");

    const result = await createSubgroup(db, {
      account,
      parentGroupId: parent.group.groupId,
      childName: "child-group",
      relationship: "child",
      treasuryMode: "independent",
      policyMode: "inherit",
      creatorAddress: account.address,
    });

    expect(result.childGroup.group.groupId).toMatch(/^grp_/);
    expect(result.childGroup.group.name).toBe("child-group");
    expect(result.subgroupRecord.parentGroupId).toBe(parent.group.groupId);
    expect(result.subgroupRecord.childGroupId).toBe(
      result.childGroup.group.groupId,
    );
    expect(result.subgroupRecord.relationship).toBe("child");
    expect(result.subgroupRecord.treasuryMode).toBe("independent");
    expect(result.subgroupRecord.policyMode).toBe("inherit");
  });

  it("list subgroups returns all children", async () => {
    const parent = await makeGroup("parent-list");

    await createSubgroup(db, {
      account,
      parentGroupId: parent.group.groupId,
      childName: "child-a",
      relationship: "child",
      treasuryMode: "independent",
      policyMode: "inherit",
      creatorAddress: account.address,
    });
    await createSubgroup(db, {
      account,
      parentGroupId: parent.group.groupId,
      childName: "child-b",
      relationship: "affiliate",
      treasuryMode: "shared",
      policyMode: "override",
      creatorAddress: account.address,
    });

    const subs = listSubgroups(db, parent.group.groupId);
    expect(subs.length).toBe(2);
    expect(subs[0].relationship).toBe("child");
    expect(subs[1].relationship).toBe("affiliate");
  });

  it("get parent group returns parent info", async () => {
    const parent = await makeGroup("parent-get");
    const result = await createSubgroup(db, {
      account,
      parentGroupId: parent.group.groupId,
      childName: "child-get",
      relationship: "child",
      treasuryMode: "sub_budget",
      subBudgetLine: "operations",
      policyMode: "inherit",
      creatorAddress: account.address,
    });

    const parentInfo = getParentGroup(
      db,
      result.childGroup.group.groupId,
    );
    expect(parentInfo).not.toBeNull();
    expect(parentInfo!.parentGroupId).toBe(parent.group.groupId);
    expect(parentInfo!.treasuryMode).toBe("sub_budget");
    expect(parentInfo!.subBudgetLine).toBe("operations");
  });

  it("get parent group returns null for root group", async () => {
    const group = await makeGroup("root-group");
    const parentInfo = getParentGroup(db, group.group.groupId);
    expect(parentInfo).toBeNull();
  });

  it("remove subgroup deletes relationship but child persists", async () => {
    const parent = await makeGroup("parent-remove");
    const result = await createSubgroup(db, {
      account,
      parentGroupId: parent.group.groupId,
      childName: "child-remove",
      relationship: "child",
      treasuryMode: "independent",
      policyMode: "override",
      creatorAddress: account.address,
    });

    const childGroupId = result.childGroup.group.groupId;

    removeSubgroup(
      db,
      parent.group.groupId,
      childGroupId,
      account.address,
    );

    // Relationship should be gone
    const subs = listSubgroups(db, parent.group.groupId);
    expect(subs.length).toBe(0);

    // Child group should still exist
    const childRow = db.raw
      .prepare("SELECT group_id FROM groups WHERE group_id = ?")
      .get(childGroupId);
    expect(childRow).toBeDefined();
  });

  // ─── Effective Policy ─────────────────────────────────────────

  it("get effective policy with inherit reads from parent", async () => {
    const parent = await makeGroup("parent-policy");

    // Set a custom policy on the parent
    setGovernancePolicy(db, parent.group.groupId, "spend", {
      quorum: 5,
      thresholdNumerator: 3,
      thresholdDenominator: 4,
    });

    const result = await createSubgroup(db, {
      account,
      parentGroupId: parent.group.groupId,
      childName: "child-inherit",
      relationship: "child",
      treasuryMode: "independent",
      policyMode: "inherit",
      creatorAddress: account.address,
    });

    const policy = getEffectiveGovernancePolicy(
      db,
      result.childGroup.group.groupId,
      "spend",
    );
    expect(policy.quorum).toBe(5);
    expect(policy.thresholdNumerator).toBe(3);
    expect(policy.thresholdDenominator).toBe(4);
    // Should reference parent's groupId
    expect(policy.groupId).toBe(parent.group.groupId);
  });

  it("get effective policy with override reads from own group", async () => {
    const parent = await makeGroup("parent-override");

    setGovernancePolicy(db, parent.group.groupId, "spend", {
      quorum: 10,
    });

    const result = await createSubgroup(db, {
      account,
      parentGroupId: parent.group.groupId,
      childName: "child-override",
      relationship: "child",
      treasuryMode: "independent",
      policyMode: "override",
      creatorAddress: account.address,
    });

    // Set own policy on child
    setGovernancePolicy(db, result.childGroup.group.groupId, "spend", {
      quorum: 2,
    });

    const policy = getEffectiveGovernancePolicy(
      db,
      result.childGroup.group.groupId,
      "spend",
    );
    expect(policy.quorum).toBe(2);
    expect(policy.groupId).toBe(result.childGroup.group.groupId);
  });
});
