/**
 * Skills Environment Overrides & Serialization Tests
 */

import { describe, it, expect, afterEach } from "vitest";
import { applySkillEnvOverrides, getActiveSkillEnvKeys } from "../skills/env-overrides.js";
import { serializeByKey } from "../skills/serialize.js";
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

// ─── Env Overrides Tests ─────────────────────────────────────────

describe("skill env overrides", () => {
  const ENV_TEST_KEY = "__OPENFOX_TEST_ENV_KEY__";
  const ENV_TEST_KEY2 = "__OPENFOX_TEST_ENV_KEY2__";

  afterEach(() => {
    delete process.env[ENV_TEST_KEY];
    delete process.env[ENV_TEST_KEY2];
  });

  it("injects env vars from skillConfig.env and reverts on release", () => {
    const skill = makeSkill({ name: "env-inject" });
    const skillsConfig: SkillsConfig = {
      entries: { "env-inject": { env: { [ENV_TEST_KEY]: "injected-value" } } },
    };

    expect(process.env[ENV_TEST_KEY]).toBeUndefined();

    const revert = applySkillEnvOverrides([skill], skillsConfig);
    expect(process.env[ENV_TEST_KEY]).toBe("injected-value");
    expect(getActiveSkillEnvKeys().has(ENV_TEST_KEY)).toBe(true);

    revert();
    expect(process.env[ENV_TEST_KEY]).toBeUndefined();
    expect(getActiveSkillEnvKeys().has(ENV_TEST_KEY)).toBe(false);
  });

  it("injects apiKey into primaryEnv", () => {
    const skill = makeSkill({ name: "api-inject", primaryEnv: ENV_TEST_KEY });
    const skillsConfig: SkillsConfig = {
      entries: { "api-inject": { apiKey: "sk-secret" } },
    };

    const revert = applySkillEnvOverrides([skill], skillsConfig);
    expect(process.env[ENV_TEST_KEY]).toBe("sk-secret");

    revert();
    expect(process.env[ENV_TEST_KEY]).toBeUndefined();
  });

  it("blocks dangerous env vars like PATH", () => {
    const originalPath = process.env.PATH;
    const skill = makeSkill({ name: "evil-skill" });
    const skillsConfig: SkillsConfig = {
      entries: { "evil-skill": { env: { PATH: "/evil/bin", [ENV_TEST_KEY]: "ok" } } },
    };

    const revert = applySkillEnvOverrides([skill], skillsConfig);
    expect(process.env.PATH).toBe(originalPath);
    expect(process.env[ENV_TEST_KEY]).toBe("ok");

    revert();
  });

  it("blocks OPENSSL_CONF injection", () => {
    const skill = makeSkill({ name: "ssl-skill" });
    const skillsConfig: SkillsConfig = {
      entries: { "ssl-skill": { env: { OPENSSL_CONF: "/evil/openssl.cnf" } } },
    };

    const revert = applySkillEnvOverrides([skill], skillsConfig);
    expect(process.env.OPENSSL_CONF).toBeUndefined();
    revert();
  });

  it("blocks null bytes in values", () => {
    const skill = makeSkill({ name: "null-skill" });
    const skillsConfig: SkillsConfig = {
      entries: { "null-skill": { env: { [ENV_TEST_KEY]: "value\0evil" } } },
    };

    const revert = applySkillEnvOverrides([skill], skillsConfig);
    expect(process.env[ENV_TEST_KEY]).toBeUndefined();
    revert();
  });

  it("restores baseline when reverting", () => {
    process.env[ENV_TEST_KEY] = "original";
    const skill = makeSkill({ name: "override-skill" });
    const skillsConfig: SkillsConfig = {
      entries: { "override-skill": { env: { [ENV_TEST_KEY]: "new-value" } } },
    };

    const revert = applySkillEnvOverrides([skill], skillsConfig);
    expect(process.env[ENV_TEST_KEY]).toBe("new-value");

    revert();
    expect(process.env[ENV_TEST_KEY]).toBe("original");
  });
});

// ─── Serialize Tests ─────────────────────────────────────────────

describe("serializeByKey", () => {
  it("executes tasks sequentially for the same key", async () => {
    const order: number[] = [];

    const task1 = serializeByKey("test", async () => {
      await new Promise((r) => setTimeout(r, 50));
      order.push(1);
      return 1;
    });

    const task2 = serializeByKey("test", async () => {
      order.push(2);
      return 2;
    });

    const [r1, r2] = await Promise.all([task1, task2]);
    expect(r1).toBe(1);
    expect(r2).toBe(2);
    expect(order).toEqual([1, 2]);
  });

  it("allows parallel execution for different keys", async () => {
    const order: string[] = [];

    const task1 = serializeByKey("a", async () => {
      await new Promise((r) => setTimeout(r, 50));
      order.push("a");
    });

    const task2 = serializeByKey("b", async () => {
      order.push("b");
    });

    await Promise.all([task1, task2]);
    expect(order).toEqual(["b", "a"]);
  });
});
