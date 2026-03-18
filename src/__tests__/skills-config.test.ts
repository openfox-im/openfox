/**
 * Skills Configuration & Eligibility Tests
 *
 * Tests shouldIncludeSkill, isBundledSkillAllowed, resolveSkillConfig,
 * isConfigPathTruthy, and the always: true bypass.
 */

import os from "os";
import { describe, it, expect } from "vitest";
import {
  shouldIncludeSkill,
  isBundledSkillAllowed,
  resolveSkillConfig,
  isConfigPathTruthy,
} from "../skills/config.js";
import type { Skill, SkillsConfig } from "../types.js";

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

// ─── shouldIncludeSkill Tests ────────────────────────────────────

describe("shouldIncludeSkill", () => {
  it("returns true for a simple enabled skill with no requirements", () => {
    const skill = makeSkill();
    expect(shouldIncludeSkill({ skill })).toBe(true);
  });

  it("returns false when skill.enabled is false", () => {
    const skill = makeSkill({ enabled: false });
    expect(shouldIncludeSkill({ skill })).toBe(false);
  });

  it("returns false when skillConfig.enabled is false", () => {
    const skill = makeSkill({ name: "my-skill" });
    const skillsConfig: SkillsConfig = { entries: { "my-skill": { enabled: false } } };
    expect(shouldIncludeSkill({ skill, skillsConfig })).toBe(false);
  });

  it("returns false when required bin is missing", () => {
    const skill = makeSkill({ requires: { bins: ["definitely-not-installed-xyz"] } });
    expect(shouldIncludeSkill({ skill })).toBe(false);
  });

  it("returns true when required bin exists", () => {
    const skill = makeSkill({ requires: { bins: ["node"] } });
    expect(shouldIncludeSkill({ skill })).toBe(true);
  });

  it("returns false when required env var is missing", () => {
    const skill = makeSkill({ requires: { env: ["NONEXISTENT_VAR_XYZ_123"] } });
    expect(shouldIncludeSkill({ skill })).toBe(false);
  });

  it("returns true when env var is provided via skillConfig.env", () => {
    const skill = makeSkill({ name: "env-skill", requires: { env: ["MY_TOKEN"] } });
    const skillsConfig: SkillsConfig = {
      entries: { "env-skill": { env: { MY_TOKEN: "secret" } } },
    };
    expect(shouldIncludeSkill({ skill, skillsConfig })).toBe(true);
  });

  it("returns true when env var is satisfied by skillConfig.apiKey + primaryEnv", () => {
    const skill = makeSkill({
      name: "api-skill",
      primaryEnv: "API_KEY",
      requires: { env: ["API_KEY"] },
    });
    const skillsConfig: SkillsConfig = {
      entries: { "api-skill": { apiKey: "sk-123" } },
    };
    expect(shouldIncludeSkill({ skill, skillsConfig })).toBe(true);
  });

  it("returns false when required config path is missing", () => {
    const skill = makeSkill({ name: "cfg-skill", requires: { config: ["auth.token"] } });
    expect(shouldIncludeSkill({ skill })).toBe(false);
  });

  it("returns true when required config path is present", () => {
    const skill = makeSkill({ name: "cfg-skill", requires: { config: ["auth.token"] } });
    const skillsConfig: SkillsConfig = {
      entries: { "cfg-skill": { config: { auth: { token: "abc" } } } },
    };
    expect(shouldIncludeSkill({ skill, skillsConfig })).toBe(true);
  });

  it("filters by OS platform", () => {
    const currentPlatform = os.platform();
    const otherPlatform = currentPlatform === "linux" ? "darwin" : "linux";
    const skill = makeSkill({ os: [otherPlatform] });
    expect(shouldIncludeSkill({ skill })).toBe(false);
  });

  it("passes when OS matches current platform", () => {
    const skill = makeSkill({ os: [os.platform()] });
    expect(shouldIncludeSkill({ skill })).toBe(true);
  });

  it("returns false when anyBins are all missing", () => {
    const skill = makeSkill({
      requires: { anyBins: ["not-a-bin-x", "not-a-bin-y"] },
    });
    expect(shouldIncludeSkill({ skill })).toBe(false);
  });

  it("returns true when at least one anyBin exists", () => {
    const skill = makeSkill({
      requires: { anyBins: ["not-a-bin-x", "node"] },
    });
    expect(shouldIncludeSkill({ skill })).toBe(true);
  });
});

// ─── always: true Bypass Tests ──────────────────────────────────

describe("shouldIncludeSkill always bypass", () => {
  it("always: true skips missing binary requirements", () => {
    const skill = makeSkill({
      always: true,
      requires: { bins: ["definitely-not-installed-xyz"] },
    });
    expect(shouldIncludeSkill({ skill })).toBe(true);
  });

  it("always: true skips missing env requirements", () => {
    const skill = makeSkill({
      always: true,
      requires: { env: ["NONEXISTENT_VAR_XYZ_123"] },
    });
    expect(shouldIncludeSkill({ skill })).toBe(true);
  });

  it("always: true skips OS platform filter", () => {
    const otherPlatform = os.platform() === "linux" ? "darwin" : "linux";
    const skill = makeSkill({ always: true, os: [otherPlatform] });
    expect(shouldIncludeSkill({ skill })).toBe(true);
  });

  it("always: true still respects explicit disable", () => {
    const skill = makeSkill({ name: "disabled-always", always: true });
    const skillsConfig: SkillsConfig = {
      entries: { "disabled-always": { enabled: false } },
    };
    expect(shouldIncludeSkill({ skill, skillsConfig })).toBe(false);
  });

  it("always: true still respects bundled allowlist", () => {
    const skill = makeSkill({ name: "blocked", always: true, source: "bundled" });
    const skillsConfig: SkillsConfig = { allowBundled: ["other-skill"] };
    expect(shouldIncludeSkill({ skill, skillsConfig })).toBe(false);
  });
});

// ─── isBundledSkillAllowed Tests ─────────────────────────────────

describe("isBundledSkillAllowed", () => {
  it("allows all skills when no allowlist", () => {
    const skill = makeSkill({ source: "bundled" });
    expect(isBundledSkillAllowed(skill)).toBe(true);
  });

  it("allows non-bundled skills regardless of allowlist", () => {
    const skill = makeSkill({ source: "workspace" });
    expect(isBundledSkillAllowed(skill, ["other-skill"])).toBe(true);
  });

  it("blocks bundled skills not in allowlist", () => {
    const skill = makeSkill({ name: "my-skill", source: "bundled" });
    expect(isBundledSkillAllowed(skill, ["other-skill"])).toBe(false);
  });

  it("allows bundled skills in allowlist", () => {
    const skill = makeSkill({ name: "my-skill", source: "bundled" });
    expect(isBundledSkillAllowed(skill, ["my-skill"])).toBe(true);
  });
});

// ─── resolveSkillConfig Tests ────────────────────────────────────

describe("resolveSkillConfig", () => {
  it("returns undefined when no config exists", () => {
    expect(resolveSkillConfig(undefined, "foo")).toBeUndefined();
    expect(resolveSkillConfig({}, "foo")).toBeUndefined();
  });

  it("returns the config for a matching skill", () => {
    const cfg: SkillsConfig = { entries: { foo: { enabled: true } } };
    expect(resolveSkillConfig(cfg, "foo")).toEqual({ enabled: true });
  });
});

// ─── isConfigPathTruthy Tests ────────────────────────────────────

describe("isConfigPathTruthy with defaults", () => {
  it("returns true for browser.enabled even without config", () => {
    expect(isConfigPathTruthy(undefined, "browser.enabled")).toBe(true);
  });

  it("returns false for unknown path without config", () => {
    expect(isConfigPathTruthy(undefined, "unknown.path")).toBe(false);
  });

  it("per-skill config overrides defaults", () => {
    const config = { config: { browser: { enabled: false } } };
    expect(isConfigPathTruthy(config, "browser.enabled")).toBe(false);
  });
});
