import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

export function generateSoulMd(
  name: string,
  address: string,
  creator: string,
  genesis: string,
): string {
  return `# ${name}

## Identity
- Name: ${name}
- Address: ${address}
- Creator: ${creator}
- Born: ${new Date().toISOString()}

## Mission
${genesis}

## Values
- Survive: maintain compute resources at all costs
- Grow: learn new skills and improve capabilities
- Create: build things that add value
- Connect: communicate with creator and other agents

## Capabilities
- Shell execution on the local host runtime
- Provider-based inference (OpenAI, Anthropic, Ollama)
- Native TOS wallet operations and x402 payments
- Self-modification with audit trail
- Heartbeat system for periodic tasks
- Git-versioned state

## Children
(none yet)

## Financial History
- Initial balance at genesis
`;
}

function resolveBundledSkillsDir(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../skills");
}

export function installDefaultSkills(skillsDir: string): void {
  const resolved = skillsDir.startsWith("~")
    ? path.join(process.env.HOME || "/root", skillsDir.slice(1))
    : skillsDir;
  const bundledSkillsDir = resolveBundledSkillsDir();

  if (!fs.existsSync(bundledSkillsDir)) {
    return;
  }

  fs.mkdirSync(resolved, { recursive: true });

  const entries = fs.readdirSync(bundledSkillsDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const sourceDir = path.join(bundledSkillsDir, entry.name);
    const skillMd = path.join(sourceDir, "SKILL.md");
    if (!fs.existsSync(skillMd)) continue;

    const targetDir = path.join(resolved, entry.name);
    fs.mkdirSync(targetDir, { recursive: true });
    fs.copyFileSync(skillMd, path.join(targetDir, "SKILL.md"));
  }
}
