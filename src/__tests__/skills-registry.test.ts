/**
 * Skills Registry Tests
 *
 * Tests registry validation, install spec validation patterns,
 * name regex, createSkill, and source code security checks.
 */

import { describe, it, expect } from "vitest";
import {
  normalizeSafeBrewFormula,
  normalizeSafeNpmSpec,
  normalizeSafeGoModule,
  normalizeSafeUvPackage,
  normalizeSafeDownloadUrl,
} from "../skills/registry.js";

// ─── Registry Source Code Validation ─────────────────────────────

describe("skills/registry.ts validation", () => {
  it("createSkill uses yaml.stringify for safe frontmatter generation", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync(
      new URL("../skills/registry.ts", import.meta.url).pathname.replace("/src/__tests__/../", "/src/"),
      "utf-8",
    );
    expect(source).toMatch(/yaml\.stringify\s*\(/);
    expect(source).not.toMatch(/`---\nname: \$\{name\}/);
  });

  it("registry has path traversal validation function", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync(
      new URL("../skills/registry.ts", import.meta.url).pathname.replace("/src/__tests__/../", "/src/"),
      "utf-8",
    );
    expect(source).toMatch(/validateSkillPath/);
    expect(source).toMatch(/path\.resolve/);
    expect(source).toMatch(/startsWith.*path\.sep/);
  });

  it("createSkill enforces description size limit", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync(
      new URL("../skills/registry.ts", import.meta.url).pathname.replace("/src/__tests__/../", "/src/"),
      "utf-8",
    );
    expect(source).toMatch(/MAX_DESCRIPTION_LENGTH/);
    expect(source).toMatch(/description\.slice\(0,\s*MAX_DESCRIPTION_LENGTH\)/);
  });

  it("createSkill enforces instructions size limit", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync(
      new URL("../skills/registry.ts", import.meta.url).pathname.replace("/src/__tests__/../", "/src/"),
      "utf-8",
    );
    expect(source).toMatch(/MAX_INSTRUCTIONS_LENGTH/);
    expect(source).toMatch(/instructions\.slice\(0,\s*MAX_INSTRUCTIONS_LENGTH\)/);
  });

  it("path traversal attacks are blocked by validateSkillPath", async () => {
    const { createSkill } = await import("../skills/registry.js");
    await expect(
      createSkill("../etc", "evil", "inject", "/tmp/skills", {} as any, {} as any),
    ).rejects.toThrow(/Invalid skill name/);
  });

  it("YAML injection via description is prevented", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync(
      new URL("../skills/registry.ts", import.meta.url).pathname.replace("/src/__tests__/../", "/src/"),
      "utf-8",
    );
    expect(source).toMatch(/yaml\.stringify/);
    expect(source).not.toMatch(/description: "\$\{description\}"/);
  });

  it("all skill operations use validateSkillPath", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync(
      new URL("../skills/registry.ts", import.meta.url).pathname.replace("/src/__tests__/../", "/src/"),
      "utf-8",
    );
    const matches = source.match(/validateSkillPath\(/g);
    expect(matches).not.toBeNull();
    expect(matches!.length).toBeGreaterThanOrEqual(4);
  });
});

// ─── Registry Constants ──────────────────────────────────────────

describe("registry MAX_DESCRIPTION_LENGTH", () => {
  it("uses 1024 as the max description length", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync(
      new URL("../skills/registry.ts", import.meta.url).pathname.replace("/src/__tests__/../", "/src/"),
      "utf-8",
    );
    expect(source).toMatch(/MAX_DESCRIPTION_LENGTH\s*=\s*1024/);
  });
});

describe("registry SKILL_NAME_RE", () => {
  it("enforces lowercase-only names", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync(
      new URL("../skills/registry.ts", import.meta.url).pathname.replace("/src/__tests__/../", "/src/"),
      "utf-8",
    );
    expect(source).toMatch(/SKILL_NAME_RE\s*=\s*\/\^\[a-z0-9\]/);
  });

  it("rejects uppercase skill names via createSkill", async () => {
    const { createSkill } = await import("../skills/registry.js");
    await expect(
      createSkill("My-Skill", "desc", "inst", "/tmp/skills", {} as any, {} as any),
    ).rejects.toThrow(/Invalid skill name/);
  });
});

describe("registry createSkill emits standard format", () => {
  it("uses top-level auto-activate (not metadata.openfox)", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync(
      new URL("../skills/registry.ts", import.meta.url).pathname.replace("/src/__tests__/../", "/src/"),
      "utf-8",
    );
    expect(source).toMatch(/"auto-activate":\s*true/);
    expect(source).not.toMatch(/openfox:\s*\{/);
  });
});

// ─── Install Spec Validation Tests ──────────────────────────────

describe("normalizeSafeBrewFormula", () => {
  it("accepts valid formula names", () => {
    expect(normalizeSafeBrewFormula("jq")).toBe("jq");
    expect(normalizeSafeBrewFormula("gnu-sed")).toBe("gnu-sed");
    expect(normalizeSafeBrewFormula("python@3.11")).toBe("python@3.11");
  });

  it("blocks flag injection (leading -)", () => {
    expect(normalizeSafeBrewFormula("-malicious")).toBeNull();
  });

  it("blocks backslash", () => {
    expect(normalizeSafeBrewFormula("foo\\bar")).toBeNull();
  });

  it("blocks path traversal (..)", () => {
    expect(normalizeSafeBrewFormula("../etc/passwd")).toBeNull();
  });

  it("blocks empty string", () => {
    expect(normalizeSafeBrewFormula("")).toBeNull();
  });
});

describe("normalizeSafeNpmSpec", () => {
  it("accepts valid specs", () => {
    expect(normalizeSafeNpmSpec("lodash")).toBe("lodash");
    expect(normalizeSafeNpmSpec("@types/node")).toBe("@types/node");
  });

  it("blocks flag injection", () => {
    expect(normalizeSafeNpmSpec("-malicious")).toBeNull();
  });
});

describe("normalizeSafeGoModule", () => {
  it("accepts valid modules", () => {
    expect(normalizeSafeGoModule("github.com/user/repo")).toBe("github.com/user/repo");
    expect(normalizeSafeGoModule("github.com/user/repo@v1.0.0")).toBe("github.com/user/repo@v1.0.0");
  });

  it("blocks protocol schemes", () => {
    expect(normalizeSafeGoModule("https://evil.com/payload")).toBeNull();
  });

  it("blocks backslash", () => {
    expect(normalizeSafeGoModule("foo\\bar")).toBeNull();
  });
});

describe("normalizeSafeUvPackage", () => {
  it("accepts valid packages", () => {
    expect(normalizeSafeUvPackage("requests")).toBe("requests");
    expect(normalizeSafeUvPackage("numpy>=1.20")).toBe("numpy>=1.20");
  });

  it("blocks protocol schemes", () => {
    expect(normalizeSafeUvPackage("https://evil.com")).toBeNull();
  });
});

describe("normalizeSafeDownloadUrl", () => {
  it("accepts valid http/https URLs", () => {
    expect(normalizeSafeDownloadUrl("https://example.com/file.tar.gz")).toBe("https://example.com/file.tar.gz");
    expect(normalizeSafeDownloadUrl("http://example.com/file")).toBe("http://example.com/file");
  });

  it("blocks non-http protocols", () => {
    expect(normalizeSafeDownloadUrl("ftp://evil.com/file")).toBeNull();
    expect(normalizeSafeDownloadUrl("file:///etc/passwd")).toBeNull();
  });

  it("blocks URLs with whitespace", () => {
    expect(normalizeSafeDownloadUrl("https://example.com/file name")).toBeNull();
  });

  it("blocks invalid URLs", () => {
    expect(normalizeSafeDownloadUrl("not-a-url")).toBeNull();
  });
});
