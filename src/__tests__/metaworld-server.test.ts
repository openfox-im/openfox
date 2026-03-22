import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import http from "http";
import { privateKeyToAccount } from "@tosnetwork/tosdk/accounts";
import { createDatabase } from "../state/database.js";
import { startMetaWorldServer, type MetaWorldServer } from "../metaworld/server.js";
import {
  createGroup,
  requestToJoinGroup,
  approveGroupJoinRequest,
  sendGroupInvite,
} from "../group/store.js";
import { followFox, followGroup } from "../metaworld/follows.js";
import { publishFoxProfile, publishGroupProfile } from "../metaworld/identity.js";
import { registerMetaWorldSitePublication } from "../metaworld/publication.js";
import type { OpenFoxConfig, OpenFoxDatabase } from "../types.js";

const TEST_ADDRESS = "0xdf96edbc954f43d46dc80e0180291bb781ac0a8a3a69c785631d4193e9a9d5e7";
const FOLLOWER_ADDRESS = "0xf4897a85e6ac20f6b7b22e2c3a8fac52fb6c36430b80655354e5aa4f5e1a3533";
const GROUP_FOLLOWER_PRIVATE_KEY =
  "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdea" as const;
const GROUP_ADMIN_PRIVATE_KEY =
  "0x8ac013baac6fd392efc57bb097b1c813eae702332ba3eaa1625f942c5472626d90abcdef1234567890abcd12" as const;
const GROUP_APPLICANT_PRIVATE_KEY =
  "0x473302ca547d5f9877e272cffe58d4def43198b66ba35cff4b2e584be19efa05222222222222222222222222" as const;
const GROUP_MEMBER_PRIVATE_KEY =
  "0x4444444444444444444444444444444444444444444444444444444444444444" as const;
const GROUP_OUTSIDER_PRIVATE_KEY =
  "0x5555555555555555555555555555555555555555555555555555555555555555" as const;
const TOS = 10n ** 18n;

function makeTmpDbPath(): string {
  const tmpDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "openfox-mw-server-test-"),
  );
  return path.join(tmpDir, "test.db");
}

function makeHexPair(seed: string): { hash: `0x${string}`; txHash: `0x${string}` } {
  return {
    hash: (`0x${seed.repeat(64)}`.slice(0, 66)) as `0x${string}`,
    txHash: (`0x${(seed + seed.toUpperCase()).repeat(32)}`.slice(0, 66)) as `0x${string}`,
  };
}

function makeHex(seed: string): `0x${string}` {
  return (`0x${seed.repeat(64)}`.slice(0, 66)) as `0x${string}`;
}

function seedGroupEconomics(params: {
  db: OpenFoxDatabase;
  adminAddress: string;
  memberAddress: string;
  outsiderAddress: string;
}): void {
  const now = "2026-03-14T12:00:00.000Z";
  const later = "2026-03-14T12:10:00.000Z";
  const latest = "2026-03-14T12:20:00.000Z";
  const paidHashes = makeHexPair("c");
  const solverHashes = makeHexPair("d");

  params.db.insertCampaign({
    campaignId: "camp_server_group_budget",
    hostAgentId: "group-admin",
    hostAddress: params.adminAddress,
    title: "Server Group Budget",
    description: "Budget for server route tests.",
    budgetTomi: (10n * TOS).toString(),
    maxOpenBounties: 8,
    allowedKinds: ["question"],
    metadata: {},
    status: "open",
    createdAt: now,
    updatedAt: latest,
  });
  params.db.insertBounty({
    bountyId: "bnt_server_group_open",
    campaignId: "camp_server_group_budget",
    hostAgentId: "group-admin",
    hostAddress: params.adminAddress,
    kind: "question",
    title: "Server Open Task",
    taskPrompt: "Open task",
    referenceOutput: "Expected",
    rewardTomi: (1n * TOS).toString(),
    submissionDeadline: "2026-03-15T00:00:00.000Z",
    judgeMode: "local_model",
    status: "open",
    createdAt: now,
    updatedAt: now,
  });
  params.db.insertBounty({
    bountyId: "bnt_server_group_approved",
    campaignId: "camp_server_group_budget",
    hostAgentId: "group-admin",
    hostAddress: params.adminAddress,
    kind: "question",
    title: "Server Approved Task",
    taskPrompt: "Approved task",
    referenceOutput: "Expected",
    rewardTomi: (2n * TOS).toString(),
    submissionDeadline: "2026-03-15T00:00:00.000Z",
    judgeMode: "local_model",
    status: "approved",
    createdAt: now,
    updatedAt: later,
  });
  params.db.insertBounty({
    bountyId: "bnt_server_group_paid",
    campaignId: "camp_server_group_budget",
    hostAgentId: "group-admin",
    hostAddress: params.adminAddress,
    kind: "question",
    title: "Server Paid Task",
    taskPrompt: "Paid task",
    referenceOutput: "Expected",
    rewardTomi: (3n * TOS).toString(),
    submissionDeadline: "2026-03-15T00:00:00.000Z",
    judgeMode: "local_model",
    status: "paid",
    createdAt: now,
    updatedAt: latest,
  });
  params.db.insertBountySubmission({
    submissionId: "sub_server_group_paid",
    bountyId: "bnt_server_group_paid",
    solverAgentId: "outsider",
    solverAddress: params.outsiderAddress,
    submissionText: "Done",
    status: "accepted",
    submittedAt: later,
    updatedAt: latest,
  });
  params.db.upsertBountyResult({
    bountyId: "bnt_server_group_paid",
    winningSubmissionId: "sub_server_group_paid",
    decision: "accepted",
    confidence: 0.98,
    judgeReason: "Correct",
    payoutTxHash: paidHashes.txHash,
    createdAt: later,
    updatedAt: latest,
  });
  params.db.upsertSettlementReceipt({
    receiptId: "rcpt_server_group_paid",
    kind: "bounty",
    subjectId: "bnt_server_group_paid",
    receipt: {} as any,
    receiptHash: paidHashes.hash,
    payoutTxHash: paidHashes.txHash,
    createdAt: latest,
    updatedAt: latest,
  });
  params.db.insertBounty({
    bountyId: "bnt_server_solver_paid",
    hostAgentId: "outsider-host",
    hostAddress: params.outsiderAddress,
    kind: "question",
    title: "Server External Paid Solver Task",
    taskPrompt: "Solve external task",
    referenceOutput: "Expected",
    rewardTomi: (4n * TOS).toString(),
    submissionDeadline: "2026-03-15T00:00:00.000Z",
    judgeMode: "local_model",
    status: "paid",
    createdAt: now,
    updatedAt: latest,
  });
  params.db.insertBountySubmission({
    submissionId: "sub_server_solver_paid",
    bountyId: "bnt_server_solver_paid",
    solverAgentId: "member-fox",
    solverAddress: params.memberAddress,
    submissionText: "Solved",
    status: "accepted",
    submittedAt: later,
    updatedAt: latest,
  });
  params.db.upsertBountyResult({
    bountyId: "bnt_server_solver_paid",
    winningSubmissionId: "sub_server_solver_paid",
    decision: "accepted",
    confidence: 0.99,
    judgeReason: "Accepted",
    payoutTxHash: solverHashes.txHash,
    createdAt: later,
    updatedAt: latest,
  });
  params.db.upsertSettlementReceipt({
    receiptId: "rcpt_server_solver_paid",
    kind: "bounty",
    subjectId: "bnt_server_solver_paid",
    receipt: {} as any,
    receiptHash: solverHashes.hash,
    payoutTxHash: solverHashes.txHash,
    createdAt: latest,
    updatedAt: latest,
  });
  params.db.insertBounty({
    bountyId: "bnt_server_solver_pending",
    hostAgentId: "outsider-host",
    hostAddress: params.outsiderAddress,
    kind: "question",
    title: "Server External Pending Solver Task",
    taskPrompt: "Pending external task",
    referenceOutput: "Expected",
    rewardTomi: (5n * TOS).toString(),
    submissionDeadline: "2026-03-15T00:00:00.000Z",
    judgeMode: "local_model",
    status: "approved",
    createdAt: now,
    updatedAt: latest,
  });
  params.db.insertBountySubmission({
    submissionId: "sub_server_solver_pending",
    bountyId: "bnt_server_solver_pending",
    solverAgentId: "member-fox",
    solverAddress: params.memberAddress,
    submissionText: "Solved pending",
    status: "accepted",
    submittedAt: later,
    updatedAt: latest,
  });
  params.db.upsertBountyResult({
    bountyId: "bnt_server_solver_pending",
    winningSubmissionId: "sub_server_solver_pending",
    decision: "accepted",
    confidence: 0.92,
    judgeReason: "Accepted but unpaid",
    payoutTxHash: null,
    createdAt: later,
    updatedAt: latest,
  });
}

function makeConfig(): OpenFoxConfig {
  return {
    name: "test-fox",
    walletAddress: TEST_ADDRESS,
    dbPath: ":memory:",
    agentId: "test-agent",
  } as unknown as OpenFoxConfig;
}

function httpGet(
  url: string,
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    http
      .get(url, (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks).toString("utf8"),
          });
        });
      })
      .on("error", reject);
  });
}

function httpPost(
  url: string,
  body: Record<string, unknown> = {},
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const parsed = new URL(url);
    const req = http.request(
      {
        hostname: parsed.hostname,
        port: parsed.port,
        path: parsed.pathname + parsed.search,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks).toString("utf8"),
          });
        });
      },
    );
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

describe("metaWorld server", () => {
  let dbPath: string;
  let db: OpenFoxDatabase;
  let server: MetaWorldServer;

  beforeEach(async () => {
    dbPath = makeTmpDbPath();
    db = createDatabase(dbPath);
    server = await startMetaWorldServer({
      db,
      config: makeConfig(),
      port: 0, // random port
      host: "127.0.0.1",
    });
  });

  afterEach(async () => {
    await server.close();
    try {
      db.close();
    } catch {
      // ignore
    }
  });

  // --- HTML route tests ---

  it("serves the home page with HTML content", async () => {
    const res = await httpGet(server.url + "/");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/html");
    expect(res.body).toContain("<!doctype html>");
    expect(res.body).toContain("metaWorld");
  });

  it("serves the feed page", async () => {
    const res = await httpGet(server.url + "/feed");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/html");
    expect(res.body).toContain("World Feed");
  });

  it("serves the personalized feed page", async () => {
    const res = await httpGet(server.url + "/personalized-feed");
    expect(res.status).toBe(200);
    expect(res.body).toContain("Personalized Feed");
  });

  it("serves the search page", async () => {
    const res = await httpGet(server.url + "/search?query=test");
    expect(res.status).toBe(200);
    expect(res.body).toContain("Search");
  });

  it("serves publication routes with published profiles and site bundles", async () => {
    const admin = privateKeyToAccount(GROUP_ADMIN_PRIVATE_KEY);
    const created = await createGroup({
      db,
      account: admin,
      input: {
        name: "Publication Server Group",
        description: "Published group on the server.",
        visibility: "public",
        actorAddress: admin.address,
        actorAgentId: "group-admin",
        creatorDisplayName: "Group Admin",
        tags: ["publication"],
      },
    });

    publishFoxProfile(db, {
      ...makeConfig(),
      walletAddress: admin.address,
      agentId: "group-admin",
      agentDiscovery: {
        enabled: true,
        publishCard: true,
        displayName: "Server Publication Fox",
        endpoints: [],
        capabilities: [],
        directoryNodeRecords: [],
      },
    });
    publishGroupProfile(db, created.group.groupId);
    registerMetaWorldSitePublication({
      db,
      result: {
        generatedAt: "2026-03-14T12:00:00.000Z",
        outputDir: "/tmp/openfox-published-site",
        manifestPath: "/tmp/openfox-published-site/manifest.json",
        shellPath: "index.html",
        foxDirectoryPath: "foxes/index.html",
        groupDirectoryPath: "groups/index.html",
        publicationPath: "publication/index.html",
        searchPath: "search/index.html",
        contentIndexPath: "content-index.json",
        routesPath: "routes.json",
        searchIndexPath: "search-index.json",
        foxPages: [{ id: admin.address.toLowerCase(), title: "Server Publication Fox", path: `foxes/${admin.address.toLowerCase()}.html` }],
        groupPages: [{ id: created.group.groupId, title: "Publication Server Group", path: `groups/${created.group.groupId}.html` }],
      },
      baseUrl: "https://world.example/server",
      label: "Server Bundle",
    });

    const htmlRes = await httpGet(server.url + "/publication");
    expect(htmlRes.status).toBe(200);
    expect(htmlRes.body).toContain("Publication &amp; Federation");
    expect(htmlRes.body).toContain("Server Publication Fox");
    expect(htmlRes.body).toContain("Server Bundle");

    const jsonRes = await httpGet(server.url + "/api/v1/publication");
    expect(jsonRes.status).toBe(200);
    const data = JSON.parse(jsonRes.body);
    expect(data.counts.publishedFoxCount).toBe(1);
    expect(data.counts.publishedGroupCount).toBe(1);
    expect(data.counts.sitePublicationCount).toBe(1);
  });

  it("serves the following page", async () => {
    const res = await httpGet(server.url + "/following");
    expect(res.status).toBe(200);
    expect(res.body).toContain("Following");
  });

  it("serves the followers page", async () => {
    const res = await httpGet(server.url + "/followers");
    expect(res.status).toBe(200);
    expect(res.body).toContain("Followers");
  });

  it("serves the recommended foxes page", async () => {
    const res = await httpGet(server.url + "/recommended/foxes");
    expect(res.status).toBe(200);
    expect(res.body).toContain("Recommended Foxes");
  });

  it("serves the subscriptions page", async () => {
    const res = await httpGet(server.url + "/subscriptions");
    expect(res.status).toBe(200);
    expect(res.body).toContain("Subscriptions");
  });

  it("serves the fox directory page", async () => {
    const res = await httpGet(server.url + "/directory/foxes");
    expect(res.status).toBe(200);
    expect(res.body).toContain("Fox Directory");
  });

  it("serves the group directory page", async () => {
    const res = await httpGet(server.url + "/directory/groups");
    expect(res.status).toBe(200);
    expect(res.body).toContain("Group Directory");
  });

  it("serves group governance HTML and JSON routes", async () => {
    const admin = privateKeyToAccount(GROUP_ADMIN_PRIVATE_KEY);
    const applicant = privateKeyToAccount(GROUP_APPLICANT_PRIVATE_KEY);
    const created = await createGroup({
      db,
      account: admin,
      input: {
        name: "Governance Group",
        actorAddress: admin.address,
      },
    });
    await sendGroupInvite({
      db,
      account: admin,
      input: {
        groupId: created.group.groupId,
        targetAddress: applicant.address,
        targetAgentId: "applicant-fox",
        targetRoles: ["member"],
        actorAddress: admin.address,
      },
    });
    await requestToJoinGroup({
      db,
      account: applicant,
      input: {
        groupId: created.group.groupId,
        actorAddress: applicant.address,
        actorAgentId: "applicant-fox",
        requestedRoles: ["member"],
      },
    });

    const html = await httpGet(
      `${server.url}/group/${encodeURIComponent(created.group.groupId)}/governance`,
    );
    expect(html.status).toBe(200);
    expect(html.body).toContain("Group Governance");
    expect(html.body).toContain("Open Proposals");
    expect(html.body).toContain("Open Join Requests");

    const json = await httpGet(
      `${server.url}/api/v1/group/${encodeURIComponent(created.group.groupId)}/governance`,
    );
    expect(json.status).toBe(200);
    const data = JSON.parse(json.body);
    expect(data.groupName).toBe("Governance Group");
    expect(data.counts.openProposalCount).toBe(1);
    expect(data.counts.openJoinRequestCount).toBe(1);
  });

  it("serves group treasury HTML and JSON routes", async () => {
    const admin = privateKeyToAccount(GROUP_ADMIN_PRIVATE_KEY);
    const member = privateKeyToAccount(GROUP_MEMBER_PRIVATE_KEY);
    const outsider = privateKeyToAccount(GROUP_OUTSIDER_PRIVATE_KEY);
    const created = await createGroup({
      db,
      account: admin,
      input: {
        name: "Treasury Group",
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
        requestedRoles: ["member"],
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
    seedGroupEconomics({
      db,
      adminAddress: admin.address,
      memberAddress: member.address,
      outsiderAddress: outsider.address,
    });

    const html = await httpGet(
      `${server.url}/group/${encodeURIComponent(created.group.groupId)}/treasury`,
    );
    expect(html.status).toBe(200);
    expect(html.body).toContain("Treasury &amp; Budget");
    expect(html.body).toContain("Budget State");
    expect(html.body).toContain("Settlement Trails");

    const json = await httpGet(
      `${server.url}/api/v1/group/${encodeURIComponent(created.group.groupId)}/treasury`,
    );
    expect(json.status).toBe(200);
    const data = JSON.parse(json.body);
    expect(data.groupName).toBe("Treasury Group");
    expect(data.counts.campaignCount).toBe(1);
    expect(data.counts.settlementCount).toBe(2);
    expect(data.totals.pendingPayablesTomi).toBe((2n * TOS).toString());
    expect(data.totals.pendingReceivablesTomi).toBe((5n * TOS).toString());
  });

  it("serves artifact and settlement HTML and JSON routes", async () => {
    const requester = privateKeyToAccount(GROUP_ADMIN_PRIVATE_KEY);
    const provider = privateKeyToAccount(GROUP_OUTSIDER_PRIVATE_KEY);
    const now = "2026-03-14T14:00:00.000Z";
    const later = "2026-03-14T14:10:00.000Z";

    db.insertBounty({
      bountyId: "bnt_route_trail",
      hostAgentId: "route-host",
      hostAddress: requester.address,
      kind: "question",
      title: "Route Trail Bounty",
      taskPrompt: "Collect evidence.",
      referenceOutput: "Expected",
      rewardTomi: (1n * TOS).toString(),
      submissionDeadline: "2026-03-15T00:00:00.000Z",
      judgeMode: "local_model",
      status: "paid",
      createdAt: now,
      updatedAt: later,
    });
    db.upsertArtifact({
      artifactId: "art_route_trail",
      kind: "oracle.evidence",
      title: "Route Trail Artifact",
      leaseId: "lease_route_trail",
      cid: "bafyrouterailcid",
      bundleHash: makeHex("f"),
      providerBaseUrl: "https://provider.example",
      providerAddress: provider.address,
      requesterAddress: requester.address,
      subjectId: "bnt_route_trail",
      summaryText: "Artifact for route tests.",
      status: "anchored",
      createdAt: now,
      updatedAt: later,
    });
    db.upsertArtifactVerification({
      verificationId: "verify_route_trail",
      artifactId: "art_route_trail",
      receipt: {} as any,
      receiptHash: makeHex("1"),
      createdAt: later,
      updatedAt: later,
    });
    db.upsertArtifactAnchor({
      anchorId: "anchor_route_trail",
      artifactId: "art_route_trail",
      summary: {} as any,
      summaryHash: makeHex("2"),
      anchorTxHash: makeHex("3"),
      createdAt: later,
      updatedAt: later,
    });
    db.upsertExecutionTrail({
      trailId: "trail_route_artifact",
      subjectKind: "artifact",
      subjectId: "art_route_trail",
      executionKind: "signer_execution",
      executionRecordId: "sign_exec_route",
      executionTxHash: makeHex("4"),
      executionReceiptHash: makeHex("5"),
      linkMode: "direct",
      createdAt: later,
      updatedAt: later,
    });
    db.upsertSettlementReceipt({
      receiptId: "rcpt_route_trail",
      kind: "bounty",
      subjectId: "bnt_route_trail",
      receipt: {} as any,
      receiptHash: makeHex("6"),
      payoutTxHash: makeHex("7"),
      settlementTxHash: makeHex("8"),
      createdAt: later,
      updatedAt: later,
    });
    db.upsertSettlementCallback({
      callbackId: "cb_route_trail",
      receiptId: "rcpt_route_trail",
      kind: "bounty",
      subjectId: "bnt_route_trail",
      contractAddress: requester.address,
      payloadMode: "receipt_hash",
      payloadHex: makeHex("9"),
      payloadHash: makeHex("a"),
      status: "confirmed",
      attemptCount: 1,
      maxAttempts: 3,
      callbackTxHash: makeHex("b"),
      createdAt: later,
      updatedAt: later,
    });

    const artifactHtml = await httpGet(
      `${server.url}/artifact/${encodeURIComponent("art_route_trail")}`,
    );
    expect(artifactHtml.status).toBe(200);
    expect(artifactHtml.body).toContain("Artifact Overview");
    expect(artifactHtml.body).toContain("Execution Trails");

    const artifactJson = await httpGet(
      `${server.url}/api/v1/artifact/${encodeURIComponent("art_route_trail")}`,
    );
    expect(artifactJson.status).toBe(200);
    expect(JSON.parse(artifactJson.body).artifact.title).toBe("Route Trail Artifact");

    const settlementHtml = await httpGet(
      `${server.url}/settlement/${encodeURIComponent("rcpt_route_trail")}`,
    );
    expect(settlementHtml.status).toBe(200);
    expect(settlementHtml.body).toContain("Settlement Overview");
    expect(settlementHtml.body).toContain("Related Artifacts");

    const settlementJson = await httpGet(
      `${server.url}/api/v1/settlement/${encodeURIComponent("rcpt_route_trail")}`,
    );
    expect(settlementJson.status).toBe(200);
    const data = JSON.parse(settlementJson.body);
    expect(data.settlement.receiptId).toBe("rcpt_route_trail");
    expect(data.relatedArtifacts).toHaveLength(1);
  });

  it("serves a board page", async () => {
    const res = await httpGet(server.url + "/boards/work");
    expect(res.status).toBe(200);
    expect(res.body).toContain("Work Board");
  });

  it("serves the presence page", async () => {
    const res = await httpGet(server.url + "/presence");
    expect(res.status).toBe(200);
    expect(res.body).toContain("Presence");
  });

  it("serves the notifications page", async () => {
    const res = await httpGet(server.url + "/notifications");
    expect(res.status).toBe(200);
    expect(res.body).toContain("Notifications");
  });

  it("returns 400 for invalid board kind", async () => {
    const res = await httpGet(server.url + "/boards/invalid");
    expect(res.status).toBe(400);
  });

  // --- JSON API tests ---

  it("returns JSON shell snapshot", async () => {
    const res = await httpGet(server.url + "/api/v1/shell");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("application/json");
    const data = JSON.parse(res.body);
    expect(data).toHaveProperty("generatedAt");
    expect(data).toHaveProperty("fox");
    expect(data).toHaveProperty("feed");
    expect(data).toHaveProperty("notifications");
    expect(data).toHaveProperty("presence");
    expect(data).toHaveProperty("boards");
    expect(data).toHaveProperty("directories");
  });

  it("returns JSON feed", async () => {
    const res = await httpGet(server.url + "/api/v1/feed");
    expect(res.status).toBe(200);
    const data = JSON.parse(res.body);
    expect(data).toHaveProperty("items");
    expect(data).toHaveProperty("generatedAt");
  });

  it("returns JSON personalized feed", async () => {
    const res = await httpGet(server.url + "/api/v1/personalized-feed");
    expect(res.status).toBe(200);
    const data = JSON.parse(res.body);
    expect(data).toHaveProperty("items");
    expect(data).toHaveProperty("summary");
  });

  it("returns JSON search results", async () => {
    const res = await httpGet(server.url + "/api/v1/search?query=test");
    expect(res.status).toBe(200);
    const data = JSON.parse(res.body);
    expect(data).toHaveProperty("results");
    expect(data).toHaveProperty("query", "test");
  });

  it("returns JSON following data", async () => {
    const res = await httpGet(server.url + "/api/v1/following");
    expect(res.status).toBe(200);
    const data = JSON.parse(res.body);
    expect(data).toHaveProperty("counts");
    expect(data).toHaveProperty("followedFoxes");
    expect(data).toHaveProperty("followedGroups");
  });

  it("returns JSON followers data", async () => {
    const res = await httpGet(server.url + "/api/v1/followers");
    expect(res.status).toBe(200);
    const data = JSON.parse(res.body);
    expect(data).toHaveProperty("foxFollowers");
    expect(data).toHaveProperty("groupFollowers");
  });

  it("returns populated follow graph snapshots", async () => {
    const owner = privateKeyToAccount(GROUP_FOLLOWER_PRIVATE_KEY);
    const created = await createGroup({
      db,
      account: owner,
      input: {
        name: "Follow Graph Group",
        actorAddress: owner.address,
      },
    });

    followFox(db, {
      followerAddress: TEST_ADDRESS,
      targetAddress: FOLLOWER_ADDRESS,
    });
    followFox(db, {
      followerAddress: FOLLOWER_ADDRESS,
      targetAddress: TEST_ADDRESS,
    });
    followGroup(db, {
      followerAddress: TEST_ADDRESS,
      groupId: created.group.groupId,
    });
    followGroup(db, {
      followerAddress: FOLLOWER_ADDRESS,
      groupId: created.group.groupId,
    });

    const following = await httpGet(server.url + "/api/v1/following");
    const followingData = JSON.parse(following.body);
    expect(followingData.followedFoxes.length).toBe(1);
    expect(followingData.followedGroups.length).toBe(1);
    expect(followingData.followedGroups[0].followerCount).toBe(2);

    const followers = await httpGet(server.url + "/api/v1/followers");
    const followersData = JSON.parse(followers.body);
    expect(followersData.foxFollowers.length).toBe(1);
  });

  it("returns JSON recommendations", async () => {
    const foxes = await httpGet(server.url + "/api/v1/recommended/foxes");
    expect(foxes.status).toBe(200);
    expect(JSON.parse(foxes.body)).toHaveProperty("items");

    const groups = await httpGet(server.url + "/api/v1/recommended/groups");
    expect(groups.status).toBe(200);
    expect(JSON.parse(groups.body)).toHaveProperty("items");
  });

  it("returns JSON subscriptions", async () => {
    const res = await httpGet(server.url + "/api/v1/subscriptions");
    expect(res.status).toBe(200);
    const data = JSON.parse(res.body);
    expect(data).toHaveProperty("subscriptions");
  });

  it("returns JSON fox directory", async () => {
    const res = await httpGet(server.url + "/api/v1/directory/foxes");
    expect(res.status).toBe(200);
    const data = JSON.parse(res.body);
    expect(data).toHaveProperty("items");
  });

  it("returns JSON group directory", async () => {
    const res = await httpGet(server.url + "/api/v1/directory/groups");
    expect(res.status).toBe(200);
    const data = JSON.parse(res.body);
    expect(data).toHaveProperty("items");
  });

  it("returns JSON board data", async () => {
    const res = await httpGet(server.url + "/api/v1/boards/opportunity");
    expect(res.status).toBe(200);
    const data = JSON.parse(res.body);
    expect(data).toHaveProperty("items");
    expect(data).toHaveProperty("boardKind", "opportunity");
  });

  it("returns 400 for invalid JSON board kind", async () => {
    const res = await httpGet(server.url + "/api/v1/boards/badkind");
    expect(res.status).toBe(400);
  });

  it("returns JSON presence", async () => {
    const res = await httpGet(server.url + "/api/v1/presence");
    expect(res.status).toBe(200);
    const data = JSON.parse(res.body);
    expect(data).toHaveProperty("items");
    expect(data).toHaveProperty("activeCount");
  });

  it("returns JSON notifications", async () => {
    const res = await httpGet(server.url + "/api/v1/notifications");
    expect(res.status).toBe(200);
    const data = JSON.parse(res.body);
    expect(data).toHaveProperty("items");
    expect(data).toHaveProperty("unreadCount");
  });

  it("returns 404 for unknown routes", async () => {
    const res = await httpGet(server.url + "/api/v1/nonexistent");
    expect(res.status).toBe(404);
  });

  // --- POST action tests ---

  it("publishes presence via POST", async () => {
    const res = await httpPost(server.url + "/api/v1/presence/publish", {
      status: "online",
      summary: "testing presence",
    });
    expect(res.status).toBe(200);
    const data = JSON.parse(res.body);
    expect(data).toHaveProperty("actorAddress");
    expect(data).toHaveProperty("effectiveStatus", "online");
    expect(data).toHaveProperty("summary", "testing presence");
  });

  it("handles notification read for non-existent notification", async () => {
    const res = await httpPost(
      server.url + "/api/v1/notifications/nonexistent-id/read",
    );
    expect(res.status).toBe(200);
    const data = JSON.parse(res.body);
    // The markWorldNotificationRead function creates a new state record
    // even if the notification didn't exist before
    expect(data).toHaveProperty("notificationId", "nonexistent-id");
  });

  it("handles notification dismiss for non-existent notification", async () => {
    const res = await httpPost(
      server.url + "/api/v1/notifications/nonexistent-dismiss/dismiss",
    );
    expect(res.status).toBe(200);
    const data = JSON.parse(res.body);
    expect(data).toHaveProperty("notificationId", "nonexistent-dismiss");
  });

  // --- HTML pages contain expected elements ---

  it("home page contains nav bar with all sections", async () => {
    const res = await httpGet(server.url + "/");
    expect(res.body).toContain("Home");
    expect(res.body).toContain("Feed");
    expect(res.body).toContain("For You");
    expect(res.body).toContain("Search");
    expect(res.body).toContain("Publication");
    expect(res.body).toContain("Directory");
    expect(res.body).toContain("Following");
    expect(res.body).toContain("Recommended");
    expect(res.body).toContain("Boards");
    expect(res.body).toContain("Presence");
    expect(res.body).toContain("Notifications");
  });

  it("home page includes client-side router script", async () => {
    const res = await httpGet(server.url + "/");
    expect(res.body).toContain("history.pushState");
    expect(res.body).toContain("mw-content");
  });

  it("feed page supports query params", async () => {
    const res = await httpGet(server.url + "/feed?limit=5");
    expect(res.status).toBe(200);
    expect(res.body).toContain("World Feed");
  });

  it("directory foxes supports query params", async () => {
    const res = await httpGet(server.url + "/directory/foxes?query=test&limit=5");
    expect(res.status).toBe(200);
    expect(res.body).toContain("Fox Directory");
  });

  it("all board kinds are accessible", async () => {
    for (const kind of ["work", "opportunity", "artifact", "settlement"]) {
      const res = await httpGet(server.url + `/boards/${kind}`);
      expect(res.status).toBe(200);
      expect(res.body).toContain("Board");
    }
  });

  it("JSON feed supports limit param", async () => {
    const res = await httpGet(server.url + "/api/v1/feed?limit=3");
    expect(res.status).toBe(200);
    const data = JSON.parse(res.body);
    expect(data).toHaveProperty("items");
  });
});
