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
  searchPath: string;
  contentIndexPath: string;
  routesPath: string;
  searchIndexPath: string;
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
        kind: "search_page";
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

export interface MetaWorldSiteSearchIndex {
  generatedAt: string;
  foxes: Array<{
    address: string;
    title: string;
    path: string;
    searchableText: string[];
    roles: string[];
    presenceStatus: string | null;
    activeGroupCount: number;
  }>;
  groups: Array<{
    groupId: string;
    title: string;
    path: string;
    searchableText: string[];
    visibility: "private" | "listed" | "public";
    joinMode: "invite_only" | "request_approval";
    activeMemberCount: number;
    tags: string[];
    roleNames: string[];
  }>;
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

function buildStaticSearchPage(params: {
  generatedAt: string;
  searchIndexPath: string;
  navLinks: Array<{ label: string; href: string }>;
}): string {
  const baseHtml = renderMetaWorldPageFrame({
    title: "Search · OpenFox metaWorld",
    eyebrow: "OpenFox Search",
    heading: "Search the Fox World",
    lede: "Filter exported Fox and Group pages locally from the generated site bundle.",
    generatedAt: params.generatedAt,
    metrics: [
      { label: "Scope", value: "Foxes + Groups" },
      { label: "Mode", value: "static" },
    ],
    navLinks: params.navLinks,
    sections: [
      `<section class="panel">
        <div class="section-head">
          <h3>Search Index</h3>
          <span>client-side</span>
        </div>
        <form id="mw-search-form" class="search-form">
          <input id="mw-search-input" name="q" type="search" placeholder="Search foxes, groups, tags, roles, capabilities..." />
          <button type="submit">Search</button>
        </form>
        <p id="mw-search-summary" class="empty">Loading search index...</p>
      </section>`,
      `<section class="grid">
        <section class="panel">
          <div class="section-head">
            <h3>Fox Results</h3>
            <span id="mw-search-fox-count">0</span>
          </div>
          <ul id="mw-search-fox-results" class="directory-list"><li class="empty">No results yet.</li></ul>
        </section>
        <section class="panel">
          <div class="section-head">
            <h3>Group Results</h3>
            <span id="mw-search-group-count">0</span>
          </div>
          <ul id="mw-search-group-results" class="directory-list"><li class="empty">No results yet.</li></ul>
        </section>
      </section>`,
    ],
  });

  const script = `<script>
(function() {
  var indexPath = ${JSON.stringify(params.searchIndexPath)};
  var form = document.getElementById("mw-search-form");
  var input = document.getElementById("mw-search-input");
  var summary = document.getElementById("mw-search-summary");
  var foxList = document.getElementById("mw-search-fox-results");
  var groupList = document.getElementById("mw-search-group-results");
  var foxCount = document.getElementById("mw-search-fox-count");
  var groupCount = document.getElementById("mw-search-group-count");
  var searchIndex = null;

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function tokenMatch(values, query) {
    if (!query) return true;
    var normalized = query.toLowerCase();
    for (var i = 0; i < values.length; i += 1) {
      var value = String(values[i] || "").toLowerCase();
      if (value.indexOf(normalized) >= 0) return true;
    }
    return false;
  }

  function renderFoxItem(item) {
    return '<li><strong><a href="../' + encodeURI(item.path) + '">' + escapeHtml(item.title) + '</a></strong><span>' +
      escapeHtml((item.presenceStatus || 'offline') + ' · groups=' + item.activeGroupCount) +
      '</span></li>';
  }

  function renderGroupItem(item) {
    return '<li><strong><a href="../' + encodeURI(item.path) + '">' + escapeHtml(item.title) + '</a></strong><span>' +
      escapeHtml(item.visibility + ' · members=' + item.activeMemberCount) +
      '</span></li>';
  }

  function applyQuery(rawQuery) {
    if (!searchIndex) return;
    var query = String(rawQuery || '').trim();
    var foxes = searchIndex.foxes.filter(function(item) {
      return tokenMatch(item.searchableText || [], query);
    });
    var groups = searchIndex.groups.filter(function(item) {
      return tokenMatch(item.searchableText || [], query);
    });

    foxCount.textContent = String(foxes.length);
    groupCount.textContent = String(groups.length);
    summary.textContent = query
      ? ('Query "' + query + '" matched ' + foxes.length + ' fox(es) and ' + groups.length + ' group(s).')
      : ('Loaded ' + foxes.length + ' fox(es) and ' + groups.length + ' group(s).');
    foxList.innerHTML = foxes.length ? foxes.map(renderFoxItem).join('') : '<li class="empty">No fox results.</li>';
    groupList.innerHTML = groups.length ? groups.map(renderGroupItem).join('') : '<li class="empty">No group results.</li>';

    var url = new URL(window.location.href);
    if (query) {
      url.searchParams.set('q', query);
    } else {
      url.searchParams.delete('q');
    }
    window.history.replaceState({}, '', url.toString());
  }

  fetch(indexPath)
    .then(function(response) { return response.json(); })
    .then(function(payload) {
      searchIndex = payload;
      var initialQuery = new URL(window.location.href).searchParams.get('q') || '';
      input.value = initialQuery;
      applyQuery(initialQuery);
    })
    .catch(function(error) {
      summary.textContent = 'Failed to load search index: ' + (error && error.message ? error.message : String(error));
    });

  form.addEventListener('submit', function(event) {
    event.preventDefault();
    applyQuery(input.value || '');
  });
})();
</script>`;

  return baseHtml.replace("</body>\n</html>", `${script}\n</body>\n</html>`);
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
  const searchDir = path.join(outputDir, "search");
  await fs.mkdir(foxDir, { recursive: true });
  await fs.mkdir(groupDir, { recursive: true });
  await fs.mkdir(searchDir, { recursive: true });

  await fs.writeFile(
    path.join(outputDir, "index.html"),
    buildMetaWorldShellHtml(shellSnapshot, {
      foxDirectoryHref: "./foxes/index.html",
      groupDirectoryHref: "./groups/index.html",
      searchHref: "./search/index.html",
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
        searchHref: "../search/index.html",
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
        searchHref: "../search/index.html",
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
        { label: "Search", href: "../search/index.html" },
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
        { label: "Search", href: "../search/index.html" },
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
      {
        kind: "search_page",
        path: "search/index.html",
        title: "Search",
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

  const searchIndex: MetaWorldSiteSearchIndex = {
    generatedAt,
    foxes: foxDirectory.items.map((item) => ({
      address: item.address,
      title: item.displayName,
      path: `foxes/${item.address}.html`,
      searchableText: [
        item.displayName,
        item.address,
        item.tnsName ?? "",
        item.agentId ?? "",
        ...item.roles,
        ...item.capabilityNames,
      ].filter((value) => value.trim().length > 0),
      roles: item.roles,
      presenceStatus: item.presenceStatus,
      activeGroupCount: item.activeGroupCount,
    })),
    groups: groupDirectory.items.map((item) => ({
      groupId: item.groupId,
      title: item.name,
      path: `groups/${item.groupId}.html`,
      searchableText: [
        item.name,
        item.description,
        item.groupId,
        item.visibility,
        item.joinMode,
        ...item.tags,
        ...Object.keys(item.roleSummary),
      ].filter((value) => value.trim().length > 0),
      visibility: item.visibility,
      joinMode: item.joinMode,
      activeMemberCount: item.activeMemberCount,
      tags: item.tags,
      roleNames: Object.keys(item.roleSummary),
    })),
  };
  await fs.writeFile(
    path.join(outputDir, "search-index.json"),
    `${JSON.stringify(searchIndex, null, 2)}\n`,
    "utf8",
  );

  await fs.writeFile(
    path.join(searchDir, "index.html"),
    buildStaticSearchPage({
      generatedAt,
      searchIndexPath: "../search-index.json",
      navLinks: [
        { label: "World Shell", href: "../index.html" },
        { label: "Fox Directory", href: "../foxes/index.html" },
        { label: "Group Directory", href: "../groups/index.html" },
        { label: "Search", href: "./index.html" },
      ],
    }),
    "utf8",
  );

  const manifest: MetaWorldSiteManifest = {
    generatedAt,
    shellPath: "index.html",
    foxDirectoryPath: "foxes/index.html",
    groupDirectoryPath: "groups/index.html",
    searchPath: "search/index.html",
    contentIndexPath: "content-index.json",
    routesPath: "routes.json",
    searchIndexPath: "search-index.json",
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
