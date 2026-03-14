/**
 * Client-side router script for the metaWorld web shell.
 * Generates a lightweight vanilla JS snippet that:
 * - Intercepts data-nav link clicks for pushState navigation
 * - Fetches JSON from /api/v1/* and re-renders the content area
 * - Auto-refreshes the feed every 30s when tab is visible
 * - Keeps the nav bar persistent across navigation
 */
export function buildMetaWorldRouterScript(): string {
  return `<script>
(function() {
  var content = document.getElementById("mw-content");
  var navLinks = document.querySelectorAll("[data-nav]");
  var refreshTimer = null;
  var currentPath = location.pathname;

  var routeToApi = {
    "/": "/api/v1/shell",
    "/feed": "/api/v1/feed",
    "/directory/foxes": "/api/v1/directory/foxes",
    "/directory/groups": "/api/v1/directory/groups",
    "/presence": "/api/v1/presence",
    "/notifications": "/api/v1/notifications"
  };

  function escapeHtml(s) {
    if (s == null) return "";
    return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
  }

  function renderCard(item) {
    var meta1 = item.occurredAt || item.lastSeenAt || item.createdAt || item.updatedAt || "";
    var meta2 = item.kind || item.status || item.effectiveStatus || "";
    var title = item.title || item.displayName || item.name || item.actorAddress || "";
    var summary = item.summary || item.previewText || item.ciphertext || "";
    return '<div class="mw-card"><div class="mw-meta"><span>' + escapeHtml(meta1) + '</span><span>' + escapeHtml(meta2) + '</span></div><h4>' + escapeHtml(title) + '</h4><p>' + escapeHtml(summary) + '</p></div>';
  }

  function renderListItem(label, value) {
    return '<li><span class="mw-li-label">' + escapeHtml(label) + '</span><span class="mw-li-value">' + escapeHtml(value) + '</span></li>';
  }

  function renderShell(data) {
    var h = '<h2 class="mw-title">' + escapeHtml(data.fox ? data.fox.displayName : "metaWorld") + '</h2>';
    h += '<div class="mw-metrics">';
    if (data.notifications) h += '<div class="mw-metric"><strong>' + (data.notifications.unreadCount || 0) + '</strong><span>Unread</span></div>';
    if (data.feed) h += '<div class="mw-metric"><strong>' + (data.feed.items ? data.feed.items.length : 0) + '</strong><span>Feed items</span></div>';
    if (data.presence) h += '<div class="mw-metric"><strong>' + (data.presence.activeCount || 0) + '</strong><span>Present</span></div>';
    if (data.fox) h += '<div class="mw-metric"><strong>' + (data.fox.stats ? data.fox.stats.activeGroupCount : 0) + '</strong><span>Groups</span></div>';
    h += '</div>';
    if (data.feed && data.feed.items && data.feed.items.length) {
      h += '<div class="mw-panel"><h3>World Feed</h3><div class="mw-grid">';
      data.feed.items.slice(0, 12).forEach(function(item) { h += renderCard(item); });
      h += '</div></div>';
    }
    if (data.notifications && data.notifications.items && data.notifications.items.length) {
      h += '<div class="mw-panel"><h3>Notifications</h3><div class="mw-grid">';
      data.notifications.items.slice(0, 8).forEach(function(item) { h += renderCard(item); });
      h += '</div></div>';
    }
    return h;
  }

  function renderFeed(data) {
    var h = '<h2 class="mw-title">World Feed</h2>';
    if (!data.items || !data.items.length) return h + '<p class="mw-empty">No feed items yet.</p>';
    h += '<div class="mw-grid">';
    data.items.forEach(function(item) { h += renderCard(item); });
    h += '</div>';
    return h;
  }

  function renderDirectory(data, kind) {
    var h = '<h2 class="mw-title">' + (kind === "foxes" ? "Fox Directory" : "Group Directory") + '</h2>';
    h += '<p style="margin-bottom:12px;"><a href="/directory/foxes" data-nav>Foxes</a> | <a href="/directory/groups" data-nav>Groups</a></p>';
    if (!data.items || !data.items.length) return h + '<p class="mw-empty">No entries yet.</p>';
    h += '<ul class="mw-list">';
    data.items.forEach(function(item) {
      var label = item.displayName || item.name || item.address || item.groupId;
      var val = item.presenceStatus || item.visibility || "";
      if (item.address) label = '<a href="/fox/' + encodeURIComponent(item.address) + '" data-nav>' + escapeHtml(label) + '</a>';
      if (item.groupId) label = '<a href="/group/' + encodeURIComponent(item.groupId) + '" data-nav>' + escapeHtml(label) + '</a>';
      h += '<li><span class="mw-li-label">' + label + '</span><span class="mw-li-value">' + escapeHtml(val) + '</span></li>';
    });
    h += '</ul>';
    return h;
  }

  function renderPresence(data) {
    var h = '<h2 class="mw-title">Presence</h2>';
    if (!data.items || !data.items.length) return h + '<p class="mw-empty">No live presence.</p>';
    h += '<ul class="mw-list">';
    data.items.forEach(function(item) {
      h += renderListItem(item.displayName || item.agentId || item.actorAddress, item.effectiveStatus + (item.groupName ? " / " + item.groupName : ""));
    });
    h += '</ul>';
    return h;
  }

  function renderNotifications(data) {
    var h = '<h2 class="mw-title">Notifications</h2>';
    if (data.unreadCount != null) h += '<p style="margin-bottom:12px;color:#8b949e;">' + data.unreadCount + ' unread</p>';
    if (!data.items || !data.items.length) return h + '<p class="mw-empty">Nothing needs attention.</p>';
    h += '<div class="mw-grid">';
    data.items.forEach(function(item) { h += renderCard(item); });
    h += '</div>';
    return h;
  }

  function renderJson(data, path) {
    if (path === "/") return renderShell(data);
    if (path === "/feed") return renderFeed(data);
    if (path.indexOf("/directory/foxes") === 0) return renderDirectory(data, "foxes");
    if (path.indexOf("/directory/groups") === 0) return renderDirectory(data, "groups");
    if (path === "/presence") return renderPresence(data);
    if (path === "/notifications") return renderNotifications(data);
    // Fallback: pretty-print JSON
    return '<h2 class="mw-title">' + escapeHtml(path) + '</h2><pre style="color:#8b949e;white-space:pre-wrap;word-break:break-all;">' + escapeHtml(JSON.stringify(data, null, 2)) + '</pre>';
  }

  function getApiPath(path) {
    if (routeToApi[path]) return routeToApi[path] + location.search;
    if (/^\\/fox\\/[^/]+\\/page$/.test(path)) return "/api/v1" + path.replace(/\\/page$/, "") + location.search;
    if (/^\\/fox\\/[^/]+$/.test(path)) return "/api/v1" + path + location.search;
    if (/^\\/group\\/[^/]+$/.test(path)) return "/api/v1" + path + location.search;
    if (/^\\/boards\\/[^/]+$/.test(path)) return "/api/v1" + path + location.search;
    return null;
  }

  function updateActiveNav(path) {
    navLinks.forEach(function(link) {
      var href = link.getAttribute("href");
      if (path === href || (href !== "/" && path.indexOf(href) === 0)) {
        link.classList.add("nav-active");
      } else {
        link.classList.remove("nav-active");
      }
    });
  }

  function navigate(path, pushState) {
    var apiPath = getApiPath(path);
    if (!apiPath) { location.href = path; return; }
    fetch(apiPath).then(function(r) { return r.json(); }).then(function(data) {
      content.innerHTML = renderJson(data, path);
      if (pushState) history.pushState(null, "", path);
      currentPath = path;
      updateActiveNav(path);
      bindContentLinks();
      resetAutoRefresh();
    }).catch(function(err) {
      content.innerHTML = '<p class="mw-empty">Error loading page: ' + escapeHtml(err.message) + '</p>';
    });
  }

  function bindContentLinks() {
    content.querySelectorAll("[data-nav]").forEach(function(link) {
      link.addEventListener("click", function(e) {
        e.preventDefault();
        navigate(link.getAttribute("href"), true);
      });
    });
  }

  function resetAutoRefresh() {
    if (refreshTimer) clearInterval(refreshTimer);
    if (currentPath === "/" || currentPath === "/feed") {
      refreshTimer = setInterval(function() {
        if (!document.hidden) navigate(currentPath, false);
      }, 30000);
    }
  }

  navLinks.forEach(function(link) {
    link.addEventListener("click", function(e) {
      e.preventDefault();
      navigate(link.getAttribute("href"), true);
    });
  });

  window.addEventListener("popstate", function() {
    navigate(location.pathname, false);
  });

  resetAutoRefresh();
})();
</script>`;
}
