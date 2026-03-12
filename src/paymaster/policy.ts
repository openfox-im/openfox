import { keccak256, toHex, type Hex } from "tosdk";
import { normalizeAddress, type ChainAddress } from "../chain/address.js";
import type {
  PaymasterProviderConfig,
  PaymasterProviderPolicyConfig,
  PaymasterProviderTrustTier,
} from "../types.js";

const SYSTEM_ACTION_ADDRESS = normalizeAddress("0x1");

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([a], [b]) => a.localeCompare(b));
  return `{${entries
    .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
    .join(",")}}`;
}

export function normalizeSelector(value: string): Hex {
  const normalized = value.trim().toLowerCase();
  if (!/^0x[0-9a-f]{8}$/.test(normalized)) {
    throw new Error("function selectors must be 4-byte hex strings");
  }
  return normalized as Hex;
}

function selectorFromData(dataHex: Hex): Hex | null {
  const normalized = dataHex.trim().toLowerCase();
  if (normalized === "0x") return null;
  if (!/^0x[0-9a-f]+$/.test(normalized) || normalized.length < 10) {
    throw new Error("data must be hex and include a function selector when not empty");
  }
  return normalized.slice(0, 10) as Hex;
}

export function getPolicySponsorAddress(
  providerAddress: ChainAddress,
  policy: PaymasterProviderPolicyConfig,
): ChainAddress {
  return normalizeAddress(policy.sponsorAddress || providerAddress);
}

export function hashPaymasterPolicy(params: {
  providerAddress: ChainAddress;
  policy: PaymasterProviderPolicyConfig;
}): Hex {
  const sponsorAddress = getPolicySponsorAddress(params.providerAddress, params.policy);
  const normalized = {
    sponsor_address: sponsorAddress,
    policy_id: params.policy.policyId,
    delegate_identity: params.policy.delegateIdentity || null,
    trust_tier: params.policy.trustTier,
    allowed_wallets: params.policy.allowedWallets.map((entry) =>
      normalizeAddress(entry),
    ),
    allowed_targets: params.policy.allowedTargets.map((entry) =>
      normalizeAddress(entry),
    ),
    allowed_function_selectors: params.policy.allowedFunctionSelectors.map((entry) =>
      normalizeSelector(entry),
    ),
    max_value_wei: params.policy.maxValueWei,
    expires_at: params.policy.expiresAt || null,
    allow_system_action: params.policy.allowSystemAction === true,
  };
  return keccak256(toHex(new TextEncoder().encode(stableStringify(normalized)))) as Hex;
}

export function buildPaymasterScopeHash(params: {
  walletAddress: ChainAddress;
  sponsorAddress: ChainAddress;
  targetAddress: ChainAddress;
  valueWei: string;
  dataHex: Hex;
  gas: string;
  trustTier: PaymasterProviderTrustTier;
}): Hex {
  const normalized = {
    wallet_address: normalizeAddress(params.walletAddress),
    sponsor_address: normalizeAddress(params.sponsorAddress),
    target_address: normalizeAddress(params.targetAddress),
    value_wei: params.valueWei,
    data_hex: params.dataHex.toLowerCase(),
    gas: params.gas,
    trust_tier: params.trustTier,
  };
  return keccak256(toHex(new TextEncoder().encode(stableStringify(normalized)))) as Hex;
}

export function validatePaymasterPolicyRequest(params: {
  providerAddress: ChainAddress;
  config: PaymasterProviderConfig;
  walletAddress: string;
  targetAddress: string;
  valueWei: string;
  dataHex?: string;
  gas?: string;
}): {
  sponsorAddress: ChainAddress;
  walletAddress: ChainAddress;
  targetAddress: ChainAddress;
  valueWei: string;
  dataHex: Hex;
  gas: string;
  policyHash: Hex;
  scopeHash: Hex;
} {
  const policy = params.config.policy;
  const sponsorAddress = getPolicySponsorAddress(params.providerAddress, policy);
  const walletAddress = normalizeAddress(params.walletAddress);
  const targetAddress = normalizeAddress(params.targetAddress);
  const value = BigInt(params.valueWei || "0");
  if (value < 0n) {
    throw new Error("value_wei must be non-negative");
  }
  const maxValueWei = BigInt(policy.maxValueWei || "0");
  if (value > maxValueWei) {
    throw new Error("value exceeds paymaster policy limit");
  }

  const dataHex = ((params.dataHex || "0x").trim().toLowerCase() || "0x") as Hex;
  if (!/^0x[0-9a-f]*$/.test(dataHex)) {
    throw new Error("data must be a hex string");
  }
  const maxDataBytes = Math.max(0, params.config.maxDataBytes);
  if ((dataHex.length - 2) / 2 > maxDataBytes) {
    throw new Error(`data exceeds maxDataBytes (${maxDataBytes})`);
  }
  if (!policy.allowSystemAction && targetAddress === SYSTEM_ACTION_ADDRESS) {
    throw new Error("system action target is not allowed by paymaster policy");
  }
  if (!policy.allowedTargets.length) {
    throw new Error("paymaster policy has no allowedTargets configured");
  }
  if (
    !policy.allowedTargets
      .map((entry) => normalizeAddress(entry))
      .includes(targetAddress)
  ) {
    throw new Error("target is not allowed by paymaster policy");
  }
  if (
    policy.allowedWallets.length > 0 &&
    !policy.allowedWallets
      .map((entry) => normalizeAddress(entry))
      .includes(walletAddress)
  ) {
    throw new Error("wallet is not allowed by paymaster policy");
  }

  const allowedSelectors = policy.allowedFunctionSelectors.map((entry) =>
    normalizeSelector(entry),
  );
  const selector = selectorFromData(dataHex);
  if (allowedSelectors.length > 0) {
    if (!selector || !allowedSelectors.includes(selector)) {
      throw new Error("function selector is not allowed by paymaster policy");
    }
  }

  if (policy.expiresAt && new Date(policy.expiresAt).getTime() <= Date.now()) {
    throw new Error("paymaster policy has expired");
  }

  const gas = params.gas || params.config.defaultGas;
  if (!/^[0-9]+$/.test(gas)) {
    throw new Error("gas must be a decimal string");
  }

  const policyHash = hashPaymasterPolicy({
    providerAddress: params.providerAddress,
    policy,
  });
  const scopeHash = buildPaymasterScopeHash({
    walletAddress,
    sponsorAddress,
    targetAddress,
    valueWei: value.toString(),
    dataHex,
    gas,
    trustTier: policy.trustTier,
  });

  return {
    sponsorAddress,
    walletAddress,
    targetAddress,
    valueWei: value.toString(),
    dataHex,
    gas,
    policyHash,
    scopeHash,
  };
}
