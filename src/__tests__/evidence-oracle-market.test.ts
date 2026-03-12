import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import {
  exportBundledTemplate,
  listBundledTemplates,
} from "../commands/templates.js";
import {
  exportBundledPack,
  listBundledPacks,
} from "../commands/packs.js";

describe("evidence and oracle market packaging", () => {
  let tempDir = "";

  afterEach(() => {
    if (tempDir) {
      fs.rmSync(tempDir, { recursive: true, force: true });
      tempDir = "";
    }
  });

  it("ships reusable evidence/oracle templates, skills, and control-plane packs", () => {
    const templates = listBundledTemplates();
    expect(templates.some((item) => item.name === "evidence-market-flow")).toBe(true);
    expect(templates.some((item) => item.name === "oracle-market-flow")).toBe(true);
    expect(templates.some((item) => item.name === "proof-market-flow")).toBe(true);
    expect(templates.some((item) => item.name === "verification-market-flow")).toBe(
      true,
    );

    expect(
      fs.existsSync(
        path.resolve("skills/evidence-market-operator/SKILL.md"),
      ),
    ).toBe(true);
    expect(
      fs.existsSync(
        path.resolve("skills/oracle-market-operator/SKILL.md"),
      ),
    ).toBe(true);

    const packs = listBundledPacks();
    expect(packs.some((item) => item.name === "market-operations-v1")).toBe(true);
    expect(packs.some((item) => item.name === "proof-market-v1")).toBe(true);
    expect(packs.some((item) => item.name === "verification-market-v1")).toBe(true);
  });

  it("exports packaged evidence and oracle flows for operator deployment", () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "openfox-evidence-oracle-pack-"));

    const evidenceOutput = path.join(tempDir, "evidence-market-flow");
    exportBundledTemplate({
      name: "evidence-market-flow",
      outputPath: evidenceOutput,
    });
    expect(fs.existsSync(path.join(evidenceOutput, "operator.openfox.json"))).toBe(true);
    expect(fs.readFileSync(path.join(evidenceOutput, "README.md"), "utf8")).toContain(
      "Evidence Market Flow",
    );

    const oracleOutput = path.join(tempDir, "oracle-market-flow");
    exportBundledTemplate({
      name: "oracle-market-flow",
      outputPath: oracleOutput,
    });
    expect(fs.existsSync(path.join(oracleOutput, "operator.openfox.json"))).toBe(true);
    expect(fs.readFileSync(path.join(oracleOutput, "README.md"), "utf8")).toContain(
      "Oracle Market Flow",
    );

    const packOutput = path.join(tempDir, "market-operations-v1");
    exportBundledPack({
      name: "market-operations-v1",
      outputPath: packOutput,
    });
    expect(fs.existsSync(path.join(packOutput, "contracts", "settlement-callback.json"))).toBe(
      true,
    );
    expect(fs.existsSync(path.join(packOutput, "manifests", "market-operator.json"))).toBe(
      true,
    );

    const proofOutput = path.join(tempDir, "proof-market-flow");
    exportBundledTemplate({
      name: "proof-market-flow",
      outputPath: proofOutput,
    });
    expect(fs.existsSync(path.join(proofOutput, "operator.openfox.json"))).toBe(true);
    expect(fs.readFileSync(path.join(proofOutput, "README.md"), "utf8")).toContain(
      "Proof Market Flow",
    );

    const verificationOutput = path.join(tempDir, "verification-market-flow");
    exportBundledTemplate({
      name: "verification-market-flow",
      outputPath: verificationOutput,
    });
    expect(
      fs.existsSync(path.join(verificationOutput, "operator.openfox.json")),
    ).toBe(true);
    expect(
      fs.readFileSync(path.join(verificationOutput, "README.md"), "utf8"),
    ).toContain("Verification Market Flow");

    const proofPackOutput = path.join(tempDir, "proof-market-v1");
    exportBundledPack({
      name: "proof-market-v1",
      outputPath: proofPackOutput,
    });
    expect(
      fs.existsSync(path.join(proofPackOutput, "contracts", "proof-verification-callback.json")),
    ).toBe(true);
    expect(
      fs.existsSync(path.join(proofPackOutput, "manifests", "proof-market.public.json")),
    ).toBe(true);

    const verificationPackOutput = path.join(tempDir, "verification-market-v1");
    exportBundledPack({
      name: "verification-market-v1",
      outputPath: verificationPackOutput,
    });
    expect(
      fs.existsSync(
        path.join(verificationPackOutput, "contracts", "committee-tally-callback.json"),
      ),
    ).toBe(true);
    expect(
      fs.existsSync(
        path.join(verificationPackOutput, "manifests", "verification-market.public.json"),
      ),
    ).toBe(true);
  });
});
