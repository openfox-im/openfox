import type { OpenFoxConfig } from "../types.js";

export interface ModelProviderStatus {
  id: "openai" | "anthropic" | "ollama" | "runtime";
  name: string;
  configured: boolean;
  selected: boolean;
  ready: boolean;
  detail: string;
}

export interface ModelStatusSnapshot {
  selectedModel: string | null;
  selectedProvider: string | null;
  providers: ModelProviderStatus[];
}

function parseSelectedModel(config: OpenFoxConfig): {
  selectedModel: string | null;
  selectedProvider: string | null;
} {
  const modelRef = config.inferenceModelRef?.trim() || "";
  const model = config.inferenceModel?.trim() || "";
  if (modelRef) {
    const parts = modelRef.split("/").filter(Boolean);
    if (parts.length >= 2) {
      return {
        selectedModel: parts[parts.length - 1] || model || modelRef,
        selectedProvider: parts[0]?.toLowerCase() || null,
      };
    }
    return { selectedModel: modelRef, selectedProvider: inferProviderFromModel(modelRef) };
  }
  if (model) {
    return { selectedModel: model, selectedProvider: inferProviderFromModel(model) };
  }
  return { selectedModel: null, selectedProvider: null };
}

function inferProviderFromModel(model: string): string | null {
  const normalized = model.trim().toLowerCase();
  if (!normalized) return null;
  if (normalized.startsWith("claude")) return "anthropic";
  if (normalized.startsWith("gpt-") || normalized.startsWith("o1") || normalized.startsWith("o3")) {
    return "openai";
  }
  if (normalized.includes(":")) return "ollama";
  return null;
}

async function probeOllama(baseUrl: string): Promise<{ ready: boolean; detail: string }> {
  const trimmed = baseUrl.replace(/\/+$/, "");
  const candidates = [`${trimmed}/api/tags`, `${trimmed}/v1/models`];

  for (const url of candidates) {
    try {
      const response = await fetch(url, {
        method: "GET",
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(3000),
      });
      if (response.ok) {
        return { ready: true, detail: `reachable at ${url}` };
      }
      return { ready: false, detail: `probe failed at ${url} (status ${response.status})` };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (url === candidates[candidates.length - 1]) {
        return { ready: false, detail: `probe failed: ${message}` };
      }
    }
  }

  return { ready: false, detail: "probe failed" };
}

export async function buildModelStatusSnapshot(
  config: OpenFoxConfig,
  options: { check?: boolean } = {},
): Promise<ModelStatusSnapshot> {
  const { selectedModel, selectedProvider } = parseSelectedModel(config);

  const providers: ModelProviderStatus[] = [
    {
      id: "openai",
      name: "OpenAI",
      configured: Boolean(config.openaiApiKey),
      selected: selectedProvider === "openai",
      ready: Boolean(config.openaiApiKey),
      detail: config.openaiApiKey ? "API key configured" : "missing OPENAI_API_KEY",
    },
    {
      id: "anthropic",
      name: "Anthropic",
      configured: Boolean(config.anthropicApiKey),
      selected: selectedProvider === "anthropic",
      ready: Boolean(config.anthropicApiKey),
      detail: config.anthropicApiKey
        ? "API key configured"
        : "missing ANTHROPIC_API_KEY",
    },
    {
      id: "ollama",
      name: "Ollama",
      configured: Boolean(config.ollamaBaseUrl),
      selected: selectedProvider === "ollama",
      ready: Boolean(config.ollamaBaseUrl),
      detail: config.ollamaBaseUrl
        ? `configured at ${config.ollamaBaseUrl}`
        : "missing OLLAMA_BASE_URL",
    },
    {
      id: "runtime",
      name: "Legacy Runtime",
      configured: Boolean(config.runtimeApiKey && config.runtimeApiUrl),
      selected: selectedProvider === "runtime",
      ready: Boolean(config.runtimeApiKey && config.runtimeApiUrl),
      detail:
        config.runtimeApiKey && config.runtimeApiUrl
          ? `configured at ${config.runtimeApiUrl}`
          : "legacy runtime not configured",
    },
  ];

  if (options.check && config.ollamaBaseUrl) {
    const ollama = providers.find((provider) => provider.id === "ollama");
    if (ollama) {
      const probe = await probeOllama(config.ollamaBaseUrl);
      ollama.ready = probe.ready;
      ollama.detail = probe.detail;
    }
  }

  return {
    selectedModel,
    selectedProvider,
    providers,
  };
}

export function buildModelStatusReport(snapshot: ModelStatusSnapshot): string {
  const lines = [
    "=== OPENFOX MODELS ===",
    `Selected model: ${snapshot.selectedModel || "(unset)"}`,
    `Selected provider: ${snapshot.selectedProvider || "(auto)"}`,
    "",
  ];

  for (const provider of snapshot.providers) {
    const badges = [
      provider.configured ? "configured" : "not configured",
      provider.ready ? "ready" : "not ready",
      provider.selected ? "selected" : null,
    ]
      .filter(Boolean)
      .join(", ");
    lines.push(`${provider.name}`);
    lines.push(`  ${badges}`);
    lines.push(`  ${provider.detail}`);
  }

  lines.push("======================");
  return lines.join("\n");
}
