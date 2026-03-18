import { loadConfig, resolvePath } from "../config.js";
import { createDatabase } from "../state/database.js";
import { createLogger } from "../observability/logger.js";
import { getWallet } from "../identity/wallet.js";
import { loadApiKeyFromConfig } from "../identity/provision.js";
import {
  readOption,
  readNumberOption,
} from "../cli/parse.js";
import {
  NoopInferenceClient,
  createConfiguredInferenceClient,
  hasConfiguredInferenceProvider,
} from "../runtime/inference-factory.js";
import {
  decideOperatorApprovalRequest,
} from "../operator/autopilot.js";
import {
  deliverOwnerReportChannels,
} from "../reports/delivery.js";
import {
  generateOwnerReport,
} from "../reports/generation.js";
import {
  generateOwnerOpportunityAlerts,
  queueOwnerOpportunityAlertAction,
} from "../reports/alerts.js";
import {
  materializeApprovedOwnerOpportunityAction,
} from "../reports/actions.js";
import {
  executeOwnerOpportunityAction,
} from "../reports/action-execution.js";
import {
  renderOwnerReportText,
} from "../reports/render.js";

const logger = createLogger("main");

export async function handleReportCommand(args: string[]): Promise<void> {
  const command = args[0] || "daily";
  const asJson = args.includes("--json");
  if (command === "--help" || command === "-h" || command === "help") {
    logger.info(`
OpenFox report

Usage:
  openfox report daily [--json]
  openfox report weekly [--json]
  openfox report list [--period <daily|weekly>] [--limit <n>] [--json]
  openfox report get --report-id <id> [--json]
  openfox report alerts [--status <unread|read|dismissed>] [--limit <n>] [--json]
  openfox report alerts-generate [--json]
  openfox report alert-read <alert-id> [--json]
  openfox report alert-dismiss <alert-id> [--json]
  openfox report alert-request-action <alert-id> [--action <review|pursue|delegate>] [--json]
  openfox report actions [--status <queued|completed|cancelled>] [--kind <review|pursue|delegate>] [--limit <n>] [--json]
  openfox report action-executions [--action-id <id>] [--status <running|completed|failed|skipped>] [--limit <n>] [--json]
  openfox report action-execute <action-id> [--json]
  openfox report action-complete <action-id> [--result-kind <note|bounty|campaign|provider_call|artifact|report|other>] [--result-ref <ref>] [--note <text>] [--json]
  openfox report action-cancel <action-id> [--result-kind <note|bounty|campaign|provider_call|artifact|report|other>] [--result-ref <ref>] [--note <text>] [--json]
  openfox report approvals [--status <pending|approved|rejected|expired>] [--limit <n>] [--json]
  openfox report approve <request-id> [--note <text>] [--json]
  openfox report reject <request-id> [--note <text>] [--json]
  openfox report deliveries [--channel <web|email>] [--status <pending|delivered|failed>] [--limit <n>] [--json]
  openfox report send --channel <web|email> [--period <daily|weekly> | --report-id <id>] [--json]
`);
    return;
  }

  const config = loadConfig();
  if (!config) {
    throw new Error("OpenFox is not configured. Run openfox --setup first.");
  }

  const db = createDatabase(resolvePath(config.dbPath));
  try {
    if (command === "list") {
      const periodKindRaw = readOption(args, "--period");
      const periodKind =
        periodKindRaw === "daily" || periodKindRaw === "weekly"
          ? periodKindRaw
          : undefined;
      const limit = readNumberOption(args, "--limit", 20);
      const items = db.listOwnerReports(limit, { periodKind });
      if (asJson) {
        logger.info(JSON.stringify({ items }, null, 2));
        return;
      }
      if (!items.length) {
        logger.info("No owner reports found.");
        return;
      }
      logger.info("=== OPENFOX OWNER REPORTS ===");
      for (const item of items) {
        logger.info(
          `${item.reportId}  [${item.periodKind}]  ${item.generationStatus}  ${item.createdAt}`,
        );
      }
      return;
    }

    if (command === "get") {
      const reportId = readOption(args, "--report-id");
      if (!reportId) {
        throw new Error("Usage: openfox report get --report-id <id> [--json]");
      }
      const report = db.getOwnerReport(reportId);
      if (!report) {
        throw new Error(`Owner report not found: ${reportId}`);
      }
      if (asJson) {
        logger.info(JSON.stringify(report, null, 2));
        return;
      }
      logger.info(renderOwnerReportText(report));
      return;
    }

    if (command === "deliveries") {
      const channelRaw = readOption(args, "--channel");
      const channel =
        channelRaw === "web" || channelRaw === "email" ? channelRaw : undefined;
      const statusRaw = readOption(args, "--status");
      const status =
        statusRaw === "pending" ||
        statusRaw === "delivered" ||
        statusRaw === "failed"
          ? statusRaw
          : undefined;
      const limit = readNumberOption(args, "--limit", 20);
      const items = db.listOwnerReportDeliveries(limit, { channel, status });
      if (asJson) {
        logger.info(JSON.stringify({ items }, null, 2));
        return;
      }
      if (!items.length) {
        logger.info("No owner report deliveries found.");
        return;
      }
      logger.info("=== OPENFOX OWNER REPORT DELIVERIES ===");
      for (const item of items) {
        logger.info(
          `${item.deliveryId}  [${item.channel}]  ${item.status}  ${item.target}`,
        );
      }
      return;
    }

    if (command === "approvals") {
      const statusRaw = readOption(args, "--status");
      const status =
        statusRaw === "pending" ||
        statusRaw === "approved" ||
        statusRaw === "rejected" ||
        statusRaw === "expired"
          ? statusRaw
          : undefined;
      const limit = readNumberOption(args, "--limit", 20);
      const items = db.listOperatorApprovalRequests(limit, { status });
      if (asJson) {
        logger.info(JSON.stringify({ items }, null, 2));
        return;
      }
      if (!items.length) {
        logger.info("No owner approval requests found.");
        return;
      }
      logger.info("=== OPENFOX OWNER APPROVALS ===");
      for (const item of items) {
        logger.info(
          `${item.requestId}  [${item.status}]  ${item.kind}  scope=${item.scope}  requested_by=${item.requestedBy}`,
        );
      }
      return;
    }

    if (command === "alerts") {
      const statusRaw = readOption(args, "--status");
      const status =
        statusRaw === "unread" ||
        statusRaw === "read" ||
        statusRaw === "dismissed"
          ? statusRaw
          : undefined;
      const limit = readNumberOption(args, "--limit", 20);
      const items = db.listOwnerOpportunityAlerts(limit, { status });
      if (asJson) {
        logger.info(JSON.stringify({ items }, null, 2));
        return;
      }
      if (!items.length) {
        logger.info("No owner opportunity alerts found.");
        return;
      }
      logger.info("=== OPENFOX OWNER OPPORTUNITY ALERTS ===");
      for (const item of items) {
        logger.info(
          `${item.alertId}  [${item.status}]  ${item.kind}  score=${item.strategyScore ?? "n/a"}  ${item.title}`,
        );
      }
      return;
    }

    if (command === "actions") {
      const statusRaw = readOption(args, "--status");
      const status =
        statusRaw === "queued" ||
        statusRaw === "completed" ||
        statusRaw === "cancelled"
          ? statusRaw
          : undefined;
      const kindRaw = readOption(args, "--kind");
      const kind =
        kindRaw === "review" || kindRaw === "pursue" || kindRaw === "delegate"
          ? kindRaw
          : undefined;
      const limit = readNumberOption(args, "--limit", 20);
      const items = db.listOwnerOpportunityActions(limit, { status, kind });
      if (asJson) {
        logger.info(JSON.stringify({ items }, null, 2));
        return;
      }
      if (!items.length) {
        logger.info("No owner opportunity actions found.");
        return;
      }
      logger.info("=== OPENFOX OWNER OPPORTUNITY ACTIONS ===");
      for (const item of items) {
        logger.info(
          `${item.actionId}  [${item.status}]  ${item.kind}  ${item.title}`,
        );
      }
      return;
    }

    if (command === "action-executions") {
      const statusRaw = readOption(args, "--status");
      const status =
        statusRaw === "running" ||
        statusRaw === "completed" ||
        statusRaw === "failed" ||
        statusRaw === "skipped"
          ? statusRaw
          : undefined;
      const limit = readNumberOption(args, "--limit", 20);
      const items = db.listOwnerOpportunityActionExecutions(limit, {
        actionId: readOption(args, "--action-id"),
        status,
      });
      if (asJson) {
        logger.info(JSON.stringify({ items }, null, 2));
        return;
      }
      if (!items.length) {
        logger.info("No owner opportunity action executions found.");
        return;
      }
      logger.info("=== OPENFOX OWNER OPPORTUNITY ACTION EXECUTIONS ===");
      for (const item of items) {
        logger.info(
          `${item.executionId}  [${item.status}]  ${item.kind}  action=${item.actionId}  target=${item.targetRef}`,
        );
      }
      return;
    }

    if (command === "alerts-generate") {
      const result = await generateOwnerOpportunityAlerts({
        config,
        db,
      });
      if (asJson) {
        logger.info(JSON.stringify(result, null, 2));
        return;
      }
      logger.info(
        `Generated ${result.created} new owner opportunity alert(s); skipped ${result.skipped}.`,
      );
      return;
    }

    if (command === "alert-read" || command === "alert-dismiss") {
      const alertId = args[1]?.trim();
      if (!alertId) {
        throw new Error(
          `Usage: openfox report ${command} <alert-id> [--json]`,
        );
      }
      const record = db.updateOwnerOpportunityAlertStatus(
        alertId,
        command === "alert-read" ? "read" : "dismissed",
      );
      if (!record) {
        throw new Error(`Owner opportunity alert not found: ${alertId}`);
      }
      if (asJson) {
        logger.info(JSON.stringify(record, null, 2));
        return;
      }
      logger.info(
        `${command === "alert-read" ? "Marked read" : "Dismissed"} ${record.alertId}`,
      );
      return;
    }

    if (command === "alert-request-action") {
      const alertId = args[1]?.trim();
      if (!alertId) {
        throw new Error(
          "Usage: openfox report alert-request-action <alert-id> [--action <review|pursue|delegate>] [--json]",
        );
      }
      const actionRaw = readOption(args, "--action");
      const action =
        actionRaw === "review" || actionRaw === "pursue" || actionRaw === "delegate"
          ? actionRaw
          : "review";
      const result = queueOwnerOpportunityAlertAction({
        config,
        db,
        alertId,
        actionKind: action,
        requestedBy: "owner-cli",
        reason: readOption(args, "--reason"),
      });
      if (asJson) {
        logger.info(JSON.stringify(result, null, 2));
        return;
      }
      logger.info(
        `Queued ${action} action for ${result.alert.alertId} as approval request ${result.request.requestId}`,
      );
      return;
    }

    if (command === "action-execute") {
      const actionId = args[1]?.trim();
      if (!actionId) {
        throw new Error("Usage: openfox report action-execute <action-id> [--json]");
      }
      const { account } = await getWallet();
      const inference = hasConfiguredInferenceProvider(config)
        ? createConfiguredInferenceClient({ config, db })
        : new NoopInferenceClient();
      const result = await executeOwnerOpportunityAction({
        identity: {
          name: config.name,
          address: config.walletAddress,
          account,
          creatorAddress: config.creatorAddress,
          sandboxId: config.sandboxId,
          apiKey: config.runtimeApiKey || loadApiKeyFromConfig() || "",
          createdAt: new Date().toISOString(),
        },
        config,
        db,
        inference,
        actionId,
      });
      if (asJson) {
        logger.info(JSON.stringify(result, null, 2));
        return;
      }
      logger.info(
        `Executed ${result.action.actionId}: ${result.execution.status}${result.execution.executionRef ? ` (${result.execution.executionRef})` : ""}`,
      );
      return;
    }

    if (command === "action-complete" || command === "action-cancel") {
      const actionId = args[1]?.trim();
      if (!actionId) {
        throw new Error(
          `Usage: openfox report ${command} <action-id> [--json]`,
        );
      }
      const resultKindRaw = readOption(args, "--result-kind");
      const record = db.updateOwnerOpportunityActionStatus(
        actionId,
        command === "action-complete" ? "completed" : "cancelled",
        undefined,
        {
          kind:
            resultKindRaw === "note" ||
            resultKindRaw === "bounty" ||
            resultKindRaw === "campaign" ||
            resultKindRaw === "provider_call" ||
            resultKindRaw === "artifact" ||
            resultKindRaw === "report" ||
            resultKindRaw === "other"
              ? resultKindRaw
              : undefined,
          ref: readOption(args, "--result-ref"),
          note: readOption(args, "--note"),
        },
      );
      if (!record) {
        throw new Error(`Owner opportunity action not found: ${actionId}`);
      }
      if (asJson) {
        logger.info(JSON.stringify(record, null, 2));
        return;
      }
      logger.info(
        `${command === "action-complete" ? "Completed" : "Cancelled"} ${record.actionId}`,
      );
      return;
    }

    if (command === "approve" || command === "reject") {
      const requestId = args[1]?.trim();
      if (!requestId) {
        throw new Error(
          `Usage: openfox report ${command} <request-id> [--note <text>] [--json]`,
        );
      }
      const record = decideOperatorApprovalRequest({
        db,
        requestId,
        status: command === "approve" ? "approved" : "rejected",
        decidedBy: "owner-cli",
        decisionNote: readOption(args, "--note"),
      });
      const action =
        command === "approve" && record.kind === "opportunity_action"
          ? materializeApprovedOwnerOpportunityAction({
              db,
              requestId: record.requestId,
            })
          : undefined;
      if (asJson) {
        logger.info(JSON.stringify(action ? { request: record, action } : record, null, 2));
        return;
      }
      logger.info(
        `${command === "approve" ? "Approved" : "Rejected"} ${record.requestId}${action ? ` and queued ${action.actionId}` : ""}`,
      );
      return;
    }

    if (command === "send") {
      const channel = readOption(args, "--channel");
      if (channel !== "web" && channel !== "email") {
        throw new Error(
          "Usage: openfox report send --channel <web|email> [--period <daily|weekly> | --report-id <id>] [--json]",
        );
      }
      const reportId = readOption(args, "--report-id");
      const periodRaw = readOption(args, "--period");
      const periodKind =
        periodRaw === "daily" || periodRaw === "weekly" ? periodRaw : "daily";
      let report = reportId ? db.getOwnerReport(reportId) : db.getLatestOwnerReport(periodKind);
      if (!report) {
        const inference = hasConfiguredInferenceProvider(config)
          ? createConfiguredInferenceClient({ config, db })
          : undefined;
        report = await generateOwnerReport({
          config,
          db,
          inference,
          periodKind,
        });
      }
      const [result] = await deliverOwnerReportChannels({
        config,
        db,
        report,
        channels: [channel],
      });
      if (asJson) {
        logger.info(JSON.stringify(result, null, 2));
        return;
      }
      logger.info(
        [
          "Owner report delivered.",
          `Channel: ${result.channel}`,
          `Status: ${result.status}`,
          `Target: ${result.target}`,
          `Report: ${report.reportId}`,
          `Rendered path: ${result.renderedPath || "(none)"}`,
        ].join("\n"),
      );
      return;
    }

    if (command !== "daily" && command !== "weekly") {
      throw new Error(`Unknown report command: ${command}`);
    }

    const inference = hasConfiguredInferenceProvider(config)
      ? createConfiguredInferenceClient({ config, db })
      : undefined;
    const report = await generateOwnerReport({
      config,
      db,
      inference,
      periodKind: command,
    });
    if (asJson) {
      logger.info(JSON.stringify(report, null, 2));
      return;
    }
    logger.info(renderOwnerReportText(report));
  } finally {
    db.close();
  }
}
