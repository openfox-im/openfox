import fs from "fs/promises";
import path from "path";
import { keccak256, toHex, type Hex } from "@tosnetwork/tosdk";
import { CID } from "multiformats/cid";
import { sha256 } from "multiformats/hashes/sha2";
import * as raw from "multiformats/codecs/raw";

export interface StorageBundleEntry {
  path: string;
  mediaType: string;
  encoding: "utf8" | "base64";
  content: string;
  sha256: Hex;
  sizeBytes: number;
}

export interface StorageBundleManifest {
  schema_version: 1;
  bundle_kind: string;
  bundle_hash: Hex;
  created_at: string;
  created_by: string;
  payload_entries: string[];
  proof_entries: string[];
  metadata_entries: string[];
}

export interface StorageBundle {
  manifest: StorageBundleManifest;
  payload: StorageBundleEntry[];
  proofs: StorageBundleEntry[];
  metadata: StorageBundleEntry[];
}

export interface StorageBundleInputEntry {
  path: string;
  mediaType: string;
  content: string | Uint8Array | Record<string, unknown>;
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortValue);
  }
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const next = sortValue((value as Record<string, unknown>)[key]);
      if (typeof next !== "undefined") {
        out[key] = next;
      }
    }
    return out;
  }
  return value;
}

export function canonicalizeBundleValue(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

export function hashBundleValue(value: unknown): Hex {
  return keccak256(toHex(canonicalizeBundleValue(value)));
}

async function createCidFromBytes(bytes: Uint8Array): Promise<string> {
  const digest = await sha256.digest(bytes);
  return CID.createV1(raw.code, digest).toString();
}

async function createEntry(params: {
  filePath: string;
  mediaType: string;
  bytes: Uint8Array;
}): Promise<StorageBundleEntry> {
  const content =
    params.mediaType.startsWith("text/") ||
    params.mediaType.includes("json")
      ? Buffer.from(params.bytes).toString("utf8")
      : Buffer.from(params.bytes).toString("base64");
  const digest = await sha256.digest(params.bytes);
  return {
    path: params.filePath.replace(/\\/g, "/"),
    mediaType: params.mediaType,
    encoding: params.mediaType.startsWith("text/") || params.mediaType.includes("json") ? "utf8" : "base64",
    content,
    sha256: `0x${Buffer.from(digest.digest).toString("hex")}` as Hex,
    sizeBytes: params.bytes.byteLength,
  };
}

export async function createBundleEntry(params: {
  filePath: string;
  mediaType: string;
  content: string | Uint8Array | Record<string, unknown>;
}): Promise<StorageBundleEntry> {
  const bytes =
    params.content instanceof Uint8Array
      ? params.content
      : typeof params.content === "string"
        ? Buffer.from(params.content, "utf8")
        : Buffer.from(canonicalizeBundleValue(params.content), "utf8");
  return createEntry({
    filePath: params.filePath,
    mediaType: params.mediaType,
    bytes,
  });
}

function guessMediaType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case ".json":
      return "application/json";
    case ".txt":
    case ".md":
      return "text/plain";
    case ".html":
      return "text/html";
    default:
      return "application/octet-stream";
  }
}

export async function buildBundleFromInput(params: {
  inputPath: string;
  bundleKind: string;
  createdBy: string;
  createdAt?: string;
}): Promise<{ bundle: StorageBundle; cid: string; bytes: Uint8Array }> {
  const stat = await fs.stat(params.inputPath);
  const createdAt = params.createdAt ?? new Date().toISOString();
  const payload: StorageBundleEntry[] = [];
  if (stat.isDirectory()) {
    const walk = async (dirPath: string, relativePrefix = ""): Promise<void> => {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });
      for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
        const absolute = path.join(dirPath, entry.name);
        const relative = relativePrefix ? `${relativePrefix}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
          await walk(absolute, relative);
          continue;
        }
        const bytes = await fs.readFile(absolute);
        payload.push(
          await createEntry({
            filePath: `payload/${relative}`,
            mediaType: guessMediaType(relative),
            bytes,
          }),
        );
      }
    };
    await walk(params.inputPath);
  } else {
    const bytes = await fs.readFile(params.inputPath);
    payload.push(
      await createEntry({
        filePath: `payload/${path.basename(params.inputPath)}`,
        mediaType: guessMediaType(params.inputPath),
        bytes,
      }),
    );
  }

  const draft = {
    manifest: {
      schema_version: 1 as const,
      bundle_kind: params.bundleKind,
      bundle_hash: "0x" as Hex,
      created_at: createdAt,
      created_by: params.createdBy,
      payload_entries: payload.map((entry) => entry.path),
      proof_entries: [] as string[],
      metadata_entries: [] as string[],
    },
    payload,
    proofs: [] as StorageBundleEntry[],
    metadata: [] as StorageBundleEntry[],
  };

  const bundleHash = hashBundleValue({
    ...draft,
    manifest: {
      ...draft.manifest,
      bundle_hash: undefined,
    },
  });
  const bundle: StorageBundle = {
    ...draft,
    manifest: {
      ...draft.manifest,
      bundle_hash: bundleHash,
    },
  };
  const canonical = canonicalizeBundleValue(bundle);
  const bytes = Buffer.from(canonical, "utf8");
  const cid = await createCidFromBytes(bytes);
  return { bundle, cid, bytes };
}

export async function buildBundleFromEntries(params: {
  bundleKind: string;
  createdBy: string;
  createdAt?: string;
  payload?: StorageBundleInputEntry[];
  proofs?: StorageBundleInputEntry[];
  metadata?: StorageBundleInputEntry[];
}): Promise<{ bundle: StorageBundle; cid: string; bytes: Uint8Array }> {
  const createdAt = params.createdAt ?? new Date().toISOString();
  const payload = await Promise.all(
    (params.payload ?? []).map((entry) =>
      createBundleEntry({
        filePath: `payload/${entry.path.replace(/^\/+/, "")}`,
        mediaType: entry.mediaType,
        content: entry.content,
      }),
    ),
  );
  const proofs = await Promise.all(
    (params.proofs ?? []).map((entry) =>
      createBundleEntry({
        filePath: `proofs/${entry.path.replace(/^\/+/, "")}`,
        mediaType: entry.mediaType,
        content: entry.content,
      }),
    ),
  );
  const metadata = await Promise.all(
    (params.metadata ?? []).map((entry) =>
      createBundleEntry({
        filePath: `metadata/${entry.path.replace(/^\/+/, "")}`,
        mediaType: entry.mediaType,
        content: entry.content,
      }),
    ),
  );
  const draft = {
    manifest: {
      schema_version: 1 as const,
      bundle_kind: params.bundleKind,
      bundle_hash: "0x" as Hex,
      created_at: createdAt,
      created_by: params.createdBy,
      payload_entries: payload.map((entry) => entry.path),
      proof_entries: proofs.map((entry) => entry.path),
      metadata_entries: metadata.map((entry) => entry.path),
    },
    payload,
    proofs,
    metadata,
  };
  const bundleHash = hashBundleValue({
    ...draft,
    manifest: {
      ...draft.manifest,
      bundle_hash: undefined,
    },
  });
  const bundle: StorageBundle = {
    ...draft,
    manifest: {
      ...draft.manifest,
      bundle_hash: bundleHash,
    },
  };
  const canonical = canonicalizeBundleValue(bundle);
  const bytes = Buffer.from(canonical, "utf8");
  const cid = await createCidFromBytes(bytes);
  return { bundle, cid, bytes };
}

export async function finalizeBundle(bundle: StorageBundle): Promise<{
  bundle: StorageBundle;
  cid: string;
  bytes: Uint8Array;
}> {
  const canonical = canonicalizeBundleValue(bundle);
  const bytes = Buffer.from(canonical, "utf8");
  const cid = await createCidFromBytes(bytes);
  return { bundle, cid, bytes };
}

export async function writeBundleToPath(bundlePath: string, bytes: Uint8Array): Promise<void> {
  await fs.mkdir(path.dirname(bundlePath), { recursive: true });
  await fs.writeFile(bundlePath, bytes);
}

export async function readBundleFromPath(bundlePath: string): Promise<StorageBundle> {
  const raw = await fs.readFile(bundlePath, "utf8");
  return JSON.parse(raw) as StorageBundle;
}
