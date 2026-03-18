import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { readOption } from "../cli/parse.js";
import { createLogger } from "../observability/logger.js";

const logger = createLogger("packs");

export interface BundledPackInfo {
  name: string;
  path: string;
  version: string | null;
  description: string | null;
}

export interface BundledPackManifest {
  name: string;
  version: string;
  description?: string;
  policies?: string[];
  manifests?: string[];
  contracts?: string[];
}

export interface BundledPackLintResult {
  rootPath: string;
  manifestPath: string | null;
  errors: string[];
  warnings: string[];
}

function getPackRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../packs");
}

function readJson<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
}

function extractDescription(readmePath: string): string | null {
  if (!fs.existsSync(readmePath)) return null;
  const lines = fs.readFileSync(readmePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    return trimmed;
  }
  return null;
}

export function listBundledPacks(): BundledPackInfo[] {
  const root = getPackRoot();
  if (!fs.existsSync(root)) return [];
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((entry) => {
      const packPath = path.join(root, entry.name);
      const manifestPath = path.join(packPath, "pack.json");
      const readmePath = path.join(packPath, "README.md");
      const manifest = fs.existsSync(manifestPath)
        ? readJson<BundledPackManifest>(manifestPath)
        : null;
      return {
        name: entry.name,
        path: packPath,
        version: manifest?.version || null,
        description: manifest?.description || extractDescription(readmePath),
      };
    });
}

export function readBundledPackReadme(name: string): string {
  const packPath = path.join(getPackRoot(), name, "README.md");
  if (!fs.existsSync(packPath)) {
    throw new Error(`Bundled pack README not found: ${name}`);
  }
  return fs.readFileSync(packPath, "utf8");
}

export function exportBundledPack(params: {
  name: string;
  outputPath: string;
  force?: boolean;
}): { name: string; sourcePath: string; outputPath: string } {
  const sourcePath = path.join(getPackRoot(), params.name);
  if (!fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isDirectory()) {
    throw new Error(`Unknown bundled pack: ${params.name}`);
  }
  const outputPath = path.resolve(params.outputPath);
  if (fs.existsSync(outputPath)) {
    if (!params.force) {
      throw new Error(`Output path already exists: ${outputPath}. Re-run with --force to overwrite.`);
    }
    fs.rmSync(outputPath, { recursive: true, force: true });
  }
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.cpSync(sourcePath, outputPath, { recursive: true });
  return { name: params.name, sourcePath, outputPath };
}

export function lintBundledPack(rootPath: string): BundledPackLintResult {
  const resolvedRoot = path.resolve(rootPath);
  const manifestPath = path.join(resolvedRoot, "pack.json");
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!fs.existsSync(resolvedRoot)) {
    errors.push("pack root does not exist");
    return { rootPath: resolvedRoot, manifestPath: null, errors, warnings };
  }
  if (!fs.existsSync(manifestPath)) {
    errors.push("missing pack.json");
    return { rootPath: resolvedRoot, manifestPath: null, errors, warnings };
  }
  const manifest = readJson<BundledPackManifest>(manifestPath);
  if (!manifest.name?.trim()) errors.push("pack.json must define name");
  if (!manifest.version?.trim()) errors.push("pack.json must define version");
  if (!fs.existsSync(path.join(resolvedRoot, "README.md"))) {
    warnings.push("missing README.md");
  }
  for (const relative of manifest.policies ?? []) {
    if (!fs.existsSync(path.join(resolvedRoot, relative))) {
      errors.push(`missing policy export: ${relative}`);
    }
  }
  for (const relative of manifest.manifests ?? []) {
    if (!fs.existsSync(path.join(resolvedRoot, relative))) {
      errors.push(`missing manifest export: ${relative}`);
    }
  }
  for (const relative of manifest.contracts ?? []) {
    if (!fs.existsSync(path.join(resolvedRoot, relative))) {
      errors.push(`missing contract example: ${relative}`);
    }
  }
  const inspectJson = (relative: string): void => {
    const filePath = path.join(resolvedRoot, relative);
    if (!fs.existsSync(filePath)) return;
    let text = "";
    try {
      text = fs.readFileSync(filePath, "utf8");
    } catch {
      errors.push(`unable to read JSON export: ${relative}`);
      return;
    }
    if (text.includes("cryptographic_proof_verification")) {
      errors.push(
        `legacy verifier class cryptographic_proof_verification is not allowed: ${relative}`,
      );
    }
    if (text.includes('"verificationMode": "fallback"') || text.includes('"verificationMode":"fallback"')) {
      errors.push(`legacy verification mode fallback is not allowed: ${relative}`);
    }
    if (
      text.includes('"verificationMode": "cryptographic"') ||
      text.includes('"verificationMode":"cryptographic"')
    ) {
      errors.push(`legacy verification mode cryptographic is not allowed: ${relative}`);
    }
  };
  for (const relative of [...(manifest.policies ?? []), ...(manifest.contracts ?? []), ...(manifest.manifests ?? [])]) {
    if (relative.endsWith(".json")) inspectJson(relative);
  }
  return { rootPath: resolvedRoot, manifestPath, errors, warnings };
}

export async function handlePacksCommand(args: string[]): Promise<void> {
  const command = args[0] || "list";
  const asJson = args.includes("--json");
  if (args.includes("--help") || args.includes("-h") || command === "help") {
    logger.info(`
OpenFox packs

Usage:
  openfox packs list [--json]
  openfox packs show <name>
  openfox packs export <name> --output <path> [--force] [--json]
  openfox packs lint --path <dir> [--json]
`);
    return;
  }

  if (command === "list") {
    const items = listBundledPacks();
    if (asJson) {
      logger.info(JSON.stringify({ items }, null, 2));
      return;
    }
    if (items.length === 0) {
      logger.info("No bundled packs found.");
      return;
    }
    logger.info("=== OPENFOX PACKS ===");
    for (const item of items) {
      logger.info(`${item.name}${item.version ? `  v${item.version}` : ""}`);
      if (item.description) logger.info(`  ${item.description}`);
    }
    return;
  }

  if (command === "show") {
    const name = args[1];
    if (!name) throw new Error("Usage: openfox packs show <name>");
    logger.info(readBundledPackReadme(name));
    return;
  }

  if (command === "export") {
    const name = args[1];
    const outputPath = readOption(args, "--output");
    if (!name || !outputPath) {
      throw new Error("Usage: openfox packs export <name> --output <path> [--force] [--json]");
    }
    const result = exportBundledPack({
      name,
      outputPath,
      force: args.includes("--force"),
    });
    if (asJson) {
      logger.info(JSON.stringify(result, null, 2));
      return;
    }
    logger.info(
      ["Pack exported.", `Name: ${result.name}`, `Source: ${result.sourcePath}`, `Output: ${result.outputPath}`].join("\n"),
    );
    return;
  }

  if (command === "lint") {
    const packPath = readOption(args, "--path");
    if (!packPath) {
      throw new Error("Usage: openfox packs lint --path <dir> [--json]");
    }
    const result = lintBundledPack(packPath);
    if (asJson) {
      logger.info(JSON.stringify(result, null, 2));
      return;
    }
    logger.info(
      [
        "=== OPENFOX PACK LINT ===",
        `Root: ${result.rootPath}`,
        `Manifest: ${result.manifestPath || "(missing)"}`,
        `Errors: ${result.errors.length}`,
        `Warnings: ${result.warnings.length}`,
        ...result.errors.map((value) => `ERROR: ${value}`),
        ...result.warnings.map((value) => `WARN: ${value}`),
      ].join("\n"),
    );
    return;
  }

  throw new Error(`Unknown packs command: ${command}`);
}
