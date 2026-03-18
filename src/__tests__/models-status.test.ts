import http from "http";
import { afterEach, describe, expect, it } from "vitest";
import { createTestConfig } from "./mocks.js";
import {
  buildModelStatusReport,
  buildModelStatusSnapshot,
} from "../models/status.js";

const servers: http.Server[] = [];

async function startServer(
  handler: (req: http.IncomingMessage, res: http.ServerResponse) => void,
): Promise<{ url: string }> {
  const server = http.createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("failed to bind test server");
  }
  return { url: `http://127.0.0.1:${address.port}` };
}

afterEach(async () => {
  while (servers.length) {
    const server = servers.pop();
    if (!server) continue;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

describe("models status", () => {
  it("reports selected provider and configured readiness", async () => {
    const snapshot = await buildModelStatusSnapshot(
      createTestConfig({
        inferenceModelRef: "openai/gpt-5-mini",
        openaiApiKey: "sk-test",
      }),
    );

    expect(snapshot.selectedProvider).toBe("openai");
    expect(snapshot.providers.find((provider) => provider.id === "openai")?.ready).toBe(true);

    const report = buildModelStatusReport(snapshot);
    expect(report).toContain("Selected provider: openai");
    expect(report).toContain("OpenAI");
  });

  it("probes a local Ollama endpoint when --check style probing is requested", async () => {
    const ollama = await startServer((_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ models: [] }));
    });

    const snapshot = await buildModelStatusSnapshot(
      createTestConfig({
        inferenceModelRef: "ollama/llama3.1:8b",
        ollamaBaseUrl: ollama.url,
      }),
      { check: true },
    );

    const provider = snapshot.providers.find((entry) => entry.id === "ollama");
    expect(provider?.selected).toBe(true);
    expect(provider?.ready).toBe(true);
    expect(provider?.detail).toContain("reachable");
  });
});
