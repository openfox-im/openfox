import { describe, expect, it, vi } from "vitest";
import {
  checkSchemaCompatibility,
  isVersionCompatible,
  parseSemver,
} from "../pipeline/schema-check.js";
import {
  checkMatrixCompatibility,
  COMPAT_MATRIX,
} from "../pipeline/compat-matrix.js";

// ---------------------------------------------------------------------------
// parseSemver
// ---------------------------------------------------------------------------
describe("parseSemver", () => {
  it("parses valid semver strings", () => {
    expect(parseSemver("0.1.0")).toEqual({ major: 0, minor: 1, patch: 0 });
    expect(parseSemver("1.2.3")).toEqual({ major: 1, minor: 2, patch: 3 });
    expect(parseSemver("10.20.30")).toEqual({ major: 10, minor: 20, patch: 30 });
  });

  it("returns null for invalid strings", () => {
    expect(parseSemver("")).toBeNull();
    expect(parseSemver("1.2")).toBeNull();
    expect(parseSemver("1.2.3.4")).toBeNull();
    expect(parseSemver("abc")).toBeNull();
    expect(parseSemver("a.b.c")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// isVersionCompatible
// ---------------------------------------------------------------------------
describe("isVersionCompatible", () => {
  it("returns true when major.minor match", () => {
    expect(isVersionCompatible("0.1.0", "0.1.0")).toBe(true);
    expect(isVersionCompatible("0.1.0", "0.1.5")).toBe(true);
    expect(isVersionCompatible("0.1.0", "0.1.99")).toBe(true);
    expect(isVersionCompatible("1.2.3", "1.2.0")).toBe(true);
  });

  it("returns false when major or minor differ", () => {
    expect(isVersionCompatible("0.1.0", "0.2.0")).toBe(false);
    expect(isVersionCompatible("0.1.0", "1.1.0")).toBe(false);
    expect(isVersionCompatible("1.0.0", "2.0.0")).toBe(false);
  });

  it("returns false for invalid versions", () => {
    expect(isVersionCompatible("invalid", "0.1.0")).toBe(false);
    expect(isVersionCompatible("0.1.0", "invalid")).toBe(false);
    expect(isVersionCompatible("", "")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// checkSchemaCompatibility (with mocked fetch)
// ---------------------------------------------------------------------------
describe("checkSchemaCompatibility", () => {
  it("returns compatible when getBoundaryVersion matches", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        jsonrpc: "2.0",
        id: 1,
        result: "0.1.0",
      }),
    });

    const result = await checkSchemaCompatibility(
      "http://localhost:8545",
      mockFetch as unknown as typeof fetch,
    );
    expect(result.compatible).toBe(true);
    expect(result.localVersion).toBe("0.1.0");
    expect(result.remoteVersion).toBe("0.1.0");
  });

  it("falls back to getSchemaVersion when the new RPC is unavailable", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          jsonrpc: "2.0",
          id: 1,
          error: { code: -32601, message: "Method not found" },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          jsonrpc: "2.0",
          id: 1,
          result: { schema_version: "0.1.5", namespace: "policyWallet" },
        }),
      });

    const result = await checkSchemaCompatibility(
      "http://localhost:8545",
      mockFetch as unknown as typeof fetch,
    );
    expect(result.compatible).toBe(true);
    expect(result.remoteVersion).toBe("0.1.5");
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String(mockFetch.mock.calls[0]?.[1]?.body)).method).toBe(
      "policyWallet_getBoundaryVersion",
    );
    expect(JSON.parse(String(mockFetch.mock.calls[1]?.[1]?.body)).method).toBe(
      "policyWallet_getSchemaVersion",
    );
  });

  it("returns incompatible when minor version differs", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        jsonrpc: "2.0",
        id: 1,
        result: "0.2.0",
      }),
    });

    const result = await checkSchemaCompatibility(
      "http://localhost:8545",
      mockFetch as unknown as typeof fetch,
    );
    expect(result.compatible).toBe(false);
    expect(result.remoteVersion).toBe("0.2.0");
    expect(result.message).toContain("mismatch");
  });

  it("handles HTTP errors gracefully", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
    });

    const result = await checkSchemaCompatibility(
      "http://localhost:8545",
      mockFetch as unknown as typeof fetch,
    );
    expect(result.compatible).toBe(false);
    expect(result.remoteVersion).toBe("unknown");
    expect(result.message).toContain("HTTP 500");
  });

  it("handles RPC errors gracefully", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        jsonrpc: "2.0",
        id: 1,
        error: { code: -32000, message: "Upstream unavailable" },
      }),
    });

    const result = await checkSchemaCompatibility(
      "http://localhost:8545",
      mockFetch as unknown as typeof fetch,
    );
    expect(result.compatible).toBe(false);
    expect(result.remoteVersion).toBe("unknown");
    expect(result.message).toContain("Upstream unavailable");
  });

  it("handles network errors gracefully", async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));

    const result = await checkSchemaCompatibility(
      "http://localhost:8545",
      mockFetch as unknown as typeof fetch,
    );
    expect(result.compatible).toBe(false);
    expect(result.remoteVersion).toBe("unknown");
    expect(result.message).toContain("ECONNREFUSED");
  });

  it("handles missing version fields in both RPC shapes", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          jsonrpc: "2.0",
          id: 1,
          result: { namespace: "policyWallet" },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          jsonrpc: "2.0",
          id: 1,
          result: { namespace: "policyWallet" },
        }),
      });

    const result = await checkSchemaCompatibility(
      "http://localhost:8545",
      mockFetch as unknown as typeof fetch,
    );
    expect(result.compatible).toBe(false);
    expect(result.remoteVersion).toBe("unknown");
    expect(result.message).toContain("did not return a boundary version");
  });
});

// ---------------------------------------------------------------------------
// checkMatrixCompatibility
// ---------------------------------------------------------------------------
describe("checkMatrixCompatibility", () => {
  it("returns compatible for openfox <-> gtos at 0.1.0", () => {
    const result = checkMatrixCompatibility("openfox", "gtos", "0.1.0");
    expect(result.compatible).toBe(true);
  });

  it("returns compatible for openfox <-> tolang at 0.1.0", () => {
    const result = checkMatrixCompatibility("openfox", "tolang", "0.1.0");
    expect(result.compatible).toBe(true);
  });

  it("returns compatible with patch versions in range", () => {
    const result = checkMatrixCompatibility("openfox", "gtos", "0.1.5");
    expect(result.compatible).toBe(true);
  });

  it("returns incompatible for unknown local repo", () => {
    const result = checkMatrixCompatibility("unknown", "gtos", "0.1.0");
    expect(result.compatible).toBe(false);
    expect(result.reason).toContain("Unknown local repository");
  });

  it("returns incompatible for unknown remote repo", () => {
    const result = checkMatrixCompatibility("openfox", "unknown", "0.1.0");
    expect(result.compatible).toBe(false);
    expect(result.reason).toContain("Unknown remote repository");
  });

  it("returns incompatible when version is outside range", () => {
    const result = checkMatrixCompatibility("openfox", "gtos", "0.2.0");
    expect(result.compatible).toBe(false);
    expect(result.reason).toContain("outside");
  });

  it("returns incompatible for major version mismatch", () => {
    const result = checkMatrixCompatibility("openfox", "gtos", "1.0.0");
    expect(result.compatible).toBe(false);
  });

  it("COMPAT_MATRIX has entries for all three repos", () => {
    expect(COMPAT_MATRIX.repositories.openfox).toBeDefined();
    expect(COMPAT_MATRIX.repositories.gtos).toBeDefined();
    expect(COMPAT_MATRIX.repositories.tolang).toBeDefined();
  });

  it("COMPAT_MATRIX schema version matches boundary schema version", () => {
    expect(COMPAT_MATRIX.schemaVersion).toBe("0.1.0");
  });
});
