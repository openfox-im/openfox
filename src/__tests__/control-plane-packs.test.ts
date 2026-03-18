import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import {
  exportBundledPack,
  lintBundledPack,
  listBundledPacks,
  readBundledPackReadme,
} from "../commands/packs.js";

describe("control-plane packs", () => {
  let tempDir = "";

  afterEach(() => {
    if (tempDir) {
      fs.rmSync(tempDir, { recursive: true, force: true });
      tempDir = "";
    }
  });

  it("lists bundled packs with versioned descriptions", () => {
    const items = listBundledPacks();
    expect(items.some((item) => item.name === "fleet-automation-v1")).toBe(true);
    expect(items.some((item) => item.name === "market-operations-v1")).toBe(true);
    expect(items.some((item) => item.name === "proof-market-v1")).toBe(true);
    expect(items.some((item) => item.name === "verification-market-v1")).toBe(true);
  });

  it("reads bundled pack readmes", () => {
    const text = readBundledPackReadme("fleet-automation-v1");
    expect(text).toContain("Fleet Automation");
  });

  it("exports a bundled pack and lints it successfully", () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "openfox-pack-"));
    const outputPath = path.join(tempDir, "fleet-automation-v1");
    const result = exportBundledPack({
      name: "fleet-automation-v1",
      outputPath,
    });

    expect(result.outputPath).toBe(outputPath);
    expect(fs.existsSync(path.join(outputPath, "pack.json"))).toBe(true);
    expect(fs.existsSync(path.join(outputPath, "policies", "signer.json"))).toBe(true);
    expect(fs.existsSync(path.join(outputPath, "manifests", "fleet.public.json"))).toBe(
      true,
    );
    expect(fs.existsSync(path.join(outputPath, "contracts", "fleet-recovery-callback.json"))).toBe(true);

    const lint = lintBundledPack(outputPath);
    expect(lint.errors).toEqual([]);
    expect(lint.warnings).toEqual([]);
  });

  it("exports and lints proof and verification market packs", () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "openfox-pack-"));

    const proofOutput = path.join(tempDir, "proof-market-v1");
    exportBundledPack({
      name: "proof-market-v1",
      outputPath: proofOutput,
    });
    expect(fs.existsSync(path.join(proofOutput, "pack.json"))).toBe(true);
    expect(fs.existsSync(path.join(proofOutput, "policies", "proof-verifier.json"))).toBe(
      true,
    );
    expect(fs.existsSync(path.join(proofOutput, "manifests", "proof-market.public.json"))).toBe(
      true,
    );
    expect(
      fs.existsSync(path.join(proofOutput, "contracts", "proof-verification-callback.json")),
    ).toBe(true);
    expect(lintBundledPack(proofOutput).errors).toEqual([]);

    const verificationOutput = path.join(tempDir, "verification-market-v1");
    exportBundledPack({
      name: "verification-market-v1",
      outputPath: verificationOutput,
    });
    expect(fs.existsSync(path.join(verificationOutput, "pack.json"))).toBe(true);
    expect(
      fs.existsSync(path.join(verificationOutput, "policies", "committee.json")),
    ).toBe(true);
    expect(
      fs.existsSync(
        path.join(verificationOutput, "manifests", "verification-market.public.json"),
      ),
    ).toBe(true);
    expect(
      fs.existsSync(path.join(verificationOutput, "contracts", "committee-tally-callback.json")),
    ).toBe(true);
    expect(lintBundledPack(verificationOutput).errors).toEqual([]);
  });

  it("reports missing required exports when a pack is incomplete", () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "openfox-pack-"));
    const packPath = path.join(tempDir, "broken-pack");
    fs.mkdirSync(packPath, { recursive: true });
    fs.writeFileSync(
      path.join(packPath, "pack.json"),
      JSON.stringify({
        name: "broken-pack",
        version: "1",
        policies: ["policies/missing.json"],
        manifests: ["manifests/missing.json"],
        contracts: ["contracts/missing.json"],
      }),
      "utf8",
    );
    const lint = lintBundledPack(packPath);
    expect(lint.errors).toEqual(
      expect.arrayContaining([
        "missing policy export: policies/missing.json",
        "missing manifest export: manifests/missing.json",
        "missing contract example: contracts/missing.json",
      ]),
    );
  });
});
