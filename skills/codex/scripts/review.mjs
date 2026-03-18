/**
 * OpenFox skill backend: codex.review
 *
 * Runs a code review via the Codex CLI.  Feeds file content (or a diff) to
 * Codex with a review-oriented system prompt and returns structured feedback.
 *
 * Input (request):
 *   - content        {string}                 Code or diff to review (required)
 *   - filename       {string}                 Filename for context (optional)
 *   - language       {string}                 Programming language hint (optional)
 *   - focusAreas     {string[]}               Areas to focus on: security, performance, readability, etc. (optional)
 *   - model          {string}                 Model id (default: from codex config)
 *   - sandbox        {string}                 Sandbox mode (optional)
 *
 * Output:
 *   - result         {string}                 Review feedback text
 *   - model          {string}                 Model used
 *   - usage          {object}                 Token usage
 *   - threadId       {string}                 Codex thread ID
 */
import { spawn } from "node:child_process";

const DEFAULT_TIMEOUT_MS = 180_000;
const MAX_STDOUT_BYTES = 2 * 1024 * 1024;

function buildReviewPrompt(request) {
  const parts = [];

  parts.push("Please review the following code and provide detailed feedback.");

  if (request.filename) {
    parts.push(`File: ${request.filename}`);
  }
  if (request.language) {
    parts.push(`Language: ${request.language}`);
  }
  if (request.focusAreas?.length > 0) {
    parts.push(`Focus areas: ${request.focusAreas.join(", ")}`);
  }

  parts.push("");
  parts.push("```");
  parts.push(request.content);
  parts.push("```");

  return parts.join("\n");
}

const REVIEW_SYSTEM_PROMPT =
  "You are an expert code reviewer. Provide clear, actionable feedback organized by severity " +
  "(critical, warning, suggestion). For each issue, explain the problem and suggest a fix. " +
  "Focus on correctness, security, performance, and readability. Be concise but thorough.";

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
      if (timedOut) { reject(new Error(`codex.review: timed out after ${timeoutMs}ms`)); return; }
      if (stdoutBytes > MAX_STDOUT_BYTES) { reject(new Error("codex.review: stdout too large")); return; }
      resolve({ exitCode: code ?? -1, stdout, stderr: stderr.trim() });
    });

    child.stdin.end();
  });
}

export async function run(input) {
  const request = input?.request ?? {};
  const options = input?.options ?? {};

  if (!request.content || typeof request.content !== "string") {
    throw new Error("codex.review: content string is required");
  }

  const model = request.model || options.model;
  const sandbox = request.sandbox || options.sandbox || "read-only";
  const timeoutMs = Number(options.timeoutMs || DEFAULT_TIMEOUT_MS);

  const prompt = buildReviewPrompt(request);

  const args = [
    "exec",
    "--json",
    "--ephemeral",
    "--skip-git-repo-check",
    "--sandbox", sandbox,
    "-c", `system_prompt="${REVIEW_SYSTEM_PROMPT.replace(/"/g, '\\"')}"`,
  ];

  if (model) {
    args.push("-m", model);
  }

  args.push(prompt);

  const result = await runCodex(args, timeoutMs);

  if (result.exitCode !== 0 && !result.stdout.trim()) {
    throw new Error(
      `codex.review: CLI exited with code ${result.exitCode}${
        result.stderr ? `: ${result.stderr}` : ""
      }`,
    );
  }

  const parsed = parseCodexJsonl(result.stdout);

  if (parsed.error && !parsed.resultText) {
    throw new Error(`codex.review: ${parsed.error}`);
  }

  return {
    result: parsed.resultText,
    model: model || "gpt-5.4",
    usage: parsed.usage,
    threadId: parsed.threadId,
  };
}
