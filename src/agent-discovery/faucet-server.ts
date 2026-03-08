import http, { type IncomingMessage, type ServerResponse } from "http";
import { URL } from "url";
import { createLogger } from "../observability/logger.js";
import {
  normalizeTOSAddress as normalizeAddress,
  isTOSAddress as isAddress,
} from "../tos/address.js";
import {
  sendTOSNativeTransfer as sendNativeTransfer,
  TOSRpcClient as RpcClient,
} from "../tos/client.js";
import type { OpenFoxConfig, OpenFoxDatabase, OpenFoxIdentity } from "../types.js";
import {
  buildFaucetServerUrl,
  type AgentDiscoveryFaucetServerConfig,
  type FaucetInvocationRequest,
} from "./types.js";
import {
  ensureRequestNotReplayed,
  normalizeNonce,
  recordRequestNonce,
  validateRequestExpiry,
} from "./security.js";

const logger = createLogger("agent-discovery.faucet");

export interface AgentDiscoveryFaucetServer {
  close(): Promise<void>;
  url: string;
}

export interface StartAgentDiscoveryFaucetServerParams {
  identity: OpenFoxIdentity;
  config: OpenFoxConfig;
  address: string;
  privateKey: `0x${string}`;
  db: OpenFoxDatabase;
  faucetConfig: AgentDiscoveryFaucetServerConfig;
}

type FaucetResponse =
  | {
      status: "approved";
      transfer_network: string;
      tx_hash: string;
      amount: string;
      cooldown_until: number;
    }
  | {
      status: "rejected" | "challenge_required" | "paid_upgrade_required";
      reason: string;
    };

const BODY_LIMIT_BYTES = 64 * 1024;

function kvKeyForRequester(identity: string): string {
  return `agent_discovery:faucet:last:${identity.toLowerCase()}`;
}

function readRequesterCooldown(
  db: OpenFoxDatabase,
  requesterIdentity: string,
): { at?: number; txHash?: string } {
  const raw = db.getKV(kvKeyForRequester(requesterIdentity));
  if (!raw) return {};
  try {
    return JSON.parse(raw) as { at?: number; txHash?: string };
  } catch {
    return {};
  }
}

function writeRequesterCooldown(
  db: OpenFoxDatabase,
  requesterIdentity: string,
  at: number,
  txHash: string,
): void {
  db.setKV(
    kvKeyForRequester(requesterIdentity),
    JSON.stringify({ at, txHash }),
  );
}

function json(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Content-Length", Buffer.byteLength(payload));
  res.end(payload);
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > BODY_LIMIT_BYTES) {
      throw new Error("request body too large");
    }
    chunks.push(buffer);
  }
  const raw = Buffer.concat(chunks).toString("utf-8");
  return raw ? JSON.parse(raw) : {};
}

function parseRequestedAmount(value: string): bigint {
  if (!/^\d+$/.test(value.trim())) {
    throw new Error("requested_amount must be a decimal wei string");
  }
  return BigInt(value.trim());
}

function validateRequest(
  request: FaucetInvocationRequest,
  faucet: AgentDiscoveryFaucetServerConfig,
): { requesterAddress: string; requestedAmountWei: bigint; requestNonce: string } {
  if (request.capability !== faucet.capability) {
    throw new Error(`unsupported capability ${request.capability}`);
  }
  if (!request.requester?.identity?.value) {
    throw new Error("missing requester identity");
  }
  if (faucet.requireNativeIdentity && request.requester.identity.kind !== "tos") {
    throw new Error("requester identity must be kind=tos");
  }
  if (!isAddress(request.requester.identity.value)) {
    throw new Error("requester identity is not a valid native address");
  }
  const requestedAmountWei = parseRequestedAmount(request.requested_amount);
  if (requestedAmountWei <= 0n) {
    throw new Error("requested_amount must be positive");
  }
  const requestNonce = normalizeNonce(request.request_nonce);
  validateRequestExpiry(request.request_expires_at);
  return {
    requesterAddress: normalizeAddress(request.requester.identity.value),
    requestedAmountWei,
    requestNonce,
  };
}

export async function startAgentDiscoveryFaucetServer(
  params: StartAgentDiscoveryFaucetServerParams,
): Promise<AgentDiscoveryFaucetServer> {
  const { faucetConfig, config, privateKey, db, address } = params;
  const rpcUrl = config.rpcUrl || process.env.TOS_RPC_URL;
  if (!rpcUrl) {
    throw new Error("Chain RPC is required to run the faucet server");
  }
  const payoutAmountWei = parseRequestedAmount(faucetConfig.payoutAmountWei);
  const maxAmountWei = parseRequestedAmount(faucetConfig.maxAmountWei);
  const path = faucetConfig.path.startsWith("/") ? faucetConfig.path : `/${faucetConfig.path}`;
  const healthzPath = `${path}/healthz`;

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
      if (req.method === "GET" && url.pathname === healthzPath) {
        json(res, 200, {
          ok: true,
          capability: faucetConfig.capability,
          payoutAmountWei: payoutAmountWei.toString(),
          maxAmountWei: maxAmountWei.toString(),
          address,
        });
        return;
      }
      if (req.method !== "POST" || url.pathname !== path) {
        json(res, 404, { error: "not found" });
        return;
      }

      const body = (await readJsonBody(req)) as FaucetInvocationRequest;
      const { requesterAddress, requestedAmountWei, requestNonce } = validateRequest(body, faucetConfig);
      ensureRequestNotReplayed({
        db,
        scope: "faucet",
        requesterIdentity: requesterAddress,
        capability: body.capability,
        nonce: requestNonce,
      });
      const last = readRequesterCooldown(db, requesterAddress);
      const now = Math.floor(Date.now() / 1000);
      const cooldownUntil = (last.at || 0) + faucetConfig.cooldownSeconds;
      if (cooldownUntil > now) {
        const response: FaucetResponse = {
          status: "rejected",
          reason: `cooldown active until ${cooldownUntil}`,
        };
        json(res, 429, response);
        return;
      }
      if (requestedAmountWei > maxAmountWei) {
        const response: FaucetResponse = {
          status: "rejected",
          reason: `requested amount exceeds maxAmountWei ${maxAmountWei.toString()}`,
        };
        json(res, 400, response);
        return;
      }

      const amountWei =
        requestedAmountWei < payoutAmountWei ? requestedAmountWei : payoutAmountWei;
      const client = new RpcClient({ rpcUrl });
      const providerBalance = await client.getBalance(normalizeAddress(address));
      if (providerBalance < amountWei) {
        const response: FaucetResponse = {
          status: "rejected",
          reason: "provider balance is insufficient",
        };
        json(res, 503, response);
        return;
      }

      const transfer = await sendNativeTransfer({
        rpcUrl,
        privateKey,
        to: requesterAddress,
        amountWei,
        waitForReceipt: false,
      });
      recordRequestNonce({
        db,
        scope: "faucet",
        requesterIdentity: requesterAddress,
        capability: body.capability,
        nonce: requestNonce,
        expiresAt: body.request_expires_at,
      });
      writeRequesterCooldown(db, requesterAddress, now, transfer.txHash);
      db.setKV(
        "agent_discovery:faucet:last_served",
        JSON.stringify({
          at: new Date().toISOString(),
          requester: requesterAddress,
          amountWei: amountWei.toString(),
          txHash: transfer.txHash,
        }),
      );

      const response: FaucetResponse = {
        status: "approved",
        transfer_network: `tos:${config.chainId || 0}`,
        tx_hash: transfer.txHash,
        amount: amountWei.toString(),
        cooldown_until: now + faucetConfig.cooldownSeconds,
      };
      json(res, 200, response);
    } catch (error) {
      logger.warn(
        `Faucet request failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      json(res, 400, {
        status: "rejected",
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(faucetConfig.port, faucetConfig.bindHost, () => {
      server.off("error", reject);
      resolve();
    });
  });

  const addr = server.address();
  const boundPort =
    addr && typeof addr === "object" && "port" in addr ? addr.port : faucetConfig.port;
  const actualURL = buildFaucetServerUrl({
    ...faucetConfig,
    port: boundPort,
  });
  logger.info(`Agent Discovery faucet server listening on ${actualURL}`);

  return {
    url: actualURL,
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      });
    },
  };
}
