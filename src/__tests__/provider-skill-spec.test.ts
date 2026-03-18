import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_NEWS_FETCH_SKILL_STAGES,
  DEFAULT_PROOF_VERIFY_SKILL_STAGES,
  DEFAULT_PROVIDER_BACKEND_MODE,
  DEFAULT_STORAGE_GET_SKILL_STAGES,
  DEFAULT_STORAGE_PUT_SKILL_STAGES,
} from "../agent-discovery/provider-skill-spec.js";
import {
  DEFAULT_AGENT_DISCOVERY_NEWS_FETCH_SERVER_CONFIG,
  DEFAULT_AGENT_DISCOVERY_PROOF_VERIFY_SERVER_CONFIG,
  DEFAULT_AGENT_DISCOVERY_STORAGE_SERVER_CONFIG,
} from "../types.js";

describe("provider skill spec", () => {
  it("keeps agent discovery defaults aligned with skills-first stage constants", () => {
    expect(DEFAULT_AGENT_DISCOVERY_NEWS_FETCH_SERVER_CONFIG.backendMode).toBe(
      DEFAULT_PROVIDER_BACKEND_MODE,
    );
    expect(DEFAULT_AGENT_DISCOVERY_NEWS_FETCH_SERVER_CONFIG.skillStages).toEqual(
      DEFAULT_NEWS_FETCH_SKILL_STAGES,
    );

    expect(DEFAULT_AGENT_DISCOVERY_PROOF_VERIFY_SERVER_CONFIG.backendMode).toBe(
      DEFAULT_PROVIDER_BACKEND_MODE,
    );
    expect(DEFAULT_AGENT_DISCOVERY_PROOF_VERIFY_SERVER_CONFIG.skillStages).toEqual(
      DEFAULT_PROOF_VERIFY_SKILL_STAGES,
    );

    expect(DEFAULT_AGENT_DISCOVERY_STORAGE_SERVER_CONFIG.putBackendMode).toBe(
      DEFAULT_PROVIDER_BACKEND_MODE,
    );
    expect(DEFAULT_AGENT_DISCOVERY_STORAGE_SERVER_CONFIG.getBackendMode).toBe(
      DEFAULT_PROVIDER_BACKEND_MODE,
    );
    expect(DEFAULT_AGENT_DISCOVERY_STORAGE_SERVER_CONFIG.putSkillStages).toEqual(
      DEFAULT_STORAGE_PUT_SKILL_STAGES,
    );
    expect(DEFAULT_AGENT_DISCOVERY_STORAGE_SERVER_CONFIG.getSkillStages).toEqual(
      DEFAULT_STORAGE_GET_SKILL_STAGES,
    );
  });

  it("ships machine-readable backend contracts for each skill-composed stage", () => {
    const cases = [
      {
        path: "../../skills/newsfetch/references/capture-contract.json",
        backend: "newsfetch.capture",
      },
      {
        path: "../../skills/zktls/references/prove-contract.json",
        backend: "zktls.prove",
      },
      {
        path: "../../skills/zktls/references/bundle-contract.json",
        backend: "zktls.bundle",
      },
      {
        path: "../../skills/proofverify/references/verify-attestations-contract.json",
        backend: "proofverify.verify-attestations",
      },
      {
        path: "../../skills/proofverify/references/verify-consensus-contract.json",
        backend: "proofverify.verify-consensus",
      },
      {
        path: "../../skills/storage-object/references/put-contract.json",
        backend: "storage-object.put",
      },
      {
        path: "../../skills/storage-object/references/get-contract.json",
        backend: "storage-object.get",
      },
    ] as const;

    for (const entry of cases) {
      const resolvedPath = fileURLToPath(new URL(entry.path, import.meta.url));
      const parsed = JSON.parse(fs.readFileSync(resolvedPath, "utf8")) as {
        backend?: string;
        contractVersion?: string;
        input?: unknown;
        output?: unknown;
      };

      expect(parsed.backend).toBe(entry.backend);
      expect(parsed.contractVersion).toBe("v1");
      expect(parsed.input).toBeTruthy();
      expect(parsed.output).toBeTruthy();
    }
  });
});
