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
  foxPages: MetaWorldSitePageRef[];
  groupPages: MetaWorldSitePageRef[];
}

export interface MetaWorldSiteExportResult extends MetaWorldSiteManifest {
  outputDir: string;
  manifestPath: string;
}

function renderDirectoryPage(params: {
  title: string;
  eyebrow: string;
  heading: string;
  lede: string;
  generatedAt: string;
  metrics: Array<{ label: string; value: string | number }>;
  entries: Array<{ title: string; subtitle: string; href: string }>;
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
    buildMetaWorldShellHtml(shellSnapshot),
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
      buildFoxPageHtml(snapshot),
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
      buildGroupPageHtml(snapshot),
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
      entries: groupDirectory.items.map((item) => ({
        title: item.name,
        subtitle: `${item.visibility} · members=${item.activeMemberCount}`,
        href: `./${item.groupId}.html`,
      })),
    }),
    "utf8",
  );

  const manifest: MetaWorldSiteManifest = {
    generatedAt,
    shellPath: "index.html",
    foxDirectoryPath: "foxes/index.html",
    groupDirectoryPath: "groups/index.html",
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
