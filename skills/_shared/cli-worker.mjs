import { spawn } from "node:child_process";

const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_STDIN_BYTES = 256 * 1024;
const DEFAULT_MAX_STDOUT_BYTES = 1024 * 1024;

export async function runCliWorker(worker, envelope) {
  if (!worker?.command || typeof worker.command !== "string") {
    throw new Error("CLI worker command is not configured");
  }

  const stdinPayload = JSON.stringify(envelope);
  const maxStdinBytes = Number(worker.maxStdinBytes || DEFAULT_MAX_STDIN_BYTES);
  if (Buffer.byteLength(stdinPayload) > maxStdinBytes) {
    throw new Error(`CLI worker stdin exceeds maxStdinBytes (${maxStdinBytes})`);
  }

  const timeoutMs = Number(worker.timeoutMs || DEFAULT_TIMEOUT_MS);
  const maxStdoutBytes = Number(worker.maxStdoutBytes || DEFAULT_MAX_STDOUT_BYTES);
  const args = Array.isArray(worker.args) ? worker.args.map(String) : [];

  return await new Promise((resolve, reject) => {
    const child = spawn(worker.command, args, {
      cwd: worker.cwd || process.cwd(),
      env: {
        ...process.env,
        ...(worker.env || {}),
      },
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let stdoutBytes = 0;

    const killTimer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");

    child.stdout.on("data", (chunk) => {
      stdoutBytes += Buffer.byteLength(chunk);
      if (stdoutBytes > maxStdoutBytes) {
        child.kill("SIGKILL");
        return;
      }
      stdout += chunk;
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });

    child.on("error", (error) => {
      clearTimeout(killTimer);
      reject(error);
    });

    child.on("close", (code, signal) => {
      clearTimeout(killTimer);
      if (timedOut) {
        reject(new Error(`CLI worker timed out after ${timeoutMs}ms`));
        return;
      }
      if (stdoutBytes > maxStdoutBytes) {
        reject(new Error(`CLI worker stdout exceeds maxStdoutBytes (${maxStdoutBytes})`));
        return;
      }

      let parsed;
      if (stdout.trim()) {
        try {
          parsed = JSON.parse(stdout);
        } catch (error) {
          reject(
            new Error(
              `CLI worker returned invalid JSON stdout: ${error instanceof Error ? error.message : String(error)}`,
            ),
          );
          return;
        }
      }

      resolve({
        exitCode: code ?? -1,
        signal: signal ?? null,
        stdout: parsed,
        stderr: stderr.trim() || undefined,
      });
    });

    child.stdin.write(stdinPayload);
    child.stdin.end();
  });
}

export function unwrapCliWorkerResult(result, expectedWorker) {
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    throw new Error("CLI worker stdout must be an object");
  }
  if (result.schema_version !== "openfox.cli-worker.v1") {
    throw new Error("CLI worker schema_version must be openfox.cli-worker.v1");
  }
  if (result.worker !== expectedWorker) {
    throw new Error(`CLI worker response worker mismatch: expected ${expectedWorker}`);
  }
  if (!("result" in result)) {
    throw new Error("CLI worker stdout is missing result");
  }
  return result.result;
}
