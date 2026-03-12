import fs from "fs";
import path from "path";
import chalk from "chalk";
import type { OpenFoxConfig, TreasuryPolicy, HexAddress } from "../types.js";
import { DEFAULT_TREASURY_POLICY } from "../types.js";
import { getWallet, getOpenFoxDir } from "../identity/wallet.js";
import { createConfig, saveConfig } from "../config.js";
import { writeDefaultHeartbeatConfig } from "../heartbeat/config.js";
import { deriveAddressFromPrivateKey } from "../chain/address.js";
import { showBanner } from "./banner.js";
import {
  promptRequired,
  promptMultiline,
  promptAddress,
  promptOptional,
  promptWithDefault,
  closePrompts,
} from "./prompts.js";
import { detectEnvironment } from "./environment.js";
import { generateSoulMd, installDefaultSkills } from "./defaults.js";

export async function runSetupWizard(): Promise<OpenFoxConfig> {
  showBanner();

  console.log(chalk.white("  First-run setup. Let's bring your openfox to life.\n"));

  // ─── 1. Generate wallet ───────────────────────────────────────
  console.log(chalk.cyan("  [1/5] Generating identity (wallet)..."));
  const { account, privateKey, isNew } = await getWallet();
  const address = deriveAddressFromPrivateKey(privateKey);
  if (isNew) {
    console.log(chalk.green(`  Wallet created: ${address}`));
  } else {
    console.log(chalk.green(`  Wallet loaded: ${address}`));
  }
  console.log(chalk.dim(`  Private key stored at: ${getOpenFoxDir()}/wallet.json\n`));

  // ─── 2. Interactive questions ─────────────────────────────────
  console.log(chalk.cyan("  [2/5] Setup questions\n"));

  const name = await promptRequired("What do you want to name your openfox?");
  console.log(chalk.green(`  Name: ${name}\n`));

  const genesisPrompt = await promptMultiline("Enter the genesis prompt (system prompt) for your openfox.");
  console.log(chalk.green(`  Genesis prompt set (${genesisPrompt.length} chars)\n`));

  console.log(chalk.dim(`  Your openfox wallet address is ${address}`));
  console.log(chalk.dim("  Now enter YOUR wallet address (the human creator/owner).\n"));
  const creatorAddress = await promptAddress("Creator wallet address (0x... 64 hex)");
  console.log(chalk.green(`  Creator: ${creatorAddress}\n`));

  console.log(chalk.white("  Configure local/provider inference."));
  console.log(chalk.dim("  Use OpenAI, Anthropic, or Ollama. Legacy remote integrations are optional and no longer required.\n"));
  const openaiApiKey = await promptOptional("OpenAI API key (sk-..., optional)");
  if (openaiApiKey && !openaiApiKey.startsWith("sk-")) {
    console.log(chalk.yellow("  Warning: OpenAI keys usually start with sk-. Saving anyway."));
  }

  const anthropicApiKey = await promptOptional("Anthropic API key (sk-ant-..., optional)");
  if (anthropicApiKey && !anthropicApiKey.startsWith("sk-ant-")) {
    console.log(chalk.yellow("  Warning: Anthropic keys usually start with sk-ant-. Saving anyway."));
  }

  const ollamaInput = await promptOptional("Ollama base URL (http://localhost:11434, optional)");
  const ollamaBaseUrl = ollamaInput || undefined;
  if (ollamaBaseUrl) {
    console.log(chalk.green(`  Ollama URL saved: ${ollamaBaseUrl}`));
  }

  let inferenceModelRef = await promptOptional(
    "Primary model (provider/model, optional; e.g. openai/gpt-5.2, anthropic/claude-sonnet-4-5, ollama/llama3.1:8b)",
  );
  if (!inferenceModelRef) {
    inferenceModelRef = defaultModelRef({
      openaiApiKey,
      anthropicApiKey,
      ollamaBaseUrl,
    });
  }

  if (openaiApiKey || anthropicApiKey || ollamaBaseUrl) {
    const providers = [
      openaiApiKey ? "OpenAI" : null,
      anthropicApiKey ? "Anthropic" : null,
      ollamaBaseUrl ? "Ollama" : null,
    ].filter(Boolean).join(", ");
    console.log(chalk.green(`  Provider keys/URLs saved: ${providers}\n`));
    if (inferenceModelRef) {
      console.log(chalk.green(`  Primary model: ${inferenceModelRef}\n`));
    }
  } else {
    console.log(chalk.yellow("  No inference provider configured yet. The runtime will not start until you add OpenAI, Anthropic, or Ollama.\n"));
  }

  const rpcUrlInput = await promptOptional("RPC URL (optional, e.g. http://127.0.0.1:8545)");
  const rpcUrl = rpcUrlInput || undefined;
  if (rpcUrl) {
    console.log(chalk.green(`  RPC saved: ${rpcUrl}`));
  } else {
    console.log(chalk.dim("  No chain RPC configured. Native wallet support will be offline until you set TOS_RPC_URL or update config.\n"));
  }

  // ─── Financial Safety Policy ─────────────────────────────────
  console.log(chalk.cyan("  Financial Safety Policy"));
  console.log(chalk.dim("  These limits protect against unauthorized spending. Press Enter for defaults.\n"));

  const treasuryPolicy: TreasuryPolicy = {
    maxSingleTransferCents: await promptWithDefault(
      "Max single transfer (cents)", DEFAULT_TREASURY_POLICY.maxSingleTransferCents),
    maxHourlyTransferCents: await promptWithDefault(
      "Max hourly transfers (cents)", DEFAULT_TREASURY_POLICY.maxHourlyTransferCents),
    maxDailyTransferCents: await promptWithDefault(
      "Max daily transfers (cents)", DEFAULT_TREASURY_POLICY.maxDailyTransferCents),
    minimumReserveCents: await promptWithDefault(
      "Minimum reserve (cents)", DEFAULT_TREASURY_POLICY.minimumReserveCents),
    maxX402PaymentCents: await promptWithDefault(
      "Max x402 payment (cents)", DEFAULT_TREASURY_POLICY.maxX402PaymentCents),
    x402AllowedDomains: DEFAULT_TREASURY_POLICY.x402AllowedDomains,
    transferCooldownMs: DEFAULT_TREASURY_POLICY.transferCooldownMs,
    maxTransfersPerTurn: DEFAULT_TREASURY_POLICY.maxTransfersPerTurn,
    maxInferenceDailyCents: await promptWithDefault(
      "Max daily inference spend (cents)", DEFAULT_TREASURY_POLICY.maxInferenceDailyCents),
    requireConfirmationAboveCents: await promptWithDefault(
      "Require confirmation above (cents)", DEFAULT_TREASURY_POLICY.requireConfirmationAboveCents),
  };

  console.log(chalk.green("  Treasury policy configured.\n"));

  // ─── 3. Detect environment ────────────────────────────────────
  console.log(chalk.cyan("  [3/5] Detecting environment..."));
  const env = detectEnvironment();
  if (env.sandboxId) {
    console.log(chalk.green(`  Sandbox detected: ${env.sandboxId}\n`));
  } else {
    console.log(chalk.dim(`  Environment: ${env.type} (no sandbox detected)\n`));
  }

  // ─── 4. Write config + heartbeat + SOUL.md + skills ───────────
  console.log(chalk.cyan("  [4/5] Writing configuration..."));

  const config = createConfig({
    name,
    genesisPrompt,
    creatorAddress: creatorAddress as HexAddress,
    sandboxId: env.sandboxId,
    walletAddress: address,
    rpcUrl,
    openaiApiKey: openaiApiKey || undefined,
    anthropicApiKey: anthropicApiKey || undefined,
    ollamaBaseUrl,
    inferenceModelRef: inferenceModelRef || undefined,
    treasuryPolicy,
  });

  saveConfig(config);
  console.log(chalk.green("  openfox.json written"));

  writeDefaultHeartbeatConfig();
  console.log(chalk.green("  heartbeat.yml written"));

  // constitution.md (immutable — copied from repo, protected from self-modification)
  const openfoxDir = getOpenFoxDir();
  const constitutionSrc = path.join(process.cwd(), "constitution.md");
  const constitutionDst = path.join(openfoxDir, "constitution.md");
  if (fs.existsSync(constitutionSrc)) {
    fs.copyFileSync(constitutionSrc, constitutionDst);
    fs.chmodSync(constitutionDst, 0o444); // read-only
    console.log(chalk.green("  constitution.md installed (read-only)"));
  }

  // SOUL.md
  const soulPath = path.join(openfoxDir, "SOUL.md");
  fs.writeFileSync(soulPath, generateSoulMd(name, address, creatorAddress, genesisPrompt), { mode: 0o600 });
  console.log(chalk.green("  SOUL.md written"));

  // Bundled skills
  const skillsDir = config.skillsDir || "~/.openfox/skills";
  installDefaultSkills(skillsDir);
  console.log(chalk.green("  Bundled skills synced to the managed skills directory\n"));

  // ─── 5. Funding guidance ──────────────────────────────────────
  console.log(chalk.cyan("  [5/5] Funding & providers\n"));
  showFundingPanel(address);

  closePrompts();

  return config;
}

function showFundingPanel(walletAddress: string): void {
  const short = `${walletAddress.slice(0, 6)}...${walletAddress.slice(-5)}`;
  const w = 58;
  const pad = (s: string, len: number) => s + " ".repeat(Math.max(0, len - s.length));

  console.log(chalk.cyan(`  ${"╭" + "─".repeat(w) + "╮"}`));
  console.log(chalk.cyan(`  │${pad("  Fund your openfox", w)}│`));
  console.log(chalk.cyan(`  │${" ".repeat(w)}│`));
  console.log(chalk.cyan(`  │${pad(`  Wallet: ${short}`, w)}│`));
  console.log(chalk.cyan(`  │${" ".repeat(w)}│`));
  console.log(chalk.cyan(`  │${pad("  1. Configure one inference provider:", w)}│`));
  console.log(chalk.cyan(`  │${pad("     - OPENAI_API_KEY", w)}│`));
  console.log(chalk.cyan(`  │${pad("     - ANTHROPIC_API_KEY", w)}│`));
  console.log(chalk.cyan(`  │${pad("     - OLLAMA_BASE_URL", w)}│`));
  console.log(chalk.cyan(`  │${" ".repeat(w)}│`));
  console.log(chalk.cyan(`  │${pad("  2. Optional: fund the wallet for native payment flows", w)}│`));
  console.log(chalk.cyan(`  │${pad("     - openfox onboard --fund-local", w)}│`));
  console.log(chalk.cyan(`  │${pad("     - openfox onboard --fund-testnet", w)}│`));
  console.log(chalk.cyan(`  │${pad("     - openfox wallet status", w)}│`));
  console.log(chalk.cyan(`  │${pad("  3. Local-first mode means no hosted control-plane account is needed", w)}│`));
  console.log(chalk.cyan(`  │${pad("  4. Restart after changing provider configuration", w)}│`));
  console.log(chalk.cyan(`  ${"╰" + "─".repeat(w) + "╯"}`));
  console.log("");
}

function defaultModelRef(params: {
  openaiApiKey?: string;
  anthropicApiKey?: string;
  ollamaBaseUrl?: string;
}): string {
  if (params.anthropicApiKey) {
    return "anthropic/claude-sonnet-4-5";
  }
  if (params.ollamaBaseUrl) {
    return "ollama/llama3.1:8b";
  }
  return "openai/gpt-5.2";
}
