/**
 * Agent Intent Tools
 *
 * GTOS 2046: Tool definitions that the agent loop can use to interact
 * with the intent execution pipeline. These tools are registered alongside
 * the existing builtin tools and follow the same OpenFoxTool interface.
 */

import type {
  OpenFoxTool,
  ToolContext,
} from "../types.js";
import { createPipeline, createTerminalRegistry, createAuditJournal } from "../pipeline/factory.js";
import { buildIntentQuotePreview, formatIntentQuotePreview } from "../routing/index.js";
import { parseContractMetadata } from "../intent/metadata-loader.js";
import type { TerminalClass, TrustTier } from "../intent/types.js";
import { formatAuditDetails } from "../audit/render.js";
import { createLogger } from "../observability/logger.js";

const logger = createLogger("intent-tools");

/**
 * Creates the set of intent pipeline tools for the agent loop.
 * These are designed to be merged into the builtin tools array.
 */
export function createIntentTools(): OpenFoxTool[] {
  return [
    // ── intent_transfer ──────────────────────────────────────────
    {
      name: "intent_transfer",
      description:
        "Execute a transfer through the intent pipeline with policy checks, sponsor selection, and audit logging. Returns the pipeline result including intent ID, receipt, and step-by-step timeline.",
      category: "financial",
      riskLevel: "caution",
      parameters: {
        type: "object",
        properties: {
          to: {
            type: "string",
            description: "Recipient address",
          },
          value: {
            type: "string",
            description: "Transfer value in wei",
          },
          terminalClass: {
            type: "string",
            enum: ["app", "card", "pos", "voice", "kiosk", "robot", "api"],
            description: "Terminal class for the transaction (default: app)",
          },
          trustTier: {
            type: "number",
            enum: [0, 1, 2, 3, 4],
            description: "Trust tier for the terminal session (default: 2)",
          },
          sponsor: {
            type: "string",
            description: "Optional preferred sponsor address to bias paymaster selection.",
          },
          contractMetadata: {
            type: "object",
            description: "Optional TOL contract metadata JSON object used to enrich routing, escalation, and approval context.",
          },
        },
        required: ["to", "value"],
      },
      execute: async (args: Record<string, unknown>, ctx: ToolContext): Promise<string> => {
        try {
          const to = args.to as string;
          const value = args.value as string;
          const terminalClass = (args.terminalClass as TerminalClass) ?? "app";
          const trustTier = (args.trustTier as TrustTier) ?? 2;
          const sponsor = typeof args.sponsor === "string" ? args.sponsor : undefined;
          const contractMetadata = args.contractMetadata === undefined
            ? undefined
            : parseContractMetadata(args.contractMetadata, "intent_transfer.contractMetadata");

          const pipeline = createPipeline(ctx.config, ctx.db, {
            autoApprove: true,
            auditEnabled: true,
            sponsorPolicy: sponsor
              ? {
                  preferredSponsors: [sponsor],
                  strategy: "preferred_first",
                }
              : undefined,
          });

          const result = await pipeline.transfer({
            from: ctx.identity.address,
            to,
            value,
            terminalClass,
            trustTier,
            contractMetadata,
          });

          if (result.success) {
            const lines = [
              `Transfer completed successfully.`,
              `Intent ID: ${result.intentId}`,
              result.planId ? `Plan ID: ${result.planId}` : null,
              result.receiptId ? `Receipt ID: ${result.receiptId}` : null,
              result.txHash ? `Tx Hash: ${result.txHash}` : null,
              ``,
              `Timeline:`,
              ...result.timeline,
            ].filter(Boolean);
            return lines.join("\n");
          } else {
            return `Transfer failed: ${result.error}\nIntent ID: ${result.intentId}\n\nTimeline:\n${result.timeline.join("\n")}`;
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          logger.error(`intent_transfer failed: ${message}`);
          return `Error executing transfer: ${message}`;
        }
      },
    },

    // ── intent_status ────────────────────────────────────────────
    {
      name: "intent_status",
      description:
        "Check the status of an intent by its ID. Returns the full audit timeline for the intent.",
      category: "financial",
      riskLevel: "safe",
      parameters: {
        type: "object",
        properties: {
          intentId: {
            type: "string",
            description: "The intent ID to look up",
          },
        },
        required: ["intentId"],
      },
      execute: async (args: Record<string, unknown>, ctx: ToolContext): Promise<string> => {
        try {
          const intentId = args.intentId as string;
          const audit = createAuditJournal(ctx.db);
          if (!audit) {
            return "Could not open audit journal.";
          }

          const entries = audit.getIntentTimeline(intentId);
          if (entries.length === 0) {
            return `No audit entries found for intent ${intentId}.`;
          }

          const lastEntry = entries[entries.length - 1]!;
          const firstEntry = entries[0]!;

          const lines = [
            `Intent: ${intentId}`,
            `Created: ${new Date(firstEntry.timestamp * 1000).toISOString()}`,
            `Updated: ${new Date(lastEntry.timestamp * 1000).toISOString()}`,
            `Last step: ${lastEntry.kind}`,
            `Summary: ${lastEntry.summary}`,
            `Total audit entries: ${entries.length}`,
          ];

          if (lastEntry.txHash) lines.push(`Tx Hash: ${lastEntry.txHash}`);
          if (lastEntry.receiptId) lines.push(`Receipt: ${lastEntry.receiptId}`);

          lines.push("", "Timeline:");
          for (const entry of entries) {
            const ts = new Date(entry.timestamp * 1000).toISOString();
            lines.push(`  [${ts}] ${entry.kind}: ${entry.summary}`);
            lines.push(...formatAuditDetails(entry.details, "    "));
          }

          return lines.join("\n");
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return `Error checking intent status: ${message}`;
        }
      },
    },

    // ── intent_explain ───────────────────────────────────────────
    {
      name: "intent_explain",
      description:
        "Get a human-readable explanation of an intent, including all pipeline steps, policy decisions, and cross-references.",
      category: "financial",
      riskLevel: "safe",
      parameters: {
        type: "object",
        properties: {
          intentId: {
            type: "string",
            description: "The intent ID to explain",
          },
        },
        required: ["intentId"],
      },
      execute: async (args: Record<string, unknown>, ctx: ToolContext): Promise<string> => {
        try {
          const intentId = args.intentId as string;
          const audit = createAuditJournal(ctx.db);
          if (!audit) {
            return "Could not open audit journal.";
          }

          const entries = audit.getIntentTimeline(intentId);
          if (entries.length === 0) {
            return `No audit entries found for intent ${intentId}.`;
          }

          const lines = [`Intent Explanation: ${intentId}`, ""];

          for (const entry of entries) {
            const ts = new Date(entry.timestamp * 1000).toISOString();
            const kindLabel = entry.kind
              .split("_")
              .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
              .join(" ");

            lines.push(`[${ts}] ${kindLabel}`);
            lines.push(`  ${entry.summary}`);
            if (entry.actorAddress) lines.push(`  Actor: ${entry.actorAddress}`);
            if (entry.sponsorAddress) lines.push(`  Sponsor: ${entry.sponsorAddress}`);
            if (entry.txHash) lines.push(`  Tx: ${entry.txHash}`);
            if (entry.value) lines.push(`  Value: ${entry.value} wei`);
            if (entry.policyDecision) lines.push(`  Policy: ${entry.policyDecision}`);
            lines.push(...formatAuditDetails(entry.details, "  "));
            lines.push("");
          }

          return lines.join("\n");
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return `Error explaining intent: ${message}`;
        }
      },
    },

    // ── intent_quotes ────────────────────────────────────────────
    {
      name: "intent_quotes",
      description:
        "Discover and compare provider route quotes plus sponsor quotes for a given intent preview. Returns intent-tied recommendations and fallback order.",
      category: "financial",
      riskLevel: "safe",
      parameters: {
        type: "object",
        properties: {
          action: {
            type: "string",
            description: "The action to get quotes for (e.g. 'transfer', 'swap')",
          },
          value: {
            type: "string",
            description: "The transaction value in wei",
          },
          to: {
            type: "string",
            description: "Optional target/recipient address for the intent preview. Defaults to the current identity.",
          },
        },
        required: ["action", "value"],
      },
      execute: async (args: Record<string, unknown>, ctx: ToolContext): Promise<string> => {
        try {
          const action = args.action as string;
          const value = args.value as string;
          const recipient = typeof args.to === "string" ? args.to : ctx.identity.address;
          const preview = await buildIntentQuotePreview({
            action,
            value,
            requester: ctx.identity.address,
            recipient,
            config: ctx.config,
            db: ctx.db,
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

          return formatIntentQuotePreview(preview);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return `Error discovering quotes: ${message}`;
        }
      },
    },

    // ── terminal_check ───────────────────────────────────────────
    {
      name: "terminal_check",
      description:
        "Check terminal capabilities and policy for a given terminal class. Returns supported actions, trust requirements, and limits.",
      category: "financial",
      riskLevel: "safe",
      parameters: {
        type: "object",
        properties: {
          terminalClass: {
            type: "string",
            enum: ["app", "card", "pos", "voice", "kiosk", "robot", "api"],
            description: "The terminal class to check",
          },
        },
        required: ["terminalClass"],
      },
      execute: async (args: Record<string, unknown>, _ctx: ToolContext): Promise<string> => {
        try {
          const terminalClass = args.terminalClass as TerminalClass;
          const registry = createTerminalRegistry();
          const adapter = registry.getAdapter(terminalClass);

          if (!adapter) {
            return `No adapter registered for terminal class "${terminalClass}".`;
          }

          const caps = adapter.capabilities();
          const policy = registry.getPolicy(terminalClass);

          const lines = [
            `Terminal: ${terminalClass.toUpperCase()}`,
            `Default trust tier: ${adapter.defaultTrustTier}`,
            "",
            "Capabilities:",
            `  Can sign: ${caps.canSign}`,
            `  Secure element: ${caps.hasSecureElement}`,
            `  Biometric: ${caps.hasBiometric}`,
            `  Display approval: ${caps.canDisplayApproval}`,
            `  Receive callbacks: ${caps.canReceiveCallbacks}`,
            caps.maxTransactionValue ? `  Max transaction: ${caps.maxTransactionValue} wei` : null,
            `  Supported actions: ${caps.supportedActions.join(", ")}`,
          ].filter(Boolean) as string[];

          if (policy) {
            lines.push(
              "",
              "Policy:",
              `  Enabled: ${policy.enabled}`,
              `  Min trust tier: ${policy.minTrustTier}`,
              `  Requires approval: ${policy.requiresApproval}`,
              `  Max single value: ${policy.maxSingleValue} wei`,
              `  Max daily value: ${policy.maxDailyValue} wei`,
              `  Allowed actions: ${policy.allowedActions.join(", ")}`,
            );
          } else {
            lines.push("", "Policy: (none configured — using adapter defaults)");
          }

          return lines.join("\n");
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return `Error checking terminal: ${message}`;
        }
      },
    },
  ];
}
