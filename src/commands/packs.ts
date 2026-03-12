import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

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
