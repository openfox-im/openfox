/**
 * Skills CLI Actions Tests
 *
 * Tests for skillsList, skillsInfo, skillsCheck and their formatting functions.
 */

import fs from "fs";
import os from "os";
import path from "path";
import { describe, it, expect } from "vitest";
import {
  skillsList,
  skillsInfo,
  skillsCheck,
  formatSkillsList,
  formatSkillInfo,
  formatSkillsCheck,
} from "../skills/skills-cli.js";
import type { Skill, SkillStatusEntry } from "../types.js";

// ─── Test Helpers ───────────────────────────────────────────────

function makeTmpSkillsDir(skills: { name: string; description: string; extra?: string }[]): string {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "openfox-cli-"));
  for (const s of skills) {
    const dir = path.join(tmp, s.name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "SKILL.md"),
      `---\nname: ${s.name}\ndescription: ${s.description}\n${s.extra || ""}---\n\nInstructions for ${s.name}.`,
    );
  }
  return tmp;
}

function makeDb() {
  const rows = new Map<string, Skill>();
  return {
    getSkillByName(name: string) { return rows.get(name); },
    upsertSkill(skill: Skill) { rows.set(skill.name, skill); },
  } as any;
}

function makeEntry(overrides: Partial<SkillStatusEntry> = {}): SkillStatusEntry {
  return {
    name: "test-skill",
    description: "A test skill",
    source: "bundled",
    path: "/tmp/test-skill/SKILL.md",
    eligible: true,
    enabled: true,
    missingBins: [],
    missingEnv: [],
    missingConfig: [],
    install: [],
    ...overrides,
  };
}

// ─── Action Tests ───────────────────────────────────────────────

describe("skillsList", () => {
  it("includes skills from the given directory", () => {
    const dir = makeTmpSkillsDir([
      { name: "alpha", description: "Alpha skill" },
      { name: "beta", description: "Beta skill" },
    ]);
    try {
      const entries = skillsList(dir, makeDb());
      const names = entries.map((e) => e.name);
      expect(names).toContain("alpha");
      expect(names).toContain("beta");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("filters to eligible only when option set", () => {
    const dir = makeTmpSkillsDir([
      { name: "has-bin-cli-test", description: "Needs missing bin", extra: "requires:\n  bins: [nonexistent_binary_xyz]\n" },
      { name: "simple-cli-test", description: "No requirements" },
    ]);
    try {
      const all = skillsList(dir, makeDb());
      const allNames = all.map((e) => e.name);
      expect(allNames).toContain("has-bin-cli-test");
      expect(allNames).toContain("simple-cli-test");

      const eligible = skillsList(dir, makeDb(), undefined, { eligible: true });
      const eligibleNames = eligible.map((e) => e.name);
      expect(eligibleNames).toContain("simple-cli-test");
      expect(eligibleNames).not.toContain("has-bin-cli-test");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("skillsInfo", () => {
  it("returns info for a named skill", () => {
    const dir = makeTmpSkillsDir([
      { name: "target", description: "Target skill" },
      { name: "other", description: "Other skill" },
    ]);
    try {
      const info = skillsInfo(dir, makeDb(), "target");
      expect(info).toBeDefined();
      expect(info!.name).toBe("target");
      expect(info!.description).toBe("Target skill");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns undefined for unknown skill", () => {
    const dir = makeTmpSkillsDir([{ name: "only", description: "Only one" }]);
    try {
      const info = skillsInfo(dir, makeDb(), "nonexistent-xyz-99");
      expect(info).toBeUndefined();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("skillsCheck", () => {
  it("counts ready and missing skills correctly", () => {
    const dir = makeTmpSkillsDir([
      { name: "ready-cli-test", description: "Ready skill" },
      { name: "missing-cli-test", description: "Missing bin", extra: "requires:\n  bins: [nonexistent_binary_xyz]\n" },
    ]);
    try {
      const result = skillsCheck(dir, makeDb());
      // Should include our test skills plus bundled skills
      expect(result.total).toBeGreaterThanOrEqual(2);
      expect(result.entries.length).toBe(result.total);
      expect(result.ready + result.missing).toBe(result.total);

      // Verify our specific test skills
      const readyEntry = result.entries.find((e) => e.name === "ready-cli-test");
      const missingEntry = result.entries.find((e) => e.name === "missing-cli-test");
      expect(readyEntry?.eligible).toBe(true);
      expect(missingEntry?.eligible).toBe(false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ─── Formatting Tests ───────────────────────────────────────────

describe("formatSkillsList", () => {
  it("returns 'No skills found.' for empty list", () => {
    expect(formatSkillsList([])).toBe("No skills found.");
  });

  it("shows badges and status for each skill", () => {
    const entries = [
      makeEntry({ name: "alpha", eligible: true, description: "Alpha" }),
      makeEntry({ name: "beta", eligible: false, description: "Beta" }),
    ];
    const output = formatSkillsList(entries);
    expect(output).toContain("[+] alpha");
    expect(output).toContain("[ready]");
    expect(output).toContain("[-] beta");
    expect(output).toContain("[missing]");
  });

  it("shows source tag for non-bundled skills", () => {
    const entries = [makeEntry({ name: "ws", source: "workspace" })];
    const output = formatSkillsList(entries);
    expect(output).toContain("(workspace)");
  });

  it("shows verbose details when enabled", () => {
    const entries = [
      makeEntry({
        name: "verbose-test",
        eligible: false,
        missingBins: ["git"],
        missingEnv: ["API_KEY"],
        missingConfig: ["some.path"],
        preferredInstall: { kind: "brew", formula: "git", label: "brew install git" },
      }),
    ];
    const output = formatSkillsList(entries, true);
    expect(output).toContain("missing bins: git");
    expect(output).toContain("missing env: API_KEY");
    expect(output).toContain("missing config: some.path");
    expect(output).toContain("install: brew");
  });
});

describe("formatSkillInfo", () => {
  it("includes all basic fields", () => {
    const entry = makeEntry({
      name: "detailed",
      description: "Detailed skill",
      source: "managed",
      path: "/home/.openfox/skills/detailed/SKILL.md",
    });
    const output = formatSkillInfo(entry);
    expect(output).toContain("Name:        detailed");
    expect(output).toContain("Description: Detailed skill");
    expect(output).toContain("Source:      managed");
    expect(output).toContain("Eligible:    yes");
  });

  it("shows optional fields when present", () => {
    const entry = makeEntry({
      always: true,
      homepage: "https://example.com",
      primaryEnv: "API_KEY",
      os: ["linux", "darwin"],
      license: "MIT",
    });
    const output = formatSkillInfo(entry);
    expect(output).toContain("Always:      yes");
    expect(output).toContain("Homepage:    https://example.com");
    expect(output).toContain("Primary Env: API_KEY");
    expect(output).toContain("OS:          linux, darwin");
    expect(output).toContain("License:     MIT");
  });

  it("shows install options", () => {
    const entry = makeEntry({
      install: [
        { kind: "brew", formula: "jq", label: "brew install jq" },
        { kind: "node", package: "jq-cli" },
      ],
      preferredInstall: { kind: "brew", formula: "jq" },
    });
    const output = formatSkillInfo(entry);
    expect(output).toContain("Install options:");
    expect(output).toContain("brew: brew install jq");
    expect(output).toContain("node: jq-cli");
    expect(output).toContain("Preferred: brew");
  });
});

describe("formatSkillsCheck", () => {
  it("shows summary line", () => {
    const result = { total: 5, ready: 3, missing: 2, entries: [] as SkillStatusEntry[] };
    const output = formatSkillsCheck(result);
    expect(output).toContain("Skills: 5 total, 3 ready, 2 missing requirements");
  });

  it("lists missing skills with reasons", () => {
    const result = {
      total: 2,
      ready: 1,
      missing: 1,
      entries: [
        makeEntry({ name: "ok", eligible: true }),
        makeEntry({ name: "broken", eligible: false, missingBins: ["curl"], missingEnv: ["TOKEN"] }),
      ],
    };
    const output = formatSkillsCheck(result);
    expect(output).toContain("broken: bins: curl; env: TOKEN");
  });

  it("does not list missing section when all ready", () => {
    const result = {
      total: 1,
      ready: 1,
      missing: 0,
      entries: [makeEntry({ eligible: true })],
    };
    const output = formatSkillsCheck(result);
    const lines = output.split("\n");
    expect(lines.length).toBe(1);
  });
});
