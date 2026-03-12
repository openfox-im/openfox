export const PROVIDER_BACKEND_MODES = [
  "skills_first",
  "skills_only",
  "builtin_first",
  "builtin_only",
] as const;

export type ProviderBackendMode = (typeof PROVIDER_BACKEND_MODES)[number];

export interface SkillBackendStageConfig {
  skill: string;
  backend: string;
}

export const DEFAULT_PROVIDER_BACKEND_MODE: ProviderBackendMode = "skills_first";

export const NEWSFETCH_CAPTURE_STAGE = {
  skill: "newsfetch",
  backend: "capture",
} as const satisfies SkillBackendStageConfig;

export const ZKTLS_PROVE_STAGE = {
  skill: "zktls",
  backend: "prove",
} as const satisfies SkillBackendStageConfig;

export const ZKTLS_BUNDLE_STAGE = {
  skill: "zktls",
  backend: "bundle",
} as const satisfies SkillBackendStageConfig;

export const PROOFVERIFY_VERIFY_STAGE = {
  skill: "proofverify",
  backend: "verify",
} as const satisfies SkillBackendStageConfig;

export const PROOFVERIFY_VERIFY_ATTESTATIONS_STAGE = {
  skill: "proofverify",
  backend: "verify-attestations",
} as const satisfies SkillBackendStageConfig;

export const PROOFVERIFY_VERIFY_CONSENSUS_STAGE = {
  skill: "proofverify",
  backend: "verify-consensus",
} as const satisfies SkillBackendStageConfig;

export const STORAGE_OBJECT_PUT_STAGE = {
  skill: "storage-object",
  backend: "put",
} as const satisfies SkillBackendStageConfig;

export const STORAGE_OBJECT_GET_STAGE = {
  skill: "storage-object",
  backend: "get",
} as const satisfies SkillBackendStageConfig;

export const DEFAULT_NEWS_FETCH_SKILL_STAGES = [
  NEWSFETCH_CAPTURE_STAGE,
  ZKTLS_PROVE_STAGE,
  ZKTLS_BUNDLE_STAGE,
] as const satisfies readonly SkillBackendStageConfig[];

export const DEFAULT_PROOF_VERIFY_SKILL_STAGES = [
  PROOFVERIFY_VERIFY_ATTESTATIONS_STAGE,
  PROOFVERIFY_VERIFY_CONSENSUS_STAGE,
] as const satisfies readonly SkillBackendStageConfig[];

export const DEFAULT_STORAGE_PUT_SKILL_STAGES = [
  STORAGE_OBJECT_PUT_STAGE,
] as const satisfies readonly SkillBackendStageConfig[];

export const DEFAULT_STORAGE_GET_SKILL_STAGES = [
  STORAGE_OBJECT_GET_STAGE,
] as const satisfies readonly SkillBackendStageConfig[];

export function cloneSkillBackendStages(
  stages: readonly SkillBackendStageConfig[],
): SkillBackendStageConfig[] {
  return stages.map((stage) => ({ ...stage }));
}

export function formatSkillBackendStage(
  stage: SkillBackendStageConfig,
): string {
  return `${stage.skill}.${stage.backend}`;
}
