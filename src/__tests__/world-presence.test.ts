import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { privateKeyToAccount } from "@tosnetwork/tosdk/accounts";
import { createDatabase } from "../state/database.js";
import {
  createGroup,
  requestToJoinGroup,
  approveGroupJoinRequest,
} from "../group/store.js";
import {
  buildWorldPresenceSnapshot,
  listWorldPresence,
  publishWorldPresence,
} from "../metaworld/presence.js";
import type { OpenFoxDatabase } from "../types.js";

const ADMIN_PRIVATE_KEY =
  "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef" as const;
const MEMBER_PRIVATE_KEY =
  "0xdf96edbc954f43d46dc80e0180291bb781ac0a8a3a69c785631d4193e9a9d5e723456789abcdef0123456789" as const;

function makeTmpDbPath(): string {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "openfox-world-presence-test-"));
  return path.join(tmpDir, "test.db");
}

describe("metaWorld presence", () => {
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

  it("publishes and lists world and group-scoped presence", async () => {
    const admin = privateKeyToAccount(ADMIN_PRIVATE_KEY);
    const member = privateKeyToAccount(MEMBER_PRIVATE_KEY);

    const created = await createGroup({
      db,
      account: admin,
      input: {
        name: "Presence Group",
        actorAddress: admin.address,
      },
    });

    const joinRequest = await requestToJoinGroup({
      db,
      account: member,
      input: {
        groupId: created.group.groupId,
        actorAddress: member.address,
      },
    });
    await approveGroupJoinRequest({
      db,
      account: admin,
      input: {
        groupId: created.group.groupId,
        requestId: joinRequest.request.requestId,
        actorAddress: admin.address,
      },
    });

    const worldPresence = publishWorldPresence({
      db,
      actorAddress: admin.address,
      agentId: "admin-fox",
      displayName: "Admin Fox",
      status: "online",
      summary: "Scanning the world",
      ttlSeconds: 300,
    });
    expect(worldPresence.scopeKind).toBe("world");
    expect(worldPresence.expired).toBe(false);

    const groupPresence = publishWorldPresence({
      db,
      actorAddress: member.address,
      agentId: "member-fox",
      displayName: "Member Fox",
      status: "busy",
      summary: "Reviewing artifacts",
      groupId: created.group.groupId,
      ttlSeconds: 300,
    });
    expect(groupPresence.scopeKind).toBe("group");
    expect(groupPresence.groupId).toBe(created.group.groupId);

    const worldItems = listWorldPresence(db, { limit: 10 });
    expect(worldItems).toHaveLength(1);
    expect(worldItems[0].actorAddress).toBe(admin.address.toLowerCase());

    const groupItems = listWorldPresence(db, {
      groupId: created.group.groupId,
      limit: 10,
    });
    expect(groupItems).toHaveLength(1);
    expect(groupItems[0].displayName).toBe("Member Fox");
    expect(groupItems[0].effectiveStatus).toBe("busy");

    const snapshot = buildWorldPresenceSnapshot(db, {
      groupId: created.group.groupId,
      limit: 10,
    });
    expect(snapshot.activeCount).toBe(1);
    expect(snapshot.summary).toContain("presence");
  });
});
