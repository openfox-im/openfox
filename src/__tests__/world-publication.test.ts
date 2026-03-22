import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import http from "http";
import { privateKeyToAccount } from "@tosnetwork/tosdk/accounts";
import type { OpenFoxConfig, OpenFoxDatabase } from "../types.js";
import { createDatabase } from "../state/database.js";
import { createGroup } from "../group/store.js";
import { publishFoxProfile, publishGroupProfile } from "../metaworld/identity.js";
import { exportMetaWorldSite } from "../metaworld/site.js";
import {
  addMetaWorldFederationPeer,
  buildMetaWorldPublicationHtml,
  buildMetaWorldPublicationSnapshot,
  listMetaWorldSitePublications,
  refreshMetaWorldFederationPeer,
  registerMetaWorldSitePublication,
  registerMetaWorldSitePublicationFromOutputDir,
} from "../metaworld/publication.js";

const ADMIN_PRIVATE_KEY =
  "0x8ac013baac6fd392efc57bb097b1c813eae702332ba3eaa1625f942c5472626daaaaaaaaaaaaaaaaaaaaaaaa" as const;

function makeTmpDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function makeConfig(walletAddress: `0x${string}`, dbPath: string): OpenFoxConfig {
  return {
    name: "Publication Fox",
    genesisPrompt: "test",
    creatorAddress:
      "0x0000000000000000000000000000000000000000000000000000000000000000" as `0x${string}`,
    registeredRemotely: false,
    sandboxId: "",
    runtimeApiUrl: undefined,
    runtimeApiKey: undefined,
    openaiApiKey: undefined,
    anthropicApiKey: undefined,
    ollamaBaseUrl: undefined,
    inferenceModel: "gpt-5.2",
    maxTokensPerTurn: 4096,
    heartbeatConfigPath: "~/.openfox/heartbeat.yml",
    dbPath,
    logLevel: "error",
    walletAddress,
    rpcUrl: "http://127.0.0.1:8545",
    chainId: 1666,
    version: "0.2.1",
    skillsDir: "~/.openfox/skills",
    maxChildren: 3,
    agentId: "publication-fox",
    agentDiscovery: {
      enabled: true,
      publishCard: true,
      cardTtlSeconds: 3600,
      displayName: "Publication Fox",
      endpoints: [],
      capabilities: [],
      directoryNodeRecords: [],
    },
  };
}

async function startManifestServer(payload: object): Promise<{
  server: http.Server;
  manifestUrl: string;
}> {
  const server = http.createServer((req, res) => {
    if (req.url === "/manifest.json") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(payload));
      return;
    }
    res.writeHead(404);
    res.end("not found");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("failed to start manifest server");
  }
  return {
    server,
    manifestUrl: `http://127.0.0.1:${address.port}/manifest.json`,
  };
}

describe("metaWorld publication", () => {
  let dbDir: string;
  let outputDir: string;
  let db: OpenFoxDatabase;

  beforeEach(() => {
    dbDir = makeTmpDir("openfox-world-publication-db-");
    outputDir = makeTmpDir("openfox-world-publication-out-");
    db = createDatabase(path.join(dbDir, "test.db"));
  });

  afterEach(() => {
    try {
      db.close();
    } catch {
      // ignore
    }
  });

  it("tracks published profiles, site bundles, and federation peers", async () => {
    const admin = privateKeyToAccount(ADMIN_PRIVATE_KEY);
    const config = makeConfig(admin.address, path.join(dbDir, "test.db"));

    const created = await createGroup({
      db,
      account: admin,
      input: {
        name: "Publication Group",
        description: "A public group for publication testing.",
        visibility: "public",
        actorAddress: admin.address,
        actorAgentId: "publication-fox",
        creatorDisplayName: "Publication Fox",
        tags: ["publication", "federation"],
      },
    });

    const foxPublish = publishFoxProfile(db, config);
    const groupPublish = publishGroupProfile(db, created.group.groupId);
    expect(foxPublish.cid).toBeTruthy();
    expect(groupPublish.cid).toBeTruthy();

    const siteResult = await exportMetaWorldSite({
      db,
      config,
      outputDir,
      foxLimit: 10,
      groupLimit: 10,
    });

    registerMetaWorldSitePublication({
      db,
      result: siteResult,
      baseUrl: "https://world.example/fox",
      label: "Primary World",
    });
    const reRegistered = await registerMetaWorldSitePublicationFromOutputDir({
      db,
      outputDir,
      baseUrl: "https://world.example/fox",
      label: "Re-registered World",
    });
    expect(reRegistered.publicationPath).toBe("publication/index.html");

    const siteRecords = listMetaWorldSitePublications(db);
    expect(siteRecords).toHaveLength(1);
    expect(siteRecords[0].label).toBe("Re-registered World");
    expect(siteRecords[0].publicationPath).toBe("publication/index.html");

    const remoteManifest = {
      generatedAt: "2026-03-14T12:00:00.000Z",
      shellPath: "index.html",
      foxDirectoryPath: "foxes/index.html",
      groupDirectoryPath: "groups/index.html",
      publicationPath: "publication/index.html",
      searchPath: "search/index.html",
      contentIndexPath: "content-index.json",
      routesPath: "routes.json",
      searchIndexPath: "search-index.json",
      foxPages: [{ id: "0xremote", title: "Remote Fox", path: "foxes/0xremote.html" }],
      groupPages: [{ id: "grp_remote", title: "Remote Group", path: "groups/grp_remote.html" }],
    };
    const remote = await startManifestServer(remoteManifest);
    try {
      const peer = await addMetaWorldFederationPeer({
        db,
        manifestUrl: remote.manifestUrl,
        label: "Remote World",
      });
      expect(peer.publicationPath).toBe("publication/index.html");

      const snapshot = buildMetaWorldPublicationSnapshot(db);
      expect(snapshot.counts.publishedFoxCount).toBe(1);
      expect(snapshot.counts.publishedGroupCount).toBe(1);
      expect(snapshot.counts.sitePublicationCount).toBe(1);
      expect(snapshot.counts.federationPeerCount).toBe(1);
      expect(snapshot.publishedFoxProfiles[0].displayName).toBe("Publication Fox");
      expect(snapshot.publishedGroupProfiles[0].name).toBe("Publication Group");
      expect(snapshot.sitePublications[0].label).toBe("Re-registered World");
      expect(snapshot.federationPeers[0].label).toBe("Remote World");

      const html = buildMetaWorldPublicationHtml(snapshot);
      expect(html).toContain("Publication &amp; Federation");
      expect(html).toContain("Publication Fox");
      expect(html).toContain("Publication Group");
      expect(html).toContain("Re-registered World");
      expect(html).toContain("Remote World");

      await new Promise<void>((resolve, reject) =>
        remote.server.close((err) => (err ? reject(err) : resolve())),
      );
      const refreshed = await refreshMetaWorldFederationPeer({
        db,
        peerId: peer.peerId,
      });
      expect(refreshed.lastError).toContain("fetch");
    } finally {
      if (remote.server.listening) {
        await new Promise<void>((resolve, reject) =>
          remote.server.close((err) => (err ? reject(err) : resolve())),
        );
      }
    }
  });
});
