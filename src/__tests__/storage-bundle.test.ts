import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildBundleFromInput,
  finalizeBundle,
  readBundleFromPath,
  writeBundleToPath,
} from "../storage/bundle.js";

const tempPaths: string[] = [];

function makeTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempPaths.push(dir);
  return dir;
}

afterEach(() => {
  while (tempPaths.length) {
    const target = tempPaths.pop();
    if (!target) continue;
    fs.rmSync(target, { recursive: true, force: true });
  }
});

describe("storage bundle", () => {
  it("builds deterministic bundles from local input", async () => {
    const dir = makeTempDir("openfox-storage-bundle-");
    const inputPath = path.join(dir, "note.json");
    fs.writeFileSync(inputPath, JSON.stringify({ hello: "world" }, null, 2));

    const first = await buildBundleFromInput({
      inputPath,
      bundleKind: "artifact.bundle",
      createdBy:
        "0x12252ae6b5d22fa4f58b295fe42cdb782f41881025d22645816d196b4f2e5143",
      createdAt: "2026-03-09T00:00:00.000Z",
    });
    const second = await buildBundleFromInput({
      inputPath,
      bundleKind: "artifact.bundle",
      createdBy:
        "0x12252ae6b5d22fa4f58b295fe42cdb782f41881025d22645816d196b4f2e5143",
      createdAt: "2026-03-09T00:00:00.000Z",
    });

    expect(first.cid).toBe(second.cid);
    expect(first.bundle.manifest.bundle_hash).toBe(
      second.bundle.manifest.bundle_hash,
    );
    expect(first.bundle.payload).toHaveLength(1);
  });

  it("writes and reloads canonical bundles", async () => {
    const dir = makeTempDir("openfox-storage-write-");
    const inputPath = path.join(dir, "payload.txt");
    fs.writeFileSync(inputPath, "hello storage");

    const built = await buildBundleFromInput({
      inputPath,
      bundleKind: "artifact.bundle",
      createdBy:
        "0xdca90de7e66cec3a5c7683922036c75aa691b36b473f162b905590f8031217c2",
    });
    const finalized = await finalizeBundle(built.bundle);
    const outputPath = path.join(dir, `${finalized.cid}.json`);

    await writeBundleToPath(outputPath, finalized.bytes);
    const reloaded = await readBundleFromPath(outputPath);

    expect(reloaded.manifest.bundle_hash).toBe(
      finalized.bundle.manifest.bundle_hash,
    );
    expect(reloaded.payload[0]?.content).toContain("hello storage");
  });
});
