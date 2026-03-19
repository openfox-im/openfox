import { verifyMessage } from "@tosnetwork/tosdk";
import type {
  AgentGatewayBootnodeConfig,
  AgentGatewaySignedBootnodeList,
  OpenFoxConfig,
} from "../types.js";

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

export function canonicalizeGatewayBootnodeListPayload(
  payload: Omit<AgentGatewaySignedBootnodeList, "signer" | "signature">,
): string {
  return JSON.stringify(sortValue(payload));
}

export async function verifyGatewayBootnodeList(
  list: AgentGatewaySignedBootnodeList,
  config: OpenFoxConfig,
): Promise<boolean> {
  if (list.version !== 1) {
    return false;
  }
  if (config.chainId !== undefined && list.networkId !== config.chainId) {
    return false;
  }
  if (!Array.isArray(list.entries) || !list.entries.length) {
    return false;
  }
  return verifyMessage({
    address: list.signer,
    message: canonicalizeGatewayBootnodeListPayload({
      version: list.version,
      networkId: list.networkId,
      entries: list.entries,
      issuedAt: list.issuedAt,
    }),
    signature: list.signature,
  });
}

export async function resolveVerifiedGatewayBootnodes(
  config: OpenFoxConfig,
): Promise<AgentGatewayBootnodeConfig[]> {
  const client = config.agentDiscovery?.gatewayClient;
  const signedList = client?.gatewayBootnodeList;
  if (signedList) {
    const valid = await verifyGatewayBootnodeList(signedList, config);
    if (valid) {
      return signedList.entries;
    }
    if (client?.requireSignedBootnodeList) {
      return [];
    }
  }
  return client?.gatewayBootnodes ?? [];
}
