import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";
import type {
  OpenFoxConfig,
  OpenFoxDatabase,
  Skill,
} from "../types.js";
import { loadSkills } from "./loader.js";

export interface SkillBackendRunContext {
  config: OpenFoxConfig;
  db: OpenFoxDatabase;
  now: () => Date;
}

export interface SkillBackendRunParams {
  skillsDir: string;
  skillName: string;
  backendName: string;
  input: unknown;
  context: SkillBackendRunContext;
}

interface SkillBackendModule {
  run?: (input: unknown, context: SkillBackendRunContext) => Promise<unknown> | unknown;
  default?: (input: unknown, context: SkillBackendRunContext) => Promise<unknown> | unknown;
}

export async function runSkillBackend(
  params: SkillBackendRunParams,
): Promise<unknown> {
  const skill = resolveEnabledSkill(params.skillsDir, params.context.db, params.skillName);
  const backendSpec = skill.providerBackends?.[params.backendName];
  if (!backendSpec) {
    throw new Error(
      `Skill "${params.skillName}" does not expose provider backend "${params.backendName}"`,
    );
  }

  const skillDir = path.dirname(skill.path);
  const entryPath = resolveSkillEntry(skillDir, backendSpec.entry);
  const module = (await importSkillModule(entryPath)) as SkillBackendModule;
  const handler =
    typeof module.run === "function"
      ? module.run
      : typeof module.default === "function"
        ? module.default
        : null;
  if (!handler) {
    throw new Error(
      `Skill backend "${params.skillName}.${params.backendName}" does not export a run() handler`,
    );
  }
  return await handler(params.input, params.context);
}

function resolveEnabledSkill(
  skillsDir: string,
  db: OpenFoxDatabase,
  skillName: string,
): Skill {
  const skill = loadSkills(skillsDir, db).find((entry) => entry.name === skillName);
  if (!skill) {
    throw new Error(`Enabled skill not found: ${skillName}`);
  }
  return skill;
}

function resolveSkillEntry(skillDir: string, entry: string): string {
  if (!entry.trim()) {
    throw new Error("Skill backend entry must not be empty");
  }
  if (path.isAbsolute(entry)) {
    throw new Error("Skill backend entry must be relative to the skill directory");
  }
  const resolved = path.resolve(skillDir, entry);
  if (resolved !== skillDir && !resolved.startsWith(skillDir + path.sep)) {
    throw new Error("Skill backend entry resolves outside the skill directory");
  }
  if (!fs.existsSync(resolved)) {
    throw new Error(`Skill backend entry not found: ${resolved}`);
  }
  return resolved;
}

async function importSkillModule(entryPath: string): Promise<unknown> {
  const stat = fs.statSync(entryPath);
  return await import(`${pathToFileURL(entryPath).href}?mtime=${stat.mtimeMs}`);
}
