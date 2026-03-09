import type { PrivateKeyAccount } from "tosdk";
import { verifyMessage } from "tosdk";
import type { OpenFoxConfig, OpenFoxIdentity } from "../types.js";
import {
  capabilityFromConfig,
  type AgentDiscoveryCard,
  type AgentDiscoveryCardPayload,
  type AgentDiscoveryConfig,
} from "./types.js";

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortValue);
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = sortValue((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

export function canonicalizeAgentDiscoveryCardPayload(
  payload: AgentDiscoveryCardPayload,
): string {
  return JSON.stringify(sortValue(payload));
}

export function buildAgentDiscoveryCardPayload(params: {
  identity: OpenFoxIdentity;
  config: OpenFoxConfig;
  agentDiscovery: AgentDiscoveryConfig;
  address: string;
  discoveryNodeId: string;
  issuedAt?: number;
  cardSequence?: number;
}): AgentDiscoveryCardPayload {
  const issuedAt = params.issuedAt ?? Math.floor(Date.now() / 1000);
  const displayName = params.agentDiscovery.displayName?.trim() || params.config.name;
  const capabilities = params.agentDiscovery.capabilities.map(capabilityFromConfig);

  return {
    version: 1,
    agent_id: params.config.agentId || params.identity.address.toLowerCase(),
    primary_identity: {
      kind: "tos",
      value: params.address.toLowerCase(),
    },
    discovery_node_id: params.discoveryNodeId,
    card_seq: params.cardSequence ?? issuedAt,
    issued_at: issuedAt,
    expires_at: issuedAt + Math.max(60, params.agentDiscovery.cardTtlSeconds),
    display_name: displayName,
    endpoints: params.agentDiscovery.endpoints.map((endpoint) => ({
      kind: endpoint.kind,
      url: endpoint.url.trim(),
      via_gateway: endpoint.viaGateway?.trim() || undefined,
      role: endpoint.role?.trim() || undefined,
    })),
    capabilities,
    reputation_refs: [],
    relay_encryption_pubkey: params.identity.account.publicKey?.toLowerCase() as
      | `0x${string}`
      | undefined,
    metadata_signer: {
      kind: "eip191",
      address: params.identity.address.toLowerCase(),
    },
  };
}

export async function signAgentDiscoveryCard(
  account: PrivateKeyAccount,
  payload: AgentDiscoveryCardPayload,
): Promise<AgentDiscoveryCard> {
  const canonical = canonicalizeAgentDiscoveryCardPayload(payload);
  const signature = await account.signMessage({ message: canonical });
  return {
    ...payload,
    signature,
  };
}

export async function buildSignedAgentDiscoveryCard(params: {
  identity: OpenFoxIdentity;
  config: OpenFoxConfig;
  agentDiscovery: AgentDiscoveryConfig;
  address: string;
  discoveryNodeId: string;
  issuedAt?: number;
  cardSequence?: number;
}): Promise<AgentDiscoveryCard> {
  const payload = buildAgentDiscoveryCardPayload(params);
  return signAgentDiscoveryCard(params.identity.account, payload);
}

export async function verifyAgentDiscoveryCard(
  card: AgentDiscoveryCard,
  expectedNodeId?: string,
): Promise<boolean> {
  if (card.version !== 1) return false;
  if (card.metadata_signer?.kind !== "eip191") return false;
  if (expectedNodeId && card.discovery_node_id !== expectedNodeId) return false;
  if (!Array.isArray(card.capabilities) || card.capabilities.length === 0) return false;
  if (!Array.isArray(card.endpoints) || card.endpoints.length === 0) return false;
  if (typeof card.signature !== "string" || !card.signature.startsWith("0x")) return false;
  if (
    card.relay_encryption_pubkey !== undefined &&
    (typeof card.relay_encryption_pubkey !== "string" ||
      !card.relay_encryption_pubkey.startsWith("0x"))
  ) {
    return false;
  }
  for (const capability of card.capabilities) {
    if (
      capability.policy !== undefined &&
      (typeof capability.policy !== "object" ||
        capability.policy === null ||
        Array.isArray(capability.policy))
    ) {
      return false;
    }
  }
  if (typeof card.expires_at !== "number" || card.expires_at <= Math.floor(Date.now() / 1000)) {
    return false;
  }
  for (const endpoint of card.endpoints) {
    if (
      !endpoint ||
      typeof endpoint.url !== "string" ||
      !endpoint.url.trim() ||
      !["http", "https", "ws"].includes(String(endpoint.kind)) ||
      (endpoint.role !== undefined &&
        (typeof endpoint.role !== "string" || !endpoint.role.trim())) ||
      (endpoint.via_gateway !== undefined &&
        (typeof endpoint.via_gateway !== "string" || !endpoint.via_gateway.trim()))
    ) {
      return false;
    }
  }

  const { signature, ...payload } = card;
  const canonical = canonicalizeAgentDiscoveryCardPayload(payload);
  return verifyMessage({
    address: card.metadata_signer.address as `0x${string}`,
    message: canonical,
    signature,
  });
}
