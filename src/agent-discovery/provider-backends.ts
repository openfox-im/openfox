import type { ProviderBackendMode } from "./provider-skill-spec.js";

export interface ProviderBackendExecutionResult<T> {
  result: T;
  kind: "skills" | "builtin";
}

export async function executeProviderBackend<T>(params: {
  mode: ProviderBackendMode;
  runSkills: () => Promise<T>;
  runBuiltin: () => Promise<T>;
  onSkillsFailure?: (error: unknown) => void;
}): Promise<ProviderBackendExecutionResult<T>> {
  if (params.mode === "builtin_only") {
    return { result: await params.runBuiltin(), kind: "builtin" };
  }
  if (params.mode === "skills_only") {
    return { result: await params.runSkills(), kind: "skills" };
  }
  if (params.mode === "builtin_first") {
    return { result: await params.runBuiltin(), kind: "builtin" };
  }

  try {
    return { result: await params.runSkills(), kind: "skills" };
  } catch (error) {
    params.onSkillsFailure?.(error);
    return { result: await params.runBuiltin(), kind: "builtin" };
  }
}
