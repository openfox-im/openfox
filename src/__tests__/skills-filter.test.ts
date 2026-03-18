/**
 * Skills Filter Tests
 */

import { describe, it, expect } from "vitest";
import {
  normalizeSkillFilter,
  normalizeSkillFilterForComparison,
  matchesSkillFilter,
} from "../skills/filter.js";

describe("normalizeSkillFilter", () => {
  it("returns undefined for null/undefined/empty", () => {
    expect(normalizeSkillFilter(undefined)).toBeUndefined();
    expect(normalizeSkillFilter(null)).toBeUndefined();
    expect(normalizeSkillFilter([])).toBeUndefined();
  });

  it("normalizes to lowercase trimmed strings", () => {
    expect(normalizeSkillFilter(["  Foo ", "BAR"])).toEqual(["foo", "bar"]);
  });

  it("filters out empty strings", () => {
    expect(normalizeSkillFilter(["foo", "", "  "])).toEqual(["foo"]);
  });
});

describe("normalizeSkillFilterForComparison", () => {
  it("deduplicates and sorts", () => {
    expect(normalizeSkillFilterForComparison(["b", "a", "b"])).toEqual(["a", "b"]);
  });

  it("returns undefined for undefined input", () => {
    expect(normalizeSkillFilterForComparison(undefined)).toBeUndefined();
  });
});

describe("matchesSkillFilter", () => {
  it("matches two undefined filters", () => {
    expect(matchesSkillFilter(undefined, undefined)).toBe(true);
  });

  it("does not match undefined vs defined", () => {
    expect(matchesSkillFilter(undefined, ["a"])).toBe(false);
    expect(matchesSkillFilter(["a"], undefined)).toBe(false);
  });

  it("matches same filters in different order", () => {
    expect(matchesSkillFilter(["b", "a"], ["a", "b"])).toBe(true);
  });

  it("does not match different filters", () => {
    expect(matchesSkillFilter(["a"], ["b"])).toBe(false);
  });
});
