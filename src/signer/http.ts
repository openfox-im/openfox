import http, { type IncomingMessage, type ServerResponse } from "http";
import { createHash, randomUUID } from "crypto";
import type { Hex } from "@tosnetwork/tosdk";
import type {
  OpenFoxConfig,
  OpenFoxDatabase,
  OpenFoxIdentity,
  SignerExecutionRecord,
  SignerProviderConfig,
  SignerQuoteRecord,
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
import { sendNativeTransfer, type SignedTransaction } from "../chain/client.js";
import {
  ensureRequestNotReplayed,
  normalizeNonce,
  recordRequestNonce,
  validateRequestExpiry,
} from "../agent-discovery/security.js";
import { createLogger } from "../observability/logger.js";
import { validateSignerPolicyRequest } from "./policy.js";

const logger = createLogger("signer.http");
const BODY_LIMIT_BYTES = 64 * 1024;

export interface SignerQuoteRequest {
  requester: {
    identity: {
      kind: "tos";
      value: ChainAddress;
    };
  };
  target: ChainAddress;
  value_tomi?: string;
  data?: Hex;
  gas?: string;
  reason?: string;
}

export interface SignerExecutionSubmitRequest {
  quote_id: string;
  requester: {
    identity: {
      kind: "tos";
      value: ChainAddress;
    };
  };
  request_nonce: string;
  request_expires_at: number;
  target: ChainAddress;
  value_tomi?: string;
  data?: Hex;
  gas?: string;
  reason?: string;
}

export interface SignerProviderServer {
  url: string;
  close(): Promise<void>;
}

export interface StartSignerProviderServerParams {
  identity: OpenFoxIdentity;
  config: OpenFoxConfig;
  db: OpenFoxDatabase;
  address: ChainAddress;
  privateKey: Hex;
  signerConfig: SignerProviderConfig;
  paymentManager?: {
    requirePayment(context: {
      req: IncomingMessage;
      serviceKind: "signer";
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
  sendTransaction?: (params: {
    rpcUrl: string;
    privateKey: Hex;
    to: ChainAddress;
    amountTomi: bigint;
    gas?: bigint;
    data?: Hex;
    waitForReceipt?: boolean;
    receiptTimeoutMs?: number;
    pollIntervalMs?: number;
  }) => Promise<{
    signed: SignedTransaction;
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

function buildQuoteId(params: {
  requesterAddress: ChainAddress;
  providerAddress: ChainAddress;
  walletAddress: ChainAddress;
  targetAddress: ChainAddress;
  valueTomi: string;
  dataHex: Hex;
  gas: string;
  policyHash: Hex;
}): string {
  return createHash("sha256")
    .update(
      [
        params.requesterAddress.toLowerCase(),
        params.providerAddress.toLowerCase(),
        params.walletAddress.toLowerCase(),
        params.targetAddress.toLowerCase(),
        params.valueTomi,
        params.dataHex.toLowerCase(),
        params.gas,
        params.policyHash.toLowerCase(),
      ].join("|"),
    )
    .digest("hex");
}

function buildSignerRequestKey(params: {
  requesterAddress: ChainAddress;
  capability: string;
  quoteId: string;
  nonce: string;
}): string {
  return [
    "signer:submit",
    params.requesterAddress.toLowerCase(),
    params.capability.toLowerCase(),
    params.quoteId,
    params.nonce,
  ].join(":");
}

function buildReceiptHash(receipt: Record<string, unknown> | null | undefined): Hex | null {
  if (!receipt) return null;
  return createHash("sha256")
    .update(JSON.stringify(receipt))
    .digest("hex")
    .replace(/^/, "0x") as Hex;
}

function buildExecutionResponse(params: {
  execution: SignerExecutionRecord;
  paymentState?: X402ServerPaymentResult;
  idempotent?: boolean;
}): Record<string, unknown> {
  return {
    status:
      params.execution.status === "failed" || params.execution.status === "rejected"
        ? "rejected"
        : params.execution.status === "confirmed"
          ? "ok"
          : "pending",
    execution_id: params.execution.executionId,
    quote_id: params.execution.quoteId,
    tx_hash: params.execution.submittedTxHash,
    receipt_hash: params.execution.receiptHash,
    payment_tx_hash:
      params.paymentState?.state === "ready" || params.paymentState?.state === "pending"
        ? params.paymentState.payment.txHash
        : undefined,
    payment_status:
      params.paymentState?.state === "ready" || params.paymentState?.state === "pending"
        ? params.paymentState.payment.status
        : undefined,
    policy_id: params.execution.policyId,
    policy_hash: params.execution.policyHash,
    scope_hash: params.execution.scopeHash,
    request_key: params.execution.requestKey,
    request_hash: params.execution.requestHash,
    idempotent: params.idempotent === true || undefined,
    last_error: params.execution.lastError,
  };
}

function validateQuoteRequest(body: SignerQuoteRequest): {
  requesterAddress: ChainAddress;
} {
  const requesterAddress = normalizeAddress(body.requester?.identity?.value);
  return { requesterAddress };
}

export async function startSignerProviderServer(
  params: StartSignerProviderServerParams,
): Promise<SignerProviderServer> {
  const {
    config,
    db,
    address,
    privateKey,
    signerConfig,
  } = params;
  const pathPrefix = normalizePathPrefix(signerConfig.pathPrefix);
  const quotePath = `${pathPrefix}/quote`;
  const submitPath = `${pathPrefix}/submit`;
  const healthzPath = `${pathPrefix}/healthz`;
  const statusPrefix = `${pathPrefix}/status/`;
  const receiptPrefix = `${pathPrefix}/receipt/`;
  const rpcUrl = config.rpcUrl || process.env.TOS_RPC_URL;
  const paymentManager =
    params.paymentManager !== undefined
      ? params.paymentManager
      : config.x402Server?.enabled && rpcUrl && BigInt(signerConfig.submitPriceTomi) > 0n
        ? createX402PaymentManager({
            db,
            rpcUrl,
            config: config.x402Server,
          })
        : null;
  const sendTransaction = params.sendTransaction ?? sendNativeTransfer;

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
      if (req.method === "GET" && url.pathname === healthzPath) {
        json(res, 200, {
          ok: true,
          provider_address: address,
          wallet_address: signerConfig.policy.walletAddress || address,
          trust_tier: signerConfig.policy.trustTier,
          capability_prefix: signerConfig.capabilityPrefix,
        });
        return;
      }

      if (req.method === "GET" && url.pathname.startsWith(statusPrefix)) {
        const executionId = decodeURIComponent(url.pathname.slice(statusPrefix.length));
        const record = db.getSignerExecution(executionId);
        if (!record) {
          json(res, 404, { error: "execution not found" });
          return;
        }
        json(res, 200, record);
        return;
      }

      if (req.method === "GET" && url.pathname.startsWith(receiptPrefix)) {
        const executionId = decodeURIComponent(url.pathname.slice(receiptPrefix.length));
        const record = db.getSignerExecution(executionId);
        if (!record) {
          json(res, 404, { error: "execution not found" });
          return;
        }
        json(res, 200, {
          execution_id: record.executionId,
          tx_hash: record.submittedTxHash,
          receipt_hash: record.receiptHash,
          receipt: record.submittedReceipt,
          status: record.status,
        });
        return;
      }

      if (req.method === "HEAD" && url.pathname === submitPath) {
        if (!rpcUrl || BigInt(signerConfig.submitPriceTomi) <= 0n) {
          res.statusCode = 204;
          res.end();
          return;
        }
        const requirement = await buildX402ServerRequirement({
          rpcUrl,
          chainId: config.chainId,
          providerAddress: address,
          amountTomi: signerConfig.submitPriceTomi,
          description: "OpenFox signer.submit payment",
        });
        writeX402RequirementResponse({ res, requirement });
        return;
      }

      if (req.method === "POST" && url.pathname === quotePath) {
        const body = (await readJsonBody(req)) as SignerQuoteRequest;
        const { requesterAddress } = validateQuoteRequest(body);
        const validated = validateSignerPolicyRequest({
          providerAddress: address,
          config: signerConfig,
          targetAddress: body.target,
          valueTomi: body.value_tomi || "0",
          dataHex: body.data,
          gas: body.gas,
        });
        const nowIso = new Date().toISOString();
        const quoteId = buildQuoteId({
          requesterAddress,
          providerAddress: address,
          walletAddress: validated.walletAddress,
          targetAddress: validated.targetAddress,
          valueTomi: validated.valueTomi,
          dataHex: validated.dataHex,
          gas: validated.gas,
          policyHash: validated.policyHash,
        });
        const expiresAt = new Date(
          Date.now() + signerConfig.quoteValiditySeconds * 1000,
        ).toISOString();
        const record: SignerQuoteRecord = {
          quoteId,
          providerAddress: address,
          walletAddress: validated.walletAddress,
          requesterAddress,
          targetAddress: validated.targetAddress,
          valueTomi: validated.valueTomi,
          dataHex: validated.dataHex,
          gas: validated.gas,
          policyId: signerConfig.policy.policyId,
          policyHash: validated.policyHash,
          scopeHash: validated.scopeHash,
          delegateIdentity: signerConfig.policy.delegateIdentity ?? null,
          trustTier: signerConfig.policy.trustTier,
          amountTomi: signerConfig.submitPriceTomi,
          status: "quoted",
          expiresAt,
          createdAt: nowIso,
          updatedAt: nowIso,
        };
        db.upsertSignerQuote(record);
        json(res, 200, {
          quote_id: record.quoteId,
          provider_address: record.providerAddress,
          wallet_address: record.walletAddress,
          requester_address: record.requesterAddress,
          target_address: record.targetAddress,
          value_tomi: record.valueTomi,
          data_hex: record.dataHex,
          gas: record.gas,
          policy_id: record.policyId,
          policy_hash: record.policyHash,
          scope_hash: record.scopeHash,
          trust_tier: record.trustTier,
          amount_tomi: record.amountTomi,
          expires_at: record.expiresAt,
        });
        return;
      }

      if (req.method !== "POST" || url.pathname !== submitPath) {
        json(res, 404, { error: "not found" });
        return;
      }

      const body = (await readJsonBody(req)) as SignerExecutionSubmitRequest;
      const quote = db.getSignerQuote(body.quote_id);
      if (!quote) {
        json(res, 404, { error: "quote not found" });
        return;
      }
      if (new Date(quote.expiresAt).getTime() <= Date.now()) {
        db.upsertSignerQuote({ ...quote, status: "expired", updatedAt: new Date().toISOString() });
        json(res, 409, { status: "rejected", reason: "quote has expired" });
        return;
      }

      const requesterAddress = normalizeAddress(body.requester?.identity?.value);
      if (requesterAddress !== quote.requesterAddress) {
        json(res, 403, { status: "rejected", reason: "requester does not match quote" });
        return;
      }
      validateRequestExpiry(body.request_expires_at);
      const requestNonce = normalizeNonce(body.request_nonce);
      const validated = validateSignerPolicyRequest({
        providerAddress: address,
        config: signerConfig,
        targetAddress: body.target,
        valueTomi: body.value_tomi || "0",
        dataHex: body.data,
        gas: body.gas,
      });
      if (
        validated.targetAddress !== quote.targetAddress ||
        validated.valueTomi !== quote.valueTomi ||
        validated.dataHex !== quote.dataHex ||
        validated.gas !== quote.gas ||
        validated.policyHash !== quote.policyHash
      ) {
        json(res, 409, {
          status: "rejected",
          reason: "execution payload does not match quoted signer policy",
        });
        return;
      }

      const requestKey = buildSignerRequestKey({
        requesterAddress,
        capability: `${signerConfig.capabilityPrefix}.submit`,
        quoteId: quote.quoteId,
        nonce: requestNonce,
      });
      const requestHash = hashX402RequestPayload({
        quote_id: quote.quoteId,
        requester_address: requesterAddress.toLowerCase(),
        wallet_address: quote.walletAddress.toLowerCase(),
        target_address: validated.targetAddress.toLowerCase(),
        value_tomi: validated.valueTomi,
        data_hex: validated.dataHex.toLowerCase(),
        gas: validated.gas,
        reason: body.reason ?? "",
      });

      const existing = db.getLatestSignerExecutionByRequestKey(requestKey);
      if (existing) {
        if (existing.requestHash !== requestHash) {
          json(res, 409, {
            status: "rejected",
            reason: "request nonce is already bound to a different signer payload",
          });
          return;
        }
        const payment =
          existing.paymentId && paymentManager
            ? { state: "ready", payment: db.getX402Payment(existing.paymentId)! }
            : undefined;
        json(res, 200, buildExecutionResponse({ execution: existing, paymentState: payment as any, idempotent: true }));
        return;
      }

      if (quote.status === "used") {
        json(res, 409, { status: "rejected", reason: "quote has already been used" });
        return;
      }

      ensureRequestNotReplayed({
        db,
        scope: "signer",
        requesterIdentity: requesterAddress,
        capability: `${signerConfig.capabilityPrefix}.submit`,
        nonce: requestNonce,
      });

      let paymentState: X402ServerPaymentResult | undefined;
      if (paymentManager && BigInt(signerConfig.submitPriceTomi) > 0n) {
        paymentState = await paymentManager.requirePayment({
          req,
          serviceKind: "signer",
          providerAddress: address,
          requestKey,
          requestHash,
          amountTomi: signerConfig.submitPriceTomi,
          description: "OpenFox signer.submit payment",
        });
        if (paymentState.state === "required") {
          writeX402RequirementResponse({ res, requirement: paymentState.requirement });
          return;
        }
        if (paymentState.state === "pending") {
          json(res, 202, {
            status: "pending",
            reason: paymentState.reason,
            payment_tx_hash: paymentState.payment.txHash,
            payment_status: paymentState.payment.status,
          });
          return;
        }
      }

      if (!rpcUrl) {
        throw new Error("Chain RPC is required to execute signer submissions");
      }

      const sent = await sendTransaction({
        rpcUrl,
        privateKey,
        to: validated.targetAddress,
        amountTomi: BigInt(validated.valueTomi),
        gas: BigInt(validated.gas),
        data: validated.dataHex,
        waitForReceipt: config.x402Server?.confirmationPolicy === "receipt",
        receiptTimeoutMs: config.x402Server?.receiptTimeoutMs,
        pollIntervalMs: config.x402Server?.receiptPollIntervalMs,
      });
      const nowIso = new Date().toISOString();
      const executionId = randomUUID();
      const record: SignerExecutionRecord = {
        executionId,
        quoteId: quote.quoteId,
        requestKey,
        requestHash,
        providerAddress: address,
        walletAddress: quote.walletAddress,
        requesterAddress,
        targetAddress: validated.targetAddress,
        valueTomi: validated.valueTomi,
        dataHex: validated.dataHex,
        gas: validated.gas,
        policyId: quote.policyId,
        policyHash: quote.policyHash,
        scopeHash: quote.scopeHash,
        delegateIdentity: quote.delegateIdentity ?? null,
        trustTier: quote.trustTier,
        requestNonce,
        requestExpiresAt: body.request_expires_at,
        reason: body.reason ?? null,
        paymentId:
          paymentState?.state === "ready" ? paymentState.payment.paymentId : null,
        submittedTxHash: sent.txHash,
        submittedReceipt: sent.receipt ?? null,
        receiptHash: buildReceiptHash(sent.receipt),
        status: sent.receipt ? "confirmed" : "submitted",
        lastError: null,
        createdAt: nowIso,
        updatedAt: nowIso,
      };
      db.upsertSignerExecution(record);
      db.upsertSignerQuote({ ...quote, status: "used", updatedAt: nowIso });
      recordRequestNonce({
        db,
        scope: "signer",
        requesterIdentity: requesterAddress,
        capability: `${signerConfig.capabilityPrefix}.submit`,
        nonce: requestNonce,
        expiresAt: body.request_expires_at,
      });
      if (paymentState?.state === "ready") {
        paymentManager?.bindPayment({
          paymentId: paymentState.payment.paymentId,
          boundKind: "signer_execution",
          boundSubjectId: record.executionId,
        });
      }
      json(res, 200, buildExecutionResponse({ execution: record, paymentState }));
    } catch (error) {
      logger.warn(
        `Signer provider request failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      const statusCode =
        error instanceof X402ServerPaymentRejectedError ? error.statusCode : 400;
      json(res, statusCode, {
        status: "rejected",
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(signerConfig.port, signerConfig.bindHost, () => {
      server.off("error", reject);
      resolve();
    });
  });

  const bound = server.address();
  if (!bound || typeof bound === "string") {
    throw new Error("failed to bind signer provider server");
  }
  const host = signerConfig.bindHost === "0.0.0.0" ? "127.0.0.1" : signerConfig.bindHost;
  const baseUrl = `http://${host}:${bound.port}${pathPrefix}`;
  return {
    url: baseUrl,
    async close() {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    },
  };
}
