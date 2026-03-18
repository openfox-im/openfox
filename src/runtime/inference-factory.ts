/**
 * Inference client factory and helpers.
 */
import type { loadConfig } from "../config.js";
import type { createDatabase } from "../state/database.js";
import { loadApiKeyFromConfig } from "../identity/provision.js";
import { createInferenceClient } from "./inference.js";
import { ModelRegistry } from "../inference/registry.js";

export class NoopInferenceClient {
  async chat(): Promise<never> {
    throw new Error("inference is not available for this command");
  }

  setLowComputeMode(): void {}

  getDefaultModel(): string {
    return "noop";
  }
}

export function resolveBountySkillName(config: {
  role: "host" | "solver";
  defaultKind:
    | "question"
    | "translation"
    | "social_proof"
    | "problem_solving"
    | "public_news_capture"
    | "oracle_evidence_capture"
    | "data_labeling";
  skill: string;
}): string {
  const defaultHostSkill =
    config.defaultKind === "translation"
      ? "translation-bounty-host"
      : config.defaultKind === "social_proof"
        ? "social-bounty-host"
        : config.defaultKind === "problem_solving"
          ? "problem-bounty-host"
          : config.defaultKind === "public_news_capture"
            ? "public-news-capture-host"
            : config.defaultKind === "oracle_evidence_capture"
              ? "oracle-evidence-capture-host"
              : config.defaultKind === "data_labeling"
                ? "data-labeling-bounty-host"
          : "question-bounty-host";
  const defaultSolverSkill =
    config.defaultKind === "translation"
      ? "translation-bounty-solver"
      : config.defaultKind === "social_proof"
        ? "social-bounty-solver"
        : config.defaultKind === "problem_solving"
          ? "problem-bounty-solver"
          : config.defaultKind === "public_news_capture"
            ? "public-news-capture-solver"
            : config.defaultKind === "oracle_evidence_capture"
              ? "oracle-evidence-capture-solver"
              : config.defaultKind === "data_labeling"
                ? "data-labeling-bounty-solver"
          : "question-bounty-solver";
  if (config.role === "solver") {
    return config.skill === "question-bounty-host"
      ? defaultSolverSkill
      : config.skill || defaultSolverSkill;
  }
  return config.skill || defaultHostSkill;
}

export function createConfiguredInferenceClient(params: {
  config: NonNullable<ReturnType<typeof loadConfig>>;
  db: ReturnType<typeof createDatabase>;
}): ReturnType<typeof createInferenceClient> {
  const apiKey = params.config.runtimeApiKey || loadApiKeyFromConfig() || "";
  const modelRegistry = new ModelRegistry(params.db.raw);
  modelRegistry.initialize();
  return createInferenceClient({
    apiUrl: params.config.runtimeApiUrl || "",
    apiKey,
    defaultModel:
      params.config.inferenceModelRef || params.config.inferenceModel,
    maxTokens: params.config.maxTokensPerTurn,
    lowComputeModel: params.config.modelStrategy?.lowComputeModel || "gpt-5-mini",
    openaiApiKey: params.config.openaiApiKey,
    anthropicApiKey: params.config.anthropicApiKey,
    ollamaBaseUrl: process.env.OLLAMA_BASE_URL || params.config.ollamaBaseUrl,
    getModelProvider: (modelId) => modelRegistry.get(modelId)?.provider,
  });
}

export function hasConfiguredInferenceProvider(
  config: NonNullable<ReturnType<typeof loadConfig>>,
): boolean {
  return Boolean(
    config.openaiApiKey ||
      config.anthropicApiKey ||
      config.ollamaBaseUrl ||
      config.runtimeApiKey,
  );
}

export function hasConfiguredInference(config: {
  openaiApiKey?: string;
  anthropicApiKey?: string;
  ollamaBaseUrl?: string;
  runtimeApiKey?: string;
  runtimeApiUrl?: string;
  inferenceModelRef?: string;
  modelStrategy?: { inferenceModel?: string };
}): boolean {
  // claude-code provider uses the locally installed CLI (no API key needed)
  const modelRef = config.inferenceModelRef || config.modelStrategy?.inferenceModel || "";
  if (modelRef.startsWith("claude-code/")) return true;

  return Boolean(
    config.openaiApiKey ||
    config.anthropicApiKey ||
    config.ollamaBaseUrl ||
    (config.runtimeApiKey && config.runtimeApiUrl),
  );
}
