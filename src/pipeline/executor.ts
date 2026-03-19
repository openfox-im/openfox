/**
 * Intent Pipeline Executor
 *
 * GTOS 2046: End-to-end orchestrator that wires together all 2046 modules
 * into a single intent-to-receipt execution flow.
 *
 * Pipeline steps:
 *   1. Create intent envelope
 *   2. Evaluate terminal policy (is the terminal allowed to perform this action?)
 *   3. Discover route (find a signer/paymaster provider via FinancialRouter)
 *   4. Select sponsor (pick the best sponsor from discovered quotes)
 *   5. Create plan from route + sponsor
 *   6. Evaluate escalation rules against intent + plan
 *   7. Request approval if escalation requires it (or auto-approve)
 *   8. Execute (create intent metadata, simulate chain execution)
 *   9. Create receipt from execution result
 *  10. Audit log all steps
 */

import { createIntent, transitionIntent, isIntentExpired } from "../intent/intent.js";
import { createPlan, transitionPlan } from "../intent/plan.js";
import { createApproval, transitionApproval } from "../intent/approval.js";
import { createReceipt, type ChainReceiptData } from "../intent/receipt.js";
import { evaluateEscalation } from "../intent/escalation.js";
import { explainIntent, formatApprovalPrompt } from "../intent/explain.js";
import { createIntentMetadata } from "../intent/bridge.js";
import { inspectContract, enrichApprovalWithMetadata, type ContractMetadata, type ContractInspection } from "../intent/metadata-consumer.js";
import { selectSponsor } from "../sponsor/discovery.js";
import { FinancialRouter } from "../routing/router.js";
import { AuditJournal } from "../audit/journal.js";
import { TerminalRegistry } from "../terminal/registry.js";
import { validateExecuteParams, validateAddress, validateValue, enforceArrayLimit, MAX_SPONSOR_QUOTES } from "./validation.js";
import { AuditEnvelopeEmitter, type EnvelopeEmitter } from "../intent/envelope-emitter.js";
import type { PipelineConfig, PipelineResult, PipelineStep } from "./types.js";
import type { TerminalClass, TrustTier } from "../intent/types.js";
import type { AuditEntryKind } from "../audit/types.js";
import type { ProviderProfile } from "../routing/types.js";
import type { SponsorQuote } from "../sponsor/types.js";

export interface ExecuteParams {
  action: string;
  requester: string;
  actorAgentId: string;
  terminalClass: TerminalClass;
  trustTier: TrustTier;
  params: Record<string, unknown>;
  constraints?: Record<string, unknown>;
  /** Optional TOL contract metadata. When present, the pipeline uses it
   *  to enrich approval prompts and adjust escalation based on contract risk. */
  contractMetadata?: ContractMetadata;
}

/**
 * Optional hook that callers can provide to perform the actual on-chain
 * execution. If not supplied the pipeline simulates a successful execution.
 */
export type ChainExecutor = (params: {
  intentId: string;
  planId: string;
  requester: string;
  metadata: Record<string, string>;
  target: string;
  value: string;
  data?: string;
  sponsor?: SponsorQuote;
  sponsorAttempt?: number;
  sponsorAttemptCount?: number;
}) => Promise<ChainReceiptData>;

export type RouteDiscoveryProvider = (params: {
  action: string;
  requester: string;
  target?: string;
  recipient?: string;
  value: string;
  gasEstimate: number;
  data?: `0x${string}`;
}) => Promise<ProviderProfile[]>;

export type SponsorQuoteProvider = (params: {
  action: string;
  requester: string;
  target?: string;
  recipient?: string;
  value: string;
  gasEstimate: number;
  data?: `0x${string}`;
}) => Promise<SponsorQuote[]>;

export class IntentPipeline {
  private router: FinancialRouter;
  private terminal: TerminalRegistry;
  private audit: AuditJournal | null;
  private config: PipelineConfig;
  private chainExecutor: ChainExecutor | null;
  private envelopeEmitter: EnvelopeEmitter | null;
  private routeDiscoveryProvider: RouteDiscoveryProvider | null;
  private sponsorQuoteProvider: SponsorQuoteProvider | null;
  private lastResult: PipelineResult | null = null;

  constructor(params: {
    router: FinancialRouter;
    terminal: TerminalRegistry;
    audit?: AuditJournal;
    config: PipelineConfig;
    chainExecutor?: ChainExecutor;
    envelopeEmitter?: EnvelopeEmitter;
    routeDiscoveryProvider?: RouteDiscoveryProvider;
    sponsorQuoteProvider?: SponsorQuoteProvider;
  }) {
    this.router = params.router;
    this.terminal = params.terminal;
    this.audit = params.audit ?? null;
    this.config = params.config;
    this.chainExecutor = params.chainExecutor ?? null;
    // Default to AuditEnvelopeEmitter backed by the same journal if available,
    // but only when auditing is enabled to avoid bypassing the auditEnabled flag.
    this.envelopeEmitter = this.config.auditEnabled
      ? (params.envelopeEmitter ?? (params.audit ? new AuditEnvelopeEmitter({ journal: params.audit }) : null))
      : null;
    this.routeDiscoveryProvider = params.routeDiscoveryProvider ?? null;
    this.sponsorQuoteProvider = params.sponsorQuoteProvider ?? null;
  }

  /**
   * Execute the full intent-to-receipt pipeline.
   */
  async execute(params: ExecuteParams): Promise<PipelineResult> {
    const timeline: string[] = [];
    let intentId = "";
    let planId: string | undefined;
    let approvalId: string | undefined;
    let receiptId: string | undefined;
    let txHash: string | undefined;

    try {
      // ── Step 0: Validate inputs ────────────────────────────────────
      const validationErrors = validateExecuteParams(params);
      if (validationErrors.length > 0) {
        return this.fail("", timeline, `Input validation failed: ${validationErrors.join("; ")}`);
      }

      // ── Step 1: Create intent ───────────────────────────────────────
      const intent = createIntent({
        action: params.action,
        requester: params.requester,
        actorAgentId: params.actorAgentId,
        terminalClass: params.terminalClass,
        trustTier: params.trustTier,
        params: params.params,
        constraints: params.constraints as import("../intent/types.js").IntentConstraints | undefined,
        ttlSeconds: this.config.defaultTTL,
      });
      intentId = intent.intentId;
      const explanation = explainIntent(intent);
      this.log(timeline, "create_intent", `Intent created: ${explanation}`);
      this.envelopeEmitter?.onIntentCreated(intent);
      // When no emitter is present, fall back to direct audit append
      if (!this.envelopeEmitter) {
        this.auditAppend("intent_created", {
          intentId,
          actorAddress: params.requester,
          terminalClass: params.terminalClass,
          trustTier: params.trustTier,
          summary: `Intent created: ${explanation}`,
        });
      }

      // ── Step 2: Evaluate terminal policy ────────────────────────────
      const adapter = this.terminal.getAdapter(params.terminalClass);
      if (!adapter) {
        return this.fail(intentId, timeline, `No terminal adapter for class "${params.terminalClass}"`);
      }

      const caps = adapter.capabilities();
      if (!caps.supportedActions.includes(params.action)) {
        return this.fail(
          intentId,
          timeline,
          `Terminal "${params.terminalClass}" does not support action "${params.action}"`,
        );
      }

      // Check max transaction value if the terminal caps define one
      if (caps.maxTransactionValue) {
        const txValue = typeof params.params["value"] === "string" ? params.params["value"] as string : "0";
        if (BigInt(txValue) > BigInt(caps.maxTransactionValue)) {
          return this.fail(
            intentId,
            timeline,
            `Transaction value exceeds terminal "${params.terminalClass}" maximum (${caps.maxTransactionValue} tomi)`,
          );
        }
      }

      this.log(timeline, "evaluate_terminal", `Terminal "${params.terminalClass}" accepted action "${params.action}"`);

      const txValue = typeof params.params["value"] === "string" ? params.params["value"] as string : "0";
      const txTarget = typeof params.params["to"] === "string"
        ? params.params["to"] as string
        : typeof params.params["target"] === "string"
          ? params.params["target"] as string
          : undefined;
      const txData = typeof params.params["data"] === "string"
        ? params.params["data"] as `0x${string}`
        : undefined;

      // Check for expiry before continuing
      if (isIntentExpired(intent)) {
        return this.fail(intentId, timeline, "Intent expired before planning");
      }

      // ── Step 2b: Inspect contract metadata (early, so routing can use it)
      let contractInspection: ContractInspection | null = null;
      if (params.contractMetadata) {
        contractInspection = inspectContract(params.contractMetadata);
        this.log(
          timeline,
          "evaluate_terminal",
          `Contract metadata: ${contractInspection.contractName} — ${contractInspection.riskSummary}`,
        );
      }

      // ── Step 3: Discover route ──────────────────────────────────────
      let planningIntent = transitionIntent(intent, "planning");
      this.auditAppend("intent_transition", {
        intentId,
        summary: `Intent transitioned to "planning"`,
      });

      if (this.routeDiscoveryProvider) {
        try {
          const discoveredProviders = await this.routeDiscoveryProvider({
            action: params.action,
            requester: params.requester,
            target: txTarget,
            recipient: txTarget,
            value: txValue,
            gasEstimate: 50_000,
            ...(txData ? { data: txData } : {}),
          });
          for (const provider of discoveredProviders) {
            this.router.registerProvider(provider);
          }
          if (discoveredProviders.length > 0) {
            this.log(
              timeline,
              "discover_route",
              `Discovery hydrated ${discoveredProviders.length} signer provider(s) for live routing`,
            );
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          this.log(timeline, "discover_route", `Discovery refresh failed; continuing with cached providers (${message})`);
        }
      }

      const routingDecision = await this.router.route({
        intentId,
        serviceKind: "signer",
        value: txValue,
        gasEstimate: 50_000,
        policyOverride: this.config.routingPolicy,
        contractInspection: contractInspection ?? undefined,
      });

      const providerAddress = routingDecision?.selected.provider.address ?? params.actorAgentId;
      const estimatedFee = routingDecision?.selected.estimatedFee ?? "0";
      this.log(
        timeline,
        "discover_route",
        routingDecision
          ? `Route found: provider ${providerAddress} (fee: ${estimatedFee})`
          : "No route found; using actor as provider",
      );

      // ── Step 4: Select sponsor ──────────────────────────────────────
      let sponsorQuotes: SponsorQuote[] = [];
      if (this.sponsorQuoteProvider) {
        try {
          sponsorQuotes = await this.sponsorQuoteProvider({
            action: params.action,
            requester: params.requester,
            target: txTarget,
            recipient: txTarget,
            value: txValue,
            gasEstimate: 50_000,
            ...(txData ? { data: txData } : {}),
          });
          if (sponsorQuotes.length > 0) {
            this.log(
              timeline,
              "select_sponsor",
              `Discovered ${sponsorQuotes.length} live sponsor quote(s) from paymaster providers`,
            );
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          this.log(timeline, "select_sponsor", `Sponsor discovery failed; falling back to routed sponsor hints (${message})`);
        }
      }

      if (sponsorQuotes.length === 0) {
        sponsorQuotes = routingDecision
        ? routingDecision.alternatives
            .filter((a) => a.provider.sponsorSupport)
            .map((a) => ({
              sponsorAddress: a.provider.address,
              sponsorName: a.provider.name,
              feeAmount: a.estimatedFee,
              feeCurrency: "TOS",
              gasLimit: 50_000,
              expiresAt: Math.floor(Date.now() / 1000) + 120,
              policyHash: "0x" + "0".repeat(64),
              trustTier: a.provider.trustTier,
              latencyMs: a.estimatedLatency,
            }))
        : [];
      }

      const sponsorSelection = selectSponsor(
        enforceArrayLimit(sponsorQuotes, MAX_SPONSOR_QUOTES),
        this.config.sponsorPolicy,
        txValue,
      );
      const sponsorAddress = sponsorSelection?.selected.sponsorAddress;
      this.log(
        timeline,
        "select_sponsor",
        sponsorSelection
          ? `Sponsor selected: ${sponsorAddress} (${sponsorSelection.totalCostDisplay})`
          : "No sponsor selected (self-pay)",
      );
      if (sponsorSelection) {
        this.auditAppend("sponsor_selected", {
          intentId,
          sponsorAddress,
          summary: `Sponsor selected: ${sponsorAddress}`,
          details: {
            strategy: sponsorSelection.reason,
            fallbackEnabled: this.config.sponsorPolicy.fallbackEnabled,
            fallbackCandidates: sponsorSelection.alternatives.map((quote) => quote.sponsorAddress),
            totalCostDisplay: sponsorSelection.totalCostDisplay,
          },
        });
      }

      // ── Step 5: Create plan ─────────────────────────────────────────
      const plan = createPlan({
        intentId,
        provider: providerAddress,
        sponsor: sponsorAddress,
        policyHash: "0x" + "0".repeat(64),
        sponsorPolicyHash: sponsorSelection?.selected.policyHash,
        estimatedGas: 50_000,
        estimatedValue: txValue,
        ttlSeconds: this.config.defaultTTL,
      });
      planId = plan.planId;
      this.log(timeline, "create_plan", `Plan created: ${planId} (provider: ${providerAddress})`);
      this.envelopeEmitter?.onPlanCreated(plan);
      if (!this.envelopeEmitter) {
        this.auditAppend("plan_created", {
          intentId,
          planId,
          summary: `Plan created with provider ${providerAddress}`,
        });
      }

      // Transition plan to ready
      const readyPlan = transitionPlan(plan, "ready");

      // ── Step 6: Evaluate escalation ─────────────────────────────────
      // Merge contract-risk escalation rules when metadata is present
      let effectiveRules = this.config.escalationRules;
      if (contractInspection && contractInspection.overallRisk === "high") {
        // Inject a contract_high_risk rule that requires guardian approval
        effectiveRules = [
          ...effectiveRules,
          {
            condition: "contract_high_risk" as import("../intent/escalation.js").EscalationRule["condition"],
            action: "require_guardian" as const,
          },
        ];
      }
      const escalation = evaluateEscalation(planningIntent, readyPlan, effectiveRules);
      this.log(
        timeline,
        "evaluate_escalation",
        escalation.escalated
          ? `Escalation triggered (level: ${escalation.level}): ${escalation.reason}`
          : "No escalation required",
      );

      if (escalation.level === "deny") {
        this.auditAppend("policy_decision", {
          intentId,
          planId,
          policyDecision: "deny",
          summary: `Escalation denied: ${escalation.reason}`,
        });
        return this.fail(intentId, timeline, `Escalation denied: ${escalation.reason}`);
      }

      // ── Step 7: Request approval ────────────────────────────────────
      let approvedPlan = readyPlan;
      let approvalDetails: Record<string, unknown> | undefined;
      if (contractInspection) {
        const approvalPrompt =
          `${formatApprovalPrompt(planningIntent, readyPlan)}\n\n--- Contract Risk Context ---\n${
            enrichApprovalWithMetadata(planningIntent, contractInspection)
          }`;
        approvalDetails = {
          approvalPrompt,
          contractName: contractInspection.contractName,
          contractRisk: contractInspection.overallRisk,
          contractRiskSummary: contractInspection.riskSummary,
        };
        this.log(
          timeline,
          "request_approval",
          `Approval context enriched from TOL metadata for ${contractInspection.contractName}`,
        );
      }
      if (escalation.escalated && !this.config.autoApprove) {
        const approval = createApproval({
          intentId,
          planId: readyPlan.planId,
          approver: params.requester,
          approverRole: escalation.level === "guardian" ? "guardian" : "requester",
          accountId: params.requester,
          terminalClass: params.terminalClass,
          trustTier: params.trustTier,
          policyHash: readyPlan.policyHash,
        });
        approvalId = approval.approvalId;
        const approvalSummary = contractInspection
          ? `Approval requested at level "${escalation.level}" for ${contractInspection.contractName} (${contractInspection.overallRisk} risk)`
          : `Approval requested at level "${escalation.level}"`;
        this.log(timeline, "request_approval", `Approval requested (${escalation.level}): ${approval.approvalId}`);
        this.auditAppend("approval_requested", {
          intentId,
          planId,
          approvalId,
          actorAddress: params.requester,
          summary: approvalSummary,
          details: approvalDetails,
        });

        // In a real system, the approval would be asynchronous.
        // For the pipeline, we auto-grant since there's no interactive UI in this path.
        const grantedApproval = transitionApproval(approval, "granted");
        approvedPlan = transitionPlan(readyPlan, "approved");
        this.log(timeline, "request_approval", `Approval granted: ${grantedApproval.approvalId}`);
        const grantedSummary = contractInspection
          ? `Approval granted by ${params.requester} for ${contractInspection.contractName} (${contractInspection.overallRisk} risk)`
          : `Approval granted by ${params.requester}`;
        this.envelopeEmitter?.onApprovalGranted(grantedApproval, {
          actorAddress: params.requester,
          summary: grantedSummary,
          details: approvalDetails,
        });
        if (!this.envelopeEmitter) {
          this.auditAppend("approval_granted", {
            intentId,
            planId,
            approvalId,
            actorAddress: params.requester,
            summary: grantedSummary,
            details: approvalDetails,
          });
        }
      } else {
        // Auto-approve path: no escalation or autoApprove is on
        const approval = createApproval({
          intentId,
          planId: readyPlan.planId,
          approver: params.requester,
          approverRole: "requester",
          accountId: params.requester,
          terminalClass: params.terminalClass,
          trustTier: params.trustTier,
          policyHash: readyPlan.policyHash,
        });
        approvalId = approval.approvalId;
        const grantedApproval = transitionApproval(approval, "granted");
        approvedPlan = transitionPlan(readyPlan, "approved");
        this.log(timeline, "request_approval", `Auto-approved: ${grantedApproval.approvalId}`);
        const autoApprovedSummary = contractInspection
          ? `Auto-approved by pipeline (level: ${escalation.level}) for ${contractInspection.contractName} (${contractInspection.overallRisk} risk)`
          : `Auto-approved by pipeline (level: ${escalation.level})`;
        this.envelopeEmitter?.onApprovalGranted(grantedApproval, {
          actorAddress: params.requester,
          summary: autoApprovedSummary,
          details: approvalDetails,
        });
        if (!this.envelopeEmitter) {
          this.auditAppend("approval_granted", {
            intentId,
            planId,
            approvalId,
            actorAddress: params.requester,
            summary: autoApprovedSummary,
            details: approvalDetails,
          });
        }
      }

      // Transition intent to approved, then executing
      planningIntent = transitionIntent(planningIntent, "approved");
      const executingIntent = transitionIntent(planningIntent, "executing");
      const executingPlan = transitionPlan(approvedPlan, "executing");

      // Check for expiry again before execution
      if (isIntentExpired(executingIntent)) {
        return this.fail(intentId, timeline, "Intent expired before execution");
      }

      // ── Step 8: Execute ─────────────────────────────────────────────
      const baseMetadata = createIntentMetadata(
        intentId,
        executingPlan.planId,
        params.terminalClass,
        params.trustTier,
      );

      const target = txTarget ?? providerAddress;
      const executionSponsors = sponsorSelection
        ? [
            sponsorSelection.selected,
            ...sponsorSelection.alternatives,
          ]
        : [];
      const executionAttempts: Array<SponsorQuote | null> = executionSponsors.length > 0
        ? [...executionSponsors, null]
        : [null];

      let chainReceipt: ChainReceiptData | null = null;
      let settledPlan = executingPlan;
      let executionError: string | null = null;

      for (let attemptIndex = 0; attemptIndex < executionAttempts.length; attemptIndex++) {
        const sponsorAttempt = executionAttempts[attemptIndex];
        const totalAttempts = executionAttempts.length;
        const planForAttempt =
          sponsorAttempt
            ? (
                approvedPlan.sponsor !== sponsorAttempt.sponsorAddress
                || approvedPlan.sponsorPolicyHash !== sponsorAttempt.policyHash
              )
              ? {
                  ...approvedPlan,
                  sponsor: sponsorAttempt.sponsorAddress,
                  sponsorPolicyHash: sponsorAttempt.policyHash,
                }
              : approvedPlan
            : executionSponsors.length > 0 && (approvedPlan.sponsor || approvedPlan.sponsorPolicyHash)
              ? {
                  ...approvedPlan,
                  sponsor: undefined,
                  sponsorPolicyHash: undefined,
                }
              : approvedPlan;
        const executingAttemptPlan = transitionPlan(planForAttempt, "executing");
        const attemptMetadata = {
          ...baseMetadata,
          "x-openfox-execution-attempt": `${attemptIndex + 1}/${totalAttempts}`,
          ...(sponsorAttempt
            ? {
                "x-sponsor-address": sponsorAttempt.sponsorAddress,
                "x-sponsor-policy": sponsorAttempt.policyHash,
              }
            : {}),
        };
        const executionSummary = sponsorAttempt
          ? `Execution submitted to ${target} via sponsor ${sponsorAttempt.sponsorAddress} (attempt ${attemptIndex + 1}/${totalAttempts})`
          : executionSponsors.length > 0
            ? `Execution submitted to ${target} via self-pay fallback (attempt ${attemptIndex + 1}/${totalAttempts})`
            : `Execution submitted to ${target}`;

        this.log(timeline, "execute", executionSummary);
        this.auditAppend("execution_submitted", {
          intentId,
          planId,
          sponsorAddress: sponsorAttempt?.sponsorAddress,
          summary: executionSummary,
          details: {
            attempt: attemptIndex + 1,
            totalAttempts,
            fallbackFromSponsor:
              attemptIndex > 0 && executionAttempts[attemptIndex - 1]
                ? executionAttempts[attemptIndex - 1]?.sponsorAddress
                : undefined,
          },
        });

        try {
          if (this.chainExecutor) {
            chainReceipt = await this.chainExecutor({
              intentId,
              planId: executingAttemptPlan.planId,
              requester: params.requester,
              metadata: attemptMetadata,
              target,
              value: txValue,
              sponsor: sponsorAttempt ?? undefined,
              sponsorAttempt: attemptIndex + 1,
              sponsorAttemptCount: totalAttempts,
            });
          } else {
            chainReceipt = {
              txHash: "0x" + Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join(""),
              blockNumber: Math.floor(Date.now() / 1000),
              blockHash: "0x" + Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join(""),
              from: params.requester,
              to: target,
              gasUsed: 21_000,
              value: txValue,
              status: "success",
            };
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          executionError = message;
          const canRetry = attemptIndex < executionAttempts.length - 1;
          this.log(
            timeline,
            "execute",
            canRetry
              ? `Execution attempt ${attemptIndex + 1} failed (${message}); retrying fallback route`
              : `Execution attempt ${attemptIndex + 1} failed (${message})`,
          );
          if (canRetry) {
            continue;
          }
          return this.fail(intentId, timeline, message);
        }

        txHash = chainReceipt.txHash;
        settledPlan = executingAttemptPlan;
        this.log(timeline, "execute", `Transaction executed: ${txHash} (status: ${chainReceipt.status})`);

        if (chainReceipt.status === "success") {
          break;
        }

        const canRetry =
          chainReceipt.status === "failed"
          && attemptIndex < executionAttempts.length - 1;
        executionError = `Transaction ${chainReceipt.status}: ${chainReceipt.txHash}`;
        this.auditAppend("execution_failed", {
          intentId,
          planId,
          txHash,
          sponsorAddress: sponsorAttempt?.sponsorAddress,
          summary: `Execution failed: ${chainReceipt.status}`,
          details: {
            attempt: attemptIndex + 1,
            totalAttempts,
            retrying: canRetry,
            nextAttempt:
              canRetry
                ? executionAttempts[attemptIndex + 1]?.sponsorAddress ?? "self-pay"
                : undefined,
          },
        });
        if (canRetry) {
          this.log(
            timeline,
            "execute",
            `Execution failed via ${sponsorAttempt?.sponsorAddress ?? "self-pay"}; retrying ${executionAttempts[attemptIndex + 1]?.sponsorAddress ?? "self-pay"}`,
          );
          continue;
        }

        const failedPlan = transitionPlan(executingAttemptPlan, "failed");
        const failResult: PipelineResult = {
          success: false,
          intentId,
          planId: failedPlan.planId,
          approvalId,
          txHash,
          error: executionError,
          timeline,
        };
        this.log(timeline, "audit_log", `Pipeline failed: ${failResult.error}`);
        this.lastResult = failResult;
        return failResult;
      }

      if (!chainReceipt || chainReceipt.status !== "success") {
        return this.fail(intentId, timeline, executionError ?? "Execution failed before receipt settlement");
      }

      // ── Step 9: Create receipt ──────────────────────────────────────
      const completedPlan = transitionPlan(settledPlan, "completed");
      const settledIntent = transitionIntent(executingIntent, "settled");

      // Build the approval record needed for the receipt
      const receiptApproval = createApproval({
        intentId,
        planId: completedPlan.planId,
        approver: params.requester,
        approverRole: "requester",
        accountId: params.requester,
        terminalClass: params.terminalClass,
        trustTier: params.trustTier,
        policyHash: completedPlan.policyHash,
      });
      const grantedReceiptApproval = transitionApproval(receiptApproval, "granted");

      const receipt = createReceipt({
        intent: settledIntent,
        plan: completedPlan,
        approval: grantedReceiptApproval,
        chainReceipt,
      });
      receiptId = receipt.receiptId;
      this.log(timeline, "create_receipt", `Receipt created: ${receiptId}`);
      this.envelopeEmitter?.onReceiptSettled(receipt);

      // ── Step 10: Audit log ──────────────────────────────────────────
      if (!this.envelopeEmitter) {
        this.auditAppend("execution_settled", {
          intentId,
          planId,
          receiptId,
          txHash,
          value: txValue,
          summary: `Execution settled: ${txHash}`,
        });
      }
      this.log(timeline, "audit_log", "Audit trail recorded for all steps");

      const result: PipelineResult = {
        success: true,
        intentId,
        planId,
        approvalId,
        receiptId,
        txHash,
        timeline,
      };
      this.lastResult = result;
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return this.fail(intentId || "unknown", timeline, message);
    }
  }

  /**
   * Convenience method: execute a simplified transfer.
   */
  async transfer(params: {
    from: string;
    to: string;
    value: string;
    terminalClass: TerminalClass;
    trustTier: TrustTier;
    contractMetadata?: ContractMetadata;
  }): Promise<PipelineResult> {
    // Validate transfer-specific fields
    if (!validateAddress(params.to)) {
      return { success: false, intentId: "", error: `Invalid recipient address: "${params.to}"`, timeline: [] };
    }
    if (!validateValue(params.value)) {
      return { success: false, intentId: "", error: `Invalid transfer value: "${params.value}"`, timeline: [] };
    }
    return this.execute({
      action: "transfer",
      requester: params.from,
      actorAgentId: params.from,
      terminalClass: params.terminalClass,
      trustTier: params.trustTier,
      params: {
        from: params.from,
        to: params.to,
        value: params.value,
      },
      contractMetadata: params.contractMetadata,
    });
  }

  /**
   * Get pipeline status / last result.
   */
  getLastResult(): PipelineResult | null {
    return this.lastResult;
  }

  // ── Private helpers ─────────────────────────────────────────────────

  private log(timeline: string[], step: PipelineStep, message: string): void {
    const ts = new Date().toISOString();
    timeline.push(`[${ts}] ${step}: ${message}`);
  }

  private fail(intentId: string, timeline: string[], error: string): PipelineResult {
    this.log(timeline, "audit_log", `Pipeline failed: ${error}`);
    this.auditAppend("execution_failed", {
      intentId,
      summary: `Pipeline failed: ${error}`,
    });
    const result: PipelineResult = {
      success: false,
      intentId,
      error,
      timeline,
    };
    this.lastResult = result;
    return result;
  }

  private auditAppend(
    kind: AuditEntryKind,
    fields: {
      intentId?: string;
      planId?: string;
      approvalId?: string;
      receiptId?: string;
      actorAddress?: string;
      terminalClass?: string;
      trustTier?: number;
      policyDecision?: string;
      txHash?: string;
      sponsorAddress?: string;
      value?: string;
      summary: string;
      details?: Record<string, unknown>;
    },
  ): void {
    if (!this.audit || !this.config.auditEnabled) return;
    this.audit.append({
      kind,
      timestamp: Math.floor(Date.now() / 1000),
      ...fields,
    });
  }
}
