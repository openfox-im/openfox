/**
 * OpenFox skill backend: codex.structured
 *
 * Like codex.chat but enforces a JSON Schema on the output, using Codex CLI's
 * --output-schema flag.  Returns a validated, parsed JSON object.
 *
 * Input (request):
 *   - messages       {Array<{role,content}>}  Chat messages
 *   - jsonSchema     {object}                 JSON Schema for output validation (required)
 *   - model          {string}                 Model id (default: from codex config)
 *   - systemPrompt   {string}                 System prompt override (optional)
 *   - sandbox        {string}                 Sandbox mode (optional)
 *
 * Output:
 *   - result         {object}                 Parsed JSON matching the schema
 *   - model          {string}                 Model used
 *   - usage          {object}                 Token usage
 *   - threadId       {string}                 Codex thread ID
 */
import { spawn } from "node:child_process";

const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_STDOUT_BYTES = 2 * 1024 * 1024;

function buildPrompt(messages) {
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new Error("codex.structured: messages array is required and must not be empty");
  }
  if (messages.length === 1 && messages[0].role === "user") {
    return messages[0].content;
  }
  const parts = [];
  for (const msg of messages) {
    if (msg.role === "system") continue;
    const prefix = msg.role === "user" ? "User" : "Assistant";
    parts.push(`${prefix}: ${msg.content}`);
  }
  return parts.join("\n\n");
}

function extractSystemPrompt(messages) {
  const systemMsgs = messages.filter((m) => m.role === "system");
  return systemMsgs.length > 0
    ? systemMsgs.map((m) => m.content).join("\n\n")
    : null;
}

function parseCodexJsonl(raw) {
  const lines = raw.trim().split("\n").filter(Boolean);
  let threadId = null;
  let resultText = "";
  let usage = {};
  let error = null;

  for (const line of lines) {
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }

    if (event.type === "thread.started") {
      threadId = event.thread_id || null;
    }

    if (event.type === "item.completed" && event.item?.type === "agent_message") {
      resultText += (resultText ? "\n" : "") + (event.item.text || "");
    }

    if (event.type === "turn.completed" && event.usage) {
      usage = {
        inputTokens: event.usage.input_tokens || 0,
        cachedInputTokens: event.usage.cached_input_tokens || 0,
        outputTokens: event.usage.output_tokens || 0,
      };
    }

    if (event.type === "error") {
      error = event.message || "Unknown Codex error";
    }

    if (event.type === "turn.failed") {
      error = event.error?.message || "Codex turn failed";
    }
  }

  return { threadId, resultText, usage, error };
}

function runCodex(args, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn("codex", args, {
      cwd: process.cwd(),
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let stdoutBytes = 0;
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdoutBytes += Buffer.byteLength(chunk);
      if (stdoutBytes > MAX_STDOUT_BYTES) { child.kill("SIGKILL"); return; }
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (err) => { clearTimeout(timer); reject(err); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (timedOut) { reject(new Error(`codex.structured: timed out after ${timeoutMs}ms`)); return; }
      if (stdoutBytes > MAX_STDOUT_BYTES) { reject(new Error("codex.structured: stdout too large")); return; }
      resolve({ exitCode: code ?? -1, stdout, stderr: stderr.trim() });
    });

    child.stdin.end();
  });
}

export async function run(input) {
  const request = input?.request ?? {};
  const options = input?.options ?? {};

  if (!request.jsonSchema || typeof request.jsonSchema !== "object") {
    throw new Error("codex.structured: jsonSchema is required");
  }

  const messages = request.messages ?? [];
  const model = request.model || options.model;
  const systemPrompt = request.systemPrompt || extractSystemPrompt(messages);
  const sandbox = request.sandbox || options.sandbox || "read-only";
  const timeoutMs = Number(options.timeoutMs || DEFAULT_TIMEOUT_MS);

  const prompt = buildPrompt(messages);

  const args = [
    "exec",
    "--json",
    "--ephemeral",
    "--skip-git-repo-check",
    "--sandbox", sandbox,
    "--output-schema", JSON.stringify(request.jsonSchema),
  ];

  if (model) {
    args.push("-m", model);
  }

  if (systemPrompt) {
    args.push("-c", `system_prompt="${systemPrompt.replace(/"/g, '\\"')}"`);
  }

  args.push(prompt);

  const result = await runCodex(args, timeoutMs);

  if (result.exitCode !== 0 && !result.stdout.trim()) {
    throw new Error(
      `codex.structured: CLI exited with code ${result.exitCode}${
        result.stderr ? `: ${result.stderr}` : ""
      }`,
    );
  }

  const parsed = parseCodexJsonl(result.stdout);

  if (parsed.error && !parsed.resultText) {
    throw new Error(`codex.structured: ${parsed.error}`);
  }

  // Parse the structured result as JSON
  let structuredResult;
  try {
    structuredResult = JSON.parse(parsed.resultText || "{}");
  } catch {
    // If Codex returned non-JSON despite schema, return raw
    structuredResult = parsed.resultText;
  }

  return {
    result: structuredResult,
    model: model || "gpt-5.4",
    usage: parsed.usage,
    threadId: parsed.threadId,
  };
}
