/**
 * Intent Pipeline CLI Commands
 *
 * GTOS 2046: Exposes the intent execution pipeline to the CLI.
 *
 * Usage:
 *   openfox intent transfer <to> <value> [--terminal <class>] [--trust <tier>] [--sponsor <addr>] [--contract-metadata <path>]
 *   openfox intent status <intentId>
 *   openfox intent list [--status <status>] [--limit <n>]
 *   openfox intent explain <intentId>
 *   openfox intent replay <intentId>
 *   openfox intent quotes <action> <value>
 */

import { loadConfig, resolvePath } from "../config.js";
import { createDatabase } from "../state/database.js";
import { createLogger } from "../observability/logger.js";
import { createPipeline, createAuditJournal } from "../pipeline/factory.js";
import { buildIntentQuotePreview, formatIntentQuotePreview } from "../routing/index.js";
import { explainIntent } from "../intent/explain.js";
import { loadContractMetadataFile } from "../intent/metadata-loader.js";
import { formatAuditDetails } from "../audit/render.js";
import type { TerminalClass, TrustTier, IntentStatus } from "../intent/types.js";

const logger = createLogger("intent");

export async function handleIntentCommand(args: string[]): Promise<void> {
  const subcommand = args[0];

  if (!subcommand || subcommand === "--help" || subcommand === "-h" || subcommand === "help") {
    printUsage();
    return;
  }

  switch (subcommand) {
    case "transfer":
      return handleTransfer(args.slice(1));
    case "status":
      return handleStatus(args.slice(1));
    case "list":
      return handleList(args.slice(1));
    case "explain":
      return handleExplain(args.slice(1));
    case "replay":
      return handleReplay(args.slice(1));
    case "quotes":
      return handleQuotes(args.slice(1));
    default:
      logger.error(`Unknown intent subcommand: ${subcommand}`);
      printUsage();
  }
}

// ── transfer ────────────────────────────────────────────────────

async function handleTransfer(args: string[]): Promise<void> {
  if (args.length < 2) {
    logger.error("Usage: openfox intent transfer <to> <value> [--terminal <class>] [--trust <tier>] [--sponsor <addr>] [--contract-metadata <path>]");
    return;
  }

  const to = args[0]!;
  const value = args[1]!;
  const terminalClass = parseFlag(args, "--terminal", "app") as TerminalClass;
  const trustTier = parseInt(parseFlag(args, "--trust", "2"), 10) as TrustTier;
  const sponsor = parseFlag(args, "--sponsor", "");
  const contractMetadataPath = parseFlag(args, "--contract-metadata", "");

  const config = requireConfig();
  if (!config) return;
  const db = createDatabase(resolvePath(config.dbPath));

  try {
    const contractMetadata = contractMetadataPath
      ? loadContractMetadataFile(resolvePath(contractMetadataPath))
      : undefined;

    const pipeline = createPipeline(config, db, {
      autoApprove: true,
      auditEnabled: true,
      sponsorPolicy: sponsor
        ? {
            preferredSponsors: [sponsor],
            strategy: "preferred_first",
          }
        : undefined,
    });

    logger.info(`Executing transfer: ${value} wei to ${to} via ${terminalClass} (trust tier ${trustTier})`);
    if (sponsor) {
      logger.info(`Preferred sponsor: ${sponsor}`);
    }
    if (contractMetadata) {
      logger.info(
        `Loaded contract metadata: ${contractMetadata.contract.name} (${contractMetadata.schema_version})`,
      );
    }

    const result = await pipeline.transfer({
      from: config.creatorAddress,
      to,
      value,
      terminalClass,
      trustTier,
      contractMetadata,
    });

    // Print step-by-step timeline
    logger.info("");
    logger.info("--- Pipeline Timeline ---");
    for (const step of result.timeline) {
      logger.info(step);
    }
    logger.info("");

    if (result.success) {
      logger.info(`Transfer completed successfully.`);
      logger.info(`  Intent ID:  ${result.intentId}`);
      if (result.planId) logger.info(`  Plan ID:    ${result.planId}`);
      if (result.approvalId) logger.info(`  Approval:   ${result.approvalId}`);
      if (result.receiptId) logger.info(`  Receipt ID: ${result.receiptId}`);
      if (result.txHash) logger.info(`  Tx Hash:    ${result.txHash}`);
    } else {
      logger.error(`Transfer failed: ${result.error}`);
      logger.error(`  Intent ID: ${result.intentId}`);
    }
  } finally {
    db.close();
  }
}

// ── status ──────────────────────────────────────────────────────

async function handleStatus(args: string[]): Promise<void> {
  const intentId = args[0];
  if (!intentId) {
    logger.error("Usage: openfox intent status <intentId>");
    return;
  }

  const config = requireConfig();
  if (!config) return;
  const db = createDatabase(resolvePath(config.dbPath));

  try {
    const audit = createAuditJournal(db);
    if (!audit) {
      logger.error("Could not open audit journal.");
      return;
    }

    const entries = audit.getIntentTimeline(intentId);
    if (entries.length === 0) {
      logger.info(`No audit entries found for intent ${intentId}.`);
      return;
    }

    const lastEntry = entries[entries.length - 1]!;
    const firstEntry = entries[0]!;

    logger.info(`Intent: ${intentId}`);
    logger.info(`  Created:  ${new Date(firstEntry.timestamp * 1000).toISOString()}`);
    logger.info(`  Updated:  ${new Date(lastEntry.timestamp * 1000).toISOString()}`);
    logger.info(`  Last step: ${lastEntry.kind}`);
    logger.info(`  Summary:  ${lastEntry.summary}`);
    logger.info(`  Total audit entries: ${entries.length}`);

    if (lastEntry.txHash) {
      logger.info(`  Tx Hash:  ${lastEntry.txHash}`);
    }
    if (lastEntry.receiptId) {
      logger.info(`  Receipt:  ${lastEntry.receiptId}`);
    }

    const latestDetailedEntry = findLatestEntryWithDetails(entries);
    if (latestDetailedEntry?.details) {
      logger.info(`  Latest context: ${formatKindLabel(latestDetailedEntry.kind)}`);
      for (const line of formatAuditDetails(latestDetailedEntry.details, "    ")) {
        logger.info(line);
      }
    }
  } finally {
    db.close();
  }
}

// ── list ────────────────────────────────────────────────────────

async function handleList(args: string[]): Promise<void> {
  const statusFilter = parseFlag(args, "--status", "") as IntentStatus | "";
  const limit = parseInt(parseFlag(args, "--limit", "20"), 10);

  const config = requireConfig();
  if (!config) return;
  const db = createDatabase(resolvePath(config.dbPath));

  try {
    const audit = createAuditJournal(db);
    if (!audit) {
      logger.error("Could not open audit journal.");
      return;
    }

    // Query intent_created entries to get the list of intents
    const entries = audit.query({
      kind: "intent_created",
      limit,
    });

    if (entries.length === 0) {
      logger.info("No intents found.");
      return;
    }

    logger.info(`Intents (showing up to ${limit}):\n`);
    for (const entry of entries) {
      const intentId = entry.intentId ?? "unknown";

      // If a status filter was specified, check against latest entry for this intent
      if (statusFilter) {
        const timeline = audit.getIntentTimeline(intentId);
        const last = timeline[timeline.length - 1];
        if (!last) continue;
        // Map last audit kind to approximate intent status
        const inferredStatus = inferStatusFromKind(last.kind);
        if (inferredStatus !== statusFilter) continue;
      }

      const ts = new Date(entry.timestamp * 1000).toISOString();
      const terminal = entry.terminalClass ?? "-";
      logger.info(`  ${intentId}  ${ts}  terminal=${terminal}  ${entry.summary}`);
    }
  } finally {
    db.close();
  }
}

// ── explain ─────────────────────────────────────────────────────

async function handleExplain(args: string[]): Promise<void> {
  const intentId = args[0];
  if (!intentId) {
    logger.error("Usage: openfox intent explain <intentId>");
    return;
  }

  const config = requireConfig();
  if (!config) return;
  const db = createDatabase(resolvePath(config.dbPath));

  try {
    const audit = createAuditJournal(db);
    if (!audit) {
      logger.error("Could not open audit journal.");
      return;
    }

    const entries = audit.getIntentTimeline(intentId);
    if (entries.length === 0) {
      logger.info(`No audit entries found for intent ${intentId}.`);
      return;
    }

    logger.info(`=== Intent Explanation: ${intentId} ===\n`);

    // Group entries by step and explain each
    for (const entry of entries) {
      const ts = new Date(entry.timestamp * 1000).toISOString();
      const kindLabel = formatKindLabel(entry.kind);
      logger.info(`[${ts}] ${kindLabel}`);
      logger.info(`  ${entry.summary}`);
      if (entry.actorAddress) logger.info(`  Actor: ${entry.actorAddress}`);
      if (entry.sponsorAddress) logger.info(`  Sponsor: ${entry.sponsorAddress}`);
      if (entry.txHash) logger.info(`  Tx: ${entry.txHash}`);
      if (entry.value) logger.info(`  Value: ${entry.value} wei`);
      if (entry.policyDecision) logger.info(`  Policy: ${entry.policyDecision}`);
      for (const line of formatAuditDetails(entry.details, "  ")) {
        logger.info(line);
      }
      logger.info("");
    }
  } finally {
    db.close();
  }
}

// ── replay ──────────────────────────────────────────────────────

async function handleReplay(args: string[]): Promise<void> {
  const intentId = args[0];
  if (!intentId) {
    logger.error("Usage: openfox intent replay <intentId>");
    return;
  }

  const config = requireConfig();
  if (!config) return;
  const db = createDatabase(resolvePath(config.dbPath));

  try {
    const audit = createAuditJournal(db);
    if (!audit) {
      logger.error("Could not open audit journal.");
      return;
    }

    const entries = audit.getIntentTimeline(intentId);
    if (entries.length === 0) {
      logger.info(`No audit entries found for intent ${intentId}.`);
      return;
    }

    logger.info(`=== Replay Timeline: ${intentId} ===\n`);

    const firstTs = entries[0]!.timestamp;

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i]!;
      const offsetMs = (entry.timestamp - firstTs) * 1000;
      const offsetLabel = offsetMs === 0 ? "T+0ms" : `T+${offsetMs}ms`;
      const kindLabel = formatKindLabel(entry.kind);

      logger.info(`${String(i + 1).padStart(2, " ")}. [${offsetLabel}] ${kindLabel}`);
      logger.info(`     ${entry.summary}`);

      // Show cross-references
      const refs: string[] = [];
      if (entry.planId) refs.push(`plan=${entry.planId}`);
      if (entry.approvalId) refs.push(`approval=${entry.approvalId}`);
      if (entry.receiptId) refs.push(`receipt=${entry.receiptId}`);
      if (entry.txHash) refs.push(`tx=${entry.txHash}`);
      if (refs.length > 0) {
        logger.info(`     refs: ${refs.join(", ")}`);
      }
      for (const line of formatAuditDetails(entry.details, "     ")) {
        logger.info(line);
      }
      logger.info("");
    }

    const lastEntry = entries[entries.length - 1]!;
    const totalMs = (lastEntry.timestamp - firstTs) * 1000;
    logger.info(`Total duration: ${totalMs}ms across ${entries.length} steps.`);
  } finally {
    db.close();
  }
}

// ── quotes ──────────────────────────────────────────────────────

async function handleQuotes(args: string[]): Promise<void> {
  if (args.length < 2) {
    logger.error("Usage: openfox intent quotes <action> <value> [--to <addr>]");
    return;
  }

  const action = args[0]!;
  const value = args[1]!;
  const recipient = parseFlag(args, "--to", "");

  const config = requireConfig();
  if (!config) return;
  const db = createDatabase(resolvePath(config.dbPath));

  try {
    logger.info(`Discovering provider and sponsor quotes for "${action}" with value ${value} wei...\n`);

    const preview = await buildIntentQuotePreview({
      action,
      value,
      requester: config.creatorAddress,
      recipient: recipient || config.creatorAddress,
      config,
      db,
      sponsorPolicy: {
        preferredSponsors: [],
        maxFeePercent: 5.0,
        maxFeeAbsolute: "0",
        minTrustTier: 0,
        strategy: "cheapest",
        fallbackEnabled: true,
        autoSelectEnabled: true,
      },
    });

    logger.info(formatIntentQuotePreview(preview));
  } finally {
    db.close();
  }
}

// ── Helpers ─────────────────────────────────────────────────────

function printUsage(): void {
  logger.info(`
OpenFox intent pipeline

Usage:
  openfox intent transfer <to> <value> [--terminal <class>] [--trust <tier>] [--sponsor <addr>] [--contract-metadata <path>]
  openfox intent status <intentId>
  openfox intent list [--status <status>] [--limit <n>]
  openfox intent explain <intentId>
  openfox intent replay <intentId>
  openfox intent quotes <action> <value> [--to <addr>]

Subcommands:
  transfer   Create and execute a transfer through the intent pipeline
  status     Look up an intent by ID and show its current status
  list       List recent intents with optional filters
  explain    Generate a human-readable explanation of an intent
  replay     Build and display a replay timeline from the audit journal
  quotes     Discover and compare sponsor/provider quotes
`);
}

function requireConfig() {
  const config = loadConfig();
  if (!config) {
    logger.error("OpenFox is not configured. Run openfox --setup first.");
    return null;
  }
  return config;
}

function parseFlag(args: string[], flag: string, defaultValue: string): string {
  const idx = args.indexOf(flag);
  if (idx !== -1 && idx + 1 < args.length) {
    return args[idx + 1]!;
  }
  return defaultValue;
}

function findLatestEntryWithDetails<T extends { details?: Record<string, unknown> }>(entries: T[]): T | undefined {
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    if (entry?.details && Object.keys(entry.details).length > 0) {
      return entry;
    }
  }
  return undefined;
}

function inferStatusFromKind(kind: string): IntentStatus {
  switch (kind) {
    case "intent_created":
      return "pending";
    case "intent_transition":
      return "planning";
    case "plan_created":
    case "plan_selected":
      return "planning";
    case "approval_requested":
    case "approval_granted":
      return "approved";
    case "execution_submitted":
      return "executing";
    case "execution_settled":
      return "settled";
    case "execution_failed":
      return "failed";
    default:
      return "pending";
  }
}

function formatKindLabel(kind: string): string {
  return kind
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}
