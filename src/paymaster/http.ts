import http, { type IncomingMessage, type ServerResponse } from "http";
import { createHash, randomUUID } from "crypto";
import {
  createPublicClient,
  hashTransaction,
  http as httpTransport,
  privateKeyToAccount,
  recoverAddress,
  serializeTransaction,
  verifyHashSignature,
  type Hex,
  type Signature,
  type TransactionSerializableNative,
} from "tosdk";
import type {
  OpenFoxConfig,
  OpenFoxDatabase,
  OpenFoxIdentity,
  PaymasterAuthorizationRecord,
  PaymasterProviderConfig,
  PaymasterQuoteRecord,
} from "../types.js";
import {
  buildX402ServerRequirement,
  createX402PaymentManager,
  hashX402RequestPayload,
  type X402ServerPaymentResult,
  writeX402RequirementResponse,
  X402ServerPaymentRejectedError,
} from "../chain/x402-server.js";
import { normalizeAddress, type ChainAddress } from "../chain/address.js";
import {
  ensureRequestNotReplayed,
  normalizeNonce,
  recordRequestNonce,
  validateRequestExpiry,
} from "../agent-discovery/security.js";
import { createLogger } from "../observability/logger.js";
import { normalizeExecutionSignature } from "./client.js";
import { validatePaymasterPolicyRequest } from "./policy.js";

const logger = createLogger("paymaster.http");
const BODY_LIMIT_BYTES = 96 * 1024;

export interface PaymasterQuoteRequest {
  requester: {
    identity: {
      kind: "tos";
      value: ChainAddress;
    };
  };
  wallet_address?: ChainAddress;
  target: ChainAddress;
  value_tomi?: string;
  data?: Hex;
  gas?: string;
  reason?: string;
}

export interface PaymasterAuthorizeRequest {
  quote_id: string;
  requester: {
    identity: {
      kind: "tos";
      value: ChainAddress;
    };
  };
  wallet_address?: ChainAddress;
  request_nonce: string;
  request_expires_at: number;
  execution_nonce: string;
  target: ChainAddress;
  value_tomi?: string;
  data?: Hex;
  gas?: string;
  execution_signature: Signature | Record<string, unknown>;
  reason?: string;
}

export interface PaymasterProviderServer {
  url: string;
  close(): Promise<void>;
}

export interface StartPaymasterProviderServerParams {
  identity: OpenFoxIdentity;
  config: OpenFoxConfig;
  db: OpenFoxDatabase;
  address: ChainAddress;
  privateKey: Hex;
  paymasterConfig: PaymasterProviderConfig;
  paymentManager?: {
    requirePayment(context: {
      req: IncomingMessage;
      serviceKind: "paymaster";
      providerAddress: string;
      requestKey: string;
      requestHash: Hex;
      amountTomi: string;
      description: string;
    }): Promise<X402ServerPaymentResult>;
    bindPayment(binding: {
      paymentId: Hex;
      boundKind: string;
      boundSubjectId: string;
      artifactUrl?: string;
    }): unknown;
  } | null;
  submitSponsoredTransaction?: (params: {
    rpcUrl: string;
    privateKey: Hex;
    transaction: TransactionSerializableNative;
    executionSignature: Signature;
    timeoutMs: number;
  }) => Promise<{
    sponsorSignature: Signature;
    rawTransaction: Hex;
    txHash: Hex;
    receipt?: Record<string, unknown> | null;
  }>;
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
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

function normalizePathPrefix(pathPrefix: string): string {
  return pathPrefix.startsWith("/") ? pathPrefix : `/${pathPrefix}`;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
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

function buildQuoteId(params: {
  requesterAddress: ChainAddress;
  providerAddress: ChainAddress;
  sponsorAddress: ChainAddress;
  walletAddress: ChainAddress;
  targetAddress: ChainAddress;
  valueTomi: string;
  dataHex: Hex;
  gas: string;
  policyHash: Hex;
  sponsorNonce: string;
}): string {
  return createHash("sha256")
    .update(
      [
        params.requesterAddress.toLowerCase(),
        params.providerAddress.toLowerCase(),
        params.sponsorAddress.toLowerCase(),
        params.walletAddress.toLowerCase(),
        params.targetAddress.toLowerCase(),
        params.valueTomi,
        params.dataHex.toLowerCase(),
        params.gas,
        params.policyHash.toLowerCase(),
        params.sponsorNonce,
      ].join("|"),
    )
    .digest("hex");
}

function buildRequestKey(params: {
  requesterAddress: ChainAddress;
  capability: string;
  quoteId: string;
  nonce: string;
}): string {
  return [
    "paymaster:authorize",
    params.requesterAddress.toLowerCase(),
    params.capability.toLowerCase(),
    params.quoteId,
    params.nonce,
  ].join(":");
}

function buildRequestHash(input: Record<string, unknown>): Hex {
  return createHash("sha256")
    .update(stableStringify(input))
    .digest("hex")
    .replace(/^/, "0x") as Hex;
}

function buildReceiptHash(receipt: Record<string, unknown> | null | undefined): Hex | null {
  if (!receipt) return null;
  return createHash("sha256")
    .update(JSON.stringify(receipt))
    .digest("hex")
    .replace(/^/, "0x") as Hex;
}

type RpcSignerDescriptor = {
  type: string;
  value: string;
  defaulted: boolean;
};

function normalizeSignerType(value: string | undefined): string {
  const normalized = (value || "secp256k1").trim().toLowerCase();
  if (normalized === "ethereum_secp256k1") return "secp256k1";
  if (normalized === "bls12381") return "bls12-381";
  return normalized;
}

async function resolveSignerDescriptor(
  publicClient: ReturnType<typeof createPublicClient>,
  address: ChainAddress,
): Promise<RpcSignerDescriptor> {
  const raw = await publicClient.request<{
    signer?: { type?: string; value?: string; defaulted?: boolean };
  }>("tos_getSigner", [address, "latest"]);
  return {
    type: normalizeSignerType(raw.signer?.type),
    value: String(raw.signer?.value || ""),
    defaulted: raw.signer?.defaulted === true,
  };
}

async function verifyExecutionAuthorization(params: {
  publicClient: ReturnType<typeof createPublicClient>;
  transaction: TransactionSerializableNative;
  walletAddress: ChainAddress;
  signerType: string;
  executionSignature: Signature;
}): Promise<boolean> {
  const signerType = normalizeSignerType(params.signerType);
  if (signerType === "secp256k1") {
    const recoveredWallet = normalizeAddress(
      await recoverAddress({
        hash: hashTransaction(params.transaction),
        signature: params.executionSignature,
      }),
    );
    return recoveredWallet === params.walletAddress;
  }

  const signer = await resolveSignerDescriptor(params.publicClient, params.walletAddress);
  if (normalizeSignerType(signer.type) !== signerType || !signer.value) {
    return false;
  }
  return verifyHashSignature({
    hash: hashTransaction(params.transaction),
    publicKey: signer.value as Hex,
    signerType,
    signature: params.executionSignature,
  });
}

function buildAuthorizationResponse(params: {
  authorization: PaymasterAuthorizationRecord;
  paymentState?: X402ServerPaymentResult;
  idempotent?: boolean;
}): Record<string, unknown> {
  return {
    status:
      params.authorization.status === "failed" ||
      params.authorization.status === "rejected" ||
      params.authorization.status === "expired"
        ? "rejected"
        : params.authorization.status === "confirmed"
          ? "ok"
          : "pending",
    authorization_id: params.authorization.authorizationId,
    quote_id: params.authorization.quoteId,
    chain_id: params.authorization.chainId,
    sponsor_address: params.authorization.sponsorAddress,
    wallet_address: params.authorization.walletAddress,
    requester_address: params.authorization.requesterAddress,
    target_address: params.authorization.targetAddress,
    policy_id: params.authorization.policyId,
    policy_hash: params.authorization.policyHash,
    scope_hash: params.authorization.scopeHash,
    trust_tier: params.authorization.trustTier,
    delegate_identity: params.authorization.delegateIdentity,
    execution_nonce: params.authorization.executionNonce,
    sponsor_nonce: params.authorization.sponsorNonce,
    sponsor_expiry: params.authorization.sponsorExpiry,
    requester_signer_type: params.authorization.requesterSignerType,
    sponsor_signer_type: params.authorization.sponsorSignerType,
    tx_hash: params.authorization.submittedTxHash,
    receipt_hash: params.authorization.receiptHash,
    payment_tx_hash:
      params.paymentState?.state === "ready" || params.paymentState?.state === "pending"
        ? params.paymentState.payment.txHash
        : undefined,
    payment_status:
      params.paymentState?.state === "ready" || params.paymentState?.state === "pending"
        ? params.paymentState.payment.status
        : undefined,
    request_key: params.authorization.requestKey,
    request_hash: params.authorization.requestHash,
    idempotent: params.idempotent === true || undefined,
    last_error: params.authorization.lastError,
  };
}

async function submitSponsoredTransaction(params: {
  rpcUrl: string;
  privateKey: Hex;
  transaction: TransactionSerializableNative;
  executionSignature: Signature;
  timeoutMs: number;
}): Promise<{
  sponsorSignature: Signature;
  rawTransaction: Hex;
  txHash: Hex;
  receipt?: Record<string, unknown> | null;
}> {
  const account = privateKeyToAccount(params.privateKey);
  const sponsorSignature = await account.signAuthorization(params.transaction);
  const rawTransaction = serializeTransaction(params.transaction, {
    execution: params.executionSignature,
    sponsor: sponsorSignature,
  });
  const client = createPublicClient({
    transport: httpTransport(params.rpcUrl),
  });
  const txHash = await client.request<Hex>("tos_sendRawTransaction", [rawTransaction]);
  let receipt: Record<string, unknown> | null = null;
  try {
    receipt = (await client.waitForTransactionReceipt({
      hash: txHash,
      timeoutMs: params.timeoutMs,
      pollIntervalMs: 1000,
    })) as Record<string, unknown>;
  } catch {
    receipt = null;
  }
  return {
    sponsorSignature,
    rawTransaction,
    txHash,
    receipt,
  };
}

function validateQuoteRequest(body: PaymasterQuoteRequest): {
  requesterAddress: ChainAddress;
  walletAddress: ChainAddress;
} {
  const requesterAddress = normalizeAddress(body.requester?.identity?.value);
  return {
    requesterAddress,
    walletAddress: normalizeAddress(body.wallet_address || requesterAddress),
  };
}

export async function startPaymasterProviderServer(
  params: StartPaymasterProviderServerParams,
): Promise<PaymasterProviderServer> {
  const { config, db, address, privateKey, paymasterConfig } = params;
  const pathPrefix = normalizePathPrefix(paymasterConfig.pathPrefix);
  const quotePath = `${pathPrefix}/quote`;
  const authorizePath = `${pathPrefix}/authorize`;
  const healthzPath = `${pathPrefix}/healthz`;
  const statusPrefix = `${pathPrefix}/status/`;
  const receiptPrefix = `${pathPrefix}/receipt/`;
  const rpcUrl = config.rpcUrl || process.env.TOS_RPC_URL;
  const publicClient = rpcUrl
    ? createPublicClient({ transport: httpTransport(rpcUrl) })
    : null;
  const paymentManager =
    params.paymentManager !== undefined
      ? params.paymentManager
      : config.x402Server?.enabled && rpcUrl && BigInt(paymasterConfig.authorizePriceTomi) > 0n
        ? createX402PaymentManager({
            db,
            rpcUrl,
            config: config.x402Server,
          })
        : null;
  const submitSponsored =
    params.submitSponsoredTransaction ?? submitSponsoredTransaction;

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
      if (req.method === "GET" && url.pathname === healthzPath) {
        json(res, 200, {
          status: "ok",
          provider_address: address,
          sponsor_address: paymasterConfig.policy.sponsorAddress || address,
          rpc_url: rpcUrl || null,
          authorize_price_tomi: paymasterConfig.authorizePriceTomi,
        });
        return;
      }

      if (req.method === "GET" && url.pathname.startsWith(statusPrefix)) {
        const authorizationId = decodeURIComponent(url.pathname.slice(statusPrefix.length));
        const authorization = db.getPaymasterAuthorization(authorizationId);
        if (!authorization) {
          json(res, 404, { status: "not_found", authorization_id: authorizationId });
          return;
        }
        json(res, 200, buildAuthorizationResponse({ authorization }));
        return;
      }

      if (req.method === "GET" && url.pathname.startsWith(receiptPrefix)) {
        const authorizationId = decodeURIComponent(url.pathname.slice(receiptPrefix.length));
        const authorization = db.getPaymasterAuthorization(authorizationId);
        if (!authorization) {
          json(res, 404, { status: "not_found", authorization_id: authorizationId });
          return;
        }
        json(res, 200, {
          authorization_id: authorization.authorizationId,
          status: authorization.status,
          quote_id: authorization.quoteId,
          chain_id: authorization.chainId,
          sponsor_address: authorization.sponsorAddress,
          wallet_address: authorization.walletAddress,
          requester_address: authorization.requesterAddress,
          target_address: authorization.targetAddress,
          trust_tier: authorization.trustTier,
          execution_nonce: authorization.executionNonce,
          sponsor_nonce: authorization.sponsorNonce,
          sponsor_expiry: authorization.sponsorExpiry,
          requester_signer_type: authorization.requesterSignerType,
          sponsor_signer_type: authorization.sponsorSignerType,
          tx_hash: authorization.submittedTxHash,
          receipt: authorization.submittedReceipt,
          receipt_hash: authorization.receiptHash,
          sponsor_signature: authorization.sponsorSignature,
        });
        return;
      }

      if (req.method === "POST" && url.pathname === quotePath) {
        if (!publicClient || !rpcUrl) {
          json(res, 503, { status: "rejected", reason: "rpcUrl is required for paymaster quote" });
          return;
        }
        const body = (await readJsonBody(req)) as PaymasterQuoteRequest;
        const { requesterAddress, walletAddress } = validateQuoteRequest(body);
        const scope = validatePaymasterPolicyRequest({
          providerAddress: address,
          config: paymasterConfig,
          walletAddress,
          targetAddress: body.target,
          valueTomi: body.value_tomi || "0",
          dataHex: body.data,
          gas: body.gas,
        });
        const [chainId, sponsorNonce] = await Promise.all([
          publicClient.getChainId(),
          publicClient.getSponsorNonce({
            address: scope.sponsorAddress,
            blockTag: "latest",
          }),
        ]);
        const [requesterSigner, sponsorSigner] = await Promise.all([
          resolveSignerDescriptor(publicClient, walletAddress),
          resolveSignerDescriptor(publicClient, scope.sponsorAddress),
        ]);
        const localSponsorSignerType = normalizeSignerType(
          (params.identity.account as { signerType?: string }).signerType,
        );
        if (normalizeSignerType(sponsorSigner.type) !== localSponsorSignerType) {
          json(res, 503, {
            status: "rejected",
            reason:
              "paymaster sponsor signer metadata does not match the local provider signer",
            sponsor_signer_type: sponsorSigner.type,
            local_signer_type: localSponsorSignerType,
          });
          return;
        }
        const now = new Date();
        const expiresAt = new Date(
          now.getTime() + paymasterConfig.quoteValiditySeconds * 1000,
        ).toISOString();
        const quote: PaymasterQuoteRecord = {
          quoteId: buildQuoteId({
            requesterAddress,
            providerAddress: address,
            sponsorAddress: scope.sponsorAddress,
            walletAddress,
            targetAddress: scope.targetAddress,
            valueTomi: scope.valueTomi,
            dataHex: scope.dataHex,
            gas: scope.gas,
            policyHash: scope.policyHash,
            sponsorNonce: sponsorNonce.toString(),
          }),
          chainId: chainId.toString(),
          providerAddress: address,
          sponsorAddress: scope.sponsorAddress,
          sponsorSignerType: sponsorSigner.type,
          walletAddress,
          requesterAddress,
          requesterSignerType: requesterSigner.type,
          targetAddress: scope.targetAddress,
          valueTomi: scope.valueTomi,
          dataHex: scope.dataHex,
          gas: scope.gas,
          policyId: paymasterConfig.policy.policyId,
          policyHash: scope.policyHash,
          scopeHash: scope.scopeHash,
          delegateIdentity: paymasterConfig.policy.delegateIdentity || null,
          trustTier: paymasterConfig.policy.trustTier,
          amountTomi: paymasterConfig.authorizePriceTomi,
          sponsorNonce: sponsorNonce.toString(),
          sponsorExpiry:
            Math.floor(Date.now() / 1000) + paymasterConfig.authorizationValiditySeconds,
          status: "quoted",
          expiresAt,
          createdAt: now.toISOString(),
          updatedAt: now.toISOString(),
        };
        db.upsertPaymasterQuote(quote);
        json(res, 200, {
          status: "quoted",
          quote_id: quote.quoteId,
          chain_id: quote.chainId,
          provider_address: quote.providerAddress,
          sponsor_address: quote.sponsorAddress,
          wallet_address: quote.walletAddress,
          requester_address: quote.requesterAddress,
          target_address: quote.targetAddress,
          value_tomi: quote.valueTomi,
          data_hex: quote.dataHex,
          gas: quote.gas,
          policy_id: quote.policyId,
          policy_hash: quote.policyHash,
          scope_hash: quote.scopeHash,
          trust_tier: quote.trustTier,
          amount_tomi: quote.amountTomi,
          sponsor_nonce: quote.sponsorNonce,
          sponsor_expiry: quote.sponsorExpiry,
          requester_signer_type: quote.requesterSignerType,
          sponsor_signer_type: quote.sponsorSignerType,
          expires_at: quote.expiresAt,
          delegate_identity: quote.delegateIdentity,
        });
        return;
      }

      if (req.method === "POST" && url.pathname === authorizePath) {
        if (!publicClient || !rpcUrl) {
          json(res, 503, { status: "rejected", reason: "rpcUrl is required for paymaster authorize" });
          return;
        }
        const body = (await readJsonBody(req)) as PaymasterAuthorizeRequest;
        const quote = db.getPaymasterQuote(body.quote_id);
        if (!quote) {
          json(res, 404, { status: "not_found", reason: "quote not found", quote_id: body.quote_id });
          return;
        }
        if (quote.status === "expired" || new Date(quote.expiresAt).getTime() <= Date.now()) {
          const expiredQuote = {
            ...quote,
            status: "expired" as const,
            updatedAt: new Date().toISOString(),
          };
          db.upsertPaymasterQuote(expiredQuote);
          json(res, 409, { status: "rejected", reason: "quote has expired", quote_id: quote.quoteId });
          return;
        }
        const requesterAddress = normalizeAddress(body.requester?.identity?.value);
        const walletAddress = normalizeAddress(body.wallet_address || requesterAddress);
        if (requesterAddress !== quote.requesterAddress || walletAddress !== quote.walletAddress) {
          json(res, 400, { status: "rejected", reason: "requester or wallet does not match quote" });
          return;
        }
        if (
          normalizeAddress(body.target) !== quote.targetAddress ||
          String(body.value_tomi || "0") !== quote.valueTomi ||
          ((body.data || "0x").toLowerCase() as Hex) !== quote.dataHex ||
          String(body.gas || quote.gas) !== quote.gas
        ) {
          json(res, 400, { status: "rejected", reason: "execution fields do not match quote" });
          return;
        }
        const requestNonce = normalizeNonce(body.request_nonce);
        validateRequestExpiry(body.request_expires_at);
        const executionNonce = BigInt(body.execution_nonce);
        const requestKey = buildRequestKey({
          requesterAddress,
          capability: `${paymasterConfig.capabilityPrefix}.authorize`,
          quoteId: quote.quoteId,
          nonce: requestNonce,
        });
        const existing = db.getLatestPaymasterAuthorizationByRequestKey(requestKey);
        if (existing) {
          json(res, 200, buildAuthorizationResponse({ authorization: existing, idempotent: true }));
          return;
        }
        ensureRequestNotReplayed({
          db,
          scope: "paymaster",
          requesterIdentity: requesterAddress,
          capability: `${paymasterConfig.capabilityPrefix}.authorize`,
          nonce: requestNonce,
        });
        if (body.request_expires_at > quote.sponsorExpiry) {
          json(res, 400, {
            status: "rejected",
            reason: "request_expires_at exceeds quote sponsor_expiry",
          });
          return;
        }
        const transaction: TransactionSerializableNative = {
          chainId: BigInt(quote.chainId),
          nonce: executionNonce,
          gas: BigInt(quote.gas),
          to: quote.targetAddress,
          value: BigInt(quote.valueTomi),
          data: quote.dataHex,
          from: quote.walletAddress,
          signerType: quote.requesterSignerType,
          sponsor: quote.sponsorAddress,
          sponsorSignerType: quote.sponsorSignerType,
          sponsorNonce: BigInt(quote.sponsorNonce),
          sponsorExpiry: BigInt(quote.sponsorExpiry),
          sponsorPolicyHash: quote.policyHash,
        };
        const executionSignature = normalizeExecutionSignature(body.execution_signature);
        const validExecutionSignature = await verifyExecutionAuthorization({
          publicClient,
          transaction,
          walletAddress: quote.walletAddress,
          signerType: quote.requesterSignerType,
          executionSignature,
        });
        if (!validExecutionSignature) {
          json(res, 400, {
            status: "rejected",
            reason: "execution signature does not match wallet_address",
          });
          return;
        }
        const requestHash = buildRequestHash({
          quote_id: quote.quoteId,
          requester_address: requesterAddress,
          wallet_address: quote.walletAddress,
          target_address: quote.targetAddress,
          value_tomi: quote.valueTomi,
          data_hex: quote.dataHex,
          gas: quote.gas,
          execution_nonce: executionNonce.toString(),
          request_nonce: requestNonce,
          request_expires_at: body.request_expires_at,
          reason: body.reason || null,
          scope_hash: quote.scopeHash,
        });
        let paymentState: X402ServerPaymentResult | undefined;
        if (paymentManager && BigInt(paymasterConfig.authorizePriceTomi) > 0n) {
          paymentState = await paymentManager.requirePayment({
            req,
            serviceKind: "paymaster",
            providerAddress: address,
            requestKey,
            requestHash,
            amountTomi: paymasterConfig.authorizePriceTomi,
            description: `OpenFox paymaster authorization ${quote.quoteId}`,
          });
          if (paymentState.state === "required") {
            const requirement =
              paymentState.requirement ??
              (await buildX402ServerRequirement({
                rpcUrl,
                providerAddress: address,
                amountTomi: paymasterConfig.authorizePriceTomi,
                description: `OpenFox paymaster authorization ${quote.quoteId}`,
              }));
            writeX402RequirementResponse({ res, requirement });
            return;
          }
          if (paymentState.state === "pending") {
            throw new X402ServerPaymentRejectedError(paymentState.reason, 409);
          }
        }

        const authorizationId = randomUUID();
        const now = new Date().toISOString();
        let authorization: PaymasterAuthorizationRecord = {
          authorizationId,
          quoteId: quote.quoteId,
          chainId: quote.chainId,
          requestKey,
          requestHash,
          providerAddress: address,
          sponsorAddress: quote.sponsorAddress,
          sponsorSignerType: quote.sponsorSignerType,
          walletAddress: quote.walletAddress,
          requesterAddress,
          requesterSignerType: quote.requesterSignerType,
          targetAddress: quote.targetAddress,
          valueTomi: quote.valueTomi,
          dataHex: quote.dataHex,
          gas: quote.gas,
          policyId: quote.policyId,
          policyHash: quote.policyHash,
          scopeHash: quote.scopeHash,
          delegateIdentity: quote.delegateIdentity || null,
          trustTier: quote.trustTier,
          requestNonce,
          requestExpiresAt: body.request_expires_at,
          executionNonce: executionNonce.toString(),
          sponsorNonce: quote.sponsorNonce,
          sponsorExpiry: quote.sponsorExpiry,
          reason: body.reason || null,
          paymentId:
            paymentState?.state === "ready" ? paymentState.payment.paymentId : null,
          executionSignature,
          sponsorSignature: null,
          submittedTxHash: null,
          submittedReceipt: null,
          receiptHash: null,
          status: "authorized",
          lastError: null,
          createdAt: now,
          updatedAt: now,
        };
        db.upsertPaymasterAuthorization(authorization);

        try {
          const submission = await submitSponsored({
            rpcUrl,
            privateKey,
            transaction,
            executionSignature,
            timeoutMs: paymasterConfig.requestTimeoutMs,
          });
          authorization = {
            ...authorization,
            sponsorSignature: submission.sponsorSignature,
            submittedTxHash: submission.txHash,
            submittedReceipt: submission.receipt || null,
            receiptHash: buildReceiptHash(submission.receipt),
            status: submission.receipt ? "confirmed" : "submitted",
            updatedAt: new Date().toISOString(),
          };
          db.upsertPaymasterAuthorization(authorization);
          db.upsertPaymasterQuote({
            ...quote,
            status: "used",
            updatedAt: new Date().toISOString(),
          });
          recordRequestNonce({
            db,
            scope: "paymaster",
            requesterIdentity: requesterAddress,
            capability: `${paymasterConfig.capabilityPrefix}.authorize`,
            nonce: requestNonce,
            expiresAt: body.request_expires_at,
          });
          if (paymentState?.state === "ready") {
            paymentManager?.bindPayment({
              paymentId: paymentState.payment.paymentId,
              boundKind: "paymaster_authorization",
              boundSubjectId: authorization.authorizationId,
            });
          }
          json(res, 200, buildAuthorizationResponse({ authorization, paymentState }));
          return;
        } catch (error) {
          authorization = {
            ...authorization,
            status: "failed",
            lastError: error instanceof Error ? error.message : String(error),
            updatedAt: new Date().toISOString(),
          };
          db.upsertPaymasterAuthorization(authorization);
          throw error;
        }
      }

      json(res, 404, { status: "not_found" });
    } catch (error) {
      if (error instanceof X402ServerPaymentRejectedError) {
        json(res, error.statusCode, { status: "rejected", reason: error.message });
        return;
      }
      logger.warn(
        `Paymaster provider request failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      json(res, 400, {
        status: "rejected",
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  });

  await new Promise<void>((resolve) => {
    server.listen(paymasterConfig.port, paymasterConfig.bindHost, () => resolve());
  });
  const listener = server.address();
  if (!listener || typeof listener === "string") {
    throw new Error("failed to start paymaster provider server");
  }
  const host = paymasterConfig.bindHost === "0.0.0.0" ? "127.0.0.1" : paymasterConfig.bindHost;
  return {
    url: `http://${host}:${listener.port}${pathPrefix}`,
    async close() {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      });
    },
  };
}
