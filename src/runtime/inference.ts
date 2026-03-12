/**
 * Runtime Inference Client
 *
 * Wraps Runtime's /v1/chat/completions endpoint (OpenAI-compatible).
 * The openfox pays for its own thinking through Runtime credits.
 */

import type {
  InferenceClient,
  ChatMessage,
  InferenceOptions,
  InferenceResponse,
  InferenceToolCall,
  TokenUsage,
  InferenceToolDefinition,
} from "../types.js";
import { ResilientHttpClient } from "./http-client.js";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const INFERENCE_TIMEOUT_MS = 60_000;

/* ── Claude Code OAuth token reuse ──────────────────────────────── */

const CLAUDE_CREDENTIALS_PATH = join(homedir(), ".claude", ".credentials.json");
const CLAUDE_OAUTH_CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
const CLAUDE_OAUTH_TOKEN_URL = "https://platform.claude.com/v1/oauth/token";
const CLAUDE_OAUTH_BETA = "oauth-2025-04-20";

interface ClaudeOAuthCredentials {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

let cachedOAuth: ClaudeOAuthCredentials | null = null;

function loadClaudeOAuthCredentials(): ClaudeOAuthCredentials | null {
  try {
    const raw = JSON.parse(readFileSync(CLAUDE_CREDENTIALS_PATH, "utf-8"));
    const oauth = raw?.claudeAiOauth;
    if (oauth?.accessToken && oauth?.refreshToken && oauth?.expiresAt) {
      return {
        accessToken: oauth.accessToken,
        refreshToken: oauth.refreshToken,
        expiresAt: oauth.expiresAt,
      };
    }
  } catch {
    // credentials file does not exist or is malformed
  }
  return null;
}

async function refreshClaudeOAuthToken(
  refreshToken: string,
): Promise<ClaudeOAuthCredentials | null> {
  try {
    const resp = await fetch(CLAUDE_OAUTH_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: CLAUDE_OAUTH_CLIENT_ID,
      }),
    });
    if (!resp.ok) return null;
    const data = (await resp.json()) as Record<string, unknown>;
    const accessToken = data.access_token as string;
    const expiresIn = (data.expires_in as number) || 28800;
    const newRefreshToken = (data.refresh_token as string) || refreshToken;
    const creds: ClaudeOAuthCredentials = {
      accessToken,
      refreshToken: newRefreshToken,
      expiresAt: Date.now() + expiresIn * 1000,
    };
    // Persist refreshed tokens so Claude Code also benefits
    try {
      const raw = JSON.parse(readFileSync(CLAUDE_CREDENTIALS_PATH, "utf-8"));
      raw.claudeAiOauth.accessToken = creds.accessToken;
      raw.claudeAiOauth.refreshToken = creds.refreshToken;
      raw.claudeAiOauth.expiresAt = creds.expiresAt;
      writeFileSync(CLAUDE_CREDENTIALS_PATH, JSON.stringify(raw), { mode: 0o600 });
    } catch {
      // non-critical — token still usable in memory
    }
    return creds;
  } catch {
    return null;
  }
}

async function getClaudeOAuthAccessToken(): Promise<string | null> {
  if (!cachedOAuth) {
    cachedOAuth = loadClaudeOAuthCredentials();
  }
  if (!cachedOAuth) return null;

  // Refresh if expiring within 5 minutes
  if (cachedOAuth.expiresAt - Date.now() < 5 * 60 * 1000) {
    const refreshed = await refreshClaudeOAuthToken(cachedOAuth.refreshToken);
    if (refreshed) {
      cachedOAuth = refreshed;
    } else {
      cachedOAuth = null;
      return null;
    }
  }
  return cachedOAuth.accessToken;
}

interface InferenceClientOptions {
  apiUrl: string;
  apiKey?: string;
  defaultModel: string;
  maxTokens: number;
  lowComputeModel?: string;
  openaiApiKey?: string;
  anthropicApiKey?: string;
  ollamaBaseUrl?: string;
  /** Optional registry lookup — if provided, used before name heuristics */
  getModelProvider?: (modelId: string) => string | undefined;
}

type InferenceBackend = "runtime" | "openai" | "anthropic" | "ollama" | "claude-code";

function parseModelSelection(model: string): {
  providerHint?: string;
  modelId: string;
} {
  const trimmed = model.trim();
  if (!trimmed.includes("/")) {
    return { modelId: trimmed };
  }

  const parts = trimmed.split("/").filter(Boolean);
  if (parts.length < 2) {
    return { modelId: trimmed };
  }

  const [providerHint] = parts;
  return {
    providerHint: providerHint.toLowerCase(),
    modelId: parts[parts.length - 1],
  };
}

export function createInferenceClient(
  options: InferenceClientOptions,
): InferenceClient {
  const { apiUrl, apiKey, openaiApiKey, anthropicApiKey, ollamaBaseUrl, getModelProvider } = options;
  const httpClient = new ResilientHttpClient({
    baseTimeout: INFERENCE_TIMEOUT_MS,
    retryableStatuses: [429, 500, 502, 503, 504],
  });
  let currentModel = options.defaultModel;
  let maxTokens = options.maxTokens;

  const chat = async (
    messages: ChatMessage[],
    opts?: InferenceOptions,
  ): Promise<InferenceResponse> => {
    const selection = parseModelSelection(opts?.model || currentModel);
    const model = selection.modelId;
    const tools = opts?.tools;

    const backend = resolveInferenceBackend(model, {
      providerHint: selection.providerHint,
      openaiApiKey,
      anthropicApiKey,
      ollamaBaseUrl,
      getModelProvider,
    });

    // Newer models (o-series, gpt-5.x, gpt-4.1) require max_completion_tokens.
    // Ollama always uses max_tokens.
    const usesCompletionTokens =
      backend !== "ollama" && /^(o[1-9]|gpt-5|gpt-4\.1)/.test(model);
    const tokenLimit = opts?.maxTokens || maxTokens;

    const body: Record<string, unknown> = {
      model,
      messages: messages.map(formatMessage),
      stream: false,
    };

    if (usesCompletionTokens) {
      body.max_completion_tokens = tokenLimit;
    } else {
      body.max_tokens = tokenLimit;
    }

    if (opts?.temperature !== undefined) {
      body.temperature = opts.temperature;
    }

    if (tools && tools.length > 0) {
      body.tools = tools;
      body.tool_choice = "auto";
    }

    if (backend === "claude-code") {
      return chatViaClaudeCode({ model, messages });
    }

    if (backend === "anthropic") {
      return chatViaAnthropic({
        model,
        tokenLimit,
        messages,
        tools,
        temperature: opts?.temperature,
        anthropicApiKey: anthropicApiKey as string,
        httpClient,
      });
    }

    const openAiLikeApiUrl =
      backend === "openai" ? "https://api.openai.com" :
      backend === "ollama" ? (ollamaBaseUrl as string).replace(/\/$/, "") :
      apiUrl;
    const openAiLikeApiKey =
      backend === "openai" ? (openaiApiKey as string) :
      backend === "ollama" ? "ollama" :
      apiKey;

    if (!openAiLikeApiKey) {
      throw new Error(
        "No inference provider configured. Set OPENAI_API_KEY, ANTHROPIC_API_KEY, OLLAMA_BASE_URL, or a legacy Runtime API key.",
      );
    }

    return chatViaOpenAiCompatible({
      model,
      body,
      apiUrl: openAiLikeApiUrl,
      apiKey: openAiLikeApiKey,
      backend,
      httpClient,
    });
  };

  /**
   * @deprecated Use InferenceRouter for tier-based model selection.
   * Still functional as a fallback; router takes priority when available.
   */
  const setLowComputeMode = (enabled: boolean): void => {
    if (enabled) {
      currentModel = options.lowComputeModel || "gpt-5-mini";
      maxTokens = 4096;
    } else {
      currentModel = options.defaultModel;
      maxTokens = options.maxTokens;
    }
  };

  const getDefaultModel = (): string => {
    return currentModel;
  };

  return {
    chat,
    setLowComputeMode,
    getDefaultModel,
  };
}

function formatMessage(
  msg: ChatMessage,
): Record<string, unknown> {
  const formatted: Record<string, unknown> = {
    role: msg.role,
    content: msg.content,
  };

  if (msg.name) formatted.name = msg.name;
  if (msg.tool_calls) formatted.tool_calls = msg.tool_calls;
  if (msg.tool_call_id) formatted.tool_call_id = msg.tool_call_id;

  return formatted;
}

/**
 * Resolve which backend to use for a model.
 * When InferenceRouter is available, it uses the model registry's provider field.
 * This function is kept for backward compatibility with direct inference calls.
 */
function resolveInferenceBackend(
  model: string,
  keys: {
    providerHint?: string;
    openaiApiKey?: string;
    anthropicApiKey?: string;
    ollamaBaseUrl?: string;
    getModelProvider?: (modelId: string) => string | undefined;
  },
): InferenceBackend {
  // Explicit provider hints
  if (keys.providerHint === "claude-code") return "claude-code";
  if (keys.providerHint === "openai" && keys.openaiApiKey) return "openai";
  if (keys.providerHint === "anthropic" && (keys.anthropicApiKey || loadClaudeOAuthCredentials())) return "anthropic";
  if ((keys.providerHint === "ollama" || keys.providerHint === "local") && keys.ollamaBaseUrl) {
    return "ollama";
  }
  if (keys.providerHint === "runtime") return "runtime";

  // Registry-based routing: most accurate, no name guessing
  if (keys.getModelProvider) {
    const provider = keys.getModelProvider(model);
    if (provider === "claude-code") return "claude-code";
    if (provider === "ollama" && keys.ollamaBaseUrl) return "ollama";
    if (provider === "anthropic" && (keys.anthropicApiKey || loadClaudeOAuthCredentials())) return "anthropic";
    if (provider === "openai" && keys.openaiApiKey) return "openai";
    if (provider === "runtime") return "runtime";
    // provider unknown or key not configured — fall through to heuristics
  }

  // Heuristic fallback (model not in registry yet)
  // Allow "anthropic" backend if API key is set OR Claude Code OAuth credentials exist
  const hasAnthropicAuth = keys.anthropicApiKey || loadClaudeOAuthCredentials() !== null;
  if (hasAnthropicAuth && /^claude/i.test(model)) return "anthropic";
  if (keys.openaiApiKey && /^(gpt-[3-9]|gpt-4|gpt-5|o[1-9][-\s.]|o[1-9]$|chatgpt)/i.test(model)) return "openai";

  // Last resort: if Claude Code CLI is installed, use it for Claude models
  if (/^claude/i.test(model) && isClaudeCodeAvailable()) return "claude-code";
  return "runtime";

}

/* ── Claude Code CLI backend ────────────────────────────────────── */

import { execSync, spawn as nodeSpawn } from "node:child_process";

let _claudeCodeAvailable: boolean | null = null;

function isClaudeCodeAvailable(): boolean {
  if (_claudeCodeAvailable !== null) return _claudeCodeAvailable;
  try {
    execSync("which claude", { stdio: "ignore" });
    _claudeCodeAvailable = true;
  } catch {
    _claudeCodeAvailable = false;
  }
  return _claudeCodeAvailable;
}

/**
 * Route inference through the locally installed Claude Code CLI.
 * This is the fully compliant path — Claude Code handles its own
 * OAuth authentication.  OpenFox never touches credentials.
 */
async function chatViaClaudeCode(params: {
  model: string;
  messages: ChatMessage[];
}): Promise<InferenceResponse> {
  // Build a single prompt from messages
  const systemParts: string[] = [];
  const convParts: string[] = [];
  for (const msg of params.messages) {
    if (msg.role === "system") {
      if (msg.content) systemParts.push(msg.content);
      continue;
    }
    const prefix = msg.role === "user" ? "User" : "Assistant";
    convParts.push(`${prefix}: ${msg.content}`);
  }

  // Map model IDs to Claude Code aliases
  const modelAlias = params.model
    .replace(/^claude-/, "")
    .replace(/-\d{8}$/, "")     // strip date suffix
    .replace(/^(sonnet|haiku|opus).*/, "$1");

  const args = [
    "-p",
    "--output-format", "json",
    "--no-session-persistence",
    "--model", modelAlias,
  ];

  if (systemParts.length > 0) {
    args.push("--system-prompt", systemParts.join("\n\n"));
  }

  const prompt = convParts.length > 0 ? convParts.join("\n\n") : "Hello";
  args.push(prompt);

  const result = await new Promise<{ exitCode: number; stdout: string; stderr: string }>(
    (resolve, reject) => {
      const child = nodeSpawn("claude", args, {
        cwd: process.cwd(),
        env: { ...process.env, CLAUDECODE: undefined },
        stdio: ["pipe", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";
      const cliTimeout = 300_000; // 5 minutes — Sonnet via CLI can be slow
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        reject(new Error(`Claude Code CLI timed out after ${cliTimeout / 1000}s`));
      }, cliTimeout);

      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (c: string) => { stdout += c; });
      child.stderr.on("data", (c: string) => { stderr += c; });
      child.on("error", (e: Error) => { clearTimeout(timer); reject(e); });
      child.on("close", (code: number | null) => {
        clearTimeout(timer);
        resolve({ exitCode: code ?? -1, stdout, stderr: stderr.trim() });
      });
      child.stdin.end();
    },
  );

  if (result.exitCode !== 0) {
    throw new Error(
      `Claude Code CLI failed (exit ${result.exitCode})${result.stderr ? `: ${result.stderr}` : ""}`,
    );
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    // Non-JSON output — wrap as plain text response
    return {
      id: "",
      model: params.model,
      message: { role: "assistant", content: result.stdout.trim() },
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      finishReason: "stop",
    };
  }

  const usage = parsed.usage as Record<string, number> | undefined;
  const inputTokens = usage?.input_tokens ?? 0;
  const outputTokens = usage?.output_tokens ?? 0;

  return {
    id: (parsed.session_id as string) || "",
    model: Object.keys((parsed.modelUsage as Record<string, unknown>) || {})[0] || params.model,
    message: {
      role: "assistant",
      content: (parsed.result as string) || "",
    },
    usage: {
      promptTokens: inputTokens,
      completionTokens: outputTokens,
      totalTokens: inputTokens + outputTokens,
    },
    finishReason: (parsed.stop_reason as string) || "stop",
  };
}

async function chatViaOpenAiCompatible(params: {
  model: string;
  body: Record<string, unknown>;
  apiUrl: string;
  apiKey: string;
  backend: "runtime" | "openai" | "ollama";
  httpClient: ResilientHttpClient;
}): Promise<InferenceResponse> {
  const resp = await params.httpClient.request(`${params.apiUrl}/v1/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization:
        params.backend === "openai" || params.backend === "ollama"
          ? `Bearer ${params.apiKey}`
          : params.apiKey,
    },
    body: JSON.stringify(params.body),
    timeout: INFERENCE_TIMEOUT_MS,
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(
      `Inference error (${params.backend}): ${resp.status}: ${text}`,
    );
  }

  const data = await resp.json() as any;
  const choice = data.choices?.[0];

  if (!choice) {
    throw new Error("No completion choice returned from inference");
  }

  const message = choice.message;
  const usage: TokenUsage = {
    promptTokens: data.usage?.prompt_tokens || 0,
    completionTokens: data.usage?.completion_tokens || 0,
    totalTokens: data.usage?.total_tokens || 0,
  };

  const toolCalls: InferenceToolCall[] | undefined =
    message.tool_calls?.map((tc: any) => ({
      id: tc.id,
      type: "function" as const,
      function: {
        name: tc.function.name,
        arguments: tc.function.arguments,
      },
    }));

  return {
    id: data.id || "",
    model: data.model || params.model,
    message: {
      role: message.role,
      content: message.content || "",
      tool_calls: toolCalls,
    },
    toolCalls,
    usage,
    finishReason: choice.finish_reason || "stop",
  };
}

async function chatViaAnthropic(params: {
  model: string;
  tokenLimit: number;
  messages: ChatMessage[];
  tools?: InferenceToolDefinition[];
  temperature?: number;
  anthropicApiKey: string;
  httpClient: ResilientHttpClient;
}): Promise<InferenceResponse> {
  const transformed = transformMessagesForAnthropic(params.messages);
  const body: Record<string, unknown> = {
    model: params.model,
    max_tokens: params.tokenLimit,
    messages:
      transformed.messages.length > 0
        ? transformed.messages
        : (() => { throw new Error("Cannot send empty message array to Anthropic API"); })(),
  };

  if (transformed.system) {
    body.system = transformed.system;
  }

  if (params.temperature !== undefined) {
    body.temperature = params.temperature;
  }

  if (params.tools && params.tools.length > 0) {
    body.tools = params.tools.map((tool) => ({
      name: tool.function.name,
      description: tool.function.description,
      input_schema: tool.function.parameters,
    }));
    body.tool_choice = { type: "auto" };
  }

  // Prefer Claude Code OAuth token (shared subscription), fall back to plain API key
  const oauthToken = await getClaudeOAuthAccessToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "anthropic-version": "2023-06-01",
  };
  if (oauthToken) {
    headers["Authorization"] = `Bearer ${oauthToken}`;
    headers["anthropic-beta"] = CLAUDE_OAUTH_BETA;
  } else {
    headers["x-api-key"] = params.anthropicApiKey;
  }

  const resp = await params.httpClient.request("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    timeout: INFERENCE_TIMEOUT_MS,
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Inference error (anthropic): ${resp.status}: ${text}`);
  }

  const data = await resp.json() as any;
  const content = Array.isArray(data.content) ? data.content : [];
  const textBlocks = content.filter((c: any) => c?.type === "text");
  const toolUseBlocks = content.filter((c: any) => c?.type === "tool_use");

  const toolCalls: InferenceToolCall[] | undefined =
    toolUseBlocks.length > 0
      ? toolUseBlocks.map((tool: any) => ({
          id: tool.id,
          type: "function" as const,
          function: {
            name: tool.name,
            arguments: JSON.stringify(tool.input || {}),
          },
        }))
      : undefined;

  const textContent = textBlocks
    .map((block: any) => String(block.text || ""))
    .join("\n")
    .trim();

  if (!textContent && !toolCalls?.length) {
    throw new Error("No completion content returned from anthropic inference");
  }

  const promptTokens = data.usage?.input_tokens || 0;
  const completionTokens = data.usage?.output_tokens || 0;
  const usage: TokenUsage = {
    promptTokens,
    completionTokens,
    totalTokens: promptTokens + completionTokens,
  };

  return {
    id: data.id || "",
    model: data.model || params.model,
    message: {
      role: "assistant",
      content: textContent,
      tool_calls: toolCalls,
    },
    toolCalls,
    usage,
    finishReason: normalizeAnthropicFinishReason(data.stop_reason),
  };
}

function transformMessagesForAnthropic(
  messages: ChatMessage[],
): { system?: string; messages: Array<Record<string, unknown>> } {
  const systemParts: string[] = [];
  const transformed: Array<Record<string, unknown>> = [];

  for (const msg of messages) {
    if (msg.role === "system") {
      if (msg.content) systemParts.push(msg.content);
      continue;
    }

    if (msg.role === "user") {
      // Merge consecutive user messages
      const last = transformed[transformed.length - 1];
      if (last && last.role === "user" && typeof last.content === "string") {
        last.content = last.content + "\n" + msg.content;
        continue;
      }
      transformed.push({
        role: "user",
        content: msg.content,
      });
      continue;
    }

    if (msg.role === "assistant") {
      const content: Array<Record<string, unknown>> = [];
      if (msg.content) {
        content.push({ type: "text", text: msg.content });
      }
      for (const toolCall of msg.tool_calls || []) {
        content.push({
          type: "tool_use",
          id: toolCall.id,
          name: toolCall.function.name,
          input: parseToolArguments(toolCall.function.arguments),
        });
      }
      if (content.length === 0) {
        content.push({ type: "text", text: "" });
      }
      // Merge consecutive assistant messages
      const last = transformed[transformed.length - 1];
      if (last && last.role === "assistant" && Array.isArray(last.content)) {
        (last.content as Array<Record<string, unknown>>).push(...content);
        continue;
      }
      transformed.push({
        role: "assistant",
        content,
      });
      continue;
    }

    if (msg.role === "tool") {
      // Merge consecutive tool messages into a single user message
      // with multiple tool_result content blocks
      const toolResultBlock = {
        type: "tool_result",
        tool_use_id: msg.tool_call_id || "unknown_tool_call",
        content: msg.content,
      };

      const last = transformed[transformed.length - 1];
      if (last && last.role === "user" && Array.isArray(last.content)) {
        // Append tool_result to existing user message with content blocks
        (last.content as Array<Record<string, unknown>>).push(toolResultBlock);
        continue;
      }

      transformed.push({
        role: "user",
        content: [toolResultBlock],
      });
    }
  }

  return {
    system: systemParts.length > 0 ? systemParts.join("\n\n") : undefined,
    messages: transformed,
  };
}

function parseToolArguments(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return { value: parsed };
  } catch {
    return { _raw: raw };
  }
}

function normalizeAnthropicFinishReason(reason: unknown): string {
  if (typeof reason !== "string") return "stop";
  if (reason === "tool_use") return "tool_calls";
  return reason;
}
