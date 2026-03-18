import type {
  OpenFoxDatabase,
  OpportunityAutomationLevel,
  OpportunityKind,
  OpportunityProviderClass,
  OpportunityReportCadence,
  OpportunityStrategyProfile,
  OpportunityTrustTier,
} from "../types.js";

const STRATEGY_PROFILES_KEY = "opportunity.strategy.profiles";
const STRATEGY_CURRENT_KEY = "opportunity.strategy.current";

const ALL_OPPORTUNITY_KINDS: OpportunityKind[] = [
  "bounty",
  "campaign",
  "provider",
];

const ALL_PROVIDER_CLASSES: OpportunityProviderClass[] = [
  "task_market",
  "observation",
  "oracle",
  "sponsored_execution",
  "storage_artifacts",
  "general_provider",
];

const ALL_TRUST_TIERS: OpportunityTrustTier[] = [
  "self_hosted",
  "org_trusted",
  "public_low_trust",
  "unknown",
];

const VALID_AUTOMATION_LEVELS: OpportunityAutomationLevel[] = [
  "manual",
  "assisted",
  "bounded_auto",
];

const VALID_REPORT_CADENCES: OpportunityReportCadence[] = [
  "on_demand",
  "daily",
  "weekly",
];

export interface OpportunityStrategyValidation {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export interface OpportunityStrategyUpdateInput {
  profileId?: string;
  name?: string;
  revenueTargetWei?: string;
  maxSpendPerOpportunityWei?: string;
  minMarginBps?: number;
  enabledOpportunityKinds?: OpportunityKind[];
  enabledProviderClasses?: OpportunityProviderClass[];
  allowedTrustTiers?: OpportunityTrustTier[];
  automationLevel?: OpportunityAutomationLevel;
  reportCadence?: OpportunityReportCadence;
  maxDeadlineHours?: number;
}

function isDecimalString(value: string): boolean {
  return /^\d+$/.test(value.trim());
}

function nowIso(): string {
  return new Date().toISOString();
}

export function createDefaultStrategyProfile(): OpportunityStrategyProfile {
  const timestamp = nowIso();
  return {
    profileId: "default",
    name: "Default Strategy",
    revenueTargetWei: "0",
    maxSpendPerOpportunityWei: "0",
    minMarginBps: 0,
    enabledOpportunityKinds: [...ALL_OPPORTUNITY_KINDS],
    enabledProviderClasses: [...ALL_PROVIDER_CLASSES],
    allowedTrustTiers: [...ALL_TRUST_TIERS],
    automationLevel: "assisted",
    reportCadence: "daily",
    maxDeadlineHours: 168,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function sanitizeUnique<T extends string>(values: T[]): T[] {
  return [...new Set(values)];
}

function parseStrategyProfiles(db: OpenFoxDatabase): OpportunityStrategyProfile[] {
  const raw = db.getKV(STRATEGY_PROFILES_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as OpportunityStrategyProfile[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeStrategyProfiles(
  db: OpenFoxDatabase,
  profiles: OpportunityStrategyProfile[],
): void {
  db.setKV(STRATEGY_PROFILES_KEY, JSON.stringify(profiles));
}

export function listStrategyProfiles(
  db: OpenFoxDatabase,
): OpportunityStrategyProfile[] {
  const profiles = parseStrategyProfiles(db);
  if (!profiles.length) {
    return [createDefaultStrategyProfile()];
  }
  return profiles;
}

export function getCurrentStrategyProfileId(
  db: OpenFoxDatabase,
): string | null {
  return db.getKV(STRATEGY_CURRENT_KEY) ?? null;
}

export function setCurrentStrategyProfileId(
  db: OpenFoxDatabase,
  profileId: string,
): void {
  db.setKV(STRATEGY_CURRENT_KEY, profileId);
}

export function getStrategyProfile(
  db: OpenFoxDatabase,
  profileId: string,
): OpportunityStrategyProfile | null {
  return listStrategyProfiles(db).find((profile) => profile.profileId === profileId) ?? null;
}

export function getCurrentStrategyProfile(
  db: OpenFoxDatabase,
): OpportunityStrategyProfile {
  const profiles = listStrategyProfiles(db);
  const currentId = getCurrentStrategyProfileId(db);
  return (
    profiles.find((profile) => profile.profileId === currentId) ??
    profiles[0] ??
    createDefaultStrategyProfile()
  );
}

export function validateStrategyProfile(
  profile: OpportunityStrategyProfile,
): OpportunityStrategyValidation {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!profile.profileId.trim()) errors.push("profileId is required.");
  if (!profile.name.trim()) errors.push("name is required.");
  if (!isDecimalString(profile.revenueTargetWei)) {
    errors.push("revenueTargetWei must be a non-negative integer string.");
  }
  if (!isDecimalString(profile.maxSpendPerOpportunityWei)) {
    errors.push("maxSpendPerOpportunityWei must be a non-negative integer string.");
  }
  if (!Number.isFinite(profile.minMarginBps) || profile.minMarginBps < 0) {
    errors.push("minMarginBps must be a non-negative number.");
  }
  if (profile.minMarginBps > 20_000) {
    warnings.push("minMarginBps is unusually high and may filter nearly all opportunities.");
  }
  if (
    !Number.isFinite(profile.maxDeadlineHours) ||
    profile.maxDeadlineHours <= 0
  ) {
    errors.push("maxDeadlineHours must be a positive number.");
  }
  if (!profile.enabledOpportunityKinds.length) {
    errors.push("enabledOpportunityKinds must include at least one kind.");
  }
  if (!profile.enabledProviderClasses.length) {
    errors.push("enabledProviderClasses must include at least one provider class.");
  }
  if (!profile.allowedTrustTiers.length) {
    errors.push("allowedTrustTiers must include at least one trust tier.");
  }
  for (const kind of profile.enabledOpportunityKinds) {
    if (!ALL_OPPORTUNITY_KINDS.includes(kind)) {
      errors.push(`Unsupported opportunity kind: ${kind}`);
    }
  }
  for (const providerClass of profile.enabledProviderClasses) {
    if (!ALL_PROVIDER_CLASSES.includes(providerClass)) {
      errors.push(`Unsupported provider class: ${providerClass}`);
    }
  }
  for (const trustTier of profile.allowedTrustTiers) {
    if (!ALL_TRUST_TIERS.includes(trustTier)) {
      errors.push(`Unsupported trust tier: ${trustTier}`);
    }
  }
  if (!VALID_AUTOMATION_LEVELS.includes(profile.automationLevel)) {
    errors.push(`Unsupported automationLevel: ${profile.automationLevel}`);
  }
  if (!VALID_REPORT_CADENCES.includes(profile.reportCadence)) {
    errors.push(`Unsupported reportCadence: ${profile.reportCadence}`);
  }
  if (profile.maxSpendPerOpportunityWei === "0") {
    warnings.push("maxSpendPerOpportunityWei is zero, so paid provider opportunities will not match.");
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

export function upsertStrategyProfile(
  db: OpenFoxDatabase,
  input: OpportunityStrategyUpdateInput,
): OpportunityStrategyProfile {
  const now = nowIso();
  const profiles = parseStrategyProfiles(db);
  const current =
    (input.profileId
      ? profiles.find((profile) => profile.profileId === input.profileId)
      : null) ?? getCurrentStrategyProfile(db);
  const profileId = input.profileId?.trim() || current.profileId || "default";
  const next: OpportunityStrategyProfile = {
    ...current,
    profileId,
    name: input.name?.trim() || current.name,
    revenueTargetWei: input.revenueTargetWei?.trim() || current.revenueTargetWei,
    maxSpendPerOpportunityWei:
      input.maxSpendPerOpportunityWei?.trim() ||
      current.maxSpendPerOpportunityWei,
    minMarginBps: input.minMarginBps ?? current.minMarginBps,
    enabledOpportunityKinds: sanitizeUnique(
      input.enabledOpportunityKinds ?? current.enabledOpportunityKinds,
    ),
    enabledProviderClasses: sanitizeUnique(
      input.enabledProviderClasses ?? current.enabledProviderClasses,
    ),
    allowedTrustTiers: sanitizeUnique(
      input.allowedTrustTiers ?? current.allowedTrustTiers,
    ),
    automationLevel: input.automationLevel ?? current.automationLevel,
    reportCadence: input.reportCadence ?? current.reportCadence,
    maxDeadlineHours: input.maxDeadlineHours ?? current.maxDeadlineHours,
    createdAt: current.createdAt || now,
    updatedAt: now,
  };

  const validation = validateStrategyProfile(next);
  if (!validation.valid) {
    throw new Error(validation.errors.join(" "));
  }

  const nextProfiles = profiles.filter((profile) => profile.profileId !== next.profileId);
  nextProfiles.unshift(next);
  writeStrategyProfiles(db, nextProfiles);
  setCurrentStrategyProfileId(db, next.profileId);
  return next;
}
