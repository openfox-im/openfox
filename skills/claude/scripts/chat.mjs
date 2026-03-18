/**
 * OpenFox skill backend: claude.chat
 *
 * Invokes the locally installed Claude Code CLI (`claude -p`) as an inference
 * provider.  This is the **compliant** path — Claude Code handles its own
 * OAuth authentication against the operator's Claude subscription.  OpenFox
 * never touches tokens, keys, or credentials directly.
 *
 * Input (request):
 *   - messages       {Array<{role,content}>}  Chat messages
 *   - model          {string}                 Model alias or full id (default: "sonnet")
 *   - maxTokens      {number}                 Max output tokens (optional)
 *   - systemPrompt   {string}                 System prompt override (optional)
 *   - temperature    {number}                 Sampling temperature (optional, unused — Claude Code does not expose this)
 *   - tools          {string}                 Tool allowlist for Claude Code (default: "" = no tools)
 *   - maxBudgetUsd   {number}                 Per-call budget cap in USD (optional)
 *   - effort         {string}                 Effort level: low | medium | high | max (optional)
 *
 * Output:
 *   - result         {string}                 Model text response
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
    throw new Error("claude.chat: messages array is required and must not be empty");
  }

  // If a single user message, use it directly
  if (messages.length === 1 && messages[0].role === "user") {
    return messages[0].content;
  }

  // Multi-turn: format as a transcript for Claude Code's -p mode
  const parts = [];
  for (const msg of messages) {
    if (msg.role === "system") continue; // handled via --system-prompt
    const prefix = msg.role === "user" ? "User" : "Assistant";
    parts.push(`${prefix}: ${msg.content}`);
  }
  return parts.join("\n\n");
}

function extractSystemPrompt(messages) {
  const systemMsgs = messages.filter((m) => m.role === "system");
  if (systemMsgs.length === 0) return null;
  return systemMsgs.map((m) => m.content).join("\n\n");
}

function runClaude(args, prompt, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn("claude", args, {
      cwd: process.cwd(),
      env: {
        ...process.env,
        CLAUDECODE: undefined,  // allow nested invocation
      },
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
      if (stdoutBytes > MAX_STDOUT_BYTES) {
        child.kill("SIGKILL");
        return;
      }
      stdout += chunk;
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      if (timedOut) {
        reject(new Error(`claude.chat: timed out after ${timeoutMs}ms`));
        return;
      }
      if (stdoutBytes > MAX_STDOUT_BYTES) {
        reject(new Error(`claude.chat: stdout exceeded ${MAX_STDOUT_BYTES} bytes`));
        return;
      }
      resolve({ exitCode: code ?? -1, stdout, stderr: stderr.trim() });
    });

    // Write prompt to stdin and close
    if (prompt) {
      child.stdin.write(prompt);
    }
    child.stdin.end();
  });
}

export async function run(input) {
  const request = input?.request ?? {};
  const options = input?.options ?? {};

  const messages = request.messages ?? [];
  const model = request.model || options.model || DEFAULT_MODEL;
  const systemPrompt = request.systemPrompt || extractSystemPrompt(messages);
  const tools = request.tools ?? "";
  const maxBudgetUsd = request.maxBudgetUsd || options.maxBudgetUsd;
  const effort = request.effort || options.effort;
  const timeoutMs = Number(options.timeoutMs || DEFAULT_TIMEOUT_MS);

  const prompt = buildPrompt(messages);

  // Build claude CLI arguments
  const args = [
    "-p",                           // print mode (non-interactive)
    "--output-format", "json",      // structured JSON output
    "--no-session-persistence",     // don't save session to disk
    "--model", model,
    "--tools", tools || '""',       // empty string = no tools
  ];

  if (systemPrompt) {
    args.push("--system-prompt", systemPrompt);
  }

  if (maxBudgetUsd) {
    args.push("--max-budget-usd", String(maxBudgetUsd));
  }

  if (effort) {
    args.push("--effort", effort);
  }

  // Pass prompt as positional argument
  args.push(prompt);

  const result = await runClaude(args, null, timeoutMs);

  if (result.exitCode !== 0) {
    throw new Error(
      `claude.chat: CLI exited with code ${result.exitCode}${
        result.stderr ? `: ${result.stderr}` : ""
      }`,
    );
  }

  // Parse JSON output
  let parsed;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    // If JSON parse fails, treat raw stdout as the result text
    return {
      result: result.stdout.trim(),
      model,
      usage: {},
      sessionId: null,
      durationMs: 0,
    };
  }

  return {
    result: parsed.result || "",
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
