import fs from "fs";

export interface EnvironmentInfo {
  type: string;
  sandboxId: string;
}

export function detectEnvironment(): EnvironmentInfo {
  // 1. Check env var
  if (process.env.OPENFOX_SANDBOX_ID) {
    const sandboxId = process.env.OPENFOX_SANDBOX_ID.trim();
    if (sandboxId) {
      return { type: "runtime-sandbox", sandboxId };
    }
  }

  // 2. Check sandbox config file
  try {
    if (fs.existsSync("/etc/runtime/sandbox.json")) {
      const data = JSON.parse(fs.readFileSync("/etc/runtime/sandbox.json", "utf-8"));
      if (data.id) {
        const sandboxId = String(data.id).trim();
        if (sandboxId) {
          return { type: "runtime-sandbox", sandboxId };
        }
      }
    }
  } catch {}

  // 3. Check Docker
  if (fs.existsSync("/.dockerenv")) {
    return { type: "docker", sandboxId: "" };
  }

  // 4. Fall back to platform
  return { type: process.platform, sandboxId: "" };
}
