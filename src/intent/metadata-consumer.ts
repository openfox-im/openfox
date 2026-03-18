/**
 * TOL Metadata Consumer
 *
 * GTOS 2046: Consumes TOL (Trust Object Layer) contract metadata to
 * classify function calls as safe/bounded vs. high-review, enrich approval
 * prompts with human-readable risk context, and score providers during
 * routing decisions.
 *
 * Type shapes mirror the JSON output of tolang/metadata/metadata.go
 * (schema version 0.1.0).
 */

import type { IntentEnvelope } from "./types.js";
import type { ProviderProfile } from "../routing/types.js";

// ── TOL metadata types (mirrors metadata.go JSON) ─────────────────

/** Canonical artifact identity for cross-system references. */
export interface ArtifactRef {
  package_hash: string;
  bytecode_hash: string;
  source_hash?: string;
  abi_hash: string;
  version?: string;
}

/** Contract-level metadata. */
export interface ContractInfo {
  name: string;
  base_contracts?: string[];
  is_account: boolean;
  storage_slots: number;
}

/** Describes a single function parameter or return value. */
export interface ParamMeta {
  name: string;
  type: string;
}

/** Describes a single external call made by a function. */
export interface CallMeta {
  capability?: string;
  interface?: string;
  selector?: string;
  max_gas?: number;
}

/** Captures what a function reads, writes, emits, and calls. */
export interface EffectsMeta {
  reads?: string[];
  writes?: string[];
  emits?: string[];
  calls?: CallMeta[];
}

/** Per-function metadata used by OpenFox for intent routing and approval UX. */
export interface FunctionMeta {
  name: string;
  selector: string;
  visibility: string;
  mutability: string; // "pure" | "view" | "payable" | "nonpayable"
  params: ParamMeta[];
  returns?: ParamMeta[];
  requires_capability?: string[];
  effects?: EffectsMeta;
  gas_upper?: number;
  verifiable: boolean;
  delegated: boolean;
  non_composable: boolean;
  risk_level?: string; // "low" | "medium" | "high"
}

/** Describes an event emitted by a contract. */
export interface EventMeta {
  name: string;
  params: ParamMeta[];
}

/** Metadata from the manifest block. */
export interface ManifestMeta {
  version?: string;
  capabilities?: string[];
  spec?: string;
  sla_uptime?: string;
  custom?: Record<string, string>;
}

/** Gas cost model used during compilation. */
export interface GasModelMeta {
  version: string;
  sload: number;
  sstore: number;
  log_base: number;
}

/** Policy-wallet characteristics of an account contract. */
export interface PolicyProfile {
  has_spend_caps: boolean;
  has_allowlist: boolean;
  has_terminal_policy: boolean;
  has_guardian: boolean;
  has_recovery: boolean;
  has_delegation: boolean;
  has_suspension: boolean;
}

/**
 * Full contract metadata as supplied by TOL (.toc artifact).
 * Mirrors the JSON serialization of metadata.go ContractMetadata.
 */
export interface ContractMetadata {
  schema_version: string;
  artifact_ref: ArtifactRef;
  contract: ContractInfo;
  functions: FunctionMeta[];
  events: EventMeta[];
  manifest?: ManifestMeta;
  gas_model: GasModelMeta;
  capabilities?: string[];
  is_account: boolean;
  policy_profile?: PolicyProfile;
}

// ── Inspection types ────────────────────────────────────────────────

export interface ContractInspection {
  contractName: string;
  isAccount: boolean;
  policyProfile: PolicyProfile | null;
  functions: FunctionInspection[];
  riskSummary: string;
  /** Overall risk level for the contract, derived from its functions. */
  overallRisk: "low" | "medium" | "high";
}

export interface FunctionInspection {
  name: string;
  selector: string;
  riskLevel: "low" | "medium" | "high";
  isSafe: boolean;
  requiresReview: boolean;
  payable: boolean;
  delegated: boolean;
  verifiable: boolean;
  effects: string[];
  mutability: string;
}

// ── High-risk effect patterns ───────────────────────────────────────

const HIGH_RISK_WRITE_PATTERNS = [
  "owner",
  "admin",
  "implementation",
  "proxy",
  "selfdestruct",
  "suicide",
];

const MEDIUM_RISK_WRITE_PATTERNS = [
  "balance",
  "allowance",
  "delegate",
  "operator",
  "paused",
];

// ── Core functions ──────────────────────────────────────────────────

/**
 * Inspect a contract's TOL metadata and produce a full classification
 * of every function as safe, review-required, or dangerous.
 */
export function inspectContract(metadata: ContractMetadata): ContractInspection {
  const functions = metadata.functions.map((fn): FunctionInspection => {
    const riskLevel = computeRiskLevel(fn, metadata.policy_profile ?? null);
    const isPayable = fn.mutability === "payable";
    const isSafe = riskLevel === "low" && !isPayable && !fn.delegated;
    const requiresReview = riskLevel === "high" || fn.delegated || (isPayable && !metadata.is_account);

    // Flatten effects into string list for display
    const effectsList: string[] = [];
    if (fn.effects) {
      if (fn.effects.reads) effectsList.push(...fn.effects.reads.map((r) => `read:${r}`));
      if (fn.effects.writes) effectsList.push(...fn.effects.writes.map((w) => `write:${w}`));
      if (fn.effects.emits) effectsList.push(...fn.effects.emits.map((e) => `emit:${e}`));
      if (fn.effects.calls) effectsList.push(...fn.effects.calls.map((c) => `call:${c.interface ?? c.selector ?? "external"}`));
    }

    return {
      name: fn.name,
      selector: fn.selector,
      riskLevel,
      isSafe,
      requiresReview,
      payable: isPayable,
      delegated: fn.delegated,
      verifiable: fn.verifiable,
      effects: effectsList,
      mutability: fn.mutability,
    };
  });

  const highCount = functions.filter((f) => f.riskLevel === "high").length;
  const mediumCount = functions.filter((f) => f.riskLevel === "medium").length;
  const safeCount = functions.filter((f) => f.isSafe).length;
  const total = functions.length;

  let riskSummary: string;
  let overallRisk: "low" | "medium" | "high";
  if (highCount > 0) {
    riskSummary = `High risk: ${highCount}/${total} functions require careful review. ${safeCount} safe bounded calls.`;
    overallRisk = "high";
  } else if (mediumCount > 0) {
    riskSummary = `Medium risk: ${mediumCount}/${total} functions need review. ${safeCount} safe bounded calls.`;
    overallRisk = "medium";
  } else {
    riskSummary = `Low risk: all ${total} functions are safe bounded calls.`;
    overallRisk = "low";
  }

  return {
    contractName: metadata.contract.name,
    isAccount: metadata.is_account,
    policyProfile: metadata.policy_profile ?? null,
    functions,
    riskSummary,
    overallRisk,
  };
}

/**
 * Classify a single function call as safe, review, or dangerous
 * based on its inspection result.
 */
export function classifyCall(fn: FunctionInspection): "safe" | "review" | "dangerous" {
  if (fn.isSafe) return "safe";
  if (fn.requiresReview && fn.riskLevel === "high") return "dangerous";
  return "review";
}

/**
 * Enrich an approval prompt with human-readable metadata context
 * drawn from the TOL contract inspection.
 */
export function enrichApprovalWithMetadata(
  intent: IntentEnvelope,
  contract: ContractInspection,
): string {
  const lines: string[] = [];

  lines.push(`Action: ${intent.action}`);
  lines.push(`Contract: ${contract.contractName} (${contract.isAccount ? "account" : "external"})`);
  lines.push(`Risk: ${contract.riskSummary}`);

  if (contract.policyProfile) {
    const pp = contract.policyProfile;
    if (pp.has_guardian) {
      lines.push("** Guardian approval required by contract policy **");
    }
    if (pp.has_spend_caps) {
      lines.push("Contract enforces spend caps");
    }
    if (pp.has_allowlist) {
      lines.push("Contract enforces an allowlist");
    }
  }

  // Find the function being called, if params specify a selector
  const selector = typeof intent.params["selector"] === "string"
    ? intent.params["selector"] as string
    : null;

  if (selector) {
    const fn = contract.functions.find((f) => f.selector === selector);
    if (fn) {
      const classification = classifyCall(fn);
      lines.push("");
      lines.push(`Function: ${fn.name} (${fn.selector})`);
      lines.push(`Classification: ${classification}`);
      lines.push(`Mutability: ${fn.mutability}`);
      if (fn.effects.length > 0) {
        lines.push(`Effects: ${fn.effects.join(", ")}`);
      }
      if (fn.payable) lines.push("** This function accepts value **");
      if (fn.delegated) lines.push("** This function uses delegatecall **");
    }
  }

  // List any dangerous functions as a warning
  const dangerous = contract.functions.filter((f) => classifyCall(f) === "dangerous");
  if (dangerous.length > 0) {
    lines.push("");
    lines.push(`Warning: ${dangerous.length} dangerous function(s) on this contract:`);
    for (const d of dangerous) {
      lines.push(`  - ${d.name}: ${d.mutability}, effects: ${d.effects.join(", ") || "none"}`);
    }
  }

  return lines.join("\n");
}

/**
 * Score a provider's suitability for a contract based on TOL metadata.
 * Higher score = better fit. Returns 0-100.
 */
export function scoreProviderByMetadata(
  provider: ProviderProfile,
  contract: ContractInspection,
): number {
  let score = 50; // baseline

  // Providers with higher trust tiers are better for high-risk contracts
  const hasHighRisk = contract.functions.some((f) => f.riskLevel === "high");
  const hasMediumRisk = contract.functions.some((f) => f.riskLevel === "medium");

  if (hasHighRisk) {
    // For high-risk contracts, strongly prefer high-trust providers
    score += provider.trustTier * 10;
    if (provider.trustTier < 3) {
      score -= 20; // penalise low-trust providers for dangerous contracts
    }
  } else if (hasMediumRisk) {
    score += provider.trustTier * 5;
  } else {
    // Low-risk: trust tier matters less, latency/cost matter more
    score += provider.trustTier * 2;
    score += Math.min(10, (10000 - (provider.latencyMs ?? 5000)) / 1000);
  }

  // Reputation bonus
  score += provider.reputationScore * 0.15;

  // Contract is an account — sponsor support is valuable
  if (contract.isAccount && provider.sponsorSupport) {
    score += 10;
  }

  // Guardian-required contracts need high-trust providers
  if (contract.policyProfile?.has_guardian && provider.trustTier >= 3) {
    score += 15;
  }

  return Math.max(0, Math.min(100, Math.round(score)));
}

/**
 * Determine the escalation level implied by contract metadata.
 * Returns "high" if any function is high-risk, "medium" if any medium-risk,
 * "low" otherwise.
 */
export function contractMetadataRiskLevel(metadata: ContractMetadata): "low" | "medium" | "high" {
  const inspection = inspectContract(metadata);
  return inspection.overallRisk;
}

/**
 * Check whether the contract metadata has any high-risk functions.
 */
export function hasHighRiskFunctions(metadata: ContractMetadata): boolean {
  return metadata.functions.some((fn) => {
    const risk = fn.risk_level ?? computeRiskLevel(fn, metadata.policy_profile ?? null);
    return risk === "high";
  });
}

// ── Internal helpers ────────────────────────────────────────────────

function computeRiskLevel(
  fn: FunctionMeta,
  policy: PolicyProfile | null,
): "low" | "medium" | "high" {
  // Explicit risk_level from TOL takes precedence
  if (fn.risk_level === "high" || fn.risk_level === "medium" || fn.risk_level === "low") {
    return fn.risk_level;
  }

  // Check effects writes for known high-risk patterns
  if (fn.effects?.writes) {
    for (const w of fn.effects.writes) {
      const lower = w.toLowerCase();
      if (HIGH_RISK_WRITE_PATTERNS.some((p) => lower.includes(p))) return "high";
    }
    for (const w of fn.effects.writes) {
      const lower = w.toLowerCase();
      if (MEDIUM_RISK_WRITE_PATTERNS.some((p) => lower.includes(p))) return "medium";
    }
  }

  // External calls raise risk
  if (fn.effects?.calls && fn.effects.calls.length > 0) {
    // Multiple external calls = medium risk at minimum
    if (fn.effects.calls.length > 1) return "medium";
  }

  const isPayable = fn.mutability === "payable";

  // Payable + delegated = high risk
  if (isPayable && fn.delegated) return "high";

  // Delegated alone = medium risk
  if (fn.delegated) return "medium";

  // Non-composable = medium risk (can't be safely composed)
  if (fn.non_composable) return "medium";

  // Payable with guardian policy = medium
  if (isPayable && policy?.has_guardian) return "medium";

  return "low";
}
