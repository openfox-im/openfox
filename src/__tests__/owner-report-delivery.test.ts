import fs from "fs/promises";
import os from "os";
import path from "path";
import { describe, expect, it } from "vitest";
import { deliverOwnerReportChannels } from "../reports/delivery.js";
import { generateOwnerReport } from "../reports/generation.js";
import { startOwnerReportServer } from "../reports/server.js";
import { DEFAULT_OWNER_REPORTS_CONFIG } from "../types.js";
import {
  MockInferenceClient,
  createTestConfig,
  createTestDb,
  noToolResponse,
} from "./mocks.js";

describe("owner report delivery", () => {
  it("renders and records web and email owner report deliveries", async () => {
    const db = createTestDb();
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "openfox-owner-report-"));
    try {
      const config = createTestConfig({
        openaiApiKey: "test-key",
        ownerReports: {
          ...DEFAULT_OWNER_REPORTS_CONFIG,
          enabled: true,
          web: {
            ...DEFAULT_OWNER_REPORTS_CONFIG.web,
            enabled: true,
            outputDir: path.join(rootDir, "web"),
          },
          email: {
            ...DEFAULT_OWNER_REPORTS_CONFIG.email,
            enabled: true,
            outboxDir: path.join(rootDir, "outbox"),
          },
        },
      });

      const report = await generateOwnerReport({
        config,
        db,
        inference: new MockInferenceClient([
          noToolResponse(
            '{"overview":"Daily summary","gains":"Gain summary","losses":"Loss summary","opportunityDigest":"Digest","anomalies":"None","recommendations":["Stay bounded."]}',
          ),
        ]),
        periodKind: "daily",
        nowMs: Date.parse("2026-03-11T18:00:00.000Z"),
      });

      const results = await deliverOwnerReportChannels({
        config,
        db,
        report,
        channels: ["web", "email"],
      });

      expect(results).toHaveLength(2);
      expect(results.every((item) => item.status === "delivered")).toBe(true);
      expect(
        await fs.readFile(path.join(rootDir, "web", `${report.reportId}.html`), "utf8"),
      ).toContain("OpenFox Owner Report");
      expect(
        await fs.readFile(path.join(rootDir, "outbox", `${report.reportId}.eml`), "utf8"),
      ).toContain("[OpenFox] daily owner report");
      expect(db.listOwnerReportDeliveries(10).length).toBe(2);
    } finally {
      db.close();
      await fs.rm(rootDir, { recursive: true, force: true });
    }
  });

  it("serves latest owner reports over the owner report web surface", async () => {
    const db = createTestDb();
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "openfox-owner-report-server-"));
    let server: Awaited<ReturnType<typeof startOwnerReportServer>> | null = null;
    try {
      const config = createTestConfig({
        ownerReports: {
          ...DEFAULT_OWNER_REPORTS_CONFIG,
          enabled: true,
          generateWithInference: false,
          web: {
            ...DEFAULT_OWNER_REPORTS_CONFIG.web,
            enabled: true,
            bindHost: "127.0.0.1",
            port: 0,
            pathPrefix: "/owner",
            outputDir: path.join(rootDir, "web"),
          },
        },
      });

      const report = await generateOwnerReport({
        config,
        db,
        periodKind: "daily",
        nowMs: Date.parse("2026-03-11T18:00:00.000Z"),
      });
      expect(report.generationStatus).toBe("deterministic_only");

      server = await startOwnerReportServer({ config, db });
      expect(server).not.toBeNull();

      const latestJson = await fetch(`${server!.url}/reports/latest/daily`);
      expect(latestJson.status).toBe(200);
      const latestPayload = await latestJson.json();
      expect(latestPayload.reportId).toBe(report.reportId);

      const latestHtml = await fetch(`${server!.url}/reports/latest/daily?format=html`);
      expect(latestHtml.status).toBe(200);
      expect(await latestHtml.text()).toContain("OpenFox Owner Report");
    } finally {
      await server?.close?.();
      db.close();
      await fs.rm(rootDir, { recursive: true, force: true });
    }
  });
});
