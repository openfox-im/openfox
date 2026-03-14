export interface MetaWorldPageMetric {
  label: string;
  value: string | number;
}

export function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function renderMetaWorldPageFrame(params: {
  title: string;
  eyebrow: string;
  heading: string;
  lede: string;
  generatedAt?: string;
  metrics: MetaWorldPageMetric[];
  sections: string[];
}): string {
  const metrics = params.metrics
    .map(
      (metric) => `<div class="metric">
  <strong>${escapeHtml(metric.value)}</strong>
  <span>${escapeHtml(metric.label)}</span>
</div>`,
    )
    .join("");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(params.title)}</title>
  <style>
    :root {
      --bg: #f3ede2;
      --paper: #fff9f1;
      --ink: #1d241f;
      --muted: #5f695f;
      --line: #d9ccb5;
      --accent: #0e6b54;
      --accent-2: #c96d2d;
      --shadow: 0 16px 40px rgba(37, 31, 20, 0.08);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: "IBM Plex Sans", "Avenir Next", "Segoe UI", sans-serif;
      color: var(--ink);
      background:
        radial-gradient(circle at top left, rgba(201,109,45,0.14), transparent 28%),
        radial-gradient(circle at top right, rgba(14,107,84,0.16), transparent 30%),
        linear-gradient(180deg, #f8f3ea 0%, var(--bg) 100%);
    }
    .shell {
      max-width: 1220px;
      margin: 0 auto;
      padding: 32px 24px 72px;
    }
    .hero {
      display: grid;
      grid-template-columns: 1.45fr 1fr;
      gap: 20px;
      margin-bottom: 22px;
    }
    .panel {
      background: rgba(255, 249, 241, 0.92);
      border: 1px solid var(--line);
      border-radius: 24px;
      padding: 20px;
      box-shadow: var(--shadow);
      backdrop-filter: blur(8px);
    }
    .hero-card {
      min-height: 240px;
      background:
        linear-gradient(140deg, rgba(14,107,84,0.08), transparent 45%),
        linear-gradient(320deg, rgba(201,109,45,0.10), transparent 50%),
        var(--paper);
    }
    .eyebrow {
      font-size: 12px;
      letter-spacing: 0.18em;
      text-transform: uppercase;
      color: var(--muted);
      margin-bottom: 10px;
    }
    h1, h2, h3, h4 { margin: 0; font-family: "IBM Plex Serif", Georgia, serif; }
    h1 { font-size: 42px; line-height: 1.02; margin-bottom: 12px; }
    h2 { font-size: 24px; }
    h3 { font-size: 20px; }
    h4 { font-size: 16px; margin-bottom: 8px; }
    .lede {
      color: var(--muted);
      line-height: 1.5;
      margin: 12px 0 18px;
    }
    .metric-band {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 12px;
    }
    .metric {
      padding: 12px 14px;
      background: rgba(255,255,255,0.66);
      border: 1px solid rgba(29,36,31,0.08);
      border-radius: 16px;
    }
    .metric strong {
      display: block;
      font-size: 22px;
      margin-bottom: 4px;
    }
    .section-head, .meta-row, .stats-row {
      display: flex;
      justify-content: space-between;
      gap: 10px;
      align-items: baseline;
    }
    .meta-row, .stats-row, .muted {
      font-size: 13px;
      color: var(--muted);
    }
    .grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 20px;
      margin-bottom: 20px;
    }
    .stack {
      display: grid;
      gap: 20px;
    }
    .list-grid {
      display: grid;
      gap: 12px;
      margin-top: 14px;
    }
    .list-card {
      padding: 14px 15px;
      border-radius: 16px;
      background: rgba(255,255,255,0.64);
      border: 1px solid rgba(29,36,31,0.08);
    }
    .list-card p {
      margin: 0;
      color: var(--muted);
      line-height: 1.45;
    }
    .directory-list, .compact-list, .tag-list {
      list-style: none;
      margin: 14px 0 0;
      padding: 0;
      display: grid;
      gap: 10px;
    }
    .directory-list li, .compact-list li {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      padding: 12px 14px;
      border-radius: 14px;
      background: rgba(255,255,255,0.62);
      border: 1px solid rgba(29,36,31,0.08);
    }
    .tag-list {
      grid-template-columns: repeat(auto-fill, minmax(120px, max-content));
    }
    .tag-list li {
      padding: 8px 12px;
      border-radius: 999px;
      background: rgba(14,107,84,0.10);
      border: 1px solid rgba(14,107,84,0.18);
      color: var(--accent);
      font-size: 13px;
    }
    .accent { color: var(--accent); }
    .accent-2 { color: var(--accent-2); }
    .empty { color: var(--muted); margin: 10px 0 0; }
    @media (max-width: 980px) {
      .hero, .grid { grid-template-columns: 1fr; }
      h1 { font-size: 34px; }
      .metric-band { grid-template-columns: 1fr 1fr; }
    }
  </style>
</head>
<body>
  <div class="shell">
    <section class="hero">
      <article class="panel hero-card">
        <div class="eyebrow">${escapeHtml(params.eyebrow)}</div>
        <h1>${escapeHtml(params.heading)}</h1>
        <p class="lede">${escapeHtml(params.lede)}</p>
        <div class="metric-band">${metrics}</div>
      </article>
      <article class="panel">
        <div class="section-head">
          <h3>Snapshot</h3>
          <span>${escapeHtml(params.generatedAt || new Date().toISOString())}</span>
        </div>
        <p class="lede">Static metaWorld page export for local-first browsing, routing, and publishable artifacts.</p>
      </article>
    </section>
    ${params.sections.join("\n")}
  </div>
</body>
</html>`;
}
