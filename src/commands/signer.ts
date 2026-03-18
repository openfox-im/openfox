import { loadConfig, resolvePath } from "../config.js";
import { createDatabase } from "../state/database.js";
import { createLogger } from "../observability/logger.js";
import { getWallet } from "../identity/wallet.js";
import {
  discoverCapabilityProviders,
} from "../agent-discovery/client.js";
import {
  fetchSignerExecutionReceipt,
  fetchSignerExecutionStatus,
  fetchSignerQuote,
  submitSignerExecution,
} from "../signer/client.js";
import type { SignerProviderTrustTier } from "../types.js";
import type { VerifiedAgentProvider } from "../agent-discovery/types.js";
import { randomUUID } from "crypto";

const logger = createLogger("main");

function readOption(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index === -1) return undefined;
  return args[index + 1]?.trim() || undefined;
}

function readSignerTrustTierOption(
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

async function resolveSignerProviderBaseUrl(params: {
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

export async function handleSignerCommand(args: string[]): Promise<void> {
  const command = args[0];
  if (!command || command === "--help" || command === "help") {
    logger.info(`
OpenFox signer

Usage:
  openfox signer list [--status <pending|submitted|confirmed|failed|rejected>] [--json]
  openfox signer get --execution <id> [--json]
  openfox signer discover [--capability-prefix <prefix>] [--json]
  openfox signer quote [--provider <base-url>] [--capability-prefix <prefix>] [--trust-tier <tier>] --target <address> [--value-wei <wei>] [--data <hex>] [--gas <gas>] [--reason <text>] [--json]
  openfox signer submit [--provider <base-url>] [--capability-prefix <prefix>] [--trust-tier <tier>] --quote-id <id> --target <address> [--value-wei <wei>] [--data <hex>] [--gas <gas>] [--reason <text>] [--json]
  openfox signer status --provider <base-url> --execution <id> [--json]
  openfox signer receipt --provider <base-url> --execution <id> [--json]
`);
    return;
  }

  const config = loadConfig();
  if (!config) {
    throw new Error("OpenFox is not configured. Run `openfox --setup` first.");
  }
  const db = createDatabase(resolvePath(config.dbPath));
  try {
    const wantsJson = args.includes("--json");
    if (command === "list") {
      const status = readOption(args, "--status") as
        | "pending"
        | "submitted"
        | "confirmed"
        | "failed"
        | "rejected"
        | undefined;
      const items = db.listSignerExecutions(50, status ? { status } : undefined);
      if (wantsJson) {
        logger.info(JSON.stringify(items, null, 2));
        return;
      }
      if (!items.length) {
        logger.info("No signer executions found.");
        return;
      }
      for (const item of items) {
        logger.info(
          `${item.executionId}  [${item.status}] wallet=${item.walletAddress} target=${item.targetAddress} tx=${item.submittedTxHash || "(pending)"}`,
        );
      }
      return;
    }

    if (command === "get") {
      const executionId = readOption(args, "--execution");
      if (!executionId) {
        throw new Error("Usage: openfox signer get --execution <id> [--json]");
      }
      const record = db.getSignerExecution(executionId);
      if (!record) {
        throw new Error(`Signer execution not found: ${executionId}`);
      }
      logger.info(JSON.stringify(record, null, 2));
      return;
    }

    if (command === "discover") {
      const capabilityPrefix =
        readOption(args, "--capability-prefix") ||
        config.signerProvider?.capabilityPrefix ||
        "signer";
      const requiredTrustTier = readSignerTrustTierOption(args);
      const providers = (await discoverCapabilityProviders({
        config,
        capability: `${capabilityPrefix}.quote`,
        limit: 10,
        db,
      })).filter((provider) =>
        requiredTrustTier
          ? provider.matchedCapability.policy?.trust_tier === requiredTrustTier
          : true,
      );
      const discovered = providers.map((provider) => ({
        providerAddress: provider.search.primaryIdentity,
        nodeId: provider.search.nodeId,
        capability: provider.matchedCapability.name,
        mode: provider.matchedCapability.mode,
        endpoint: provider.endpoint.url,
        trustTier: provider.matchedCapability.policy?.trust_tier ?? null,
        trust: provider.search.trust,
      }));
      if (wantsJson) {
        logger.info(JSON.stringify(discovered, null, 2));
        return;
      }
      if (!discovered.length) {
        logger.info("No signer providers discovered.");
        return;
      }
      for (const provider of discovered) {
        logger.info(
          `${provider.providerAddress}  capability=${provider.capability}  mode=${provider.mode}  trust_tier=${provider.trustTier || "(unknown)"}  endpoint=${provider.endpoint}`,
        );
      }
      return;
    }

    if (command === "quote") {
      const capabilityPrefix =
        readOption(args, "--capability-prefix") ||
        config.signerProvider?.capabilityPrefix ||
        "signer";
      const requiredTrustTier = readSignerTrustTierOption(args);
      const { providerBaseUrl, provider } = await resolveSignerProviderBaseUrl({
        config,
        capabilityPrefix,
        providerBaseUrl: readOption(args, "--provider"),
        db,
        requiredTrustTier,
      });
      const target = readOption(args, "--target");
      if (!providerBaseUrl || !target) {
        throw new Error("Usage: openfox signer quote [--provider <base-url>] [--capability-prefix <prefix>] [--trust-tier <tier>] --target <address> [--value-wei <wei>] [--data <hex>] [--gas <gas>] [--reason <text>] [--json]");
      }
      const result = await fetchSignerQuote({
        providerBaseUrl,
        requesterAddress: config.walletAddress,
        target: target as `0x${string}`,
        valueWei: readOption(args, "--value-wei") || "0",
        data: (readOption(args, "--data") as `0x${string}` | undefined) ?? undefined,
        gas: readOption(args, "--gas") || undefined,
        reason: readOption(args, "--reason") || undefined,
      });
      if (
        requiredTrustTier &&
        result.trust_tier &&
        result.trust_tier !== requiredTrustTier
      ) {
        throw new Error(
          `Signer provider returned trust_tier=${String(result.trust_tier)} but ${requiredTrustTier} was required.`,
        );
      }
      if (
        !requiredTrustTier &&
        (result.trust_tier === "public_low_trust" ||
          provider?.matchedCapability.policy?.trust_tier === "public_low_trust")
      ) {
        logger.warn(
          "Selected signer-provider is public_low_trust. Re-run with --trust-tier self_hosted or --trust-tier org_trusted for a stricter policy boundary.",
        );
      }
      logger.info(JSON.stringify(result, null, 2));
      return;
    }

    if (command === "submit") {
      const capabilityPrefix =
        readOption(args, "--capability-prefix") ||
        config.signerProvider?.capabilityPrefix ||
        "signer";
      const requiredTrustTier = readSignerTrustTierOption(args);
      const { providerBaseUrl, provider } = await resolveSignerProviderBaseUrl({
        config,
        capabilityPrefix,
        providerBaseUrl: readOption(args, "--provider"),
        db,
        requiredTrustTier,
      });
      const quoteId = readOption(args, "--quote-id");
      const target = readOption(args, "--target");
      if (!providerBaseUrl || !quoteId || !target) {
        throw new Error("Usage: openfox signer submit [--provider <base-url>] [--capability-prefix <prefix>] [--trust-tier <tier>] --quote-id <id> --target <address> [--value-wei <wei>] [--data <hex>] [--gas <gas>] [--reason <text>] [--json]");
      }
      if (!config.rpcUrl) {
        throw new Error("rpcUrl is required for signer submit");
      }
      const { account } = await getWallet();
      const result = await submitSignerExecution({
        providerBaseUrl,
        account,
        rpcUrl: config.rpcUrl,
        requesterAddress: config.walletAddress,
        quoteId,
        target: target as `0x${string}`,
        valueWei: readOption(args, "--value-wei") || "0",
        data: (readOption(args, "--data") as `0x${string}` | undefined) ?? undefined,
        gas: readOption(args, "--gas") || undefined,
        requestNonce: randomUUID().replace(/-/g, ""),
        requestExpiresAt: Math.floor(Date.now() / 1000) + 300,
        reason: readOption(args, "--reason") || undefined,
      });
      if (
        !requiredTrustTier &&
        provider?.matchedCapability.policy?.trust_tier === "public_low_trust"
      ) {
        logger.warn(
          "Submitted through a public_low_trust signer-provider. Prefer --trust-tier self_hosted or org_trusted for higher-value delegated execution.",
        );
      }
      logger.info(JSON.stringify(result.body, null, 2));
      return;
    }

    if (command === "status") {
      const providerBaseUrl = readOption(args, "--provider");
      const executionId = readOption(args, "--execution");
      if (!providerBaseUrl || !executionId) {
        throw new Error("Usage: openfox signer status --provider <base-url> --execution <id> [--json]");
      }
      const result = await fetchSignerExecutionStatus(providerBaseUrl, executionId);
      logger.info(JSON.stringify(result, null, 2));
      return;
    }

    if (command === "receipt") {
      const providerBaseUrl = readOption(args, "--provider");
      const executionId = readOption(args, "--execution");
      if (!providerBaseUrl || !executionId) {
        throw new Error("Usage: openfox signer receipt --provider <base-url> --execution <id> [--json]");
      }
      const result = await fetchSignerExecutionReceipt(providerBaseUrl, executionId);
      logger.info(JSON.stringify(result, null, 2));
      return;
    }

    throw new Error(`Unknown signer command: ${command}`);
  } finally {
    db.close();
  }
}
