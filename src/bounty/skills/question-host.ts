import type { BountyJudgeResult } from "../../types.js";

export interface QuestionBountyDraft {
  question: string;
  referenceAnswer: string;
  submissionTtlSeconds?: number;
}

export function buildQuestionBountyDraftPrompt(params: {
  openingPrompt?: string;
  defaultSubmissionTtlSeconds: number;
  skillInstructions?: string;
}): string {
  return [
    "You are creating one bounded question bounty for OpenFox.",
    "Generate exactly one question that a small local model can judge deterministically.",
    "Use a short question and a short canonical answer.",
    "Avoid subjective or multi-step reasoning questions.",
    params.skillInstructions?.trim()
      ? `Skill instructions:\n${params.skillInstructions.trim()}`
      : undefined,
    "",
    "Return only a JSON object with this exact shape:",
    '{"question":"short question","reference_answer":"short canonical answer","submission_ttl_seconds":3600}',
    "",
    `Default submission TTL seconds: ${params.defaultSubmissionTtlSeconds}`,
    params.openingPrompt?.trim()
      ? `Opening instructions: ${params.openingPrompt.trim()}`
      : "Opening instructions: Create a concise factual or multiple-choice-style question.",
  ].join("\n");
}

export function parseQuestionBountyDraft(raw: string): QuestionBountyDraft {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) {
    throw new Error("Bounty draft model did not return a JSON object");
  }
  const parsed = JSON.parse(match[0]) as {
    question?: unknown;
    reference_answer?: unknown;
    submission_ttl_seconds?: unknown;
  };
  const question =
    typeof parsed.question === "string" ? parsed.question.trim() : "";
  const referenceAnswer =
    typeof parsed.reference_answer === "string"
      ? parsed.reference_answer.trim()
      : "";
  if (!question) {
    throw new Error("Bounty draft is missing question");
  }
  if (!referenceAnswer) {
    throw new Error("Bounty draft is missing reference_answer");
  }
  const submissionTtlSeconds =
    typeof parsed.submission_ttl_seconds === "number" &&
    Number.isFinite(parsed.submission_ttl_seconds) &&
    parsed.submission_ttl_seconds > 0
      ? Math.floor(parsed.submission_ttl_seconds)
      : undefined;
  return {
    question,
    referenceAnswer,
    submissionTtlSeconds,
  };
}

export function buildQuestionBountyJudgePrompt(params: {
  question: string;
  referenceAnswer: string;
  candidateAnswer: string;
  skillInstructions?: string;
}): string {
  return [
    "You are the host-side judge for a bounded question bounty.",
    "Decide whether the candidate answer should receive the reward.",
    "Be strict and deterministic.",
    params.skillInstructions?.trim()
      ? `Skill instructions:\n${params.skillInstructions.trim()}`
      : undefined,
    "",
    "Return only a JSON object with this exact shape:",
    '{"decision":"accepted|rejected","confidence":0.0,"reason":"short explanation"}',
    "",
    `Question: ${params.question}`,
    `Reference answer: ${params.referenceAnswer}`,
    `Candidate answer: ${params.candidateAnswer}`,
  ].join("\n");
}

export function parseQuestionBountyJudgeResult(
  raw: string,
): BountyJudgeResult {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) {
    throw new Error("Judge model did not return a JSON object");
  }
  const parsed = JSON.parse(match[0]) as Partial<BountyJudgeResult>;
  if (
    parsed.decision !== "accepted" &&
    parsed.decision !== "rejected"
  ) {
    throw new Error("Judge result is missing a valid decision");
  }
  const confidence =
    typeof parsed.confidence === "number" &&
    Number.isFinite(parsed.confidence)
      ? Math.min(1, Math.max(0, parsed.confidence))
      : 0;
  return {
    decision: parsed.decision,
    confidence,
    reason:
      typeof parsed.reason === "string" && parsed.reason.trim()
        ? parsed.reason.trim()
        : "No judge reason provided.",
  };
}
