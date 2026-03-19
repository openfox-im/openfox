/**
 * Human-Readable Intent Explanations
 *
 * Generates readable text descriptions from intent pipeline objects
 * for display in approval prompts, logs, and audit trails.
 */

import { TrustTierLabels, type ApprovalRecord, type ExecutionReceipt, type IntentEnvelope, type PlanRecord, type TerminalClass, type TrustTier } from "./types.js";

/** Shorten an address or hash to prefix...suffix form. */
function shorten(value: string, prefixLen = 6, suffixLen = 4): string {
  if (value.length <= prefixLen + suffixLen + 3) return value;
  return `${value.slice(0, prefixLen)}...${value.slice(-suffixLen)}`;
}

/** Format a tomi string into a human-friendly token amount (simple integer division by 1e18). */
function formatTomi(tomi: string): string {
  if (!tomi || tomi === "0") return "0";
  // Handle values smaller than 1 token
  if (tomi.length <= 18) {
    const padded = tomi.padStart(18, "0");
    const decimals = padded.replace(/0+$/, "");
    return decimals.length > 0 ? `0.${padded.slice(0, 6).replace(/0+$/, "")}` : "0";
  }
  const integerPart = tomi.slice(0, tomi.length - 18);
  const fractionalPart = tomi.slice(tomi.length - 18, tomi.length - 18 + 4).replace(/0+$/, "");
  return fractionalPart.length > 0 ? `${integerPart}.${fractionalPart}` : integerPart;
}

function describeTrust(tier: TrustTier): string {
  return TrustTierLabels[tier] ?? `tier-${tier}`;
}

function describeTerminal(cls: TerminalClass): string {
  const labels: Record<TerminalClass, string> = {
    app: "app",
    card: "card terminal",
    pos: "POS terminal",
    voice: "voice node",
    kiosk: "kiosk",
    robot: "robot",
    api: "API endpoint",
  };
  return labels[cls] ?? cls;
}

/**
 * Generate a one-line human-readable explanation of an intent envelope.
 *
 * Example: "Transfer 100 TOS to 0xABC... via card terminal (low trust)"
 */
export function explainIntent(intent: IntentEnvelope): string {
  const action = intent.action.charAt(0).toUpperCase() + intent.action.slice(1);
  const terminal = describeTerminal(intent.terminalClass);
  const trust = describeTrust(intent.trustTier);

  // Extract common param patterns for richer descriptions
  const value = typeof intent.params["value"] === "string" ? formatTomi(intent.params["value"] as string) : undefined;
  const to = typeof intent.params["to"] === "string" ? shorten(intent.params["to"] as string) : undefined;
  const token = typeof intent.params["token"] === "string" ? (intent.params["token"] as string) : "TOS";

  const parts: string[] = [action];
  if (value) parts.push(`${value} ${token}`);
  if (to) parts.push(`to ${to}`);
  parts.push(`via ${terminal} (${trust} trust)`);

  return parts.join(" ");
}

/**
 * Generate a one-line explanation of a plan record.
 *
 * Example: "Execute via provider 0xDEF... sponsored by 0x123... (est. gas: 50000)"
 */
export function explainPlan(plan: PlanRecord): string {
  const provider = shorten(plan.provider);
  const parts: string[] = [`Execute via provider ${provider}`];

  if (plan.sponsor) {
    parts.push(`sponsored by ${shorten(plan.sponsor)}`);
  }

  const details: string[] = [];
  if (plan.estimatedGas > 0) details.push(`est. gas: ${plan.estimatedGas}`);
  if (plan.estimatedValue && plan.estimatedValue !== "0") {
    details.push(`est. value: ${formatTomi(plan.estimatedValue)} TOS`);
  }
  if (plan.route && plan.route.length > 0) {
    details.push(`${plan.route.length} step${plan.route.length > 1 ? "s" : ""}`);
  }

  if (details.length > 0) {
    parts.push(`(${details.join(", ")})`);
  }

  return parts.join(" ");
}

/**
 * Generate a one-line explanation of an approval record.
 *
 * Example: "Approved by owner (guardian role) for up to 1000 TOS on card terminals"
 */
export function explainApproval(approval: ApprovalRecord): string {
  const approver = shorten(approval.approver);
  const role = approval.approverRole;
  const terminal = describeTerminal(approval.terminalClass);
  const status = approval.status;

  const parts: string[] = [];

  if (status === "granted") {
    parts.push(`Approved by ${approver} (${role} role)`);
  } else if (status === "denied") {
    parts.push(`Denied by ${approver} (${role} role)`);
  } else if (status === "pending") {
    parts.push(`Pending approval from ${approver} (${role} role)`);
  } else if (status === "revoked") {
    parts.push(`Revoked by ${approver} (${role} role)`);
  } else {
    parts.push(`Expired approval from ${approver} (${role} role)`);
  }

  if (approval.scope?.maxValue) {
    parts.push(`for up to ${formatTomi(approval.scope.maxValue)} TOS`);
  }

  parts.push(`on ${terminal}s`);

  return parts.join(" ");
}

/**
 * Generate a one-line explanation of an execution receipt.
 *
 * Example: "Settled: 100 TOS transferred. Gas used: 42000. Sponsor: 0x123..."
 */
export function explainReceipt(receipt: ExecutionReceipt): string {
  const statusLabel = receipt.receiptStatus === "success"
    ? "Settled"
    : receipt.receiptStatus === "reverted"
      ? "Reverted"
      : "Failed";

  const value = formatTomi(receipt.value);
  const parts: string[] = [`${statusLabel}: ${value} TOS transferred.`];
  parts.push(`Gas used: ${receipt.gasUsed}.`);

  if (receipt.sponsor) {
    parts.push(`Sponsor: ${shorten(receipt.sponsor)}.`);
  }

  parts.push(`Tx: ${shorten(receipt.txHash)}`);

  return parts.join(" ");
}

/**
 * Generate a full approval prompt that combines intent and plan details
 * for human review before authorizing execution.
 */
export function formatApprovalPrompt(intent: IntentEnvelope, plan: PlanRecord): string {
  const lines: string[] = [];

  lines.push("=== Intent Approval Required ===");
  lines.push("");
  lines.push(`Intent: ${intent.intentId}`);
  lines.push(`Action: ${intent.action}`);
  lines.push(`Terminal: ${describeTerminal(intent.terminalClass)} (${describeTrust(intent.trustTier)} trust)`);
  lines.push(`Requester: ${intent.requester}`);
  lines.push(`Actor: ${intent.actorAgentId}`);

  if (Object.keys(intent.params).length > 0) {
    lines.push("");
    lines.push("Parameters:");
    for (const [key, val] of Object.entries(intent.params)) {
      const display = typeof val === "string" ? val : JSON.stringify(val);
      lines.push(`  ${key}: ${display}`);
    }
  }

  if (intent.constraints) {
    lines.push("");
    lines.push("Constraints:");
    if (intent.constraints.maxValue) lines.push(`  Max value: ${formatTomi(intent.constraints.maxValue)} TOS`);
    if (intent.constraints.maxGas) lines.push(`  Max gas: ${intent.constraints.maxGas}`);
    if (intent.constraints.requiredTrustTier !== undefined) lines.push(`  Required trust: ${describeTrust(intent.constraints.requiredTrustTier)}`);
    if (intent.constraints.deadline) lines.push(`  Deadline: ${new Date(intent.constraints.deadline * 1000).toISOString()}`);
    if (intent.constraints.allowedRecipients && intent.constraints.allowedRecipients.length > 0) {
      lines.push(`  Allowed recipients: ${intent.constraints.allowedRecipients.map((r) => shorten(r)).join(", ")}`);
    }
  }

  lines.push("");
  lines.push("--- Execution Plan ---");
  lines.push(`Plan: ${plan.planId}`);
  lines.push(`Provider: ${plan.provider}`);
  if (plan.sponsor) lines.push(`Sponsor: ${plan.sponsor}`);
  lines.push(`Estimated gas: ${plan.estimatedGas}`);
  lines.push(`Estimated value: ${formatTomi(plan.estimatedValue)} TOS`);
  lines.push(`Policy hash: ${shorten(plan.policyHash)}`);

  if (plan.route && plan.route.length > 0) {
    lines.push("");
    lines.push("Route:");
    for (let i = 0; i < plan.route.length; i++) {
      const step = plan.route[i]!;
      const stepValue = step.value ? ` (${formatTomi(step.value)} TOS)` : "";
      lines.push(`  ${i + 1}. ${step.action} -> ${shorten(step.target)}${stepValue}`);
    }
  }

  lines.push("");
  lines.push("================================");

  return lines.join("\n");
}
