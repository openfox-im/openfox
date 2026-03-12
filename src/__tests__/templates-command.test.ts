import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import {
  exportBundledTemplate,
  listBundledTemplates,
  readBundledTemplateReadme,
} from "../commands/templates.js";
import { lintBundledPack } from "../commands/packs.js";

describe("bundled templates", () => {
  let tempDir = "";

  afterEach(() => {
    if (tempDir) {
      fs.rmSync(tempDir, { recursive: true, force: true });
      tempDir = "";
    }
  });

  it("lists bundled templates with descriptions", () => {
    const items = listBundledTemplates();
    expect(items.some((item) => item.name === "third-party-quickstart")).toBe(true);
    expect(items.some((item) => item.name === "local-marketplace")).toBe(true);
    expect(items.some((item) => item.name === "public-fleet-operator")).toBe(true);
    expect(items.some((item) => item.name === "evidence-market-flow")).toBe(true);
    expect(items.some((item) => item.name === "oracle-market-flow")).toBe(true);
    expect(items.some((item) => item.name === "proof-market-flow")).toBe(true);
    expect(items.some((item) => item.name === "verification-market-flow")).toBe(true);
  });

  it("reads bundled template readmes", () => {
    const text = readBundledTemplateReadme("local-marketplace");
    expect(text).toContain("Local Marketplace");
  });

  it("exports bundled templates to a target directory", () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "openfox-template-"));
    const outputPath = path.join(tempDir, "local-marketplace");
    const result = exportBundledTemplate({
      name: "local-marketplace",
      outputPath,
    });

    expect(result.outputPath).toBe(outputPath);
    expect(fs.existsSync(path.join(outputPath, "host.openfox.json"))).toBe(true);
    expect(fs.existsSync(path.join(outputPath, "solver.openfox.json"))).toBe(true);
  });

  it("exports the public fleet operator bundle", () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "openfox-template-"));
    const outputPath = path.join(tempDir, "public-fleet-operator");
    exportBundledTemplate({
      name: "public-fleet-operator",
      outputPath,
    });

    expect(fs.existsSync(path.join(outputPath, "fleet.yml"))).toBe(true);
    expect(fs.existsSync(path.join(outputPath, "operator-notes.md"))).toBe(true);
    expect(
      fs.existsSync(path.join(outputPath, "dashboard", "export-dashboard.sh")),
    ).toBe(true);
  });

  it("exports packaged evidence and oracle market templates", () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "openfox-template-"));

    const evidenceOutput = path.join(tempDir, "evidence-market-flow");
    exportBundledTemplate({
      name: "evidence-market-flow",
      outputPath: evidenceOutput,
    });
    expect(fs.existsSync(path.join(evidenceOutput, "operator.openfox.json"))).toBe(true);

    const oracleOutput = path.join(tempDir, "oracle-market-flow");
    exportBundledTemplate({
      name: "oracle-market-flow",
      outputPath: oracleOutput,
    });
    expect(fs.existsSync(path.join(oracleOutput, "operator.openfox.json"))).toBe(true);

    const proofOutput = path.join(tempDir, "proof-market-flow");
    exportBundledTemplate({
      name: "proof-market-flow",
      outputPath: proofOutput,
    });
    expect(fs.existsSync(path.join(proofOutput, "operator.openfox.json"))).toBe(true);

    const verificationOutput = path.join(tempDir, "verification-market-flow");
    exportBundledTemplate({
      name: "verification-market-flow",
      outputPath: verificationOutput,
    });
    expect(
      fs.existsSync(path.join(verificationOutput, "operator.openfox.json")),
    ).toBe(true);
  });

  it("rejects proof packs with legacy verifier classes", () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "openfox-pack-"));
    const packRoot = path.join(tempDir, "legacy-pack");
    fs.mkdirSync(path.join(packRoot, "policies"), { recursive: true });
    fs.mkdirSync(path.join(packRoot, "contracts"), { recursive: true });
    fs.writeFileSync(
      path.join(packRoot, "pack.json"),
      JSON.stringify({
        name: "legacy-pack",
        version: "1.0.0",
        policies: ["policies/proof-verifier.json"],
        contracts: ["contracts/proof-verification-callback.json"],
      }),
    );
    fs.writeFileSync(path.join(packRoot, "README.md"), "# Legacy Pack\n");
    fs.writeFileSync(
      path.join(packRoot, "policies", "proof-verifier.json"),
      JSON.stringify({ default_verifier_class: "cryptographic_proof_verification" }),
    );
    fs.writeFileSync(
      path.join(packRoot, "contracts", "proof-verification-callback.json"),
      JSON.stringify({ verifier_class: "cryptographic_proof_verification" }),
    );

    const lint = lintBundledPack(packRoot);
    expect(lint.errors.some((entry) => entry.includes("legacy verifier class"))).toBe(
      true,
    );
  });
});
