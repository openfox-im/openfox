import { randomBytes } from "crypto";
import { verifyMessage, type PrivateKeyAccount } from "@tosnetwork/tosdk";
import { createLogger } from "../observability/logger.js";
import type { AgentGatewaySessionAuth, AgentGatewaySessionAuthPayload } from "./types.js";

const logger = createLogger("agent-gateway.auth");

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

export function canonicalizeGatewaySessionAuthPayload(
  payload: AgentGatewaySessionAuthPayload,
): string {
  return JSON.stringify(sortValue(payload));
}

export async function signGatewaySessionAuth(params: {
  account: PrivateKeyAccount;
  agentId: string;
  primaryIdentity: { kind: string; value: string };
  gatewayAgentId: string;
  ttlSeconds: number;
  issuedAt?: number;
  sessionNonce?: string;
}): Promise<AgentGatewaySessionAuth> {
  const issuedAt = params.issuedAt ?? Math.floor(Date.now() / 1000);
  const payload: AgentGatewaySessionAuthPayload = {
    version: 1,
    agent_id: params.agentId.toLowerCase(),
    primary_identity: {
      kind: params.primaryIdentity.kind,
      value: params.primaryIdentity.value.toLowerCase(),
    },
    metadata_signer: {
      kind: "eip191",
      address: params.account.address.toLowerCase(),
    },
    gateway_agent_id: params.gatewayAgentId.toLowerCase(),
    session_nonce:
      params.sessionNonce || `0x${randomBytes(16).toString("hex")}`,
    issued_at: issuedAt,
    expires_at: issuedAt + Math.max(60, params.ttlSeconds),
  };
  const signature = await params.account.signMessage({
    message: canonicalizeGatewaySessionAuthPayload(payload),
  });
  return {
    ...payload,
    signature,
  };
}

export async function verifyGatewaySessionAuth(params: {
  auth: AgentGatewaySessionAuth;
  expectedGatewayAgentId: string;
  now?: number;
}): Promise<boolean> {
  const { auth } = params;
  if (auth.version !== 1) return false;
  if (auth.metadata_signer?.kind !== "eip191") return false;
  if (!auth.gateway_agent_id || !auth.session_nonce) return false;
  if (
    auth.gateway_agent_id.toLowerCase() !==
    params.expectedGatewayAgentId.toLowerCase()
  ) {
    return false;
  }
  const now = params.now ?? Math.floor(Date.now() / 1000);
  if (auth.issued_at > now + 30) return false;
  if (auth.expires_at <= now) return false;
  const { signature, ...payload } = auth;
  try {
    return await verifyMessage({
      address: auth.metadata_signer.address as `0x${string}`,
      message: canonicalizeGatewaySessionAuthPayload(payload),
      signature,
    });
  } catch (error) {
    logger.warn(
      `Gateway session auth verification failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    return false;
  }
}
