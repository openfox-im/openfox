import { loadConfig, resolvePath } from "../config.js";
import { createDatabase } from "../state/database.js";
import { createLogger } from "../observability/logger.js";
import { getWallet } from "../identity/wallet.js";
import {
  discoverCapabilityProviders,
} from "../agent-discovery/client.js";
import {
  authorizePaymasterExecution,
  fetchPaymasterAuthorizationReceipt,
  fetchPaymasterAuthorizationStatus,
  fetchPaymasterQuote,
} from "../paymaster/client.js";
import {
  toPaymasterQuoteRecord,
  toPaymasterAuthorizationRecord,
} from "../runtime/record-transformers.js";
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

async function resolvePaymasterProviderBaseUrl(params: {
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

export async function handlePaymasterCommand(args: string[]): Promise<void> {
  const command = args[0];
  if (!command || command === "--help" || command === "help") {
    logger.info(`
OpenFox paymaster

Usage:
  openfox paymaster list [--kind <quote|authorization>] [--status <quoted|used|expired|authorized|submitted|confirmed|failed|rejected>] [--json]
  openfox paymaster get (--quote <id> | --authorization <id>) [--json]
  openfox paymaster discover [--capability-prefix <prefix>] [--trust-tier <tier>] [--json]
  openfox paymaster quote [--provider <base-url>] [--capability-prefix <prefix>] [--trust-tier <tier>] [--wallet <address>] --target <address> [--value-wei <wei>] [--data <hex>] [--gas <gas>] [--reason <text>] [--json]
  openfox paymaster authorize [--provider <base-url>] [--capability-prefix <prefix>] [--trust-tier <tier>] --quote-id <id> [--reason <text>] [--json]
  openfox paymaster status --provider <base-url> --authorization <id> [--json]
  openfox paymaster receipt --provider <base-url> --authorization <id> [--json]
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
      const kind = (readOption(args, "--kind") || "authorization").trim().toLowerCase();
      if (kind === "quote") {
        const status = readOption(args, "--status") as
          | "quoted"
          | "used"
          | "expired"
          | undefined;
        const items = db.listPaymasterQuotes(50, status ? { status } : undefined);
        if (wantsJson) {
          logger.info(JSON.stringify(items, null, 2));
          return;
        }
        if (!items.length) {
          logger.info("No paymaster quotes found.");
          return;
        }
        for (const item of items) {
          logger.info(
            `${item.quoteId}  [${item.status}] wallet=${item.walletAddress} sponsor=${item.sponsorAddress} target=${item.targetAddress} amount=${item.amountWei}`,
          );
        }
        return;
      }
      const status = readOption(args, "--status") as
        | "authorized"
        | "submitted"
        | "confirmed"
        | "failed"
        | "rejected"
        | "expired"
        | undefined;
      const items = db.listPaymasterAuthorizations(50, status ? { status } : undefined);
      if (wantsJson) {
        logger.info(JSON.stringify(items, null, 2));
        return;
      }
      if (!items.length) {
        logger.info("No paymaster authorizations found.");
        return;
      }
      for (const item of items) {
        logger.info(
          `${item.authorizationId}  [${item.status}] wallet=${item.walletAddress} sponsor=${item.sponsorAddress} target=${item.targetAddress} tx=${item.submittedTxHash || "(pending)"}`,
        );
      }
      return;
    }

    if (command === "get") {
      const quoteId = readOption(args, "--quote");
      const authorizationId = readOption(args, "--authorization");
      if (!quoteId && !authorizationId) {
        throw new Error("Usage: openfox paymaster get (--quote <id> | --authorization <id>) [--json]");
      }
      const record = quoteId
        ? db.getPaymasterQuote(quoteId)
        : db.getPaymasterAuthorization(authorizationId!);
      if (!record) {
        throw new Error(
          quoteId
            ? `Paymaster quote not found: ${quoteId}`
            : `Paymaster authorization not found: ${authorizationId}`,
        );
      }
      logger.info(JSON.stringify(record, null, 2));
      return;
    }

    if (command === "discover") {
      const capabilityPrefix =
        readOption(args, "--capability-prefix") ||
        config.paymasterProvider?.capabilityPrefix ||
        "paymaster";
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
        sponsorAddress: provider.matchedCapability.policy?.sponsor_address ?? null,
        trust: provider.search.trust,
      }));
      if (wantsJson) {
        logger.info(JSON.stringify(discovered, null, 2));
        return;
      }
      if (!discovered.length) {
        logger.info("No paymaster providers discovered.");
        return;
      }
      for (const provider of discovered) {
        logger.info(
          `${provider.providerAddress}  capability=${provider.capability}  mode=${provider.mode}  trust_tier=${provider.trustTier || "(unknown)"}  sponsor=${provider.sponsorAddress || "(unset)"}  endpoint=${provider.endpoint}`,
        );
      }
      return;
    }

    if (command === "quote") {
      const capabilityPrefix =
        readOption(args, "--capability-prefix") ||
        config.paymasterProvider?.capabilityPrefix ||
        "paymaster";
      const requiredTrustTier = readSignerTrustTierOption(args);
      const { providerBaseUrl, provider } = await resolvePaymasterProviderBaseUrl({
        config,
        capabilityPrefix,
        providerBaseUrl: readOption(args, "--provider"),
        db,
        requiredTrustTier,
      });
      const target = readOption(args, "--target");
      if (!providerBaseUrl || !target) {
        throw new Error("Usage: openfox paymaster quote [--provider <base-url>] [--capability-prefix <prefix>] [--trust-tier <tier>] [--wallet <address>] --target <address> [--value-wei <wei>] [--data <hex>] [--gas <gas>] [--reason <text>] [--json]");
      }
      const result = await fetchPaymasterQuote({
        providerBaseUrl,
        requesterAddress: config.walletAddress,
        walletAddress: (readOption(args, "--wallet") as `0x${string}` | undefined) ?? undefined,
        target: target as `0x${string}`,
        valueWei: readOption(args, "--value-wei") || "0",
        data: (readOption(args, "--data") as `0x${string}` | undefined) ?? undefined,
        gas: readOption(args, "--gas") || undefined,
        reason: readOption(args, "--reason") || undefined,
      });
      const quoteRecord = toPaymasterQuoteRecord(result);
      db.upsertPaymasterQuote(quoteRecord);
      if (
        requiredTrustTier &&
        result.trust_tier &&
        result.trust_tier !== requiredTrustTier
      ) {
        throw new Error(
          `Paymaster provider returned trust_tier=${String(result.trust_tier)} but ${requiredTrustTier} was required.`,
        );
      }
      if (
        !requiredTrustTier &&
        (result.trust_tier === "public_low_trust" ||
          provider?.matchedCapability.policy?.trust_tier === "public_low_trust")
      ) {
        logger.warn(
          "Selected paymaster-provider is public_low_trust. Re-run with --trust-tier self_hosted or --trust-tier org_trusted for a stricter sponsorship boundary.",
        );
      }
      logger.info(JSON.stringify(result, null, 2));
      return;
    }

    if (command === "authorize") {
      const capabilityPrefix =
        readOption(args, "--capability-prefix") ||
        config.paymasterProvider?.capabilityPrefix ||
        "paymaster";
      const requiredTrustTier = readSignerTrustTierOption(args);
      const { providerBaseUrl, provider } = await resolvePaymasterProviderBaseUrl({
        config,
        capabilityPrefix,
        providerBaseUrl: readOption(args, "--provider"),
        db,
        requiredTrustTier,
      });
      const quoteId = readOption(args, "--quote-id");
      if (!providerBaseUrl || !quoteId) {
        throw new Error("Usage: openfox paymaster authorize [--provider <base-url>] [--capability-prefix <prefix>] [--trust-tier <tier>] --quote-id <id> [--reason <text>] [--json]");
      }
      if (!config.rpcUrl) {
        throw new Error("rpcUrl is required for paymaster authorize");
      }
      const quote = db.getPaymasterQuote(quoteId);
      if (!quote) {
        throw new Error(`Paymaster quote not found locally: ${quoteId}. Run \`openfox paymaster quote\` first.`);
      }
      const { account } = await getWallet();
      const result = await authorizePaymasterExecution({
        providerBaseUrl,
        rpcUrl: config.rpcUrl,
        account,
        requesterAddress: config.walletAddress,
        quote,
        requestNonce: randomUUID().replace(/-/g, ""),
        requestExpiresAt: Math.floor(Date.now() / 1000) + 300,
        reason: readOption(args, "--reason") || undefined,
      });
      const authorization = toPaymasterAuthorizationRecord(result.body, quote);
      db.upsertPaymasterAuthorization(authorization);
      db.upsertPaymasterQuote({
        ...quote,
        status: authorization.status === "rejected" ? quote.status : "used",
        updatedAt: new Date().toISOString(),
      });
      if (
        !requiredTrustTier &&
        provider?.matchedCapability.policy?.trust_tier === "public_low_trust"
      ) {
        logger.warn(
          "Authorized through a public_low_trust paymaster-provider. Prefer --trust-tier self_hosted or org_trusted for higher-value sponsored execution.",
        );
      }
      logger.info(JSON.stringify(result.body, null, 2));
      return;
    }

    if (command === "status") {
      const providerBaseUrl = readOption(args, "--provider");
      const authorizationId = readOption(args, "--authorization");
      if (!providerBaseUrl || !authorizationId) {
        throw new Error("Usage: openfox paymaster status --provider <base-url> --authorization <id> [--json]");
      }
      const result = await fetchPaymasterAuthorizationStatus(providerBaseUrl, authorizationId);
      logger.info(JSON.stringify(result, null, 2));
      return;
    }

    if (command === "receipt") {
      const providerBaseUrl = readOption(args, "--provider");
      const authorizationId = readOption(args, "--authorization");
      if (!providerBaseUrl || !authorizationId) {
        throw new Error("Usage: openfox paymaster receipt --provider <base-url> --authorization <id> [--json]");
      }
      const result = await fetchPaymasterAuthorizationReceipt(providerBaseUrl, authorizationId);
      logger.info(JSON.stringify(result, null, 2));
      return;
    }

    throw new Error(`Unknown paymaster command: ${command}`);
  } finally {
    db.close();
  }
}
