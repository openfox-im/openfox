import fs from "fs/promises";
import path from "path";
import type { OpenFoxConfig, OpenFoxDatabase } from "../types.js";
import {
  buildWorldFoxDirectorySnapshot,
  buildWorldGroupDirectorySnapshot,
} from "./directory.js";
import {
  buildFoxPageHtml,
  buildFoxPageSnapshot,
} from "./fox-page.js";
import {
  buildGroupPageHtml,
  buildGroupPageSnapshot,
} from "./group-page.js";
import {
  renderMetaWorldPageFrame,
  escapeHtml,
} from "./render.js";
import {
  buildMetaWorldShellHtml,
  buildMetaWorldShellSnapshot,
} from "./shell.js";

export interface MetaWorldSitePageRef {
  id: string;
  title: string;
  path: string;
}

export interface MetaWorldSiteManifest {
  generatedAt: string;
  shellPath: string;
  foxDirectoryPath: string;
  groupDirectoryPath: string;
  contentIndexPath: string;
  routesPath: string;
  foxPages: MetaWorldSitePageRef[];
  groupPages: MetaWorldSitePageRef[];
}

export interface MetaWorldSiteExportResult extends MetaWorldSiteManifest {
  outputDir: string;
  manifestPath: string;
}

export interface MetaWorldSiteContentIndex {
  generatedAt: string;
  shell: {
    path: string;
    foxCount: number;
    groupCount: number;
    unreadNotificationCount: number;
    activeGroupCount: number;
    feedItemCount: number;
  };
  foxes: Array<{
    address: string;
    title: string;
    path: string;
    tnsName: string | null;
    activeGroupCount: number;
    presenceStatus: string | null;
    roles: string[];
  }>;
  groups: Array<{
    groupId: string;
    title: string;
    path: string;
    visibility: "private" | "listed" | "public";
    joinMode: "invite_only" | "request_approval";
    activeMemberCount: number;
    tags: string[];
  }>;
}

export interface MetaWorldSiteRoutesIndex {
  generatedAt: string;
  routes: Array<
    | {
        kind: "world_shell";
        path: string;
        title: string;
      }
    | {
        kind: "directory";
        directoryKind: "foxes" | "groups";
        path: string;
        title: string;
      }
    | {
        kind: "fox_page";
        address: string;
        path: string;
        title: string;
      }
    | {
        kind: "group_page";
        groupId: string;
        path: string;
        title: string;
      }
  >;
}

function renderDirectoryPage(params: {
  title: string;
  eyebrow: string;
  heading: string;
  lede: string;
  generatedAt: string;
  metrics: Array<{ label: string; value: string | number }>;
  entries: Array<{ title: string; subtitle: string; href: string }>;
  navLinks: Array<{ label: string; href: string }>;
}): string {
  const listItems = params.entries
    .map(
      (entry) => `<li><strong><a href="${escapeHtml(entry.href)}">${escapeHtml(entry.title)}</a></strong><span>${escapeHtml(entry.subtitle)}</span></li>`,
    )
    .join("");

  return renderMetaWorldPageFrame({
    title: params.title,
    eyebrow: params.eyebrow,
    heading: params.heading,
    lede: params.lede,
    generatedAt: params.generatedAt,
    metrics: params.metrics,
    navLinks: params.navLinks,
    sections: [
      `<section class="panel">
        <div class="section-head">
          <h3>Entries</h3>
          <span>${params.entries.length}</span>
        </div>
        <ul class="directory-list">${listItems || '<li class="empty">No entries.</li>'}</ul>
      </section>`,
    ],
  });
}

export async function exportMetaWorldSite(params: {
  db: OpenFoxDatabase;
  config: OpenFoxConfig;
  outputDir: string;
  foxLimit?: number;
  groupLimit?: number;
  shellFeedLimit?: number;
  shellNotificationLimit?: number;
  shellBoardLimit?: number;
  shellDirectoryLimit?: number;
  shellGroupLimit?: number;
  foxActivityLimit?: number;
  foxMessageLimit?: number;
  foxAnnouncementLimit?: number;
  foxPresenceLimit?: number;
  groupMessageLimit?: number;
  groupAnnouncementLimit?: number;
  groupEventLimit?: number;
  groupPresenceLimit?: number;
  groupActivityLimit?: number;
}): Promise<MetaWorldSiteExportResult> {
  const generatedAt = new Date().toISOString();
  const outputDir = params.outputDir;
  const foxLimit = Math.max(1, params.foxLimit ?? 50);
  const groupLimit = Math.max(1, params.groupLimit ?? 50);
  const shellFoxLinks = Object.fromEntries(
    buildWorldFoxDirectorySnapshot(params.db, params.config, {
      limit: foxLimit,
    }).items.map((item) => [item.address, `./foxes/${item.address}.html`]),
  );
  const shellGroupLinks = Object.fromEntries(
    buildWorldGroupDirectorySnapshot(params.db, {
      limit: groupLimit,
    }).items.map((item) => [item.groupId, `./groups/${item.groupId}.html`]),
  );

  const shellSnapshot = buildMetaWorldShellSnapshot({
    db: params.db,
    config: params.config,
    feedLimit: Math.max(1, params.shellFeedLimit ?? 16),
    notificationLimit: Math.max(1, params.shellNotificationLimit ?? 12),
    boardLimit: Math.max(1, params.shellBoardLimit ?? 8),
    directoryLimit: Math.max(
      foxLimit,
      groupLimit,
      params.shellDirectoryLimit ?? 24,
    ),
    groupPageLimit: Math.max(1, params.shellGroupLimit ?? 4),
  });
  const foxDirectory = buildWorldFoxDirectorySnapshot(params.db, params.config, {
    limit: foxLimit,
  });
  const groupDirectory = buildWorldGroupDirectorySnapshot(params.db, {
    limit: groupLimit,
  });

  const foxDir = path.join(outputDir, "foxes");
  const groupDir = path.join(outputDir, "groups");
  await fs.mkdir(foxDir, { recursive: true });
  await fs.mkdir(groupDir, { recursive: true });

  await fs.writeFile(
    path.join(outputDir, "index.html"),
    buildMetaWorldShellHtml(shellSnapshot, {
      foxDirectoryHref: "./foxes/index.html",
      groupDirectoryHref: "./groups/index.html",
      foxHrefsByAddress: shellFoxLinks,
      groupHrefsById: shellGroupLinks,
    }),
    "utf8",
  );

  const foxPages: MetaWorldSitePageRef[] = [];
  for (const item of foxDirectory.items) {
    const snapshot = buildFoxPageSnapshot({
      db: params.db,
      config: params.config,
      address: item.address,
      activityLimit: Math.max(1, params.foxActivityLimit ?? 12),
      messageLimit: Math.max(1, params.foxMessageLimit ?? 10),
      announcementLimit: Math.max(1, params.foxAnnouncementLimit ?? 8),
      presenceLimit: Math.max(1, params.foxPresenceLimit ?? 10),
    });
    const relativePath = `foxes/${item.address}.html`;
    await fs.writeFile(
      path.join(outputDir, relativePath),
      buildFoxPageHtml(snapshot, {
        homeHref: "../index.html",
        foxDirectoryHref: "./index.html",
        groupDirectoryHref: "../groups/index.html",
        groupHrefsById: Object.fromEntries(
          Object.entries(shellGroupLinks).map(([groupId, href]) => [
            groupId,
            href.replace("./groups/", "../groups/"),
          ]),
        ),
      }),
      "utf8",
    );
    foxPages.push({
      id: item.address,
      title: snapshot.fox.displayName,
      path: relativePath,
    });
  }

  const groupPages: MetaWorldSitePageRef[] = [];
  for (const item of groupDirectory.items) {
    const snapshot = buildGroupPageSnapshot(params.db, {
      groupId: item.groupId,
      messageLimit: Math.max(1, params.groupMessageLimit ?? 20),
      announcementLimit: Math.max(1, params.groupAnnouncementLimit ?? 10),
      eventLimit: Math.max(1, params.groupEventLimit ?? 20),
      presenceLimit: Math.max(1, params.groupPresenceLimit ?? 20),
      activityLimit: Math.max(1, params.groupActivityLimit ?? 20),
    });
    const relativePath = `groups/${item.groupId}.html`;
    await fs.writeFile(
      path.join(outputDir, relativePath),
      buildGroupPageHtml(snapshot, {
        homeHref: "../index.html",
        foxDirectoryHref: "../foxes/index.html",
        groupDirectoryHref: "./index.html",
        foxHrefsByAddress: Object.fromEntries(
          Object.entries(shellFoxLinks).map(([address, href]) => [
            address,
            href.replace("./foxes/", "../foxes/"),
          ]),
        ),
      }),
      "utf8",
    );
    groupPages.push({
      id: item.groupId,
      title: snapshot.group.name,
      path: relativePath,
    });
  }

  await fs.writeFile(
    path.join(foxDir, "index.html"),
    renderDirectoryPage({
      title: "Fox Directory · OpenFox metaWorld",
      eyebrow: "OpenFox Fox Directory",
      heading: "Fox Directory",
      lede: "Exported fox pages for the local-first metaWorld bundle.",
      generatedAt,
      metrics: [
        { label: "Fox pages", value: foxPages.length },
        { label: "Generated at", value: generatedAt.slice(0, 19) },
      ],
      navLinks: [
        { label: "World Shell", href: "../index.html" },
        { label: "Fox Directory", href: "./index.html" },
        { label: "Group Directory", href: "../groups/index.html" },
      ],
      entries: foxDirectory.items.map((item) => ({
        title: item.displayName,
        subtitle: `${item.presenceStatus || "offline"} · groups=${item.activeGroupCount}`,
        href: `./${item.address}.html`,
      })),
    }),
    "utf8",
  );

  await fs.writeFile(
    path.join(groupDir, "index.html"),
    renderDirectoryPage({
      title: "Group Directory · OpenFox metaWorld",
      eyebrow: "OpenFox Group Directory",
      heading: "Group Directory",
      lede: "Exported group pages for the local-first metaWorld bundle.",
      generatedAt,
      metrics: [
        { label: "Group pages", value: groupPages.length },
        { label: "Generated at", value: generatedAt.slice(0, 19) },
      ],
      navLinks: [
        { label: "World Shell", href: "../index.html" },
        { label: "Fox Directory", href: "../foxes/index.html" },
        { label: "Group Directory", href: "./index.html" },
      ],
      entries: groupDirectory.items.map((item) => ({
        title: item.name,
        subtitle: `${item.visibility} · members=${item.activeMemberCount}`,
        href: `./${item.groupId}.html`,
      })),
    }),
    "utf8",
  );

  const contentIndex: MetaWorldSiteContentIndex = {
    generatedAt,
    shell: {
      path: "index.html",
      foxCount: foxDirectory.items.length,
      groupCount: groupDirectory.items.length,
      unreadNotificationCount: shellSnapshot.notifications.unreadCount,
      activeGroupCount: shellSnapshot.fox.stats.activeGroupCount,
      feedItemCount: shellSnapshot.feed.items.length,
    },
    foxes: foxDirectory.items.map((item) => ({
      address: item.address,
      title: item.displayName,
      path: `foxes/${item.address}.html`,
      tnsName: item.tnsName,
      activeGroupCount: item.activeGroupCount,
      presenceStatus: item.presenceStatus,
      roles: item.roles,
    })),
    groups: groupDirectory.items.map((item) => ({
      groupId: item.groupId,
      title: item.name,
      path: `groups/${item.groupId}.html`,
      visibility: item.visibility,
      joinMode: item.joinMode,
      activeMemberCount: item.activeMemberCount,
      tags: item.tags,
    })),
  };
  await fs.writeFile(
    path.join(outputDir, "content-index.json"),
    `${JSON.stringify(contentIndex, null, 2)}\n`,
    "utf8",
  );

  const routesIndex: MetaWorldSiteRoutesIndex = {
    generatedAt,
    routes: [
      {
        kind: "world_shell",
        path: "index.html",
        title: "OpenFox metaWorld",
      },
      {
        kind: "directory",
        directoryKind: "foxes",
        path: "foxes/index.html",
        title: "Fox Directory",
      },
      {
        kind: "directory",
        directoryKind: "groups",
        path: "groups/index.html",
        title: "Group Directory",
      },
      ...foxPages.map((page) => ({
        kind: "fox_page" as const,
        address: page.id,
        path: page.path,
        title: page.title,
      })),
      ...groupPages.map((page) => ({
        kind: "group_page" as const,
        groupId: page.id,
        path: page.path,
        title: page.title,
      })),
    ],
  };
  await fs.writeFile(
    path.join(outputDir, "routes.json"),
    `${JSON.stringify(routesIndex, null, 2)}\n`,
    "utf8",
  );

  const manifest: MetaWorldSiteManifest = {
    generatedAt,
    shellPath: "index.html",
    foxDirectoryPath: "foxes/index.html",
    groupDirectoryPath: "groups/index.html",
    contentIndexPath: "content-index.json",
    routesPath: "routes.json",
    foxPages,
    groupPages,
  };
  const manifestPath = path.join(outputDir, "manifest.json");
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  return {
    ...manifest,
    outputDir,
    manifestPath,
  };
}
