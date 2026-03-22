import http, { type IncomingMessage, type ServerResponse } from "http";
import type { OpenFoxConfig, OpenFoxDatabase } from "../types.js";
import { createLogger } from "../observability/logger.js";
import {
  buildGatewayStatusSnapshot,
  buildCombinedServiceStatusSnapshot,
} from "../service/operator.js";
import { getManagedServiceStatus } from "../service/daemon.js";
import { buildHealthSnapshot } from "../doctor/report.js";
import {
  buildRuntimeStatusSnapshot,
} from "./status.js";
import {
  buildArtifactsOperatorStatusSnapshot,
  buildPaymasterOperatorStatusSnapshot,
  buildSignerOperatorStatusSnapshot,
  buildStorageOperatorStatusSnapshot,
} from "./components.js";
import {
  runArtifactMaintenance,
  runStorageMaintenance,
} from "./maintenance.js";
import { buildProviderReputationSnapshot } from "./provider-reputation.js";
import { buildStorageLeaseHealthSnapshot } from "./storage-health.js";
import {
  buildOperatorFinanceSnapshot,
  buildOperatorWalletSnapshot,
} from "./wallet-finance.js";
import {
  buildOperatorMarketSnapshot,
  buildOperatorPaymentsSnapshot,
  buildOperatorSettlementSnapshot,
} from "./finops.js";
import {
  applyOperatorControlAction,
  buildOperatorControlSnapshot,
} from "./control.js";
import {
  buildOperatorAutopilotSnapshot,
  createOperatorApprovalRequest,
  decideOperatorApprovalRequest,
  runOperatorAutopilot,
} from "./autopilot.js";
import { materializeApprovedOwnerOpportunityAction } from "../reports/actions.js";
import { executeOwnerOpportunityAction } from "../reports/action-execution.js";
import { getWallet } from "../identity/wallet.js";
import { createInferenceClient } from "../runtime/inference.js";
import { ModelRegistry } from "../inference/registry.js";
import {
  buildZkTlsBundleSummary,
  getZkTlsBundleRecord,
  buildProofVerificationSummary,
  getProofVerificationRecord,
} from "../proof-market/records.js";
import { createCommitteeManager } from "../committee/manager.js";
import { buildEvidenceWorkflowSummary } from "../evidence-workflow/summary.js";
import { buildOracleSummary } from "../agent-discovery/oracle-summary.js";
import {
  inspectOpenFoxSettlementRecordRuntimeBridge,
  inspectOpenFoxRuntimeReceipt,
  inspectOpenFoxSettlementEffect,
  resolveOpenFoxSettlementRuntimeRefs,
} from "../settlement/runtime.js";

const logger = createLogger("operator.api");

export interface OperatorApiServer {
  url: string;
  close(): Promise<void>;
}

export interface StartOperatorApiServerParams {
  config: OpenFoxConfig;
  db: OpenFoxDatabase;
}

function json(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Content-Length", Buffer.byteLength(payload));
  res.end(payload);
}

function normalizePathPrefix(pathPrefix: string): string {
  return pathPrefix.startsWith("/") ? pathPrefix : `/${pathPrefix}`;
}

async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  if (chunks.length === 0) return {};
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return {};
  const parsed = JSON.parse(raw);
  return typeof parsed === "object" && parsed !== null
    ? (parsed as Record<string, unknown>)
    : {};
}

function getBearerToken(req: IncomingMessage): string | undefined {
  const authHeader = req.headers.authorization;
  if (typeof authHeader === "string" && authHeader.startsWith("Bearer ")) {
    return authHeader.slice("Bearer ".length).trim();
  }
  const alt = req.headers["x-openfox-operator-token"];
  return typeof alt === "string" && alt.trim() ? alt.trim() : undefined;
}

function ensureAuthorized(
  req: IncomingMessage,
  res: ServerResponse,
  token: string | undefined,
): boolean {
  if (!token) {
    json(res, 500, {
      error: "operator API is enabled but no auth token is configured",
    });
    return false;
  }
  const provided = getBearerToken(req);
  if (provided !== token) {
    json(res, 401, { error: "unauthorized" });
    return false;
  }
  return true;
}

export async function startOperatorApiServer(
  params: StartOperatorApiServerParams,
): Promise<OperatorApiServer | null> {
  const operatorApi = params.config.operatorApi;
  if (!operatorApi?.enabled) return null;

  const pathPrefix = normalizePathPrefix(operatorApi.pathPrefix);
  const statusPath = `${pathPrefix}/status`;
  const healthPath = `${pathPrefix}/health`;
  const doctorPath = `${pathPrefix}/doctor`;
  const servicePath = `${pathPrefix}/service/status`;
  const gatewayPath = `${pathPrefix}/gateway/status`;
  const storagePath = `${pathPrefix}/storage/status`;
  const storageLeaseHealthPath = `${pathPrefix}/storage/lease-health`;
  const storageMaintainPath = `${pathPrefix}/storage/maintain`;
  const artifactsPath = `${pathPrefix}/artifacts/status`;
  const artifactsMaintainPath = `${pathPrefix}/artifacts/maintain`;
  const signerPath = `${pathPrefix}/signer/status`;
  const paymasterPath = `${pathPrefix}/paymaster/status`;
  const providersPath = `${pathPrefix}/providers/reputation`;
  const walletPath = `${pathPrefix}/wallet/status`;
  const financePath = `${pathPrefix}/finance/status`;
  const ownerReportsPath = `${pathPrefix}/owner/reports`;
  const ownerReportLatestPath = `${pathPrefix}/owner/reports/latest`;
  const ownerReportDeliveriesPath = `${pathPrefix}/owner/report-deliveries`;
  const ownerAlertsPath = `${pathPrefix}/owner/alerts`;
  const ownerActionsPath = `${pathPrefix}/owner/actions`;
  const ownerActionExecutionsPath = `${pathPrefix}/owner/action-executions`;
  const newsZkTlsPath = `${pathPrefix}/news/zktls`;
  const proofSummaryPath = `${pathPrefix}/proof/summary`;
  const committeeSummaryPath = `${pathPrefix}/committee/summary`;
  const evidenceSummaryPath = `${pathPrefix}/evidence/summary`;
  const oracleSummaryPath = `${pathPrefix}/oracle/summary`;
  const paymentsPath = `${pathPrefix}/payments/status`;
  const settlementPath = `${pathPrefix}/settlement/status`;
  const settlementBridgePath = `${pathPrefix}/settlement/bridge`;
  const settlementRuntimeReceiptPath = `${pathPrefix}/settlement/runtime-receipt`;
  const settlementRuntimeEffectPath = `${pathPrefix}/settlement/runtime-effect`;
  const marketPath = `${pathPrefix}/market/status`;
  const controlStatusPath = `${pathPrefix}/control/status`;
  const controlEventsPath = `${pathPrefix}/control/events`;
  const controlPausePath = `${pathPrefix}/control/pause`;
  const controlResumePath = `${pathPrefix}/control/resume`;
  const controlDrainPath = `${pathPrefix}/control/drain`;
  const controlRetryPaymentsPath = `${pathPrefix}/control/retry/payments`;
  const controlRetrySettlementPath = `${pathPrefix}/control/retry/settlement`;
  const controlRetryMarketPath = `${pathPrefix}/control/retry/market`;
  const controlRetrySignerPath = `${pathPrefix}/control/retry/signer`;
  const controlRetryPaymasterPath = `${pathPrefix}/control/retry/paymaster`;
  const controlMaintainStoragePath = `${pathPrefix}/control/maintain/storage`;
  const controlMaintainArtifactsPath = `${pathPrefix}/control/maintain/artifacts`;
  const controlQuarantineProviderPath = `${pathPrefix}/control/quarantine/provider`;
  const autopilotStatusPath = `${pathPrefix}/autopilot/status`;
  const autopilotRunPath = `${pathPrefix}/autopilot/run`;
  const autopilotApprovalsPath = `${pathPrefix}/autopilot/approvals`;
  const healthzPath = `${pathPrefix}/healthz`;
  const fleetReconciliationPath = `${pathPrefix}/fleet/reconciliation`;
  const fleetProviderLivenessPath = `${pathPrefix}/fleet/provider-liveness`;
  const fleetRecoverReplicationPath = `${pathPrefix}/fleet/recover/replication`;
  const fleetRecoverProviderRoutePath = `${pathPrefix}/fleet/recover/provider-route`;
  const fleetRecoverCallbackQueuePath = `${pathPrefix}/fleet/recover/callback-queue`;

  const hasInferenceConfigured = Boolean(
    params.config.openaiApiKey ||
      params.config.anthropicApiKey ||
      params.config.ollamaBaseUrl ||
      params.config.runtimeApiKey,
  );

  const createOperatorInference = () => {
    const modelRegistry = new ModelRegistry(params.db.raw);
    modelRegistry.initialize();
    return createInferenceClient({
      apiUrl: params.config.runtimeApiUrl || "",
      apiKey: params.config.runtimeApiKey,
      defaultModel:
        params.config.inferenceModelRef || params.config.inferenceModel,
      maxTokens: params.config.maxTokensPerTurn,
      lowComputeModel:
        params.config.modelStrategy?.lowComputeModel || "gpt-5-mini",
      openaiApiKey: params.config.openaiApiKey,
      anthropicApiKey: params.config.anthropicApiKey,
      ollamaBaseUrl:
        process.env.OLLAMA_BASE_URL || params.config.ollamaBaseUrl,
      getModelProvider: (modelId) => modelRegistry.get(modelId)?.provider,
    });
  };

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
      if (req.method === "GET" && url.pathname === healthzPath) {
        json(res, 200, { ok: true });
        return;
      }

      if (!ensureAuthorized(req, res, operatorApi.authToken)) {
        return;
      }

      if (req.method === "GET" && url.pathname === statusPath) {
        json(res, 200, buildRuntimeStatusSnapshot(params.config, params.db));
        return;
      }

      if (req.method === "GET" && url.pathname === healthPath) {
        json(res, 200, await buildHealthSnapshot(params.config, params.db));
        return;
      }

      if (req.method === "GET" && url.pathname === doctorPath) {
        if (!operatorApi.exposeDoctor) {
          json(res, 404, { error: "doctor endpoint disabled" });
          return;
        }
        json(res, 200, await buildHealthSnapshot(params.config, params.db));
        return;
      }

      if (req.method === "GET" && url.pathname === servicePath) {
        if (!operatorApi.exposeServiceStatus) {
          json(res, 404, { error: "service status endpoint disabled" });
          return;
        }
        json(
          res,
          200,
          buildCombinedServiceStatusSnapshot(
            getManagedServiceStatus(),
            params.config,
            params.db.raw,
          ),
        );
        return;
      }

      if (req.method === "GET" && url.pathname === gatewayPath) {
        if (!operatorApi.exposeServiceStatus) {
          json(res, 404, { error: "gateway status endpoint disabled" });
          return;
        }
        json(res, 200, await buildGatewayStatusSnapshot(params.config, params.db.raw));
        return;
      }

      if (req.method === "GET" && url.pathname === storagePath) {
        json(res, 200, await buildStorageOperatorStatusSnapshot(params.config, params.db));
        return;
      }

      if (req.method === "GET" && url.pathname === storageLeaseHealthPath) {
        const limitParam = url.searchParams.get("limit");
        const limit =
          limitParam && Number.isFinite(Number(limitParam))
            ? Number(limitParam)
            : undefined;
        json(
          res,
          200,
          buildStorageLeaseHealthSnapshot({
            config: params.config,
            db: params.db,
            limit,
          }),
        );
        return;
      }

      if (req.method === "POST" && url.pathname === storageMaintainPath) {
        const body = await readJsonBody(req);
        const limit =
          typeof body.limit === "number" && Number.isFinite(body.limit)
            ? body.limit
            : undefined;
        json(
          res,
          200,
          await runStorageMaintenance({
            config: params.config,
            db: params.db,
            limit,
          }),
        );
        return;
      }

      if (req.method === "GET" && url.pathname === artifactsPath) {
        json(res, 200, await buildArtifactsOperatorStatusSnapshot(params.config, params.db));
        return;
      }

      if (req.method === "POST" && url.pathname === artifactsMaintainPath) {
        const body = await readJsonBody(req);
        const limit =
          typeof body.limit === "number" && Number.isFinite(body.limit)
            ? body.limit
            : undefined;
        json(
          res,
          200,
          await runArtifactMaintenance({
            config: params.config,
            db: params.db,
            limit,
          }),
        );
        return;
      }

      if (req.method === "GET" && url.pathname === signerPath) {
        json(res, 200, await buildSignerOperatorStatusSnapshot(params.config, params.db));
        return;
      }

      if (req.method === "GET" && url.pathname === paymasterPath) {
        json(res, 200, await buildPaymasterOperatorStatusSnapshot(params.config, params.db));
        return;
      }

      if (req.method === "GET" && url.pathname === providersPath) {
        const kindParam = url.searchParams.get("kind");
        const kind =
          kindParam === "storage" ||
          kindParam === "artifacts" ||
          kindParam === "signer" ||
          kindParam === "paymaster"
            ? kindParam
            : undefined;
        const limitParam = url.searchParams.get("limit");
        const limit =
          limitParam && Number.isFinite(Number(limitParam))
            ? Number(limitParam)
            : undefined;
        json(
          res,
          200,
          buildProviderReputationSnapshot({
            db: params.db,
            kind,
            limit,
          }),
        );
        return;
      }

      if (req.method === "GET" && url.pathname === walletPath) {
        json(
          res,
          200,
          await buildOperatorWalletSnapshot(params.config, params.db),
        );
        return;
      }

      if (req.method === "GET" && url.pathname === financePath) {
        json(
          res,
          200,
          await buildOperatorFinanceSnapshot(params.config, params.db),
        );
        return;
      }

      if (req.method === "GET" && url.pathname === ownerReportsPath) {
        const limitParam = url.searchParams.get("limit");
        const limit =
          limitParam && Number.isFinite(Number(limitParam))
            ? Number(limitParam)
            : 20;
        const periodParam = url.searchParams.get("period");
        json(res, 200, {
          items: params.db.listOwnerReports(limit, {
            periodKind:
              periodParam === "daily" || periodParam === "weekly"
                ? periodParam
                : undefined,
          }),
        });
        return;
      }

      if (req.method === "GET" && url.pathname === ownerReportLatestPath) {
        const periodParam = url.searchParams.get("period");
        const report = params.db.getLatestOwnerReport(
          periodParam === "weekly" ? "weekly" : "daily",
        );
        if (!report) {
          json(res, 404, { error: "owner report not found" });
          return;
        }
        json(res, 200, report);
        return;
      }

      if (req.method === "GET" && url.pathname === ownerReportDeliveriesPath) {
        const limitParam = url.searchParams.get("limit");
        const limit =
          limitParam && Number.isFinite(Number(limitParam))
            ? Number(limitParam)
            : 20;
        const channelParam = url.searchParams.get("channel");
        const statusParam = url.searchParams.get("status");
        json(res, 200, {
          items: params.db.listOwnerReportDeliveries(limit, {
            channel:
              channelParam === "web" || channelParam === "email"
                ? channelParam
                : undefined,
            status:
              statusParam === "pending" ||
              statusParam === "delivered" ||
              statusParam === "failed"
                ? statusParam
                : undefined,
          }),
        });
        return;
      }

      if (req.method === "GET" && url.pathname === ownerAlertsPath) {
        const limitParam = url.searchParams.get("limit");
        const limit =
          limitParam && Number.isFinite(Number(limitParam))
            ? Number(limitParam)
            : 20;
        const statusParam = url.searchParams.get("status");
        const kindParam = url.searchParams.get("kind");
        const kind =
          kindParam === "bounty" ||
          kindParam === "campaign" ||
          kindParam === "provider"
            ? kindParam
            : undefined;
        json(res, 200, {
          items: params.db.listOwnerOpportunityAlerts(limit, {
            status:
              statusParam === "unread" ||
              statusParam === "read" ||
              statusParam === "dismissed"
                ? statusParam
                : undefined,
            kind,
          }),
        });
        return;
      }

      if (req.method === "GET" && url.pathname === ownerActionsPath) {
        const limitParam = url.searchParams.get("limit");
        const limit =
          limitParam && Number.isFinite(Number(limitParam))
            ? Number(limitParam)
            : 20;
        const statusParam = url.searchParams.get("status");
        const kindParam = url.searchParams.get("kind");
        json(res, 200, {
          items: params.db.listOwnerOpportunityActions(limit, {
            status:
              statusParam === "queued" ||
              statusParam === "completed" ||
              statusParam === "cancelled"
                ? statusParam
                : undefined,
            kind:
              kindParam === "review" ||
              kindParam === "pursue" ||
              kindParam === "delegate"
                ? kindParam
                : undefined,
          }),
        });
        return;
      }

      if (req.method === "GET" && url.pathname === ownerActionExecutionsPath) {
        const limitParam = url.searchParams.get("limit");
        const limit =
          limitParam && Number.isFinite(Number(limitParam))
            ? Number(limitParam)
            : 20;
        const statusParam = url.searchParams.get("status");
        json(res, 200, {
          items: params.db.listOwnerOpportunityActionExecutions(limit, {
            actionId: url.searchParams.get("actionId") || undefined,
            status:
              statusParam === "running" ||
              statusParam === "completed" ||
              statusParam === "failed" ||
              statusParam === "skipped"
                ? statusParam
                : undefined,
          }),
        });
        return;
      }

      if (req.method === "GET" && url.pathname === newsZkTlsPath) {
        const limitParam = url.searchParams.get("limit");
        const limit =
          limitParam && Number.isFinite(Number(limitParam))
            ? Number(limitParam)
            : 20;
        const recordId = url.searchParams.get("recordId");
        if (recordId) {
          const record = getZkTlsBundleRecord(params.db, recordId);
          if (!record) {
            json(res, 404, { error: "zkTLS bundle record not found" });
            return;
          }
          json(res, 200, record);
          return;
        }
        json(res, 200, buildZkTlsBundleSummary(params.db, limit));
        return;
      }

      if (req.method === "GET" && url.pathname === proofSummaryPath) {
        const limitParam = url.searchParams.get("limit");
        const limit =
          limitParam && Number.isFinite(Number(limitParam))
            ? Number(limitParam)
            : 20;
        const recordId = url.searchParams.get("recordId");
        if (recordId) {
          const record = getProofVerificationRecord(params.db, recordId);
          if (!record) {
            json(res, 404, { error: "proof verification record not found" });
            return;
          }
          json(res, 200, record);
          return;
        }
        json(res, 200, buildProofVerificationSummary(params.db, limit));
        return;
      }

      if (req.method === "GET" && url.pathname === committeeSummaryPath) {
        const limitParam = url.searchParams.get("limit");
        const limit =
          limitParam && Number.isFinite(Number(limitParam))
            ? Number(limitParam)
            : 20;
        const kindParam = url.searchParams.get("kind");
        const kind =
          kindParam === "evidence" || kindParam === "oracle"
            ? kindParam
            : undefined;
        json(res, 200, createCommitteeManager(params.db).buildSummary(limit, kind));
        return;
      }

      if (req.method === "GET" && url.pathname === evidenceSummaryPath) {
        const limitParam = url.searchParams.get("limit");
        const limit =
          limitParam && Number.isFinite(Number(limitParam))
            ? Number(limitParam)
            : 20;
        json(res, 200, buildEvidenceWorkflowSummary({ db: params.db, limit }));
        return;
      }

      if (req.method === "GET" && url.pathname === oracleSummaryPath) {
        const limitParam = url.searchParams.get("limit");
        const limit =
          limitParam && Number.isFinite(Number(limitParam))
            ? Number(limitParam)
            : 20;
        json(res, 200, buildOracleSummary({ db: params.db, limit }));
        return;
      }

      if (
        req.method === "POST" &&
        /^\/?.*\/owner\/actions\/[^/]+\/execute$/.test(url.pathname)
      ) {
        const match = url.pathname.match(/\/owner\/actions\/([^/]+)\/execute$/);
        const actionId = match?.[1] ? decodeURIComponent(match[1]) : undefined;
        if (!actionId) {
          json(res, 404, { error: "owner action route not found" });
          return;
        }
        if (!hasInferenceConfigured) {
          json(res, 400, {
            error: "owner action execution requires an inference provider",
          });
          return;
        }
        try {
          const { account } = await getWallet();
          const result = await executeOwnerOpportunityAction({
            identity: {
              name: params.config.name,
              address: params.config.walletAddress,
              account,
              creatorAddress: params.config.creatorAddress,
              sandboxId: params.config.sandboxId,
              apiKey: params.config.runtimeApiKey || "",
              createdAt: new Date().toISOString(),
            },
            config: params.config,
            db: params.db,
            inference: createOperatorInference(),
            actionId,
          });
          json(res, 200, result);
        } catch (error) {
          json(res, 400, {
            error: error instanceof Error ? error.message : String(error),
          });
        }
        return;
      }

      if (
        req.method === "POST" &&
        /^\/?.*\/owner\/actions\/[^/]+\/(complete|cancel)$/.test(url.pathname)
      ) {
        const match = url.pathname.match(/\/owner\/actions\/([^/]+)\/(complete|cancel)$/);
        const actionId = match?.[1] ? decodeURIComponent(match[1]) : undefined;
        const decision = match?.[2];
        if (!actionId || !decision) {
          json(res, 404, { error: "owner action route not found" });
          return;
        }
        const body = await readJsonBody(req);
        const record = params.db.updateOwnerOpportunityActionStatus(
          actionId,
          decision === "complete" ? "completed" : "cancelled",
          undefined,
          {
            kind:
              body.resultKind === "note" ||
              body.resultKind === "bounty" ||
              body.resultKind === "campaign" ||
              body.resultKind === "provider_call" ||
              body.resultKind === "artifact" ||
              body.resultKind === "report" ||
              body.resultKind === "other"
                ? body.resultKind
                : undefined,
            ref: typeof body.resultRef === "string" ? body.resultRef : undefined,
            note: typeof body.note === "string" ? body.note : undefined,
          },
        );
        if (!record) {
          json(res, 404, { error: "owner action not found" });
          return;
        }
        json(res, 200, record);
        return;
      }

      if (req.method === "GET" && url.pathname === paymentsPath) {
        json(
          res,
          200,
          await buildOperatorPaymentsSnapshot(params.config, params.db),
        );
        return;
      }

      if (req.method === "GET" && url.pathname === settlementPath) {
        json(
          res,
          200,
          await buildOperatorSettlementSnapshot(params.config, params.db),
        );
        return;
      }

      if (req.method === "GET" && url.pathname === settlementBridgePath) {
        const receiptId = url.searchParams.get("receipt_id")?.trim();
        if (!receiptId) {
          json(res, 400, { error: "missing receipt_id" });
          return;
        }
        const record = params.db.getSettlementReceiptById(receiptId);
        if (!record) {
          json(res, 404, { error: "settlement receipt not found" });
          return;
        }
        const runtimeRefs = resolveOpenFoxSettlementRuntimeRefs(record);
        let runtimeBridge: Awaited<
          ReturnType<typeof inspectOpenFoxSettlementRecordRuntimeBridge>
        > | null = null;
        let runtimeBridgeError: string | null = null;
        if ((runtimeRefs.runtimeReceiptRef || runtimeRefs.runtimeSettlementRef) && params.config.rpcUrl) {
          try {
            runtimeBridge = await inspectOpenFoxSettlementRecordRuntimeBridge({
              rpcUrl: params.config.rpcUrl,
              record,
            });
          } catch (err) {
            runtimeBridge = runtimeRefs;
            runtimeBridgeError = err instanceof Error ? err.message : String(err);
          }
        } else {
          runtimeBridge = runtimeRefs;
        }
        json(res, 200, {
          record,
          callback: params.db.getSettlementCallbackByReceiptId(record.receiptId) ?? null,
          runtimeBridge,
          runtimeBridgeError,
        });
        return;
      }

      if (req.method === "GET" && url.pathname === settlementRuntimeReceiptPath) {
        const receiptRef = url.searchParams.get("receipt_ref")?.trim();
        if (!receiptRef) {
          json(res, 400, { error: "missing receipt_ref" });
          return;
        }
        if (!params.config.rpcUrl) {
          json(res, 400, { error: "runtime settlement inspection requires rpcUrl" });
          return;
        }
        json(
          res,
          200,
          await inspectOpenFoxRuntimeReceipt({
            rpcUrl: params.config.rpcUrl,
            receiptRef: receiptRef as `0x${string}`,
          }),
        );
        return;
      }

      if (req.method === "GET" && url.pathname === settlementRuntimeEffectPath) {
        const settlementRef = url.searchParams.get("settlement_ref")?.trim();
        if (!settlementRef) {
          json(res, 400, { error: "missing settlement_ref" });
          return;
        }
        if (!params.config.rpcUrl) {
          json(res, 400, { error: "runtime settlement inspection requires rpcUrl" });
          return;
        }
        json(
          res,
          200,
          await inspectOpenFoxSettlementEffect({
            rpcUrl: params.config.rpcUrl,
            settlementRef: settlementRef as `0x${string}`,
          }),
        );
        return;
      }

      if (req.method === "GET" && url.pathname === marketPath) {
        json(
          res,
          200,
          await buildOperatorMarketSnapshot(params.config, params.db),
        );
        return;
      }

      if (req.method === "GET" && url.pathname === controlStatusPath) {
        json(res, 200, buildOperatorControlSnapshot(params.config, params.db));
        return;
      }

      if (req.method === "GET" && url.pathname === controlEventsPath) {
        const limitParam = url.searchParams.get("limit");
        const limit =
          limitParam && Number.isFinite(Number(limitParam))
            ? Number(limitParam)
            : 50;
        json(res, 200, { items: params.db.listOperatorControlEvents(limit) });
        return;
      }

      if (req.method === "GET" && url.pathname === autopilotStatusPath) {
        json(res, 200, buildOperatorAutopilotSnapshot(params.config, params.db));
        return;
      }

      if (req.method === "GET" && url.pathname === autopilotApprovalsPath) {
        const limitParam = url.searchParams.get("limit");
        const limit =
          limitParam && Number.isFinite(Number(limitParam))
            ? Number(limitParam)
            : 50;
        const statusParam = url.searchParams.get("status");
        const kindParam = url.searchParams.get("kind");
        json(res, 200, {
          items: params.db.listOperatorApprovalRequests(limit, {
            status:
              statusParam === "pending" ||
              statusParam === "approved" ||
              statusParam === "rejected" ||
              statusParam === "expired"
                ? statusParam
                : undefined,
            kind:
              kindParam === "treasury_policy_change" ||
              kindParam === "spend_cap_change" ||
              kindParam === "signer_policy_change" ||
              kindParam === "paymaster_policy_change" ||
              kindParam === "opportunity_action"
                ? kindParam
                : undefined,
          }),
        });
        return;
      }

      if (
        req.method === "POST" &&
        (url.pathname === controlPausePath ||
          url.pathname === controlResumePath ||
          url.pathname === controlDrainPath ||
          url.pathname === controlMaintainStoragePath ||
          url.pathname === controlMaintainArtifactsPath ||
          url.pathname === controlQuarantineProviderPath ||
          url.pathname === controlRetryPaymentsPath ||
          url.pathname === controlRetrySettlementPath ||
          url.pathname === controlRetryMarketPath ||
          url.pathname === controlRetrySignerPath ||
          url.pathname === controlRetryPaymasterPath)
      ) {
        const body = await readJsonBody(req);
        const action =
          url.pathname === controlPausePath
            ? "pause"
            : url.pathname === controlResumePath
              ? "resume"
              : url.pathname === controlDrainPath
                ? "drain"
                : url.pathname === controlMaintainStoragePath
                  ? "maintain_storage"
                  : url.pathname === controlMaintainArtifactsPath
                    ? "maintain_artifacts"
                    : url.pathname === controlQuarantineProviderPath
                      ? "quarantine_provider"
                : url.pathname === controlRetryPaymentsPath
                  ? "retry_payments"
                  : url.pathname === controlRetrySettlementPath
                    ? "retry_settlement"
                    : url.pathname === controlRetryMarketPath
                      ? "retry_market"
                      : url.pathname === controlRetrySignerPath
                        ? "retry_signer"
                        : "retry_paymaster";
        const result = await applyOperatorControlAction({
          config: params.config,
          db: params.db,
          action,
          actor:
            typeof body.actor === "string" && body.actor.trim()
              ? body.actor.trim()
              : "operator-api",
          reason:
            typeof body.reason === "string" && body.reason.trim()
              ? body.reason.trim()
              : undefined,
          providerKey:
            typeof body.providerKey === "string" && body.providerKey.trim()
              ? body.providerKey.trim()
              : undefined,
          providerKind:
            typeof body.providerKind === "string" && body.providerKind.trim()
              ? body.providerKind.trim()
              : undefined,
          providerAddress:
            typeof body.providerAddress === "string" && body.providerAddress.trim()
              ? body.providerAddress.trim()
              : undefined,
          providerBaseUrl:
            typeof body.providerBaseUrl === "string" && body.providerBaseUrl.trim()
              ? body.providerBaseUrl.trim()
              : undefined,
          providerScore:
            typeof body.providerScore === "number" && Number.isFinite(body.providerScore)
              ? body.providerScore
              : undefined,
          providerGrade:
            typeof body.providerGrade === "string" && body.providerGrade.trim()
              ? body.providerGrade.trim()
              : undefined,
          providerTotalEvents:
            typeof body.providerTotalEvents === "number" &&
            Number.isFinite(body.providerTotalEvents)
              ? body.providerTotalEvents
              : undefined,
          limit:
            typeof body.limit === "number" && Number.isFinite(body.limit)
              ? body.limit
              : undefined,
        });
        json(res, result.status === "failed" ? 409 : 200, result);
        return;
      }

      if (req.method === "POST" && url.pathname === autopilotRunPath) {
        const body = await readJsonBody(req);
        json(
          res,
          200,
          await runOperatorAutopilot({
            config: params.config,
            db: params.db,
            actor:
              typeof body.actor === "string" && body.actor.trim()
                ? body.actor.trim()
                : "operator-api",
            reason:
              typeof body.reason === "string" && body.reason.trim()
                ? body.reason.trim()
                : undefined,
          }),
        );
        return;
      }

      if (req.method === "POST" && url.pathname === `${autopilotApprovalsPath}/request`) {
        const body = await readJsonBody(req);
        const kind =
          body.kind === "treasury_policy_change" ||
          body.kind === "spend_cap_change" ||
          body.kind === "signer_policy_change" ||
          body.kind === "paymaster_policy_change" ||
          body.kind === "opportunity_action"
            ? body.kind
            : null;
        if (!kind || typeof body.scope !== "string" || !body.scope.trim()) {
          json(res, 400, { error: "kind and scope are required" });
          return;
        }
        json(
          res,
          200,
          createOperatorApprovalRequest({
            db: params.db,
            config: params.config,
            kind,
            scope: body.scope.trim(),
            requestedBy:
              typeof body.requestedBy === "string" && body.requestedBy.trim()
                ? body.requestedBy.trim()
                : "operator-api",
            reason:
              typeof body.reason === "string" && body.reason.trim()
                ? body.reason.trim()
                : undefined,
            payload: body.payload,
            ttlSeconds:
              typeof body.ttlSeconds === "number" && Number.isFinite(body.ttlSeconds)
                ? body.ttlSeconds
                : undefined,
          }),
        );
        return;
      }

      if (
        req.method === "POST" &&
        /^\/?.*\/autopilot\/approvals\/[^/]+\/(approve|reject)$/.test(url.pathname)
      ) {
        const match = url.pathname.match(/\/autopilot\/approvals\/([^/]+)\/(approve|reject)$/);
        if (!match) {
          json(res, 404, { error: "not found" });
          return;
        }
        const [, requestId, decision] = match;
        const body = await readJsonBody(req);
        const record = decideOperatorApprovalRequest({
          db: params.db,
          requestId,
          status: decision === "approve" ? "approved" : "rejected",
          decidedBy:
            typeof body.decidedBy === "string" && body.decidedBy.trim()
              ? body.decidedBy.trim()
              : "operator-api",
          decisionNote:
            typeof body.decisionNote === "string" && body.decisionNote.trim()
              ? body.decisionNote.trim()
              : undefined,
        });
        const actionRecord =
          decision === "approve" && record.kind === "opportunity_action"
            ? materializeApprovedOwnerOpportunityAction({
                db: params.db,
                requestId: record.requestId,
              })
            : undefined;
        json(res, 200, actionRecord ? { request: record, action: actionRecord } : record);
        return;
      }

      if (req.method === "GET" && url.pathname === fleetReconciliationPath) {
        json(res, 200, buildStorageLeaseHealthSnapshot({
          config: params.config,
          db: params.db,
        }));
        return;
      }

      if (req.method === "GET" && url.pathname === fleetProviderLivenessPath) {
        json(res, 200, buildProviderReputationSnapshot({
          db: params.db,
        }));
        return;
      }

      if (
        req.method === "POST" &&
        (url.pathname === fleetRecoverReplicationPath ||
          url.pathname === fleetRecoverProviderRoutePath ||
          url.pathname === fleetRecoverCallbackQueuePath)
      ) {
        const body = await readJsonBody(req);
        const kind =
          url.pathname === fleetRecoverReplicationPath
            ? "replication"
            : url.pathname === fleetRecoverProviderRoutePath
              ? "provider_route"
              : "callback_queue";
        const limit =
          typeof body.limit === "number" && Number.isFinite(body.limit)
            ? body.limit
            : 25;
        const actor =
          typeof body.actor === "string" && body.actor.trim()
            ? body.actor.trim()
            : "operator-api";

        if (kind === "replication") {
          const result = await runStorageMaintenance({
            config: params.config,
            db: params.db,
            limit,
          });
          json(res, 200, {
            status: result.renewed > 0 || result.audited > 0 ? "recovered" : "skipped",
            attempted: result.renewalAttempts + result.auditAttempts,
            recovered: result.renewed + result.audited,
            failed: result.renewalFailures + result.auditFailures,
            details: result,
          });
        } else if (kind === "provider_route") {
          // Provider route recovery: run artifact maintenance to re-verify degraded routes
          const result = await runArtifactMaintenance({
            config: params.config,
            db: params.db,
            limit,
          });
          json(res, 200, {
            status: result.verified > 0 || result.anchored > 0 ? "recovered" : "skipped",
            attempted: result.verifyAttempts + result.anchorAttempts,
            recovered: result.verified + result.anchored,
            failed: result.verifyFailures + result.anchorFailures,
            details: result,
          });
        } else {
          // Callback queue recovery: dispatch to the appropriate retry action
          const controlResult = await applyOperatorControlAction({
            config: params.config,
            db: params.db,
            action: "retry_settlement",
            actor,
            reason: "fleet recovery: stuck callback queue",
            limit,
          });
          json(res, 200, {
            status: controlResult.changed ? "recovered" : "skipped",
            attempted: 1,
            recovered: controlResult.changed ? 1 : 0,
            failed: controlResult.status === "failed" ? 1 : 0,
            details: controlResult,
          });
        }
        return;
      }

      json(res, 404, { error: "not found" });
    } catch (error) {
      logger.error("Operator API request failed", error instanceof Error ? error : undefined);
      json(res, 500, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(operatorApi.port, operatorApi.bindHost, () => {
      server.off("error", reject);
      resolve();
    });
  });

  const boundAddress = server.address();
  const actualPort =
    boundAddress && typeof boundAddress !== "string"
      ? boundAddress.port
      : operatorApi.port;
  const normalizedHost =
    operatorApi.bindHost === "0.0.0.0" ? "127.0.0.1" : operatorApi.bindHost;
  const baseUrl = `http://${normalizedHost}:${actualPort}${pathPrefix}`;
  logger.info(`Operator API enabled at ${baseUrl}`);

  return {
    url: baseUrl,
    async close() {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    },
  };
}
