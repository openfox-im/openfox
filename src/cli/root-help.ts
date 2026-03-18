import { ROOT_COMMANDS } from "./root-commands.js";

interface HelpLine {
  readonly invocation: string;
  readonly summary: string;
}

const ROOT_PREFIX_LINES: readonly HelpLine[] = [
  {
    invocation: "openfox --run",
    summary: "Start the openfox (first run triggers setup wizard)",
  },
  {
    invocation: "openfox --setup",
    summary: "Re-run the interactive setup wizard",
  },
  {
    invocation: "openfox --configure",
    summary: "Edit configuration (providers, model, treasury, general)",
  },
  {
    invocation: "openfox --pick-model",
    summary: "Interactively pick the active inference model",
  },
  {
    invocation: "openfox --init",
    summary: "Initialize wallet and config directory",
  },
  {
    invocation: "openfox --status",
    summary: "Show current openfox status",
  },
] as const;

const ROOT_SUFFIX_LINES: readonly HelpLine[] = [
  {
    invocation: "openfox --version",
    summary: "Show version",
  },
  {
    invocation: "openfox --help",
    summary: "Show this help",
  },
] as const;

const ENVIRONMENT_LINES: readonly string[] = [
  "  OPENAI_API_KEY           OpenAI API key",
  "  ANTHROPIC_API_KEY        Anthropic API key",
  "  OLLAMA_BASE_URL          Ollama base URL (overrides config, e.g. http://localhost:11434)",
  "  OPENFOX_API_URL           Legacy Runtime API URL (optional)",
  "  OPENFOX_API_KEY           Legacy Runtime API key (optional)",
  "  TOS_RPC_URL              Chain RPC URL (overrides config for native wallet operations)",
] as const;

function formatUsageLines(lines: readonly HelpLine[]): string {
  const width = lines.reduce(
    (max, line) => Math.max(max, line.invocation.length),
    0,
  );
  return lines
    .map((line) => `  ${line.invocation.padEnd(width)}  ${line.summary}`)
    .join("\n");
}

export function buildRootHelp(version: string): string {
  const commandLines: HelpLine[] = ROOT_COMMANDS.map((command) => ({
    invocation: command.invocation,
    summary: command.summary,
  }));
  const usageLines = [
    ...ROOT_PREFIX_LINES,
    ...commandLines,
    ...ROOT_SUFFIX_LINES,
  ];
  return `
OpenFox v${version}
Sovereign AI Agent Runtime

Usage:
${formatUsageLines(usageLines)}

Environment:
${ENVIRONMENT_LINES.join("\n")}
`;
}
