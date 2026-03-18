import { createLogger } from "../observability/logger.js";
import {
  readOption,
  readNumberOption,
  readFlag,
} from "../cli/parse.js";
import {
  buildFleetBundleReport,
  buildFleetBundleSnapshot,
  buildFleetControlReport,
  buildFleetControlSnapshot,
  buildFleetReport,
  buildFleetLintReport,
  buildFleetLintSnapshot,
  buildFleetQueueRetryReport,
  buildFleetQueueRetrySnapshot,
  buildFleetRepairReport,
  buildFleetRepairSnapshot,
  buildFleetReconciliationReport,
  buildFleetReconciliationSnapshot,
  buildFleetProviderLivenessReport,
  buildFleetProviderLivenessSnapshot,
  buildFleetRecoveryReport,
  buildFleetRecoverySnapshot,
  buildFleetSnapshot,
  type FleetControlAction,
  type FleetRepairComponent,
  type FleetEndpoint,
  type FleetRetryQueue,
  type FleetRecoveryKind,
} from "../operator/fleet.js";
import {
  appendFleetIncidentHistory,
  buildFleetIncidentAlertReport,
  buildFleetIncidentRemediationReport,
  buildFleetIncidentReport,
  buildFleetIncidentSnapshot,
  deliverFleetIncidentAlerts,
  evaluateFleetIncidentAlerts,
  readFleetIncidentHistory,
  runFleetIncidentRemediation,
} from "../operator/incidents.js";

const logger = createLogger("main");

export async function handleFleetCommand(args: string[]): Promise<void> {
  const command = args[0] || "status";
  const asJson = args.includes("--json");
  const manifestPath = readFlag(args, "--manifest");
  const bundlePath = readFlag(args, "--bundle");
  const helpRequested =
    command === "--help" || command === "-h" || command === "help" || args.includes("--help") || args.includes("-h");

  if (helpRequested || (!manifestPath && command !== "bundle" && command !== "incident-history")) {
    logger.info(`
OpenFox fleet

Usage:
  openfox fleet status --manifest <path> [--json]
  openfox fleet lint --manifest <path> [--json]
  openfox fleet bundle inspect --bundle <dir> [--json]
  openfox fleet health --manifest <path> [--json]
  openfox fleet doctor --manifest <path> [--json]
  openfox fleet service --manifest <path> [--json]
  openfox fleet gateway --manifest <path> [--json]
  openfox fleet wallet --manifest <path> [--json]
  openfox fleet finance --manifest <path> [--json]
  openfox fleet payments --manifest <path> [--json]
  openfox fleet settlement --manifest <path> [--json]
  openfox fleet market --manifest <path> [--json]
  openfox fleet storage --manifest <path> [--json]
  openfox fleet lease-health --manifest <path> [--json]
  openfox fleet artifacts --manifest <path> [--json]
  openfox fleet signer --manifest <path> [--json]
  openfox fleet paymaster --manifest <path> [--json]
  openfox fleet providers --manifest <path> [--json]
  openfox fleet control <pause|resume|drain> --manifest <path> [--node <name>] [--actor <id>] [--reason <text>] [--json]
  openfox fleet retry <payments|settlement|market|signer|paymaster> --manifest <path> [--node <name>] [--actor <id>] [--reason <text>] [--limit N] [--json]
  openfox fleet repair <storage|artifacts> --manifest <path> [--limit N] [--json]
  openfox fleet reconciliation --manifest <path> [--json]
  openfox fleet provider-liveness --manifest <path> [--json]
  openfox fleet recover <replication|provider_route|callback_queue> --manifest <path> [--limit N] [--json]
  openfox fleet incidents --manifest <path> [--history-file <path>] [--record-history] [--json]
  openfox fleet incident-history --history-file <path> [--limit N] [--json]
  openfox fleet incident-alerts --manifest <path> [--history-file <path>] [--record-history] [--channel <stdout|json-file|webhook>] [--output <path>] [--webhook-url <url>] [--json]
  openfox fleet incident-remediate --manifest <path> [--limit N] [--json]
`);
    if (!manifestPath && command !== "bundle" && command !== "incident-history" && !helpRequested) {
      throw new Error("A fleet manifest is required. Use --manifest <path>.");
    }
    return;
  }

  const resolvedManifestPath = manifestPath ?? "";

  if (command === "repair") {
    const component = args[1];
    const normalizedComponent =
      component === "storage" || component === "artifacts"
        ? (component as FleetRepairComponent)
        : null;
    if (!normalizedComponent) {
      throw new Error("Usage: openfox fleet repair <storage|artifacts> --manifest <path> [--limit N] [--json]");
    }
    const snapshot = await buildFleetRepairSnapshot({
      manifestPath: resolvedManifestPath,
      component: normalizedComponent,
      limit: readNumberOption(args, "--limit", 10),
    });
    if (asJson) {
      logger.info(JSON.stringify(snapshot, null, 2));
      return;
    }
    logger.info(buildFleetRepairReport(snapshot));
    return;
  }

  if (command === "bundle") {
    const subcommand = args[1] || "inspect";
    if (subcommand !== "inspect") {
      throw new Error("Usage: openfox fleet bundle inspect --bundle <dir> [--json]");
    }
    if (!bundlePath) {
      throw new Error("A fleet bundle path is required. Use --bundle <dir>.");
    }
    const snapshot = buildFleetBundleSnapshot({ bundlePath });
    if (asJson) {
      logger.info(JSON.stringify(snapshot, null, 2));
      return;
    }
    logger.info(buildFleetBundleReport(snapshot));
    return;
  }

  if (command === "control") {
    const action = args[1];
    const normalizedAction =
      action === "pause" || action === "resume" || action === "drain"
        ? (action as FleetControlAction)
        : null;
    if (!normalizedAction) {
      throw new Error(
        "Usage: openfox fleet control <pause|resume|drain> --manifest <path> [--node <name>] [--actor <id>] [--reason <text>] [--json]",
      );
    }
    const snapshot = await buildFleetControlSnapshot({
      manifestPath: resolvedManifestPath,
      action: normalizedAction,
      nodeName: readFlag(args, "--node"),
      actor: readFlag(args, "--actor"),
      reason: readFlag(args, "--reason"),
    });
    if (asJson) {
      logger.info(JSON.stringify(snapshot, null, 2));
      return;
    }
    logger.info(buildFleetControlReport(snapshot));
    return;
  }

  if (command === "retry") {
    const queue = args[1];
    const normalizedQueue =
      queue === "payments" ||
      queue === "settlement" ||
      queue === "market" ||
      queue === "signer" ||
      queue === "paymaster"
        ? (queue as FleetRetryQueue)
        : null;
    if (!normalizedQueue) {
      throw new Error(
        "Usage: openfox fleet retry <payments|settlement|market|signer|paymaster> --manifest <path> [--node <name>] [--actor <id>] [--reason <text>] [--limit N] [--json]",
      );
    }
    const snapshot = await buildFleetQueueRetrySnapshot({
      manifestPath: resolvedManifestPath,
      queue: normalizedQueue,
      nodeName: readFlag(args, "--node"),
      actor: readFlag(args, "--actor"),
      reason: readFlag(args, "--reason"),
      limit: readNumberOption(args, "--limit", 25),
    });
    if (asJson) {
      logger.info(JSON.stringify(snapshot, null, 2));
      return;
    }
    logger.info(buildFleetQueueRetryReport(snapshot));
    return;
  }

  if (command === "lint") {
    const snapshot = buildFleetLintSnapshot({ manifestPath: resolvedManifestPath });
    if (asJson) {
      logger.info(JSON.stringify(snapshot, null, 2));
      return;
    }
    logger.info(buildFleetLintReport(snapshot));
    return;
  }

  if (command === "reconciliation") {
    const snapshot = await buildFleetReconciliationSnapshot({
      manifestPath: resolvedManifestPath,
    });
    if (asJson) {
      logger.info(JSON.stringify(snapshot, null, 2));
      return;
    }
    logger.info(buildFleetReconciliationReport(snapshot));
    return;
  }

  if (command === "provider-liveness") {
    const snapshot = await buildFleetProviderLivenessSnapshot({
      manifestPath: resolvedManifestPath,
    });
    if (asJson) {
      logger.info(JSON.stringify(snapshot, null, 2));
      return;
    }
    logger.info(buildFleetProviderLivenessReport(snapshot));
    return;
  }

  if (command === "incidents") {
    const snapshot = await buildFleetIncidentSnapshot({
      manifestPath: resolvedManifestPath,
    });
    if (args.includes("--record-history")) {
      const historyPath = readFlag(args, "--history-file");
      if (!historyPath) {
        throw new Error("Use --history-file <path> when --record-history is set.");
      }
      appendFleetIncidentHistory({ historyPath, snapshot });
    }
    if (asJson) {
      logger.info(JSON.stringify(snapshot, null, 2));
      return;
    }
    logger.info(buildFleetIncidentReport(snapshot));
    return;
  }

  if (command === "incident-history") {
    const historyPath = readFlag(args, "--history-file");
    if (!historyPath) {
      throw new Error("Usage: openfox fleet incident-history --history-file <path> [--limit N] [--json]");
    }
    const items = readFleetIncidentHistory({
      historyPath,
      limit: readNumberOption(args, "--limit", 20),
    });
    if (asJson) {
      logger.info(JSON.stringify({ items }, null, 2));
      return;
    }
    logger.info(
      [
        "=== OPENFOX FLEET INCIDENT HISTORY ===",
        `Entries: ${items.length}`,
        ...items.map(
          (item) =>
            `${item.recordedAt}  ${item.snapshot.summary}`,
        ),
      ].join("\n"),
    );
    return;
  }

  if (command === "incident-alerts") {
    const snapshot = await buildFleetIncidentSnapshot({
      manifestPath: resolvedManifestPath,
    });
    const historyPath = readFlag(args, "--history-file");
    const previous = historyPath
      ? readFleetIncidentHistory({ historyPath, limit: 1 })[0]?.snapshot ?? null
      : null;
    const evaluation = evaluateFleetIncidentAlerts({
      current: snapshot,
      previous,
    });
    const channelRaw = readOption(args, "--channel") || "stdout";
    if (!["stdout", "json-file", "webhook"].includes(channelRaw)) {
      throw new Error("Invalid --channel value. Expected stdout, json-file, or webhook.");
    }
    if (args.includes("--record-history")) {
      if (!historyPath) {
        throw new Error("Use --history-file <path> when --record-history is set.");
      }
      appendFleetIncidentHistory({ historyPath, snapshot });
    }
    const delivery = await deliverFleetIncidentAlerts({
      evaluation,
      channel: channelRaw as "stdout" | "json-file" | "webhook",
      outputPath: readFlag(args, "--output"),
      webhookUrl: readFlag(args, "--webhook-url"),
    });
    if (asJson) {
      logger.info(JSON.stringify({ evaluation, delivery }, null, 2));
      return;
    }
    logger.info(buildFleetIncidentAlertReport(evaluation));
    if (delivery.target) {
      logger.info(`Delivered ${delivery.delivered} alert(s) via ${delivery.channel} -> ${delivery.target}`);
    }
    return;
  }

  if (command === "incident-remediate") {
    const snapshot = await runFleetIncidentRemediation({
      manifestPath: resolvedManifestPath,
      limit: readNumberOption(args, "--limit", 25),
    });
    if (asJson) {
      logger.info(JSON.stringify(snapshot, null, 2));
      return;
    }
    logger.info(buildFleetIncidentRemediationReport(snapshot));
    return;
  }

  if (command === "recover") {
    const kind = args[1];
    const normalizedKind =
      kind === "replication" || kind === "provider_route" || kind === "callback_queue"
        ? (kind as FleetRecoveryKind)
        : null;
    if (!normalizedKind) {
      throw new Error(
        "Usage: openfox fleet recover <replication|provider_route|callback_queue> --manifest <path> [--limit N] [--json]",
      );
    }
    const snapshot = await buildFleetRecoverySnapshot({
      manifestPath: resolvedManifestPath,
      kind: normalizedKind,
      limit: readNumberOption(args, "--limit", 25),
    });
    if (asJson) {
      logger.info(JSON.stringify(snapshot, null, 2));
      return;
    }
    logger.info(buildFleetRecoveryReport(snapshot));
    return;
  }

  const endpoint =
    command === "status" ||
    command === "health" ||
    command === "doctor" ||
    command === "service" ||
    command === "gateway" ||
    command === "wallet" ||
    command === "finance" ||
    command === "payments" ||
    command === "settlement" ||
    command === "market" ||
    command === "storage" ||
    command === "lease-health" ||
    command === "artifacts" ||
    command === "signer" ||
    command === "paymaster" ||
    command === "providers" ||
    command === "reconciliation" ||
    command === "provider-liveness"
      ? (command as FleetEndpoint)
      : null;
  if (!endpoint) {
    throw new Error(`Unknown fleet command: ${command}`);
  }

  const snapshot = await buildFleetSnapshot({
    manifestPath: resolvedManifestPath,
    endpoint,
  });
  if (asJson) {
    logger.info(JSON.stringify(snapshot, null, 2));
    return;
  }
  logger.info(buildFleetReport(snapshot));
}
