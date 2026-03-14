import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { privateKeyToAccount } from "tosdk/accounts";
import type { OpenFoxConfig, OpenFoxDatabase } from "../types.js";
import { createDatabase } from "../state/database.js";
import {
  createGroup,
  postGroupAnnouncement,
  postGroupMessage,
} from "../group/store.js";
import { publishWorldPresence } from "../metaworld/presence.js";
import { exportMetaWorldSite } from "../metaworld/site.js";

const ADMIN_PRIVATE_KEY =
  "0x59c6995e998f97a5a0044966f094538e4a2e0d7a5b5d5b4b8b1c1d1e1f1a1b1c" as const;

function makeTmpDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function makeConfig(walletAddress: `0x${string}`, dbPath: string): OpenFoxConfig {
  return {
    name: "Site Fox",
    genesisPrompt: "test",
    creatorAddress:
      "0x0000000000000000000000000000000000000000" as `0x${string}`,
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
    logLevel: "info",
    walletAddress,
    rpcUrl: "http://127.0.0.1:8545",
    chainId: 1666,
    version: "0.2.1",
    skillsDir: "~/.openfox/skills",
    maxChildren: 3,
    agentId: "site-fox",
    agentDiscovery: {
      enabled: true,
      publishCard: false,
      cardTtlSeconds: 3600,
      displayName: "Site Fox",
      endpoints: [],
      capabilities: [],
      directoryNodeRecords: [],
    },
  };
}

describe("metaWorld site export", () => {
  let dbDir: string;
  let outputDir: string;
  let db: OpenFoxDatabase;

  beforeEach(() => {
    dbDir = makeTmpDir("openfox-world-site-db-");
    outputDir = makeTmpDir("openfox-world-site-out-");
    db = createDatabase(path.join(dbDir, "test.db"));
  });

  afterEach(() => {
    try {
      db.close();
    } catch {
      // ignore
    }
  });

  it("exports a static metaWorld site bundle with shell, directory indexes, and page files", async () => {
    const admin = privateKeyToAccount(ADMIN_PRIVATE_KEY);
    const config = makeConfig(admin.address, path.join(dbDir, "test.db"));

    const created = await createGroup({
      db,
      account: admin,
      input: {
        name: "Site Group",
        description: "A group included in the site bundle.",
        visibility: "public",
        actorAddress: admin.address,
        actorAgentId: "site-fox",
        creatorDisplayName: "Site Fox",
        tags: ["site", "bundle"],
      },
    });
    await postGroupAnnouncement({
      db,
      account: admin,
      input: {
        groupId: created.group.groupId,
        title: "Site Announcement",
        bodyText: "The site bundle should contain this announcement.",
        actorAddress: admin.address,
      },
    });
    await postGroupMessage({
      db,
      account: admin,
      input: {
        groupId: created.group.groupId,
        text: "The site bundle should contain this message.",
        actorAddress: admin.address,
        actorAgentId: "site-fox",
      },
    });
    publishWorldPresence({
      db,
      actorAddress: admin.address,
      agentId: "site-fox",
      displayName: "Site Fox",
      status: "online",
      ttlSeconds: 300,
    });

    const result = await exportMetaWorldSite({
      db,
      config,
      outputDir,
      foxLimit: 10,
      groupLimit: 10,
    });

    expect(result.foxPages).toHaveLength(1);
    expect(result.groupPages).toHaveLength(1);
    expect(fs.existsSync(path.join(outputDir, "index.html"))).toBe(true);
    expect(fs.existsSync(path.join(outputDir, "manifest.json"))).toBe(true);
    expect(fs.existsSync(path.join(outputDir, "content-index.json"))).toBe(true);
    expect(fs.existsSync(path.join(outputDir, "routes.json"))).toBe(true);
    expect(fs.existsSync(path.join(outputDir, "search-index.json"))).toBe(true);
    expect(fs.existsSync(path.join(outputDir, "search", "index.html"))).toBe(true);
    expect(fs.existsSync(path.join(outputDir, "foxes", "index.html"))).toBe(true);
    expect(fs.existsSync(path.join(outputDir, "groups", "index.html"))).toBe(true);
    expect(
      fs.existsSync(path.join(outputDir, result.foxPages[0].path)),
    ).toBe(true);
    expect(
      fs.existsSync(path.join(outputDir, result.groupPages[0].path)),
    ).toBe(true);

    const manifest = JSON.parse(
      fs.readFileSync(path.join(outputDir, "manifest.json"), "utf8"),
    ) as {
      searchPath: string;
      contentIndexPath: string;
      routesPath: string;
      searchIndexPath: string;
      foxPages: Array<{ title: string }>;
      groupPages: Array<{ title: string }>;
    };
    expect(manifest.foxPages[0].title).toBe("Site Fox");
    expect(manifest.groupPages[0].title).toBe("Site Group");
    expect(manifest.searchPath).toBe("search/index.html");
    expect(manifest.contentIndexPath).toBe("content-index.json");
    expect(manifest.routesPath).toBe("routes.json");
    expect(manifest.searchIndexPath).toBe("search-index.json");

    const contentIndex = JSON.parse(
      fs.readFileSync(path.join(outputDir, "content-index.json"), "utf8"),
    ) as {
      shell: { path: string; groupCount: number };
      foxes: Array<{ title: string; path: string }>;
      groups: Array<{ title: string; path: string; tags: string[] }>;
    };
    expect(contentIndex.shell.path).toBe("index.html");
    expect(contentIndex.shell.groupCount).toBe(1);
    expect(contentIndex.foxes[0].title).toBe("Site Fox");
    expect(contentIndex.groups[0].title).toBe("Site Group");
    expect(contentIndex.groups[0].tags).toContain("site");

    const routesIndex = JSON.parse(
      fs.readFileSync(path.join(outputDir, "routes.json"), "utf8"),
    ) as {
      routes: Array<{ kind: string; path: string; title: string }>;
    };
    expect(routesIndex.routes.some((route) => route.kind === "world_shell")).toBe(
      true,
    );
    expect(
      routesIndex.routes.some(
        (route) =>
          route.kind === "search_page" &&
          route.title === "Search" &&
          route.path === "search/index.html",
      ),
    ).toBe(true);
    expect(
      routesIndex.routes.some(
        (route) =>
          route.kind === "fox_page" && route.title === "Site Fox" && route.path === result.foxPages[0].path,
      ),
    ).toBe(true);
    expect(
      routesIndex.routes.some(
        (route) =>
          route.kind === "group_page" &&
          route.title === "Site Group" &&
          route.path === result.groupPages[0].path,
        ),
    ).toBe(true);

    const searchIndex = JSON.parse(
      fs.readFileSync(path.join(outputDir, "search-index.json"), "utf8"),
    ) as {
      foxes: Array<{ title: string; searchableText: string[] }>;
      groups: Array<{ title: string; searchableText: string[]; roleNames: string[] }>;
    };
    expect(searchIndex.foxes[0].title).toBe("Site Fox");
    expect(searchIndex.foxes[0].searchableText).toContain(admin.address.toLowerCase());
    expect(searchIndex.groups[0].title).toBe("Site Group");
    expect(searchIndex.groups[0].searchableText).toContain("site");
    expect(searchIndex.groups[0].roleNames).toContain("owner");

    const shellHtml = fs.readFileSync(path.join(outputDir, "index.html"), "utf8");
    const foxHtml = fs.readFileSync(
      path.join(outputDir, result.foxPages[0].path),
      "utf8",
    );
    const groupHtml = fs.readFileSync(
      path.join(outputDir, result.groupPages[0].path),
      "utf8",
    );
    const searchHtml = fs.readFileSync(
      path.join(outputDir, "search", "index.html"),
      "utf8",
    );
    expect(shellHtml).toContain("OpenFox metaWorld");
    expect(shellHtml).toContain('href="./foxes/index.html"');
    expect(shellHtml).toContain('href="./groups/index.html"');
    expect(shellHtml).toContain('href="./search/index.html"');
    expect(foxHtml).toContain("Site Fox");
    expect(foxHtml).toContain('href="../index.html"');
    expect(foxHtml).toContain('href="../groups/index.html"');
    expect(foxHtml).toContain('href="../search/index.html"');
    expect(foxHtml).toContain(`href="../groups/${created.group.groupId}.html"`);
    expect(groupHtml).toContain("Site Group");
    expect(groupHtml).toContain("Site Announcement");
    expect(groupHtml).toContain('href="../foxes/index.html"');
    expect(groupHtml).toContain('href="../search/index.html"');
    expect(groupHtml).toContain(`href="../foxes/${admin.address.toLowerCase()}.html"`);
    expect(searchHtml).toContain("../search-index.json");
    expect(searchHtml).toContain("Search the Fox World");
  });
});
