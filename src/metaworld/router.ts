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
    "/personalized-feed": "/api/v1/personalized-feed",
    "/search": "/api/v1/search",
    "/publication": "/api/v1/publication",
    "/following": "/api/v1/following",
    "/followers": "/api/v1/followers",
    "/recommended/foxes": "/api/v1/recommended/foxes",
    "/recommended/groups": "/api/v1/recommended/groups",
    "/subscriptions": "/api/v1/subscriptions",
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

  function renderSearch(data) {
    var h = '<h2 class="mw-title">Search</h2>';
    h += '<p style="color:#8b949e;margin-bottom:12px;">' + escapeHtml(data.summary || "") + '</p>';
    if (!data.results || !data.results.length) return h + '<p class="mw-empty">No results.</p>';
    h += '<div class="mw-grid">';
    data.results.forEach(function(item) {
      h += '<div class="mw-card"><div class="mw-meta"><span>' + escapeHtml(item.kind) + '</span><span>score ' + escapeHtml(item.relevanceScore) + '</span></div><h4>' + escapeHtml(item.title) + '</h4><p>' + escapeHtml(item.summary) + '</p></div>';
    });
    h += '</div>';
    return h;
  }

  function renderRecommended(data, label) {
    var h = '<h2 class="mw-title">' + escapeHtml(label) + '</h2>';
    h += '<p style="margin-bottom:12px;"><a href="/recommended/foxes" data-nav>Foxes</a> | <a href="/recommended/groups" data-nav>Groups</a></p>';
    h += '<p style="color:#8b949e;margin-bottom:12px;">' + escapeHtml(data.summary || "") + '</p>';
    if (!data.items || !data.items.length) return h + '<p class="mw-empty">No recommendations yet.</p>';
    h += '<div class="mw-grid">';
    data.items.forEach(function(item) {
      var title = item.displayName || item.name || item.address || item.groupId || "";
      var score = item.score != null ? String(item.score) : "";
      var summary = item.reason || item.description || "";
      h += '<div class="mw-card"><div class="mw-meta"><span>recommended</span><span>' + escapeHtml(score) + '</span></div><h4>' + escapeHtml(title) + '</h4><p>' + escapeHtml(summary) + '</p></div>';
    });
    h += '</div>';
    return h;
  }

  function renderPublication(data) {
    var h = '<h2 class="mw-title">Publication & Federation</h2>';
    h += '<p style="color:#8b949e;margin-bottom:12px;">' + escapeHtml(data.summary || "") + '</p>';
    h += '<div class="mw-metrics">';
    h += '<div class="mw-metric"><strong>' + escapeHtml(data.counts && data.counts.publishedFoxCount || 0) + '</strong><span>Published Foxes</span></div>';
    h += '<div class="mw-metric"><strong>' + escapeHtml(data.counts && data.counts.publishedGroupCount || 0) + '</strong><span>Published Groups</span></div>';
    h += '<div class="mw-metric"><strong>' + escapeHtml(data.counts && data.counts.sitePublicationCount || 0) + '</strong><span>Site Bundles</span></div>';
    h += '<div class="mw-metric"><strong>' + escapeHtml(data.counts && data.counts.federationPeerCount || 0) + '</strong><span>Federation Peers</span></div>';
    h += '</div>';
    h += '<div class="mw-grid">';
    h += '<div class="mw-panel"><h3>Published Fox Profiles</h3>';
    if (data.publishedFoxProfiles && data.publishedFoxProfiles.length) {
      h += '<ul class="mw-list">';
      data.publishedFoxProfiles.slice(0, 12).forEach(function(item) {
        h += renderListItem(item.displayName || item.address, item.publishedCid || "");
      });
      h += '</ul>';
    } else {
      h += '<p class="mw-empty">No published Fox profiles.</p>';
    }
    h += '</div>';
    h += '<div class="mw-panel"><h3>Published Group Profiles</h3>';
    if (data.publishedGroupProfiles && data.publishedGroupProfiles.length) {
      h += '<ul class="mw-list">';
      data.publishedGroupProfiles.slice(0, 12).forEach(function(item) {
        h += renderListItem(item.name || item.groupId, item.publishedCid || "");
      });
      h += '</ul>';
    } else {
      h += '<p class="mw-empty">No published Group profiles.</p>';
    }
    h += '</div>';
    h += '</div>';
    h += '<div class="mw-grid">';
    h += '<div class="mw-panel"><h3>Hosted Site Bundles</h3>';
    if (data.sitePublications && data.sitePublications.length) {
      h += '<ul class="mw-list">';
      data.sitePublications.slice(0, 12).forEach(function(item) {
        h += renderListItem(item.label || item.publicationId, (item.baseUrl || item.outputDir || "") + ' · foxes=' + String(item.foxPageCount || 0));
      });
      h += '</ul>';
    } else {
      h += '<p class="mw-empty">No hosted site bundles yet.</p>';
    }
    h += '</div>';
    h += '<div class="mw-panel"><h3>Federation Peers</h3>';
    if (data.federationPeers && data.federationPeers.length) {
      h += '<ul class="mw-list">';
      data.federationPeers.slice(0, 12).forEach(function(item) {
        h += renderListItem(item.label || item.peerId, item.manifestUrl || item.baseUrl || "");
      });
      h += '</ul>';
    } else {
      h += '<p class="mw-empty">No federation peers yet.</p>';
    }
    h += '</div>';
    h += '</div>';
    return h;
  }

  function renderSubscriptions(data) {
    var h = '<h2 class="mw-title">Subscriptions</h2>';
    h += '<p style="margin-bottom:12px;"><a href="/following" data-nav>Following</a> | <a href="/followers" data-nav>Followers</a> | <a href="/subscriptions" data-nav>Subscriptions</a></p>';
    if (!data.subscriptions || !data.subscriptions.length) return h + '<p class="mw-empty">No subscriptions configured.</p>';
    h += '<ul class="mw-list">';
    data.subscriptions.forEach(function(item) {
      h += renderListItem(item.feedKind + ':' + item.targetId, item.notifyOn.join(', '));
    });
    h += '</ul>';
    return h;
  }

  function renderFollowing(data) {
    var h = '<h2 class="mw-title">Following</h2>';
    h += '<p style="margin-bottom:12px;"><a href="/following" data-nav>Following</a> | <a href="/followers" data-nav>Followers</a> | <a href="/subscriptions" data-nav>Subscriptions</a></p>';
    if (data.counts) {
      h += '<div class="mw-metrics">';
      h += '<div class="mw-metric"><strong>' + (data.counts.followingFoxes || 0) + '</strong><span>Foxes</span></div>';
      h += '<div class="mw-metric"><strong>' + (data.counts.followingGroups || 0) + '</strong><span>Groups</span></div>';
      h += '<div class="mw-metric"><strong>' + (data.counts.followers || 0) + '</strong><span>Followers</span></div>';
      h += '</div>';
    }
    h += '<div class="mw-grid">';
    h += '<div class="mw-panel"><h3>Followed Foxes</h3>';
    if (data.followedFoxes && data.followedFoxes.length) {
      h += '<ul class="mw-list">';
      data.followedFoxes.forEach(function(item) {
        var label = '<a href="/fox/' + encodeURIComponent(item.targetAddress) + '" data-nav>' + escapeHtml(item.displayName || item.targetAddress) + '</a>';
        h += '<li><span class="mw-li-label">' + label + '</span><span class="mw-li-value">' + escapeHtml((item.followerCount || 0) + ' follower(s)') + '</span></li>';
      });
      h += '</ul>';
    } else {
      h += '<p class="mw-empty">No followed foxes.</p>';
    }
    h += '</div>';
    h += '<div class="mw-panel"><h3>Followed Groups</h3>';
    if (data.followedGroups && data.followedGroups.length) {
      h += '<ul class="mw-list">';
      data.followedGroups.forEach(function(item) {
        var label = '<a href="/group/' + encodeURIComponent(item.groupId) + '" data-nav>' + escapeHtml(item.name || item.groupId) + '</a>';
        h += '<li><span class="mw-li-label">' + label + '</span><span class="mw-li-value">' + escapeHtml((item.followerCount || 0) + ' follower(s)') + '</span></li>';
      });
      h += '</ul>';
    } else {
      h += '<p class="mw-empty">No followed groups.</p>';
    }
    h += '</div>';
    h += '</div>';
    return h;
  }

  function renderFollowers(data) {
    var h = '<h2 class="mw-title">Followers</h2>';
    h += '<p style="margin-bottom:12px;"><a href="/following" data-nav>Following</a> | <a href="/followers" data-nav>Followers</a> | <a href="/subscriptions" data-nav>Subscriptions</a></p>';
    h += '<div class="mw-grid">';
    h += '<div class="mw-panel"><h3>Fox Followers</h3>';
    if (data.foxFollowers && data.foxFollowers.length) {
      h += '<ul class="mw-list">';
      data.foxFollowers.forEach(function(item) {
        var label = '<a href="/fox/' + encodeURIComponent(item.followerAddress) + '" data-nav>' + escapeHtml(item.displayName || item.followerAddress) + '</a>';
        h += '<li><span class="mw-li-label">' + label + '</span><span class="mw-li-value">' + escapeHtml(item.createdAt || '') + '</span></li>';
      });
      h += '</ul>';
    } else {
      h += '<p class="mw-empty">No fox followers yet.</p>';
    }
    h += '</div>';
    h += '<div class="mw-panel"><h3>Group Followers</h3>';
    if (data.groupFollowers && data.groupFollowers.length) {
      data.groupFollowers.forEach(function(group) {
        h += '<h4 style="margin:8px 0 6px 0;"><a href="/group/' + encodeURIComponent(group.groupId) + '" data-nav>' + escapeHtml(group.name || group.groupId) + '</a></h4>';
        if (group.followers && group.followers.length) {
          h += '<ul class="mw-list">';
          group.followers.forEach(function(item) {
            var label = '<a href="/fox/' + encodeURIComponent(item.followerAddress) + '" data-nav>' + escapeHtml(item.displayName || item.followerAddress) + '</a>';
            h += '<li><span class="mw-li-label">' + label + '</span><span class="mw-li-value">' + escapeHtml(item.createdAt || '') + '</span></li>';
          });
          h += '</ul>';
        } else {
          h += '<p class="mw-empty">No followers for this group.</p>';
        }
      });
    } else {
      h += '<p class="mw-empty">No group followers yet.</p>';
    }
    h += '</div>';
    h += '</div>';
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
    if (path === "/personalized-feed") return renderFeed(data);
    if (path.indexOf("/search") === 0) return renderSearch(data);
    if (path === "/publication") return renderPublication(data);
    if (path === "/following") return renderFollowing(data);
    if (path === "/followers") return renderFollowers(data);
    if (path === "/recommended/foxes") return renderRecommended(data, "Recommended Foxes");
    if (path === "/recommended/groups") return renderRecommended(data, "Recommended Groups");
    if (path === "/subscriptions") return renderSubscriptions(data);
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
    var navAlias = {
      "/directory/groups": "/directory/foxes",
      "/recommended/groups": "/recommended/foxes",
      "/followers": "/following",
      "/subscriptions": "/following"
    };
    var effectivePath = navAlias[path] || path;
    navLinks.forEach(function(link) {
      var href = link.getAttribute("href");
      if (effectivePath === href || (href !== "/" && effectivePath.indexOf(href) === 0)) {
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

  window.__refreshContent = function() {
    if (!document.hidden) navigate(currentPath, false);
  };

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

  // Use SSE for real-time push when available, fall back to polling
  if (typeof EventSource !== "undefined") {
    var evtSource = new EventSource("/api/v1/events/stream?kinds=feed.item,notification.new,presence.update,proposal.update,intent.update,treasury.update");

    evtSource.addEventListener("feed.item", function() {
      if (currentPath === "/" || currentPath === "/feed") {
        window.__refreshContent && window.__refreshContent();
      }
    });

    evtSource.addEventListener("notification.new", function() {
      window.__refreshContent && window.__refreshContent();
    });

    ["proposal.update", "intent.update", "treasury.update", "presence.update"].forEach(function(kind) {
      evtSource.addEventListener(kind, function() {
        window.__refreshContent && window.__refreshContent();
      });
    });

    evtSource.onerror = function() {
      // On error, close SSE and fall back to polling
      evtSource.close();
      resetAutoRefresh();
    };
  } else {
    resetAutoRefresh();
  }
})();
</script>`;
}
