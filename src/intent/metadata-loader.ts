import { readFileSync } from "node:fs";
import type {
  ArtifactRef,
  CallMeta,
  ContractInfo,
  ContractMetadata,
  EffectsMeta,
  EventMeta,
  FunctionMeta,
  GasModelMeta,
  ManifestMeta,
  ParamMeta,
  PolicyProfile,
} from "./metadata-consumer.js";

export function isContractMetadata(value: unknown): value is ContractMetadata {
  try {
    parseContractMetadata(value);
    return true;
  } catch {
    return false;
  }
}

export function parseContractMetadata(
  value: unknown,
  label = "contract metadata",
): ContractMetadata {
  const candidate = unwrapMetadata(value, label);
  return {
    schema_version: requireString(candidate.schema_version, `${label}.schema_version`),
    artifact_ref: parseArtifactRef(candidate.artifact_ref, `${label}.artifact_ref`),
    contract: parseContractInfo(candidate.contract, `${label}.contract`),
    functions: requireArray(candidate.functions, `${label}.functions`).map((item, index) =>
      parseFunctionMeta(item, `${label}.functions[${index}]`),
    ),
    events: requireArray(candidate.events, `${label}.events`).map((item, index) =>
      parseEventMeta(item, `${label}.events[${index}]`),
    ),
    manifest: candidate.manifest === undefined
      ? undefined
      : parseManifestMeta(candidate.manifest, `${label}.manifest`),
    gas_model: parseGasModelMeta(candidate.gas_model, `${label}.gas_model`),
    capabilities: candidate.capabilities === undefined
      ? undefined
      : requireStringArray(candidate.capabilities, `${label}.capabilities`),
    is_account: requireBoolean(candidate.is_account, `${label}.is_account`),
    policy_profile: candidate.policy_profile === undefined
      ? undefined
      : parsePolicyProfile(candidate.policy_profile, `${label}.policy_profile`),
  };
}

export function loadContractMetadataFile(filePath: string): ContractMetadata {
  const raw = readFileSync(filePath, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to parse contract metadata JSON at ${filePath}: ${message}`);
  }
  return parseContractMetadata(parsed, `contract metadata file ${filePath}`);
}

function unwrapMetadata(value: unknown, label: string): Record<string, unknown> {
  const record = requireRecord(value, label);
  if ("metadata" in record) {
    return requireRecord(record.metadata, `${label}.metadata`);
  }
  return record;
}

function parseArtifactRef(value: unknown, label: string): ArtifactRef {
  const record = requireRecord(value, label);
  return {
    package_hash: requireString(record.package_hash, `${label}.package_hash`),
    bytecode_hash: requireString(record.bytecode_hash, `${label}.bytecode_hash`),
    source_hash: optionalString(record.source_hash, `${label}.source_hash`),
    abi_hash: requireString(record.abi_hash, `${label}.abi_hash`),
    version: optionalString(record.version, `${label}.version`),
  };
}

function parseContractInfo(value: unknown, label: string): ContractInfo {
  const record = requireRecord(value, label);
  return {
    name: requireString(record.name, `${label}.name`),
    base_contracts: record.base_contracts === undefined
      ? undefined
      : requireStringArray(record.base_contracts, `${label}.base_contracts`),
    is_account: requireBoolean(record.is_account, `${label}.is_account`),
    storage_slots: requireNumber(record.storage_slots, `${label}.storage_slots`),
  };
}

function parseParamMeta(value: unknown, label: string): ParamMeta {
  const record = requireRecord(value, label);
  return {
    name: requireString(record.name, `${label}.name`),
    type: requireString(record.type, `${label}.type`),
  };
}

function parseCallMeta(value: unknown, label: string): CallMeta {
  const record = requireRecord(value, label);
  return {
    capability: optionalString(record.capability, `${label}.capability`),
    interface: optionalString(record.interface, `${label}.interface`),
    selector: optionalString(record.selector, `${label}.selector`),
    max_gas: optionalNumber(record.max_gas, `${label}.max_gas`),
  };
}

function parseEffectsMeta(value: unknown, label: string): EffectsMeta {
  const record = requireRecord(value, label);
  return {
    reads: record.reads === undefined
      ? undefined
      : requireStringArray(record.reads, `${label}.reads`),
    writes: record.writes === undefined
      ? undefined
      : requireStringArray(record.writes, `${label}.writes`),
    emits: record.emits === undefined
      ? undefined
      : requireStringArray(record.emits, `${label}.emits`),
    calls: record.calls === undefined
      ? undefined
      : requireArray(record.calls, `${label}.calls`).map((item, index) =>
        parseCallMeta(item, `${label}.calls[${index}]`),
      ),
  };
}

function parseFunctionMeta(value: unknown, label: string): FunctionMeta {
  const record = requireRecord(value, label);
  return {
    name: requireString(record.name, `${label}.name`),
    selector: requireString(record.selector, `${label}.selector`),
    visibility: requireString(record.visibility, `${label}.visibility`),
    mutability: requireString(record.mutability, `${label}.mutability`),
    params: requireArray(record.params, `${label}.params`).map((item, index) =>
      parseParamMeta(item, `${label}.params[${index}]`),
    ),
    returns: record.returns === undefined
      ? undefined
      : requireArray(record.returns, `${label}.returns`).map((item, index) =>
        parseParamMeta(item, `${label}.returns[${index}]`),
      ),
    requires_capability: record.requires_capability === undefined
      ? undefined
      : requireStringArray(record.requires_capability, `${label}.requires_capability`),
    effects: record.effects === undefined
      ? undefined
      : parseEffectsMeta(record.effects, `${label}.effects`),
    gas_upper: optionalNumber(record.gas_upper, `${label}.gas_upper`),
    verifiable: requireBoolean(record.verifiable, `${label}.verifiable`),
    delegated: requireBoolean(record.delegated, `${label}.delegated`),
    non_composable: requireBoolean(record.non_composable, `${label}.non_composable`),
    risk_level: optionalString(record.risk_level, `${label}.risk_level`),
  };
}

function parseEventMeta(value: unknown, label: string): EventMeta {
  const record = requireRecord(value, label);
  return {
    name: requireString(record.name, `${label}.name`),
    params: requireArray(record.params, `${label}.params`).map((item, index) =>
      parseParamMeta(item, `${label}.params[${index}]`),
    ),
  };
}

function parseManifestMeta(value: unknown, label: string): ManifestMeta {
  const record = requireRecord(value, label);
  return {
    version: optionalString(record.version, `${label}.version`),
    capabilities: record.capabilities === undefined
      ? undefined
      : requireStringArray(record.capabilities, `${label}.capabilities`),
    spec: optionalString(record.spec, `${label}.spec`),
    sla_uptime: optionalString(record.sla_uptime, `${label}.sla_uptime`),
    custom: record.custom === undefined
      ? undefined
      : parseStringMap(record.custom, `${label}.custom`),
  };
}

function parseGasModelMeta(value: unknown, label: string): GasModelMeta {
  const record = requireRecord(value, label);
  return {
    version: requireString(record.version, `${label}.version`),
    sload: requireNumber(record.sload, `${label}.sload`),
    sstore: requireNumber(record.sstore, `${label}.sstore`),
    log_base: requireNumber(record.log_base, `${label}.log_base`),
  };
}

function parsePolicyProfile(value: unknown, label: string): PolicyProfile {
  const record = requireRecord(value, label);
  return {
    has_spend_caps: requireBoolean(record.has_spend_caps, `${label}.has_spend_caps`),
    has_allowlist: requireBoolean(record.has_allowlist, `${label}.has_allowlist`),
    has_terminal_policy: requireBoolean(record.has_terminal_policy, `${label}.has_terminal_policy`),
    has_guardian: requireBoolean(record.has_guardian, `${label}.has_guardian`),
    has_recovery: requireBoolean(record.has_recovery, `${label}.has_recovery`),
    has_delegation: requireBoolean(record.has_delegation, `${label}.has_delegation`),
    has_suspension: requireBoolean(record.has_suspension, `${label}.has_suspension`),
  };
}

function parseStringMap(value: unknown, label: string): Record<string, string> {
  const record = requireRecord(value, label);
  const output: Record<string, string> = {};
  for (const [key, item] of Object.entries(record)) {
    output[key] = requireString(item, `${label}.${key}`);
  }
  return output;
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function requireArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array`);
  }
  return value;
}

function requireStringArray(value: unknown, label: string): string[] {
  return requireArray(value, label).map((item, index) => requireString(item, `${label}[${index}]`));
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
}

function optionalString(value: unknown, label: string): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  return requireString(value, label);
}

function requireBoolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`${label} must be a boolean`);
  }
  return value;
}

function requireNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number`);
  }
  return value;
}

function optionalNumber(value: unknown, label: string): number | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  return requireNumber(value, label);
}
