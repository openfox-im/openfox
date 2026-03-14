import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { privateKeyToAccount } from "tosdk/accounts";
import { createDatabase } from "../state/database.js";
import {
  createGroup,
  requestToJoinGroup,
  approveGroupJoinRequest,
  postGroupAnnouncement,
  postGroupMessage,
} from "../group/store.js";
import { publishWorldPresence } from "../metaworld/presence.js";
import {
  buildGroupPageHtml,
  buildGroupPageSnapshot,
} from "../metaworld/group-page.js";
import type { OpenFoxDatabase } from "../types.js";

const ADMIN_PRIVATE_KEY =
  "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef" as const;
const MEMBER_PRIVATE_KEY =
  "0xabcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789" as const;

function makeTmpDbPath(): string {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "openfox-world-group-page-test-"));
  return path.join(tmpDir, "test.db");
}

describe("metaWorld group page", () => {
  let dbPath: string;
  let db: OpenFoxDatabase;

  beforeEach(() => {
    dbPath = makeTmpDbPath();
    db = createDatabase(dbPath);
  });

  afterEach(() => {
    try {
      db.close();
    } catch {
      // ignore
    }
  });

  it("builds a group page snapshot with members, messages, announcements, presence, and feed", async () => {
    const admin = privateKeyToAccount(ADMIN_PRIVATE_KEY);
    const member = privateKeyToAccount(MEMBER_PRIVATE_KEY);

    const created = await createGroup({
      db,
      account: admin,
      input: {
        name: "Page Group",
        actorAddress: admin.address,
      },
    });

    const joinRequest = await requestToJoinGroup({
      db,
      account: member,
      input: {
        groupId: created.group.groupId,
        actorAddress: member.address,
        actorAgentId: "member-fox",
        requestedRoles: ["member", "watcher"],
      },
    });
    await approveGroupJoinRequest({
      db,
      account: admin,
      input: {
        groupId: created.group.groupId,
        requestId: joinRequest.request.requestId,
        actorAddress: admin.address,
        displayName: "Member Fox",
      },
    });

    await postGroupAnnouncement({
      db,
      account: admin,
      input: {
        groupId: created.group.groupId,
        title: "Page Launch",
        bodyText: "The group page should show this announcement.",
        actorAddress: admin.address,
      },
    });
    await postGroupMessage({
      db,
      account: admin,
      input: {
        groupId: created.group.groupId,
        text: "First page message.",
        actorAddress: admin.address,
      },
    });
    publishWorldPresence({
      db,
      actorAddress: member.address,
      groupId: created.group.groupId,
      agentId: "member-fox",
      displayName: "Member Fox",
      status: "busy",
      ttlSeconds: 300,
    });

    const page = buildGroupPageSnapshot(db, {
      groupId: created.group.groupId,
      messageLimit: 10,
      announcementLimit: 10,
      eventLimit: 10,
      presenceLimit: 10,
      activityLimit: 10,
    });
    const html = buildGroupPageHtml(page);

    expect(page.group.name).toBe("Page Group");
    expect(page.stats.activeMemberCount).toBe(2);
    expect(page.channels.length).toBeGreaterThanOrEqual(2);
    expect(page.announcements).toHaveLength(1);
    expect(page.recentMessages).toHaveLength(1);
    expect(page.presence).toHaveLength(1);
    expect(page.presence[0].displayName).toBe("Member Fox");
    expect(page.roleSummary.owner).toBe(1);
    expect(page.roleSummary.watcher).toBe(1);
    expect(page.activityFeed.items.map((item) => item.kind)).toContain(
      "group_announcement",
    );
    expect(html).toContain("<title>Page Group · OpenFox metaWorld</title>");
    expect(html).toContain("Community snapshot for Page Group");
    expect(html).toContain("Page Launch");
  });
});
