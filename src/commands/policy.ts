/**
 * Policy CLI Commands
 *
 * GTOS 2046: Policy authoring, simulation, and template management.
 *
 * Usage:
 *   openfox policy list                              — list all templates
 *   openfox policy show <id>                         — show template details
 *   openfox policy simulate <id>                     — run simulation battery
 *   openfox policy create <accountType> <trustLevel> — create from template
 *   openfox policy explain <id>                      — human-readable explanation
 *   openfox policy diff <id1> <id2>                  — diff two templates
 *   openfox policy validate <id>                     — validate a template
 */

import { createLogger } from "../observability/logger.js";
import {
  POLICY_TEMPLATES,
  getTemplate,
  getTemplatesForAccountType,
  createPolicyFromTemplate,
  validatePolicy,
  explainPolicy,
  diffPolicies,
  simulateBattery,
  formatSimulationResults,
} from "../policy/index.js";

const logger = createLogger("policy");

export async function handlePolicyCommand(args: string[]): Promise<void> {
  const subcommand = args[0];

  if (!subcommand || subcommand === "--help" || subcommand === "-h" || subcommand === "help") {
    printUsage();
    return;
  }

  switch (subcommand) {
    case "list":
      return handleList(args.slice(1));
    case "show":
      return handleShow(args.slice(1));
    case "simulate":
      return handleSimulate(args.slice(1));
    case "create":
      return handleCreate(args.slice(1));
    case "explain":
      return handleExplain(args.slice(1));
    case "diff":
      return handleDiff(args.slice(1));
    case "validate":
      return handleValidate(args.slice(1));
    default:
      logger.error(`Unknown policy subcommand: ${subcommand}`);
      printUsage();
  }
}

// ── list ─────────────────────────────────────────────────────────

async function handleList(args: string[]): Promise<void> {
  const accountFilter = args[0];

  const templates = accountFilter
    ? getTemplatesForAccountType(accountFilter)
    : POLICY_TEMPLATES;

  if (templates.length === 0) {
    logger.info(accountFilter
      ? `No templates found for account type "${accountFilter}".`
      : "No policy templates available.");
    return;
  }

  logger.info(`Policy Templates${accountFilter ? ` (${accountFilter})` : ""}:\n`);

  for (const t of templates) {
    logger.info(`  ${t.id}`);
    logger.info(`    ${t.name} — ${t.description.slice(0, 80)}`);
    logger.info(`    Account: ${t.accountType}  Trust: ${t.trustLevel}`);
    logger.info("");
  }

  logger.info(`Total: ${templates.length} template(s)`);
}

// ── show ─────────────────────────────────────────────────────────

async function handleShow(args: string[]): Promise<void> {
  const id = args[0];
  if (!id) {
    logger.error("Usage: openfox policy show <id>");
    return;
  }

  const template = getTemplate(id);
  if (!template) {
    logger.error(`Template "${id}" not found. Use "openfox policy list" to see available templates.`);
    return;
  }

  logger.info(`Template: ${template.id}`);
  logger.info(`  Name:        ${template.name}`);
  logger.info(`  Account:     ${template.accountType}`);
  logger.info(`  Trust level: ${template.trustLevel}`);
  logger.info(`  Description: ${template.description}`);
  logger.info("");
  logger.info(explainPolicy(template.draft));
}

// ── simulate ─────────────────────────────────────────────────────

async function handleSimulate(args: string[]): Promise<void> {
  const id = args[0];
  if (!id) {
    logger.error("Usage: openfox policy simulate <id>");
    return;
  }

  const template = getTemplate(id);
  if (!template) {
    logger.error(`Template "${id}" not found. Use "openfox policy list" to see available templates.`);
    return;
  }

  logger.info(`Simulating policy: ${template.name} (${template.id})\n`);

  const results = simulateBattery(template.draft);
  logger.info(formatSimulationResults(results));
}

// ── create ───────────────────────────────────────────────────────

async function handleCreate(args: string[]): Promise<void> {
  if (args.length < 2) {
    logger.error("Usage: openfox policy create <accountType> <trustLevel>");
    logger.error("  Account types: personal, merchant, agent, institutional");
    logger.error("  Trust levels:  conservative, standard, permissive");
    return;
  }

  const accountType = args[0]!;
  const trustLevel = args[1]!;

  const draft = createPolicyFromTemplate(accountType, trustLevel);
  const validation = validatePolicy(draft);

  logger.info(`Created policy draft: ${draft.name}\n`);
  logger.info(explainPolicy(draft));

  if (!validation.valid) {
    logger.info("\nValidation warnings:");
    for (const err of validation.errors) {
      logger.info(`  - ${err}`);
    }
  } else {
    logger.info("\nValidation: PASSED");
  }
}

// ── explain ──────────────────────────────────────────────────────

async function handleExplain(args: string[]): Promise<void> {
  const id = args[0];
  if (!id) {
    logger.error("Usage: openfox policy explain <id>");
    return;
  }

  const template = getTemplate(id);
  if (!template) {
    logger.error(`Template "${id}" not found. Use "openfox policy list" to see available templates.`);
    return;
  }

  logger.info(`${template.name} (${template.id})`);
  logger.info(`${template.description}\n`);
  logger.info(explainPolicy(template.draft));
}

// ── diff ─────────────────────────────────────────────────────────

async function handleDiff(args: string[]): Promise<void> {
  if (args.length < 2) {
    logger.error("Usage: openfox policy diff <id1> <id2>");
    return;
  }

  const t1 = getTemplate(args[0]!);
  const t2 = getTemplate(args[1]!);

  if (!t1) {
    logger.error(`Template "${args[0]}" not found.`);
    return;
  }
  if (!t2) {
    logger.error(`Template "${args[1]}" not found.`);
    return;
  }

  const diffs = diffPolicies(t1.draft, t2.draft);

  if (diffs.length === 0) {
    logger.info(`No differences between "${t1.id}" and "${t2.id}".`);
    return;
  }

  logger.info(`Differences: ${t1.id} -> ${t2.id}\n`);
  for (const d of diffs) {
    logger.info(`  ${d}`);
  }
  logger.info(`\nTotal: ${diffs.length} difference(s)`);
}

// ── validate ─────────────────────────────────────────────────────

async function handleValidate(args: string[]): Promise<void> {
  const id = args[0];
  if (!id) {
    logger.error("Usage: openfox policy validate <id>");
    return;
  }

  const template = getTemplate(id);
  if (!template) {
    logger.error(`Template "${id}" not found.`);
    return;
  }

  const result = validatePolicy(template.draft);

  if (result.valid) {
    logger.info(`Policy "${template.id}" is valid.`);
  } else {
    logger.error(`Policy "${template.id}" has ${result.errors.length} error(s):`);
    for (const err of result.errors) {
      logger.error(`  - ${err}`);
    }
  }
}

// ── Helpers ──────────────────────────────────────────────────────

function printUsage(): void {
  logger.info(`
OpenFox policy management

Usage:
  openfox policy list [accountType]              List available policy templates
  openfox policy show <id>                       Show template details
  openfox policy simulate <id>                   Run simulation battery against a template
  openfox policy create <accountType> <trustLevel>  Create a policy from template
  openfox policy explain <id>                    Human-readable policy explanation
  openfox policy diff <id1> <id2>                Compare two policy templates
  openfox policy validate <id>                   Validate a policy template

Account types: personal, merchant, agent, institutional
Trust levels:  conservative, standard, permissive
`);
}
