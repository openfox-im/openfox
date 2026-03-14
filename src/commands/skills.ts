import { loadConfig, resolvePath } from "../config.js";
import { createDatabase } from "../state/database.js";
import { createRuntimeClient } from "../runtime/client.js";
import { loadApiKeyFromConfig } from "../identity/provision.js";
import { buildSkillStatusReport } from "../skills/loader.js";
import { installSkillFromGit, installSkillFromUrl } from "../skills/registry.js";
import { readOption } from "../cli/parse.js";
import { createLogger } from "../observability/logger.js";

const logger = createLogger("skills");

export async function handleSkillsCommand(args: string[]): Promise<void> {
  if (args.length === 0 || args[0] === "--help" || args[0] === "-h" || args[0] === "help") {
    logger.info(`
OpenFox skills

Usage:
  openfox skills list
  openfox skills status [name]
  openfox skills enable <name>
  openfox skills disable <name>
  openfox skills install --name <name> --git <repo-url>
  openfox skills install --name <name> --url <skill-md-url>
`);
    return;
  }

  const config = loadConfig();
  if (!config) {
    logger.error("OpenFox is not configured. Run openfox --setup first.");
    process.exit(1);
  }

  const db = createDatabase(resolvePath(config.dbPath));
  const skillsDir = config.skillsDir || "~/.openfox/skills";
  const command = args[0] || "list";

  try {
    if (command === "list") {
      const report = buildSkillStatusReport(skillsDir, db);
      if (report.length === 0) {
        logger.info("No skills found.");
        return;
      }
      logger.info("=== OPENFOX SKILLS ===");
      for (const entry of report) {
        const state = entry.enabled ? "enabled" : "disabled";
        const eligibility = entry.eligible ? "eligible" : "missing requirements";
        logger.info(
          `${entry.name}  [${entry.source}]  ${state}  ${eligibility}${entry.always ? "  always" : ""}`,
        );
        if (entry.description) {
          logger.info(`  ${entry.description}`);
        }
      }
      return;
    }

    if (command === "status") {
      const targetName = args[1]?.trim();
      const report = buildSkillStatusReport(skillsDir, db);
      const entries = targetName
        ? report.filter((entry) => entry.name === targetName)
        : report;
      if (entries.length === 0) {
        logger.error(targetName ? `Skill not found: ${targetName}` : "No skills found.");
        process.exit(1);
      }
      for (const entry of entries) {
        logger.info(`
=== SKILL STATUS ===
Name:        ${entry.name}
Source:      ${entry.source}
Enabled:     ${entry.enabled ? "yes" : "no"}
Eligible:    ${entry.eligible ? "yes" : "no"}
Always:      ${entry.always ? "yes" : "no"}
Path:        ${entry.path}
Homepage:    ${entry.homepage || "(none)"}
Primary env: ${entry.primaryEnv || "(none)"}
Missing bins: ${entry.missingBins.length > 0 ? entry.missingBins.join(", ") : "(none)"}
Missing any-bins set: ${entry.missingAnyBins.length > 0 ? entry.missingAnyBins.join(", ") : "(none)"}
Missing env: ${entry.missingEnv.length > 0 ? entry.missingEnv.join(", ") : "(none)"}
Install hints: ${entry.install.length > 0 ? entry.install.map((spec) => spec.label || spec.kind).join(", ") : "(none)"}
Description: ${entry.description || "(none)"}
=====================
`);
      }
      return;
    }

    if (command === "enable" || command === "disable") {
      const name = args[1]?.trim();
      if (!name) {
        logger.error(`Usage: openfox skills ${command} <name>`);
        process.exit(1);
      }
      const skill = db.getSkillByName(name);
      if (!skill) {
        logger.error(`Skill not found: ${name}`);
        process.exit(1);
      }
      db.setSkillEnabled(name, command === "enable");
      logger.info(`Skill ${command}d: ${name}`);
      return;
    }

    if (command === "install") {
      const name = readOption(args, "--name");
      const gitUrl = readOption(args, "--git");
      const url = readOption(args, "--url");

      if (!name || (!gitUrl && !url) || (gitUrl && url)) {
        logger.error("Usage: openfox skills install --name <name> (--git <repo-url> | --url <skill-md-url>)");
        process.exit(1);
      }

      const runtime = createRuntimeClient({
        apiUrl: config.runtimeApiUrl,
        apiKey: config.runtimeApiKey || loadApiKeyFromConfig() || "",
        sandboxId: config.sandboxId,
      });

      const installed = gitUrl
        ? await installSkillFromGit(gitUrl, name, skillsDir, db, runtime)
        : await installSkillFromUrl(url!, name, skillsDir, db, runtime);

      if (!installed) {
        logger.error("Skill installation failed.");
        process.exit(1);
      }
      logger.info(`Skill installed: ${installed.name} (${installed.source})`);
      return;
    }

    logger.error(`Unknown skills command: ${command}`);
    logger.info(`Available commands: list, status, install, enable, disable`);
    process.exit(1);
  } finally {
    db.close();
  }
}
