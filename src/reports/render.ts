import type {
  OwnerFinanceAttributionEntry,
  OwnerFinanceSnapshotData,
  OwnerGeneratedNarrative,
  OwnerReportData,
  OwnerReportRecord,
} from "../types.js";

const WEI_PER_TOS = 10n ** 18n;

export interface OwnerRenderedSection {
  title: string;
  lines: string[];
}

export interface OwnerRenderedReport {
  reportId: string;
  periodKind: OwnerReportData["periodKind"];
  generatedAt: string;
  summary: string;
  financeSummary: {
    revenue: string;
    cost: string;
    net: string;
    pending: string;
    operatingCost: string;
    eventCounts: string;
  };
  sections: OwnerRenderedSection[];
}

function toBigInt(value: string | bigint | null | undefined): bigint {
  if (typeof value === "bigint") return value;
  if (!value) return 0n;
  return BigInt(value);
}

function formatTOS(value: bigint): string {
  const sign = value < 0n ? "-" : "";
  const abs = value < 0n ? -value : value;
  const whole = abs / WEI_PER_TOS;
  const fraction = abs % WEI_PER_TOS;
  if (fraction === 0n) return `${sign}${whole.toString()} TOS`;
  const decimals = fraction.toString().padStart(18, "0").replace(/0+$/, "");
  return `${sign}${whole.toString()}.${decimals.slice(0, 6)} TOS`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function formatAttributionEntry(entry: OwnerFinanceAttributionEntry): string {
  if (entry.amountWei !== "0") {
    return `${entry.title}: ${formatTOS(toBigInt(entry.amountWei))}`;
  }
  return `${entry.title}: ${formatCents(entry.amountCents ?? 0)}`;
}

function buildNarrativeSections(narrative: OwnerGeneratedNarrative | null): OwnerRenderedSection[] {
  if (!narrative) return [];
  const sections: OwnerRenderedSection[] = [];
  if (narrative.overview) {
    sections.push({ title: "Overview", lines: [narrative.overview] });
  }
  if (narrative.gains) {
    sections.push({ title: "Gains", lines: [narrative.gains] });
  }
  if (narrative.losses) {
    sections.push({ title: "Losses", lines: [narrative.losses] });
  }
  if (narrative.opportunityDigest) {
    sections.push({
      title: "Opportunity Digest",
      lines: [narrative.opportunityDigest],
    });
  }
  if (narrative.anomalies) {
    sections.push({ title: "Anomalies", lines: [narrative.anomalies] });
  }
  if (narrative.recommendations.length) {
    sections.push({
      title: "Recommendations",
      lines: narrative.recommendations.map((item) => `- ${item}`),
    });
  }
  return sections;
}

function buildFinanceSections(finance: OwnerFinanceSnapshotData): OwnerRenderedSection[] {
  const opportunities = finance.topGains.length
    ? finance.topGains.map(formatAttributionEntry)
    : ["(none)"];
  const losses = finance.topLosses.length
    ? finance.topLosses.map(formatAttributionEntry)
    : ["(none)"];
  const anomalies = finance.anomalies.length ? finance.anomalies : ["(none)"];
  return [
    {
      title: "Top Gains",
      lines: opportunities,
    },
    {
      title: "Top Losses",
      lines: losses,
    },
    {
      title: "Anomalies",
      lines: anomalies,
    },
  ];
}

function buildEvidenceOracleSections(
  input: OwnerReportData["input"],
): OwnerRenderedSection[] {
  if (!input.evidenceOracle) return [];
  const evidence = input.evidenceOracle.evidence;
  const oracle = input.evidenceOracle.oracle;
  return [
    {
      title: "Evidence Workflows",
      lines: [
        `Runs: ${evidence.totalRuns}`,
        `Completed: ${evidence.completedRuns}`,
        `Failed: ${evidence.failedRuns}`,
        `Valid sources: ${evidence.validSources}/${evidence.attemptedSources}`,
        `Aggregates published: ${evidence.aggregatePublished}`,
        `Estimated cost: ${formatTOS(toBigInt(evidence.estimatedCostWei))}`,
        evidence.summary,
      ],
    },
    {
      title: "Oracle Results",
      lines: [
        `Results: ${oracle.totalResults}`,
        `Settled: ${oracle.settledResults}`,
        `Market bound: ${oracle.marketBoundResults}`,
        `Average confidence: ${oracle.averageConfidence.toFixed(4)}`,
        `Estimated cost: ${formatTOS(toBigInt(oracle.estimatedCostWei))}`,
        `Kinds: ${
          Object.keys(oracle.queryKinds).length === 0
            ? "(none)"
            : Object.entries(oracle.queryKinds)
                .map(([kind, count]) => `${kind}=${count}`)
                .join(", ")
        }`,
        oracle.summary,
      ],
    },
  ];
}

export function buildOwnerRenderedReport(record: OwnerReportRecord): OwnerRenderedReport {
  const finance = record.payload.input.finance;
  const narrativeSections = buildNarrativeSections(record.payload.narrative);
  const financeSections = buildFinanceSections(finance);
  return {
    reportId: record.reportId,
    periodKind: record.periodKind,
    generatedAt: record.payload.generatedAt,
    summary: finance.summary,
    financeSummary: {
      revenue: formatTOS(toBigInt(finance.realizedRevenueWei)),
      cost: formatTOS(toBigInt(finance.realizedCostWei)),
      net: formatTOS(toBigInt(finance.realizedNetWei)),
      pending: formatTOS(toBigInt(finance.pendingNetWei)),
      operatingCost: formatCents(finance.operatingCostCents),
      eventCounts: `revenue=${finance.revenueEvents}, cost=${finance.costEvents}`,
    },
    sections: [...narrativeSections, ...buildEvidenceOracleSections(record.payload.input), ...financeSections],
  };
}

export function renderOwnerReportText(record: OwnerReportRecord): string {
  const rendered = buildOwnerRenderedReport(record);
  const lines = [
    "=== OPENFOX OWNER REPORT ===",
    `Report:    ${rendered.reportId}`,
    `Period:    ${rendered.periodKind}`,
    `Generated: ${rendered.generatedAt}`,
    `Revenue:   ${rendered.financeSummary.revenue}`,
    `Cost:      ${rendered.financeSummary.cost}`,
    `Net:       ${rendered.financeSummary.net}`,
    `Pending:   ${rendered.financeSummary.pending}`,
    `Ops cost:  ${rendered.financeSummary.operatingCost}`,
    `Events:    ${rendered.financeSummary.eventCounts}`,
    "",
    `Summary: ${rendered.summary}`,
    "",
  ];
  for (const section of rendered.sections) {
    lines.push(`${section.title}:`);
    for (const line of section.lines) {
      lines.push(`  ${line}`);
    }
    lines.push("");
  }
  lines.push("============================");
  return lines.join("\n");
}

export function renderOwnerReportHtml(record: OwnerReportRecord): string {
  const rendered = buildOwnerRenderedReport(record);
  const finance = record.payload.input.finance;
  const opportunityLines = record.payload.input.opportunities.slice(0, 10).map((item) => {
    const title =
      typeof item.title === "string" && item.title.trim()
        ? item.title.trim()
        : "Opportunity";
    const score =
      typeof item.strategyScore === "number"
        ? ` score=${item.strategyScore}`
        : "";
    const trust =
      typeof item.trustTier === "string" && item.trustTier
        ? ` trust=${item.trustTier}`
        : "";
    return `${title}${score}${trust}`;
  });
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>OpenFox Owner Report</title>
    <style>
      body {
        font-family: ui-sans-serif, system-ui, sans-serif;
        margin: 0;
        padding: 0;
        background: #f5f2e8;
        color: #1c1a17;
      }
      main {
        max-width: 760px;
        margin: 0 auto;
        padding: 24px 16px 40px;
      }
      h1, h2 {
        margin: 0 0 12px;
      }
      .meta, .summary, .card, .section {
        background: #fffdf7;
        border: 1px solid #d7cfba;
        border-radius: 14px;
        padding: 16px;
        margin-bottom: 16px;
        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
      }
      .grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
        gap: 12px;
      }
      .metric-label {
        font-size: 0.78rem;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        color: #756c5d;
      }
      .metric-value {
        margin-top: 4px;
        font-size: 1.1rem;
        font-weight: 600;
      }
      ul {
        margin: 8px 0 0;
        padding-left: 18px;
      }
      li + li {
        margin-top: 6px;
      }
      .footer {
        color: #756c5d;
        font-size: 0.9rem;
        margin-top: 20px;
      }
    </style>
  </head>
  <body>
    <main>
      <h1>OpenFox Owner Report</h1>
      <div class="meta">
        <div><strong>Period:</strong> ${escapeHtml(rendered.periodKind)}</div>
        <div><strong>Generated:</strong> ${escapeHtml(rendered.generatedAt)}</div>
        <div><strong>Range:</strong> ${escapeHtml(finance.periodStart)} -> ${escapeHtml(finance.periodEnd)}</div>
      </div>
      <div class="summary">
        <strong>Summary</strong>
        <p>${escapeHtml(rendered.summary)}</p>
      </div>
      ${
        record.payload.input.evidenceOracle
          ? `<div class="card">
        <h2>Evidence and Oracle</h2>
        <div><strong>Evidence:</strong> ${escapeHtml(record.payload.input.evidenceOracle.evidence.summary)}</div>
        <div><strong>Oracle:</strong> ${escapeHtml(record.payload.input.evidenceOracle.oracle.summary)}</div>
      </div>`
          : ""
      }
      <div class="card grid">
        <div><div class="metric-label">Revenue</div><div class="metric-value">${escapeHtml(rendered.financeSummary.revenue)}</div></div>
        <div><div class="metric-label">Cost</div><div class="metric-value">${escapeHtml(rendered.financeSummary.cost)}</div></div>
        <div><div class="metric-label">Net</div><div class="metric-value">${escapeHtml(rendered.financeSummary.net)}</div></div>
        <div><div class="metric-label">Pending</div><div class="metric-value">${escapeHtml(rendered.financeSummary.pending)}</div></div>
        <div><div class="metric-label">Operating Cost</div><div class="metric-value">${escapeHtml(rendered.financeSummary.operatingCost)}</div></div>
        <div><div class="metric-label">Events</div><div class="metric-value">${escapeHtml(rendered.financeSummary.eventCounts)}</div></div>
      </div>
      ${rendered.sections
        .map(
          (section) => `<section class="section">
        <h2>${escapeHtml(section.title)}</h2>
        <ul>${section.lines.map((line) => `<li>${escapeHtml(line)}</li>`).join("")}</ul>
      </section>`,
        )
        .join("\n")}
      <section class="section">
        <h2>Opportunity Inputs</h2>
        <ul>${
          opportunityLines.length
            ? opportunityLines.map((line) => `<li>${escapeHtml(line)}</li>`).join("")
            : "<li>(none)</li>"
        }</ul>
      </section>
      <div class="footer">Report ID: ${escapeHtml(rendered.reportId)}</div>
    </main>
  </body>
</html>`;
}
