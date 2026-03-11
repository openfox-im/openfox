/**
 * Skills Utilities Tests
 *
 * Tests for bundled-dir, bundled-context, tools-dir, skillKey,
 * nested root detection, install preference, and snapshot filter.
 */

import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { describe, it, expect } from "vitest";
import { resolveSkillToolsRootDir } from "../skills/tools-dir.js";
import { resolveSkillKey } from "../skills/config.js";
import { selectPreferredInstallSpec, buildSkillsSnapshot, loadSkills } from "../skills/loader.js";
import { parseSkillMd } from "../skills/format.js";
import type { Skill, SkillInstallSpec } from "../types.js";

// ─── Test Helpers ───────────────────────────────────────────────

function makeSkill(overrides: Partial<Skill> = {}): Skill {
  return {
    name: "test-skill",
    description: "A test skill",
    instructions: "Do something useful.",
    source: "self",
    path: "/tmp/skills/test-skill/SKILL.md",
    baseDir: "/tmp/skills/test-skill",
    enabled: true,
    autoActivate: true,
    installedAt: new Date().toISOString(),
    ...overrides,
  };
}

// ─── tools-dir Tests ─────────────────────────────────────────────

describe("resolveSkillToolsRootDir", () => {
  it("returns a path under ~/.openfox/config/tools/", () => {
    const dir = resolveSkillToolsRootDir("my-skill");
    expect(dir).toContain(path.join(".openfox", "config", "tools"));
  });

  it("uses hashed path segments to prevent traversal", () => {
    const dir1 = resolveSkillToolsRootDir("../etc/passwd");
    expect(dir1).not.toContain("..");
    // Should contain a hash suffix
    expect(dir1).toMatch(/-[a-f0-9]{16}$/);
  });

  it("returns different paths for different keys", () => {
    const dir1 = resolveSkillToolsRootDir("skill-a");
    const dir2 = resolveSkillToolsRootDir("skill-b");
    expect(dir1).not.toBe(dir2);
  });
});

// ─── skillKey Tests ──────────────────────────────────────────────

describe("resolveSkillKey", () => {
  it("returns skill.name when no skillKey set", () => {
    const skill = makeSkill({ name: "my-skill" });
    expect(resolveSkillKey(skill)).toBe("my-skill");
  });

  it("returns skillKey when set", () => {
    const skill = makeSkill({ name: "my-skill", skillKey: "custom-key" });
    expect(resolveSkillKey(skill)).toBe("custom-key");
  });
});

describe("parseSkillMd skill-key", () => {
  it("parses skill-key from frontmatter", () => {
    const content = `---
name: my-skill
description: A skill
skill-key: custom-config-key
---

Instructions.
`;
    const skill = parseSkillMd(content, "/tmp/skills/my-skill/SKILL.md");
    expect(skill).not.toBeNull();
    expect(skill!.skillKey).toBe("custom-config-key");
  });

  it("skillKey is undefined when not specified", () => {
    const content = `---
name: no-key-skill
description: A skill
---

Instructions.
`;
    const skill = parseSkillMd(content, "/tmp/skills/no-key-skill/SKILL.md");
    expect(skill!.skillKey).toBeUndefined();
  });
});

// ─── Install Preference Chain Tests ──────────────────────────────

describe("selectPreferredInstallSpec", () => {
  const specs: SkillInstallSpec[] = [
    { kind: "brew", formula: "jq", label: "brew jq" },
    { kind: "node", package: "jq-cli", label: "node jq" },
    { kind: "uv", package: "jq", label: "uv jq" },
    { kind: "download", url: "https://example.com/jq", label: "download jq" },
  ];

  it("prefers uv over node/brew/download by default", () => {
    const result = selectPreferredInstallSpec(specs);
    expect(result?.kind).toBe("uv");
  });

  it("prefers brew when preferBrew is true", () => {
    const result = selectPreferredInstallSpec(specs, { preferBrew: true });
    expect(result?.kind).toBe("brew");
  });

  it("returns undefined for empty list", () => {
    expect(selectPreferredInstallSpec([])).toBeUndefined();
  });

  it("filters by OS platform", () => {
    const otherPlatform = os.platform() === "linux" ? "darwin" : "linux";
    const osSpecs: SkillInstallSpec[] = [
      { kind: "brew", formula: "jq", os: [otherPlatform] },
      { kind: "node", package: "jq-cli" },
    ];
    const result = selectPreferredInstallSpec(osSpecs);
    expect(result?.kind).toBe("node");
  });
});

// ─── Snapshot Skill Filter Tests ─────────────────────────────────

describe("buildSkillsSnapshot with skillFilter", () => {
  it("filters skills by name", () => {
    const skills = [
      makeSkill({ name: "allowed" }),
      makeSkill({ name: "blocked" }),
    ];
    const snapshot = buildSkillsSnapshot(skills, undefined, undefined, ["allowed"]);
    expect(snapshot.skills.map((s) => s.name)).toEqual(["allowed"]);
    expect(snapshot.skillFilter).toEqual(["allowed"]);
  });

  it("includes all skills when no filter", () => {
    const skills = [
      makeSkill({ name: "a" }),
      makeSkill({ name: "b" }),
    ];
    const snapshot = buildSkillsSnapshot(skills);
    expect(snapshot.skills.length).toBe(2);
    expect(snapshot.skillFilter).toBeUndefined();
  });

  it("resolvedSkills is unaffected by filter", () => {
    const skills = [
      makeSkill({ name: "allowed" }),
      makeSkill({ name: "blocked" }),
    ];
    const snapshot = buildSkillsSnapshot(skills, undefined, undefined, ["allowed"]);
    expect(snapshot.resolvedSkills.length).toBe(2);
  });
});

// ─── Nested Root Detection Tests ─────────────────────────────────

describe("nested skills root detection", () => {
  it("auto-detects skills/ subdirectory when loading", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "openfox-nested-"));
    const rootDir = path.join(tmp, "project");
    const nestedDir = path.join(rootDir, "skills", "my-skill");
    fs.mkdirSync(nestedDir, { recursive: true });
    fs.writeFileSync(
      path.join(nestedDir, "SKILL.md"),
      `---\nname: my-skill\ndescription: Nested\n---\n\nNested instructions.`,
    );

    const rows = new Map<string, Skill>();
    const db = {
      getSkillByName(name: string) { return rows.get(name); },
      upsertSkill(skill: Skill) { rows.set(skill.name, skill); },
    } as any;

    const originalCwd = process.cwd();
    try {
      // Use rootDir as managed, with no workspace skills
      const emptyDir = path.join(tmp, "empty-workspace");
      fs.mkdirSync(emptyDir, { recursive: true });
      process.chdir(emptyDir);
      const skills = loadSkills(rootDir, db);
      const found = skills.find((s: Skill) => s.name === "my-skill");
      expect(found).toBeDefined();
      expect(found?.description).toBe("Nested");
    } finally {
      process.chdir(originalCwd);
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
