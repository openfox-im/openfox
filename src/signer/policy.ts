import { keccak256, toHex, type Hex } from "tosdk";
import { normalizeAddress, type ChainAddress } from "../chain/address.js";
import type {
  SignerProviderConfig,
  SignerProviderPolicyConfig,
  SignerProviderTrustTier,
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

export function getPolicyWalletAddress(
  providerAddress: ChainAddress,
  policy: SignerProviderPolicyConfig,
): ChainAddress {
  return normalizeAddress(policy.walletAddress || providerAddress);
}

export function hashSignerPolicy(params: {
  providerAddress: ChainAddress;
  policy: SignerProviderPolicyConfig;
}): Hex {
  const walletAddress = getPolicyWalletAddress(params.providerAddress, params.policy);
  const normalized = {
    wallet_address: walletAddress,
    policy_id: params.policy.policyId,
    delegate_identity: params.policy.delegateIdentity || null,
    trust_tier: params.policy.trustTier,
    allowed_targets: params.policy.allowedTargets.map((entry) =>
      normalizeAddress(entry),
    ),
    allowed_function_selectors: params.policy.allowedFunctionSelectors.map((entry) =>
      normalizeSelector(entry),
    ),
    max_value_tomi: params.policy.maxValueTomi,
    expires_at: params.policy.expiresAt || null,
    allow_system_action: params.policy.allowSystemAction === true,
  };
  return keccak256(toHex(new TextEncoder().encode(stableStringify(normalized)))) as Hex;
}

export function buildSignerScopeHash(params: {
  walletAddress: ChainAddress;
  targetAddress: ChainAddress;
  valueTomi: string;
  dataHex: Hex;
  gas: string;
  trustTier: SignerProviderTrustTier;
}): Hex {
  const normalized = {
    wallet_address: normalizeAddress(params.walletAddress),
    target_address: normalizeAddress(params.targetAddress),
    value_tomi: params.valueTomi,
    data_hex: params.dataHex.toLowerCase(),
    gas: params.gas,
    trust_tier: params.trustTier,
  };
  return keccak256(toHex(new TextEncoder().encode(stableStringify(normalized)))) as Hex;
}

export function validateSignerPolicyRequest(params: {
  providerAddress: ChainAddress;
  config: SignerProviderConfig;
  targetAddress: string;
  valueTomi: string;
  dataHex?: string;
  gas?: string;
}): {
  walletAddress: ChainAddress;
  targetAddress: ChainAddress;
  valueTomi: string;
  dataHex: Hex;
  gas: string;
  policyHash: Hex;
  scopeHash: Hex;
} {
  const policy = params.config.policy;
  const walletAddress = getPolicyWalletAddress(params.providerAddress, policy);
  const targetAddress = normalizeAddress(params.targetAddress);
  const value = BigInt(params.valueTomi || "0");
  if (value < 0n) {
    throw new Error("value_tomi must be non-negative");
  }
  const maxValueTomi = BigInt(policy.maxValueTomi || "0");
  if (value > maxValueTomi) {
    throw new Error("value exceeds signer provider policy limit");
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
    throw new Error("system action target is not allowed by signer policy");
  }
  if (!policy.allowedTargets.length) {
    throw new Error("signer policy has no allowedTargets configured");
  }
  if (
    !policy.allowedTargets
      .map((entry) => normalizeAddress(entry))
      .includes(targetAddress)
  ) {
    throw new Error("target is not allowed by signer policy");
  }

  const allowedSelectors = policy.allowedFunctionSelectors.map((entry) =>
    normalizeSelector(entry),
  );
  const selector = selectorFromData(dataHex);
  if (allowedSelectors.length > 0) {
    if (!selector || !allowedSelectors.includes(selector)) {
      throw new Error("function selector is not allowed by signer policy");
    }
  }

  if (policy.expiresAt && new Date(policy.expiresAt).getTime() <= Date.now()) {
    throw new Error("signer policy has expired");
  }

  const gas = params.gas || params.config.defaultGas;
  if (!/^[0-9]+$/.test(gas)) {
    throw new Error("gas must be a decimal string");
  }

  const policyHash = hashSignerPolicy({
    providerAddress: params.providerAddress,
    policy,
  });
  const scopeHash = buildSignerScopeHash({
    walletAddress,
    targetAddress,
    valueTomi: value.toString(),
    dataHex,
    gas,
    trustTier: policy.trustTier,
  });

  return {
    walletAddress,
    targetAddress,
    valueTomi: value.toString(),
    dataHex,
    gas,
    policyHash,
    scopeHash,
  };
}
