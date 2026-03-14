import { escapeHtml } from "./render.js";

export interface MetaWorldLayoutOptions {
  title: string;
  nav?: string;
  content: string;
  scripts?: string;
  activeRoute?: string;
}

const NAV_LINKS = [
  { label: "Home", href: "/" },
  { label: "Feed", href: "/feed" },
  { label: "For You", href: "/personalized-feed" },
  { label: "Search", href: "/search" },
  { label: "Directory", href: "/directory/foxes" },
  { label: "Recommended", href: "/recommended/foxes" },
  { label: "Boards", href: "/boards/work" },
  { label: "Presence", href: "/presence" },
  { label: "Notifications", href: "/notifications" },
] as const;

export function buildMetaWorldLayout(options: MetaWorldLayoutOptions): string {
  const navItems = NAV_LINKS.map((link) => {
    const active = options.activeRoute === link.href ? ' class="nav-active"' : "";
    return `<a href="${escapeHtml(link.href)}" data-nav${active}>${escapeHtml(link.label)}</a>`;
  }).join("");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(options.title)}</title>
  <style>
    :root {
      --bg: #0d1117;
      --surface: #161b22;
      --surface-2: #1c2129;
      --border: #30363d;
      --text: #c9d1d9;
      --text-muted: #8b949e;
      --accent: #3fb950;
      --accent-dim: rgba(63,185,80,0.15);
      --accent-2: #f0883e;
      --link: #58a6ff;
      --shadow: 0 8px 24px rgba(0,0,0,0.4);
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
      color: var(--text);
      background: var(--bg);
      line-height: 1.5;
    }
    a { color: var(--link); text-decoration: none; }
    a:hover { text-decoration: underline; }
    .mw-nav {
      position: sticky;
      top: 0;
      z-index: 100;
      display: flex;
      gap: 2px;
      padding: 8px 16px;
      background: var(--surface);
      border-bottom: 1px solid var(--border);
      overflow-x: auto;
    }
    .mw-nav a {
      color: var(--text-muted);
      padding: 8px 14px;
      border-radius: 6px;
      font-size: 14px;
      font-weight: 500;
      white-space: nowrap;
      transition: background 0.15s, color 0.15s;
    }
    .mw-nav a:hover { background: var(--surface-2); color: var(--text); text-decoration: none; }
    .mw-nav a.nav-active { color: var(--accent); background: var(--accent-dim); }
    .mw-main {
      max-width: 1200px;
      margin: 0 auto;
      padding: 24px 20px 64px;
    }
    #mw-content { min-height: 60vh; }
    .mw-title {
      font-size: 28px;
      font-weight: 600;
      margin-bottom: 20px;
      color: var(--text);
    }
    .mw-panel {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 20px;
      margin-bottom: 16px;
      box-shadow: var(--shadow);
    }
    .mw-panel h3 {
      font-size: 16px;
      font-weight: 600;
      margin-bottom: 12px;
      color: var(--text);
    }
    .mw-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
      gap: 16px;
      margin-bottom: 16px;
    }
    .mw-card {
      background: var(--surface-2);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 14px;
    }
    .mw-card h4 {
      font-size: 14px;
      font-weight: 600;
      margin-bottom: 6px;
    }
    .mw-card p {
      font-size: 13px;
      color: var(--text-muted);
      margin: 0;
      line-height: 1.4;
    }
    .mw-meta {
      display: flex;
      justify-content: space-between;
      font-size: 12px;
      color: var(--text-muted);
      margin-bottom: 6px;
    }
    .mw-list {
      list-style: none;
    }
    .mw-list li {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      padding: 10px 12px;
      border-bottom: 1px solid var(--border);
      font-size: 14px;
    }
    .mw-list li:last-child { border-bottom: none; }
    .mw-list .mw-li-label { font-weight: 500; }
    .mw-list .mw-li-value { color: var(--text-muted); text-align: right; }
    .mw-metrics {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
      gap: 12px;
      margin-bottom: 20px;
    }
    .mw-metric {
      background: var(--surface-2);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 14px;
      text-align: center;
    }
    .mw-metric strong {
      display: block;
      font-size: 24px;
      color: var(--accent);
      margin-bottom: 4px;
    }
    .mw-metric span {
      font-size: 12px;
      color: var(--text-muted);
    }
    .mw-empty {
      color: var(--text-muted);
      font-size: 14px;
      padding: 16px 0;
    }
    .mw-badge {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 12px;
      font-size: 12px;
      font-weight: 500;
      background: var(--accent-dim);
      color: var(--accent);
    }
    .mw-badge-warn {
      background: rgba(240,136,62,0.15);
      color: var(--accent-2);
    }
    @media (max-width: 640px) {
      .mw-grid { grid-template-columns: 1fr; }
      .mw-metrics { grid-template-columns: 1fr 1fr; }
      .mw-main { padding: 16px 12px 48px; }
      .mw-title { font-size: 22px; }
    }
  </style>
</head>
<body>
  <nav class="mw-nav">${navItems}</nav>
  <div class="mw-main">
    <div id="mw-content">
${options.content}
    </div>
  </div>
${options.scripts || ""}
</body>
</html>`;
}
