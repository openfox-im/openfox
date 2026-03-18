/**
 * Skills Format (SKILL.md Parser) Tests
 *
 * Tests parseSkillMd: YAML frontmatter parsing, name validation,
 * agentskills.io standard fields, invocation policy, OS, baseDir.
 */

import { describe, it, expect } from "vitest";
import { parseSkillMd } from "../skills/format.js";

// ─── YAML Frontmatter Parser Tests ────────────────────────────

describe("parseSkillMd YAML frontmatter", () => {
  it("parses requires.bins list items into the correct nested location", () => {
    const content = `---
name: my-skill
description: Test skill
requires:
  bins:
    - git
    - curl
---

Some instructions here.
`;
    const skill = parseSkillMd(content, "/tmp/skills/my-skill/SKILL.md");
    expect(skill).not.toBeNull();
    expect(skill!.requires).toBeDefined();
    expect(skill!.requires!.bins).toEqual(["git", "curl"]);
  });

  it("parses requires.env list items into the correct nested location", () => {
    const content = `---
name: env-skill
description: Skill needing env vars
requires:
  env:
    - OPENAI_KEY
    - SECRET_TOKEN
---

Instructions.
`;
    const skill = parseSkillMd(content, "/tmp/skills/env-skill/SKILL.md");
    expect(skill).not.toBeNull();
    expect(skill!.requires).toBeDefined();
    expect(skill!.requires!.env).toEqual(["OPENAI_KEY", "SECRET_TOKEN"]);
  });

  it("parses richer frontmatter fields with a real YAML parser", () => {
    const content = `---
name: rich-skill
description: Rich skill
homepage: https://example.com/skill
always: true
primary-env: OPENAI_API_KEY
requires:
  bins:
    - git
install:
  - kind: brew
    label: Install jq
    formula: jq
---

Instructions.
`;
    const skill = parseSkillMd(content, "/tmp/skills/rich-skill/SKILL.md");
    expect(skill).not.toBeNull();
    expect(skill!.name).toBe("rich-skill");
    expect(skill!.description).toBe("Rich skill");
    expect(skill!.requires!.bins).toEqual(["git"]);
    expect(skill!.homepage).toBe("https://example.com/skill");
    expect(skill!.always).toBe(true);
    expect(skill!.primaryEnv).toBe("OPENAI_API_KEY");
    expect(skill!.install?.[0]?.kind).toBe("brew");
  });
});

// ─── agentskills.io Standard Format Tests ─────────────────────────

describe("parseSkillMd agentskills.io standard format", () => {
  it("parses top-level platform fields correctly", () => {
    const content = `---
name: standard-skill
description: A standard skill
auto-activate: true
homepage: https://example.com
always: true
primary-env: MY_TOKEN
provider-backends:
  fetch:
    entry: scripts/fetch.mjs
    description: Fetch data
---

Standard instructions.
`;
    const skill = parseSkillMd(content, "/tmp/skills/standard-skill/SKILL.md");
    expect(skill).not.toBeNull();
    expect(skill!.name).toBe("standard-skill");
    expect(skill!.autoActivate).toBe(true);
    expect(skill!.homepage).toBe("https://example.com");
    expect(skill!.always).toBe(true);
    expect(skill!.primaryEnv).toBe("MY_TOKEN");
    expect(skill!.providerBackends).toBeDefined();
    expect(skill!.providerBackends!.fetch.entry).toBe("scripts/fetch.mjs");
  });

  it("parses license, compatibility, and allowed-tools", () => {
    const content = `---
name: licensed-skill
description: A licensed skill
license: MIT
compatibility: ">=1.0.0"
allowed-tools: read_file, exec
---

Instructions.
`;
    const skill = parseSkillMd(content, "/tmp/skills/licensed-skill/SKILL.md");
    expect(skill).not.toBeNull();
    expect(skill!.license).toBe("MIT");
    expect(skill!.compatibility).toBe(">=1.0.0");
    expect(skill!.allowedTools).toEqual(["read_file", "exec"]);
  });

  it("parses allowed-tools with space delimiters", () => {
    const content = `---
name: space-tools
description: A skill
allowed-tools: Read Grep Glob
---

Instructions.
`;
    const skill = parseSkillMd(content, "/tmp/skills/space-tools/SKILL.md");
    expect(skill).not.toBeNull();
    expect(skill!.allowedTools).toEqual(["Read", "Grep", "Glob"]);
  });

  it("parses generic metadata as key-value map", () => {
    const content = `---
name: meta-skill
description: A skill with metadata
metadata:
  author: openfox-team
  version: "1.0"
---

Instructions.
`;
    const skill = parseSkillMd(content, "/tmp/skills/meta-skill/SKILL.md");
    expect(skill).not.toBeNull();
    expect(skill!.name).toBe("meta-skill");
  });
});

// ─── Name Validation Tests ────────────────────────────────────────

describe("parseSkillMd name validation", () => {
  it("auto-lowercases skill names", () => {
    const content = `---
name: My-Skill
description: A skill
---

Instructions.
`;
    const skill = parseSkillMd(content, "/tmp/skills/my-skill/SKILL.md");
    expect(skill).not.toBeNull();
    expect(skill!.name).toBe("my-skill");
  });

  it("rejects names longer than 64 characters", () => {
    const longName = "a".repeat(65);
    const content = `---
name: ${longName}
description: A skill
---

Instructions.
`;
    const skill = parseSkillMd(content, `/tmp/skills/${longName}/SKILL.md`);
    expect(skill).toBeNull();
  });

  it("rejects names with consecutive hyphens", () => {
    const content = `---
name: bad--name
description: A skill
---

Instructions.
`;
    const skill = parseSkillMd(content, "/tmp/skills/bad--name/SKILL.md");
    expect(skill).toBeNull();
  });

  it("rejects names with leading hyphens", () => {
    const content = `---
name: -leading
description: A skill
---

Instructions.
`;
    const skill = parseSkillMd(content, "/tmp/skills/-leading/SKILL.md");
    expect(skill).toBeNull();
  });

  it("rejects names with trailing hyphens", () => {
    const content = `---
name: trailing-
description: A skill
---

Instructions.
`;
    const skill = parseSkillMd(content, "/tmp/skills/trailing-/SKILL.md");
    expect(skill).toBeNull();
  });
});

// ─── Invocation Policy Tests ────────────────────────────────────

describe("parseSkillMd invocation policy", () => {
  it("defaults to user-invocable: true, disable-model-invocation: false", () => {
    const content = `---
name: basic-skill
description: A skill
---

Instructions.
`;
    const skill = parseSkillMd(content, "/tmp/skills/basic-skill/SKILL.md");
    expect(skill).not.toBeNull();
    expect(skill!.invocation?.userInvocable).toBe(true);
    expect(skill!.invocation?.disableModelInvocation).toBe(false);
  });

  it("respects user-invocable: false", () => {
    const content = `---
name: hidden-skill
description: A skill
user-invocable: false
---

Instructions.
`;
    const skill = parseSkillMd(content, "/tmp/skills/hidden-skill/SKILL.md");
    expect(skill!.invocation?.userInvocable).toBe(false);
  });

  it("respects disable-model-invocation: true", () => {
    const content = `---
name: manual-skill
description: A skill
disable-model-invocation: true
---

Instructions.
`;
    const skill = parseSkillMd(content, "/tmp/skills/manual-skill/SKILL.md");
    expect(skill!.invocation?.disableModelInvocation).toBe(true);
  });
});

// ─── OS Field Parsing Tests ──────────────────────────────────────

describe("parseSkillMd OS field", () => {
  it("parses os array and normalizes to lowercase", () => {
    const content = `---
name: os-skill
description: A skill
os:
  - Linux
  - Darwin
---

Instructions.
`;
    const skill = parseSkillMd(content, "/tmp/skills/os-skill/SKILL.md");
    expect(skill!.os).toEqual(["linux", "darwin"]);
  });

  it("omits os when empty array", () => {
    const content = `---
name: no-os-skill
description: A skill
os: []
---

Instructions.
`;
    const skill = parseSkillMd(content, "/tmp/skills/no-os-skill/SKILL.md");
    expect(skill!.os).toBeUndefined();
  });
});

// ─── baseDir Extraction Tests ────────────────────────────────────

describe("parseSkillMd baseDir", () => {
  it("sets baseDir to the parent directory of the SKILL.md file", () => {
    const content = `---
name: dir-skill
description: A skill
---

Instructions.
`;
    const skill = parseSkillMd(content, "/tmp/skills/dir-skill/SKILL.md");
    expect(skill!.baseDir).toBe("/tmp/skills/dir-skill");
  });
});
