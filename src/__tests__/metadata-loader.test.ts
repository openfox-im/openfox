import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";

import {
  isContractMetadata,
  loadContractMetadataFile,
  parseContractMetadata,
} from "../intent/metadata-loader.js";

function makeContractMetadata() {
  return {
    schema_version: "0.1.0",
    artifact_ref: {
      package_hash: "0x" + "1".repeat(64),
      bytecode_hash: "0x" + "2".repeat(64),
      abi_hash: "0x" + "3".repeat(64),
      version: "1.0.0",
    },
    contract: {
      name: "GuardianVault",
      base_contracts: ["PolicyWallet"],
      is_account: true,
      storage_slots: 12,
    },
    functions: [
      {
        name: "executeTransfer",
        selector: "0xdeadbeef",
        visibility: "external",
        mutability: "payable",
        params: [
          { name: "to", type: "address" },
          { name: "value", type: "uint256" },
        ],
        returns: [],
        requires_capability: ["guardian-approval"],
        effects: {
          writes: ["owner_balance"],
          calls: [{ interface: "IERC20", selector: "0xa9059cbb", max_gas: 50000 }],
        },
        gas_upper: 90000,
        verifiable: true,
        delegated: true,
        non_composable: false,
        risk_level: "high",
      },
    ],
    events: [],
    manifest: {
      version: "1.0.0",
      capabilities: ["guardian-approval"],
    },
    gas_model: {
      version: "istanbul",
      sload: 2100,
      sstore: 20000,
      log_base: 375,
    },
    capabilities: ["guardian-approval"],
    is_account: true,
    policy_profile: {
      has_spend_caps: true,
      has_allowlist: true,
      has_terminal_policy: true,
      has_guardian: true,
      has_recovery: true,
      has_delegation: true,
      has_suspension: false,
    },
  };
}

describe("metadata-loader", () => {
  it("parses a direct metadata object", () => {
    const metadata = parseContractMetadata(makeContractMetadata());

    expect(metadata.contract.name).toBe("GuardianVault");
    expect(metadata.functions[0]?.risk_level).toBe("high");
    expect(isContractMetadata(metadata)).toBe(true);
  });

  it("parses a wrapped metadata payload", () => {
    const metadata = parseContractMetadata({ metadata: makeContractMetadata() });

    expect(metadata.schema_version).toBe("0.1.0");
    expect(metadata.policy_profile?.has_guardian).toBe(true);
  });

  it("loads metadata from a JSON file", () => {
    const dir = mkdtempSync(join(tmpdir(), "openfox-metadata-"));
    try {
      const filePath = join(dir, "guardian-vault.json");
      writeFileSync(filePath, JSON.stringify(makeContractMetadata(), null, 2));

      const metadata = loadContractMetadataFile(filePath);
      expect(metadata.artifact_ref.version).toBe("1.0.0");
      expect(metadata.gas_model.version).toBe("istanbul");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
