/**
 * CLI argument parsing utilities.
 */
import type { GroupVisibility, GroupJoinMode } from "../group/store.js";
import type { SignerProviderTrustTier } from "../types.js";
import type { VerifiedAgentProvider } from "../agent-discovery/types.js";
import type { loadConfig } from "../config.js";
import type { createDatabase } from "../state/database.js";
import { discoverCapabilityProviders } from "../agent-discovery/client.js";

export function readOption(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index === -1) return undefined;
  return args[index + 1]?.trim() || undefined;
}

export function readNumberOption(args: string[], flag: string, fallback: number): number {
  const raw = readOption(args, flag);
  if (!raw) return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`Invalid numeric value for ${flag}: ${raw}`);
  }
  return value;
}

export function collectRepeatedOption(args: string[], flag: string): string[] {
  const values: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === flag) {
      const value = args[index + 1]?.trim();
      if (value) values.push(value);
    }
  }
  return values;
}

export function readCsvOption(args: string[], flag: string): string[] | undefined {
  const raw = readOption(args, flag);
  if (!raw) return undefined;
  const values = raw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  return values.length ? values : undefined;
}

export function readFlag(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

export function readGroupIdArg(args: string[], positionalIndex?: number): string | undefined {
  if (readOption(args, "--group")) {
    return readOption(args, "--group");
  }
  if (typeof positionalIndex !== "number") {
    return undefined;
  }
  return args[positionalIndex]?.trim() || undefined;
}

export function readGroupVisibilityOption(args: string[]): GroupVisibility | undefined {
  const raw = readOption(args, "--visibility");
  if (!raw) return undefined;
  if (raw !== "private" && raw !== "listed" && raw !== "public") {
    throw new Error("Invalid --visibility value: expected private, listed, or public");
  }
  return raw;
}

export function readGroupJoinModeOption(args: string[]): GroupJoinMode | undefined {
  const raw = readOption(args, "--join-mode");
  if (!raw) return undefined;
  if (raw !== "invite_only" && raw !== "request_approval") {
    throw new Error(
      "Invalid --join-mode value: expected invite_only or request_approval",
    );
  }
  return raw;
}

export function parseGroupChannelSpecs(
  args: string[],
): Array<{ name: string; description?: string }> {
  return collectRepeatedOption(args, "--channel")
    .map((entry) => {
      const separator = entry.indexOf(":");
      if (separator === -1) {
        return { name: entry.trim() };
      }
      return {
        name: entry.slice(0, separator).trim(),
        description: entry.slice(separator + 1).trim(),
      };
    })
    .filter((entry) => entry.name.length > 0);
}

export function readSignerTrustTierOption(
  args: string[],
): SignerProviderTrustTier | undefined {
  const raw = readOption(args, "--trust-tier");
  if (!raw) return undefined;
  if (
    raw !== "self_hosted" &&
    raw !== "org_trusted" &&
    raw !== "public_low_trust"
  ) {
    throw new Error(
      `Invalid --trust-tier value: ${raw}. Expected self_hosted, org_trusted, or public_low_trust.`,
    );
  }
  return raw;
}

export async function resolveSignerProviderBaseUrl(params: {
  config: NonNullable<ReturnType<typeof loadConfig>>;
  capabilityPrefix: string;
  providerBaseUrl?: string;
  db?: ReturnType<typeof createDatabase>;
  requiredTrustTier?: SignerProviderTrustTier;
}): Promise<{ providerBaseUrl: string; provider?: VerifiedAgentProvider }> {
  if (params.providerBaseUrl) {
    return { providerBaseUrl: params.providerBaseUrl.replace(/\/+$/, "") };
  }
  if (!params.config.agentDiscovery?.enabled) {
    throw new Error(
      "No --provider was given and Agent Discovery is not enabled for signer discovery.",
    );
  }
  const providers = await discoverCapabilityProviders({
    config: params.config,
    capability: `${params.capabilityPrefix}.quote`,
    limit: 5,
    db: params.db,
  });
  const matchingProviders = params.requiredTrustTier
    ? providers.filter(
        (provider) =>
          provider.matchedCapability.policy?.trust_tier ===
          params.requiredTrustTier,
      )
    : providers;
  if (!matchingProviders.length) {
    throw new Error(
      params.requiredTrustTier
        ? `No signer-provider advertising ${params.capabilityPrefix}.quote with trust_tier=${params.requiredTrustTier} was discovered.`
        : `No signer-provider advertising ${params.capabilityPrefix}.quote was discovered.`,
    );
  }
  const provider = matchingProviders[0];
  const endpointUrl = provider.endpoint.url.replace(/\/+$/, "");
  return {
    provider,
    providerBaseUrl: endpointUrl.endsWith("/quote")
      ? endpointUrl.slice(0, -"/quote".length)
      : endpointUrl,
  };
}

export async function resolvePaymasterProviderBaseUrl(params: {
  config: NonNullable<ReturnType<typeof loadConfig>>;
  capabilityPrefix: string;
  providerBaseUrl?: string;
  db?: ReturnType<typeof createDatabase>;
  requiredTrustTier?: SignerProviderTrustTier;
}): Promise<{ providerBaseUrl: string; provider?: VerifiedAgentProvider }> {
  if (params.providerBaseUrl) {
    return { providerBaseUrl: params.providerBaseUrl.replace(/\/+$/, "") };
  }
  if (!params.config.agentDiscovery?.enabled) {
    throw new Error(
      "No --provider was given and Agent Discovery is not enabled for paymaster discovery.",
    );
  }
  const providers = await discoverCapabilityProviders({
    config: params.config,
    capability: `${params.capabilityPrefix}.quote`,
    limit: 5,
    db: params.db,
  });
  const matchingProviders = params.requiredTrustTier
    ? providers.filter(
        (provider) =>
          provider.matchedCapability.policy?.trust_tier ===
          params.requiredTrustTier,
      )
    : providers;
  if (!matchingProviders.length) {
    throw new Error(
      params.requiredTrustTier
        ? `No paymaster-provider advertising ${params.capabilityPrefix}.quote with trust_tier=${params.requiredTrustTier} was discovered.`
        : `No paymaster-provider advertising ${params.capabilityPrefix}.quote was discovered.`,
    );
  }
  const provider = matchingProviders[0];
  const endpointUrl = provider.endpoint.url.replace(/\/+$/, "");
  return {
    provider,
    providerBaseUrl: endpointUrl.endsWith("/quote")
      ? endpointUrl.slice(0, -"/quote".length)
      : endpointUrl,
  };
}
