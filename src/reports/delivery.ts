import { spawn } from "child_process";
import fs from "fs/promises";
import path from "path";
import { ulid } from "ulid";
import { resolvePath } from "../config.js";
import type {
  OpenFoxConfig,
  OpenFoxDatabase,
  OwnerReportChannel,
  OwnerReportDeliveryRecord,
  OwnerReportRecord,
} from "../types.js";
import { createLogger } from "../observability/logger.js";
import { renderOwnerReportHtml, renderOwnerReportText } from "./render.js";

const logger = createLogger("reports.delivery");
export interface OwnerReportDeliveryResult {
  channel: OwnerReportChannel;
  status: "delivered" | "failed";
  target: string;
  renderedPath?: string | null;
  metadata?: Record<string, unknown> | null;
  error?: string | null;
  record: OwnerReportDeliveryRecord;
}

function buildDeliveryId(
  reportId: string,
  channel: OwnerReportChannel,
  target: string,
): string {
  return `owner-delivery:${channel}:${reportId}:${target}`;
}

async function ensureDir(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true });
}

async function deliverWeb(
  config: OpenFoxConfig,
  report: OwnerReportRecord,
): Promise<{
  target: string;
  renderedPath: string;
  metadata: Record<string, unknown>;
}> {
  const outputDir = resolvePath(config.ownerReports?.web.outputDir || "~/.openfox/reports/web");
  await ensureDir(outputDir);
  const htmlPath = path.join(outputDir, `${report.reportId}.html`);
  const jsonPath = path.join(outputDir, `${report.reportId}.json`);
  const latestHtmlPath = path.join(outputDir, `latest-${report.periodKind}.html`);
  const latestJsonPath = path.join(outputDir, `latest-${report.periodKind}.json`);
  const html = renderOwnerReportHtml(report);
  const json = JSON.stringify(report, null, 2);
  await fs.writeFile(htmlPath, html, "utf8");
  await fs.writeFile(jsonPath, json, "utf8");
  await fs.writeFile(latestHtmlPath, html, "utf8");
  await fs.writeFile(latestJsonPath, json, "utf8");
  return {
    target: `${config.ownerReports?.web.pathPrefix || "/owner"}/reports/latest/${report.periodKind}`,
    renderedPath: htmlPath,
    metadata: {
      htmlPath,
      jsonPath,
      latestHtmlPath,
      latestJsonPath,
    },
  };
}

function buildEmailMessage(
  config: OpenFoxConfig,
  report: OwnerReportRecord,
  html: string,
  text: string,
): string {
  const boundary = `openfox-${ulid()}`;
  const from = config.ownerReports?.email.from || "openfox@localhost";
  const to = config.ownerReports?.email.to || "owner@localhost";
  const subject = `[OpenFox] ${report.periodKind} owner report`;
  return [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    'Content-Type: text/plain; charset="utf-8"',
    "",
    text,
    "",
    `--${boundary}`,
    'Content-Type: text/html; charset="utf-8"',
    "",
    html,
    "",
    `--${boundary}--`,
    "",
  ].join("\n");
}

async function deliverEmail(
  config: OpenFoxConfig,
  report: OwnerReportRecord,
): Promise<{
  target: string;
  renderedPath: string;
  metadata: Record<string, unknown>;
}> {
  const emailConfig = config.ownerReports?.email ?? {
    enabled: false,
    mode: "outbox" as const,
    from: "openfox@localhost",
    to: "owner@localhost",
    outboxDir: "~/.openfox/reports/outbox",
    sendmailPath: "/usr/sbin/sendmail",
  };
  const outboxDir = resolvePath(emailConfig.outboxDir);
  await ensureDir(outboxDir);
  const html = renderOwnerReportHtml(report);
  const text = renderOwnerReportText(report);
  const eml = buildEmailMessage(config, report, html, text);
  const baseName = `${report.reportId}`;
  const textPath = path.join(outboxDir, `${baseName}.txt`);
  const htmlPath = path.join(outboxDir, `${baseName}.html`);
  const emlPath = path.join(outboxDir, `${baseName}.eml`);
  await fs.writeFile(textPath, text, "utf8");
  await fs.writeFile(htmlPath, html, "utf8");
  await fs.writeFile(emlPath, eml, "utf8");
  if (emailConfig.enabled && emailConfig.mode === "sendmail") {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(emailConfig.sendmailPath, ["-t", "-i"], {
        stdio: ["pipe", "ignore", "pipe"],
      });
      let stderr = "";
      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString("utf8");
      });
      child.on("error", reject);
      child.on("close", (code) => {
        if (code === 0) {
          resolve();
          return;
        }
        reject(new Error(stderr.trim() || `sendmail exited with code ${code}`));
      });
      child.stdin.write(eml);
      child.stdin.end();
    });
  }
  return {
    target: emailConfig.to,
    renderedPath: emlPath,
    metadata: {
      textPath,
      htmlPath,
      emlPath,
      mode: emailConfig.mode,
    },
  };
}

export async function deliverOwnerReport(params: {
  config: OpenFoxConfig;
  db: OpenFoxDatabase;
  report: OwnerReportRecord;
  channel: OwnerReportChannel;
}): Promise<OwnerReportDeliveryResult> {
  const { config, db, report, channel } = params;
  let target = "";
  let renderedPath: string | null = null;
  let metadata: Record<string, unknown> | null = null;
  let status: "delivered" | "failed" = "delivered";
  let error: string | null = null;

  try {
    if (channel === "web") {
      const result = await deliverWeb(config, report);
      target = result.target;
      renderedPath = result.renderedPath;
      metadata = result.metadata;
    } else {
      const result = await deliverEmail(config, report);
      target = result.target;
      renderedPath = result.renderedPath;
      metadata = result.metadata;
    }
  } catch (deliveryError) {
    status = "failed";
    error =
      deliveryError instanceof Error ? deliveryError.message : String(deliveryError);
    logger.warn(`Owner report delivery failed: ${error}`);
    if (!target) {
      target =
        channel === "web"
          ? config.ownerReports?.web.pathPrefix || "/owner"
          : config.ownerReports?.email.to || "owner@localhost";
    }
  }

  const now = new Date().toISOString();
  const record: OwnerReportDeliveryRecord = {
    deliveryId: buildDeliveryId(report.reportId, channel, target),
    reportId: report.reportId,
    channel,
    status,
    target,
    renderedPath,
    metadata,
    lastError: error,
    deliveredAt: status === "delivered" ? now : null,
    createdAt: now,
    updatedAt: now,
  };
  db.upsertOwnerReportDelivery(record);
  return {
    channel,
    status,
    target,
    renderedPath,
    metadata,
    error,
    record,
  };
}

export async function deliverOwnerReportChannels(params: {
  config: OpenFoxConfig;
  db: OpenFoxDatabase;
  report: OwnerReportRecord;
  channels: OwnerReportChannel[];
}): Promise<OwnerReportDeliveryResult[]> {
  const results: OwnerReportDeliveryResult[] = [];
  for (const channel of params.channels) {
    results.push(
      await deliverOwnerReport({
        config: params.config,
        db: params.db,
        report: params.report,
        channel,
      }),
    );
  }
  return results;
}
