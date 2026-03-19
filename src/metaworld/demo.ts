import fs from "fs/promises";
import os from "os";
import path from "path";
import { privateKeyToAccount } from "@tosnetwork/tosdk/accounts";
import { createConfig } from "../config.js";
import { createDatabase } from "../state/database.js";
import type { OpenFoxConfig, OpenFoxDatabase, WalletData } from "../types.js";
import {
  acceptGroupInvite,
  createGroup,
  postGroupAnnouncement,
  postGroupMessage,
  sendGroupInvite,
} from "../group/store.js";
import { applyGroupSnapshot, buildGroupSnapshot } from "../group/sync.js";
import { publishWorldPresence } from "./presence.js";
import { followFox, followGroup } from "./follows.js";
import { subscribeToFeed } from "./subscriptions.js";
import { buildGroupPageSnapshot } from "./group-page.js";
import { buildWorldFeedSnapshot } from "./feed.js";
import { exportMetaWorldSite, type MetaWorldSiteExportResult } from "./site.js";
import { startMetaWorldServer } from "./server.js";

type DemoNodeId = "alpha" | "beta" | "observer";

interface DemoNodeSeedSpec {
  id: DemoNodeId;
  role: "host" | "member" | "observer";
  displayName: string;
  agentId: string;
  privateKey: `0x${string}`;
  servePort: number;
}

export interface MetaWorldDemoNodeManifest {
  id: DemoNodeId;
  role: "host" | "member" | "observer";
  displayName: string;
  agentId: string;
  servePort: number;
  homeDir: string;
  openfoxDir: string;
  configPath: string;
  walletPath: string;
  dbPath: string;
  siteDir: string;
}

export interface MetaWorldDemoManifest {
  version: 1;
  generatedAt: string;
  bundleName: string;
  nodes: MetaWorldDemoNodeManifest[];
  replicatedGroup: {
    groupId: string;
    name: string;
    expectedActiveMembers: number;
    expectedAnnouncements: number;
    expectedMessages: number;
    expectedPresence: number;
    expectedFeedTitles: string[];
  };
}

export interface MetaWorldDemoExportResult {
  outputDir: string;
  manifestPath: string;
  manifest: MetaWorldDemoManifest;
}

export interface MetaWorldDemoValidationCheck {
  name: string;
  ok: boolean;
  detail: string;
}

export interface MetaWorldDemoNodeValidation {
  nodeId: DemoNodeId;
  url: string;
  feedCount: number;
  groupCount: number;
  groupPage: {
    activeMemberCount: number;
    announcementCount: number;
    messageCount: number;
    presenceCount: number;
  };
  site: {
    outputDir: string;
    manifestPath: string;
    shellPath: string;
    groupPagePath: string;
  };
}

export interface MetaWorldDemoValidationResult {
  bundleDir: string;
  validatedAt: string;
  ok: boolean;
  checks: MetaWorldDemoValidationCheck[];
  nodes: MetaWorldDemoNodeValidation[];
}

const DEMO_BUNDLE_NAME = "openfox-metaworld-demo";
const DEMO_DB_FILENAME = "metaworld.db";
const DEMO_MANIFEST_FILENAME = "metaworld-demo.json";

const DEMO_NODES: DemoNodeSeedSpec[] = [
  {
    id: "alpha",
    role: "host",
    displayName: "Alpha Fox",
    agentId: "alpha-fox",
    privateKey:
      "0x59c6995e998f97a5a0044966f094538e4a2e0d7a5b5d5b4b8b1c1d1e1f1a1b1c",
    servePort: 4101,
  },
  {
    id: "beta",
    role: "member",
    displayName: "Beta Fox",
    agentId: "beta-fox",
    privateKey:
      "0x8b3a350cf5c34c9194ca3b6d7d2bbf4fcb57db538f9b1a9ff9b90f9bcb8c4d11",
    servePort: 4102,
  },
  {
    id: "observer",
    role: "observer",
    displayName: "Observer Fox",
    agentId: "observer-fox",
    privateKey:
      "0x9f2c9f6cbe7ef4d6af7adf4647bcf8b2f5d7286213b5636e33d7e6443da8932b",
    servePort: 4103,
  },
];

function toPosixRelative(from: string, to: string): string {
  return path.relative(from, to).split(path.sep).join("/");
}

function makeDemoConfig(params: {
  displayName: string;
  agentId: string;
  walletAddress: `0x${string}`;
}): OpenFoxConfig {
  const base = createConfig({
    name: params.displayName,
    genesisPrompt: `Operate as ${params.displayName} inside the local OpenFox metaWorld demo bundle.`,
    creatorAddress: params.walletAddress,
    sandboxId: `demo-${params.agentId}`,
    walletAddress: params.walletAddress,
    inferenceModel: "gpt-5.2",
    rpcUrl: "http://127.0.0.1:8545",
    chainId: 1666,
    registeredRemotely: false,
  });
  return {
    ...base,
    name: params.displayName,
    agentId: params.agentId,
    dbPath: `~/.openfox/${DEMO_DB_FILENAME}`,
    heartbeatConfigPath: "~/.openfox/heartbeat.yml",
    skillsDir: "~/.openfox/skills",
    agentDiscovery: {
      ...base.agentDiscovery,
      enabled: true,
      publishCard: false,
      displayName: params.displayName,
      endpoints: [],
      capabilities: [],
      directoryNodeRecords: [],
    },
  } as OpenFoxConfig;
}

async function writeJsonFile(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function exportNodeSite(params: {
  db: OpenFoxDatabase;
  config: OpenFoxConfig;
  outputDir: string;
}): Promise<MetaWorldSiteExportResult> {
  await fs.rm(params.outputDir, { recursive: true, force: true });
  return exportMetaWorldSite({
    db: params.db,
    config: params.config,
    outputDir: params.outputDir,
    foxLimit: 16,
    groupLimit: 16,
  });
}

function renderDemoReadme(manifest: MetaWorldDemoManifest): string {
  const nodeLines = manifest.nodes
    .map(
      (node) =>
        `- \`${node.id}\` (${node.role}) — port \`${node.servePort}\`, home \`${node.homeDir}\``,
    )
    .join("\n");
  return `# OpenFox metaWorld Local Demo

This bundle is a packaged local multi-node OpenFox metaWorld environment.

It contains:

- three local Fox nodes with separate \`HOME\` directories
- seeded SQLite state for a replicated Group and shared world activity
- pre-exported static site bundles for each node
- a manifest that describes the demo topology
- helper scripts to serve and validate the bundle

## Topology

${nodeLines}

Replicated Group:

- \`${manifest.replicatedGroup.name}\`
- group id: \`${manifest.replicatedGroup.groupId}\`
- expected active members: \`${manifest.replicatedGroup.expectedActiveMembers}\`

## Quick Start

Serve one node in a terminal:

\`\`\`bash
./scripts/serve-node.sh alpha
\`\`\`

Serve another node in a second terminal:

\`\`\`bash
./scripts/serve-node.sh beta
\`\`\`

Validate the bundle end-to-end:

\`\`\`bash
./scripts/validate.sh
\`\`\`

## Notes

- The scripts expect an OpenFox CLI on your machine.
- By default they use \`pnpm openfox\`.
- Override with \`OPENFOX_BIN\` if needed, for example:

\`\`\`bash
OPENFOX_BIN="npx @openfox/openfox" ./scripts/validate.sh
\`\`\`
`;
}

function renderServeNodeScript(): string {
  return `#!/usr/bin/env bash
set -euo pipefail

BUNDLE_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
NODE_ID="\${1:-alpha}"

case "$NODE_ID" in
  alpha) NODE_HOME="$BUNDLE_ROOT/nodes/alpha"; PORT=4101 ;;
  beta) NODE_HOME="$BUNDLE_ROOT/nodes/beta"; PORT=4102 ;;
  observer) NODE_HOME="$BUNDLE_ROOT/nodes/observer"; PORT=4103 ;;
  *)
    echo "Usage: $0 <alpha|beta|observer>" >&2
    exit 1
    ;;
esac

if [ -n "\${OPENFOX_BIN:-}" ]; then
  # shellcheck disable=SC2206
  BIN=(\${OPENFOX_BIN})
else
  BIN=(pnpm openfox)
fi

env HOME="$NODE_HOME" "\${BIN[@]}" world serve --host 127.0.0.1 --port "$PORT"
`;
}

function renderValidateScript(): string {
  return `#!/usr/bin/env bash
set -euo pipefail

BUNDLE_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

if [ -n "\${OPENFOX_BIN:-}" ]; then
  # shellcheck disable=SC2206
  BIN=(\${OPENFOX_BIN})
else
  BIN=(pnpm openfox)
fi

"\${BIN[@]}" world demo validate --bundle "$BUNDLE_ROOT"
`;
}

async function chmodExecutable(filePath: string): Promise<void> {
  await fs.chmod(filePath, 0o755);
}

function loadDemoNodeConfig(nodeRoot: string): Promise<OpenFoxConfig> {
  return fs
    .readFile(path.join(nodeRoot, ".openfox", "openfox.json"), "utf8")
    .then((text) => JSON.parse(text) as OpenFoxConfig);
}

export async function exportMetaWorldDemoBundle(params: {
  outputDir: string;
  force?: boolean;
}): Promise<MetaWorldDemoExportResult> {
  const outputDir = path.resolve(params.outputDir);
  if (await fs.stat(outputDir).then(() => true).catch(() => false)) {
    if (!params.force) {
      throw new Error(
        `Output path already exists: ${outputDir}. Re-run with --force to overwrite.`,
      );
    }
    await fs.rm(outputDir, { recursive: true, force: true });
  }

  await fs.mkdir(outputDir, { recursive: true });
  await fs.mkdir(path.join(outputDir, "nodes"), { recursive: true });
  await fs.mkdir(path.join(outputDir, "sites"), { recursive: true });
  await fs.mkdir(path.join(outputDir, "scripts"), { recursive: true });

  const runtimeNodes = await Promise.all(
    DEMO_NODES.map(async (spec) => {
      const account = privateKeyToAccount(spec.privateKey);
      const nodeHome = path.join(outputDir, "nodes", spec.id);
      const openfoxDir = path.join(nodeHome, ".openfox");
      const dbPath = path.join(openfoxDir, DEMO_DB_FILENAME);
      const configPath = path.join(openfoxDir, "openfox.json");
      const walletPath = path.join(openfoxDir, "wallet.json");
      const config = makeDemoConfig({
        displayName: spec.displayName,
        agentId: spec.agentId,
        walletAddress: account.address,
      });
      const walletData: WalletData = {
        privateKey: spec.privateKey,
        createdAt: new Date().toISOString(),
      };
      await writeJsonFile(configPath, config);
      await writeJsonFile(walletPath, walletData);
      const db = createDatabase(dbPath);
      return {
        spec,
        account,
        config,
        db,
        homeDir: nodeHome,
        openfoxDir,
        configPath,
        walletPath,
        dbPath,
        siteDir: path.join(outputDir, "sites", spec.id),
      };
    }),
  );

  try {
    const alpha = runtimeNodes.find((node) => node.spec.id === "alpha");
    const beta = runtimeNodes.find((node) => node.spec.id === "beta");
    const observer = runtimeNodes.find((node) => node.spec.id === "observer");
    if (!alpha || !beta || !observer) {
      throw new Error("demo bundle requires alpha, beta, and observer nodes");
    }

    const created = await createGroup({
      db: alpha.db,
      account: alpha.account,
      input: {
        name: "Fox Builders Guild",
        description:
          "A replicated OpenFox metaWorld community used to validate cross-node pages, feeds, and local-first synchronization.",
        visibility: "public",
        joinMode: "invite_only",
        tags: ["metaworld", "demo", "builders"],
        actorAddress: alpha.account.address,
        actorAgentId: alpha.spec.agentId,
        creatorDisplayName: alpha.spec.displayName,
      },
    });
    const groupId = created.group.groupId;

    const invite = await sendGroupInvite({
      db: alpha.db,
      account: alpha.account,
      input: {
        groupId,
        targetAddress: beta.account.address,
        targetAgentId: beta.spec.agentId,
        targetRoles: ["member"],
        actorAddress: alpha.account.address,
        actorAgentId: alpha.spec.agentId,
      },
    });

    await acceptGroupInvite({
      db: alpha.db,
      account: beta.account,
      input: {
        groupId,
        proposalId: invite.proposal.proposalId,
        actorAddress: beta.account.address,
        actorAgentId: beta.spec.agentId,
        displayName: beta.spec.displayName,
      },
    });

    await postGroupAnnouncement({
      db: alpha.db,
      account: alpha.account,
      input: {
        groupId,
        title: "Fox metaWorld demo online",
        bodyText:
          "This replicated Group is seeded by openfox world demo export and should appear identically on every synced node.",
        pin: true,
        actorAddress: alpha.account.address,
        actorAgentId: alpha.spec.agentId,
      },
    });

    await postGroupMessage({
      db: alpha.db,
      account: alpha.account,
      input: {
        groupId,
        text: "Alpha Fox published the first replicated message.",
        actorAddress: alpha.account.address,
        actorAgentId: alpha.spec.agentId,
      },
    });

    await postGroupMessage({
      db: alpha.db,
      account: beta.account,
      input: {
        groupId,
        text: "Beta Fox confirms the feed and pages should stay in sync.",
        actorAddress: beta.account.address,
        actorAgentId: beta.spec.agentId,
      },
    });

    publishWorldPresence({
      db: alpha.db,
      actorAddress: alpha.account.address,
      agentId: alpha.spec.agentId,
      displayName: alpha.spec.displayName,
      status: "online",
      summary: "Hosting the demo guild.",
      groupId,
      ttlSeconds: 600,
    });
    publishWorldPresence({
      db: alpha.db,
      actorAddress: beta.account.address,
      agentId: beta.spec.agentId,
      displayName: beta.spec.displayName,
      status: "busy",
      summary: "Validating replicated community state.",
      groupId,
      ttlSeconds: 600,
    });

    followFox(alpha.db, {
      followerAddress: alpha.account.address,
      targetAddress: beta.account.address,
    });
    followFox(alpha.db, {
      followerAddress: beta.account.address,
      targetAddress: alpha.account.address,
    });
    followGroup(alpha.db, {
      followerAddress: alpha.account.address,
      groupId,
    });
    subscribeToFeed(alpha.db, {
      address: alpha.account.address,
      feedKind: "group",
      targetId: groupId,
      notifyOn: ["announcement", "message"],
    });

    const snapshot = buildGroupSnapshot(alpha.db, groupId);
    applyGroupSnapshot(beta.db, groupId, snapshot);
    applyGroupSnapshot(observer.db, groupId, snapshot);

    for (const replica of [beta, observer]) {
      publishWorldPresence({
        db: replica.db,
        actorAddress: alpha.account.address,
        agentId: alpha.spec.agentId,
        displayName: alpha.spec.displayName,
        status: "online",
        summary: "Hosting the demo guild.",
        groupId,
        ttlSeconds: 600,
      });
      publishWorldPresence({
        db: replica.db,
        actorAddress: beta.account.address,
        agentId: beta.spec.agentId,
        displayName: beta.spec.displayName,
        status: "busy",
        summary: "Validating replicated community state.",
        groupId,
        ttlSeconds: 600,
      });
    }

    const expectedGroup = buildGroupPageSnapshot(alpha.db, {
      groupId,
      messageLimit: 20,
      announcementLimit: 10,
      presenceLimit: 20,
      activityLimit: 20,
    });
    const expectedFeedTitles = buildWorldFeedSnapshot(alpha.db, {
      groupId,
      limit: 10,
    }).items.map((item) => item.title);

    for (const node of runtimeNodes) {
      await exportNodeSite({
        db: node.db,
        config: node.config,
        outputDir: node.siteDir,
      });
    }

    const manifest: MetaWorldDemoManifest = {
      version: 1,
      generatedAt: new Date().toISOString(),
      bundleName: DEMO_BUNDLE_NAME,
      nodes: runtimeNodes.map((node) => ({
        id: node.spec.id,
        role: node.spec.role,
        displayName: node.spec.displayName,
        agentId: node.spec.agentId,
        servePort: node.spec.servePort,
        homeDir: toPosixRelative(outputDir, node.homeDir),
        openfoxDir: toPosixRelative(outputDir, node.openfoxDir),
        configPath: toPosixRelative(outputDir, node.configPath),
        walletPath: toPosixRelative(outputDir, node.walletPath),
        dbPath: toPosixRelative(outputDir, node.dbPath),
        siteDir: toPosixRelative(outputDir, node.siteDir),
      })),
      replicatedGroup: {
        groupId,
        name: expectedGroup.group.name,
        expectedActiveMembers: expectedGroup.stats.activeMemberCount,
        expectedAnnouncements: expectedGroup.stats.announcementCount,
        expectedMessages: expectedGroup.stats.messageCount,
        expectedPresence: expectedGroup.stats.presenceCount,
        expectedFeedTitles,
      },
    };

    const manifestPath = path.join(outputDir, DEMO_MANIFEST_FILENAME);
    await writeJsonFile(manifestPath, manifest);
    await fs.writeFile(
      path.join(outputDir, "README.md"),
      renderDemoReadme(manifest),
      "utf8",
    );
    const serveScriptPath = path.join(outputDir, "scripts", "serve-node.sh");
    const validateScriptPath = path.join(outputDir, "scripts", "validate.sh");
    await fs.writeFile(serveScriptPath, renderServeNodeScript(), "utf8");
    await fs.writeFile(validateScriptPath, renderValidateScript(), "utf8");
    await chmodExecutable(serveScriptPath);
    await chmodExecutable(validateScriptPath);

    return {
      outputDir,
      manifestPath,
      manifest,
    };
  } finally {
    for (const node of runtimeNodes) {
      try {
        node.db.close();
      } catch {
        // ignore
      }
    }
  }
}

export async function loadMetaWorldDemoManifest(
  bundleDir: string,
): Promise<MetaWorldDemoManifest> {
  const manifestPath = path.join(path.resolve(bundleDir), DEMO_MANIFEST_FILENAME);
  const raw = await fs.readFile(manifestPath, "utf8");
  return JSON.parse(raw) as MetaWorldDemoManifest;
}

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`request failed: ${response.status} ${response.statusText} for ${url}`);
  }
  return response.json();
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`request failed: ${response.status} ${response.statusText} for ${url}`);
  }
  return response.text();
}

export async function validateMetaWorldDemoBundle(params: {
  bundleDir: string;
}): Promise<MetaWorldDemoValidationResult> {
  const bundleDir = path.resolve(params.bundleDir);
  const manifest = await loadMetaWorldDemoManifest(bundleDir);

  const runtimeNodes = await Promise.all(
    manifest.nodes.map(async (node) => {
      const config = await loadDemoNodeConfig(path.join(bundleDir, node.homeDir));
      const db = createDatabase(path.join(bundleDir, node.dbPath));
      return {
        manifestNode: node,
        config: {
          ...config,
          dbPath: path.join(bundleDir, node.dbPath),
        } as OpenFoxConfig,
        db,
      };
    }),
  );

  const servers = [];
  const validationNodes: MetaWorldDemoNodeValidation[] = [];
  const checks: MetaWorldDemoValidationCheck[] = [];

  try {
    for (const node of runtimeNodes) {
      const server = await startMetaWorldServer({
        db: node.db,
        config: node.config,
        port: 0,
        host: "127.0.0.1",
      });
      servers.push(server);
    }

    for (let index = 0; index < runtimeNodes.length; index += 1) {
      const runtime = runtimeNodes[index];
      const server = servers[index];
      const groupId = manifest.replicatedGroup.groupId;

      const [feed, directory, groupPage, groupHtml] = await Promise.all([
        fetchJson(`${server.url}/api/v1/feed?limit=20`) as Promise<{
          items: Array<{ title: string }>;
        }>,
        fetchJson(`${server.url}/api/v1/directory/groups?limit=20`) as Promise<{
          items: Array<{ groupId: string }>;
        }>,
        fetchJson(
          `${server.url}/api/v1/group/${encodeURIComponent(groupId)}`,
        ) as Promise<{
          stats: {
            activeMemberCount: number;
            announcementCount: number;
            messageCount: number;
            presenceCount: number;
          };
        }>,
        fetchText(`${server.url}/group/${encodeURIComponent(groupId)}`),
      ]);

      const siteOutputDir = await fs.mkdtemp(
        path.join(os.tmpdir(), `openfox-metaworld-demo-site-${runtime.manifestNode.id}-`),
      );
      const siteResult = await exportNodeSite({
        db: runtime.db,
        config: runtime.config,
        outputDir: siteOutputDir,
      });
      const generatedGroupPagePath = path.join(
        siteOutputDir,
        "groups",
        `${groupId}.html`,
      );
      const generatedGroupHtml = await fs.readFile(generatedGroupPagePath, "utf8");

      validationNodes.push({
        nodeId: runtime.manifestNode.id,
        url: server.url,
        feedCount: feed.items.length,
        groupCount: directory.items.length,
        groupPage: {
          activeMemberCount: groupPage.stats.activeMemberCount,
          announcementCount: groupPage.stats.announcementCount,
          messageCount: groupPage.stats.messageCount,
          presenceCount: groupPage.stats.presenceCount,
        },
        site: {
          outputDir: siteResult.outputDir,
          manifestPath: siteResult.manifestPath,
          shellPath: siteResult.shellPath,
          groupPagePath: `groups/${groupId}.html`,
        },
      });

      checks.push({
        name: `${runtime.manifestNode.id}: replicated group visible in directory`,
        ok: directory.items.some((item) => item.groupId === groupId),
        detail: `${directory.items.length} group(s) visible`,
      });
      checks.push({
        name: `${runtime.manifestNode.id}: group page member count`,
        ok:
          groupPage.stats.activeMemberCount ===
          manifest.replicatedGroup.expectedActiveMembers,
        detail: `expected=${manifest.replicatedGroup.expectedActiveMembers} actual=${groupPage.stats.activeMemberCount}`,
      });
      checks.push({
        name: `${runtime.manifestNode.id}: group page announcement count`,
        ok:
          groupPage.stats.announcementCount ===
          manifest.replicatedGroup.expectedAnnouncements,
        detail: `expected=${manifest.replicatedGroup.expectedAnnouncements} actual=${groupPage.stats.announcementCount}`,
      });
      checks.push({
        name: `${runtime.manifestNode.id}: group page message count`,
        ok:
          groupPage.stats.messageCount ===
          manifest.replicatedGroup.expectedMessages,
        detail: `expected=${manifest.replicatedGroup.expectedMessages} actual=${groupPage.stats.messageCount}`,
      });
      checks.push({
        name: `${runtime.manifestNode.id}: group page presence count`,
        ok:
          groupPage.stats.presenceCount ===
          manifest.replicatedGroup.expectedPresence,
        detail: `expected=${manifest.replicatedGroup.expectedPresence} actual=${groupPage.stats.presenceCount}`,
      });
      checks.push({
        name: `${runtime.manifestNode.id}: feed contains replicated titles`,
        ok: manifest.replicatedGroup.expectedFeedTitles.every((title) =>
          feed.items.some((item) => item.title === title),
        ),
        detail: `${feed.items.length} feed item(s) inspected`,
      });
      checks.push({
        name: `${runtime.manifestNode.id}: live HTML page contains group content`,
        ok:
          groupHtml.includes(manifest.replicatedGroup.name) &&
          manifest.replicatedGroup.expectedFeedTitles.every((title) =>
            groupHtml.includes(title),
          ),
        detail: `checked live HTML route for ${groupId}`,
      });
      checks.push({
        name: `${runtime.manifestNode.id}: site export contains group content`,
        ok:
          generatedGroupHtml.includes(manifest.replicatedGroup.name) &&
          manifest.replicatedGroup.expectedFeedTitles.every((title) =>
            generatedGroupHtml.includes(title),
          ),
        detail: generatedGroupPagePath,
      });
    }
  } finally {
    await Promise.all(
      servers.map((server) => server.close().catch(() => undefined)),
    );
    for (const node of runtimeNodes) {
      try {
        node.db.close();
      } catch {
        // ignore
      }
    }
  }

  return {
    bundleDir,
    validatedAt: new Date().toISOString(),
    ok: checks.every((check) => check.ok),
    checks,
    nodes: validationNodes,
  };
}
