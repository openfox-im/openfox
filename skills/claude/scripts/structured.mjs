/**
 * OpenFox skill backend: claude.structured
 *
 * Like claude.chat but enforces a JSON Schema on the output, using Claude
 * Code's --json-schema flag.  Returns a validated, parsed JSON object.
 *
 * Input (request):
 *   - messages       {Array<{role,content}>}  Chat messages
 *   - jsonSchema     {object}                 JSON Schema for output validation (required)
 *   - model          {string}                 Model alias or full id (default: "sonnet")
 *   - systemPrompt   {string}                 System prompt override (optional)
 *   - maxBudgetUsd   {number}                 Per-call budget cap in USD (optional)
 *   - effort         {string}                 Effort level (optional)
 *
 * Output:
 *   - result         {object}                 Parsed JSON matching the schema
 *   - model          {string}                 Actual model used
 *   - usage          {object}                 Token usage and cost
 *   - sessionId      {string}                 Claude Code session ID
 *   - durationMs     {number}                 Total wall-clock time
 */
import { spawn } from "node:child_process";

const DEFAULT_MODEL = "sonnet";
const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_STDOUT_BYTES = 2 * 1024 * 1024;

function buildPrompt(messages) {
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new Error("claude.structured: messages array is required");
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

function runClaude(args, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn("claude", args, {
      cwd: process.cwd(),
      env: { ...process.env, CLAUDECODE: undefined },
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
      if (timedOut) { reject(new Error(`claude.structured: timed out after ${timeoutMs}ms`)); return; }
      if (stdoutBytes > MAX_STDOUT_BYTES) { reject(new Error("claude.structured: stdout too large")); return; }
      resolve({ exitCode: code ?? -1, stdout, stderr: stderr.trim() });
    });

    child.stdin.end();
  });
}

export async function run(input) {
  const request = input?.request ?? {};
  const options = input?.options ?? {};

  if (!request.jsonSchema || typeof request.jsonSchema !== "object") {
    throw new Error("claude.structured: jsonSchema is required");
  }

  const messages = request.messages ?? [];
  const model = request.model || options.model || DEFAULT_MODEL;
  const systemPrompt = request.systemPrompt || extractSystemPrompt(messages);
  const maxBudgetUsd = request.maxBudgetUsd || options.maxBudgetUsd;
  const effort = request.effort || options.effort;
  const timeoutMs = Number(options.timeoutMs || DEFAULT_TIMEOUT_MS);

  const prompt = buildPrompt(messages);

  const args = [
    "-p",
    "--output-format", "json",
    "--no-session-persistence",
    "--model", model,
    "--tools", '""',
    "--json-schema", JSON.stringify(request.jsonSchema),
    prompt,
  ];

  if (systemPrompt) args.push("--system-prompt", systemPrompt);
  if (maxBudgetUsd) args.push("--max-budget-usd", String(maxBudgetUsd));
  if (effort) args.push("--effort", effort);

  const res = await runClaude(args, timeoutMs);

  if (res.exitCode !== 0) {
    throw new Error(
      `claude.structured: CLI exited with code ${res.exitCode}${
        res.stderr ? `: ${res.stderr}` : ""
      }`,
    );
  }

  let parsed;
  try {
    parsed = JSON.parse(res.stdout);
  } catch {
    throw new Error("claude.structured: failed to parse CLI JSON output");
  }

  // The result field contains the structured text — parse it as JSON
  let structuredResult;
  try {
    structuredResult = JSON.parse(parsed.result || "{}");
  } catch {
    // If Claude returned non-JSON text despite schema, return raw
    structuredResult = parsed.result;
  }

  return {
    result: structuredResult,
    model: Object.keys(parsed.modelUsage || {})[0] || model,
    usage: {
      inputTokens: parsed.usage?.input_tokens || 0,
      outputTokens: parsed.usage?.output_tokens || 0,
      cacheCreationInputTokens: parsed.usage?.cache_creation_input_tokens || 0,
      cacheReadInputTokens: parsed.usage?.cache_read_input_tokens || 0,
      costUsd: parsed.total_cost_usd || 0,
    },
    sessionId: parsed.session_id || null,
    durationMs: parsed.duration_ms || 0,
    stopReason: parsed.stop_reason || "end_turn",
  };
}
