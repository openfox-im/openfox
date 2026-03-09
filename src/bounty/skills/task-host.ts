import type { BountyJudgeResult, BountyKind } from "../../types.js";

export interface TaskBountyDraft {
  title: string;
  taskPrompt: string;
  referenceOutput: string;
  submissionTtlSeconds?: number;
}

function labelForKind(kind: BountyKind): string {
  switch (kind) {
    case "question":
      return "question";
    case "translation":
      return "translation";
    case "social_proof":
      return "social proof";
    case "problem_solving":
      return "problem solving";
  }
}

export function buildTaskBountyDraftPrompt(params: {
  kind: BountyKind;
  openingPrompt?: string;
  defaultSubmissionTtlSeconds: number;
  skillInstructions?: string;
}): string {
  return [
    `You are creating one bounded ${labelForKind(params.kind)} bounty for OpenFox.`,
    "Generate exactly one task that a small local model can judge deterministically.",
    "Use a short title, a clear task prompt, and a short canonical reference output.",
    params.kind === "social_proof"
      ? "For social proof bounties, require a proof URL and a short proof text."
      : "Avoid subjective or open-ended tasks that cannot be judged reliably.",
    params.skillInstructions?.trim()
      ? `Skill instructions:\n${params.skillInstructions.trim()}`
      : undefined,
    "",
    "Return only a JSON object with this exact shape:",
    '{"title":"short title","task_prompt":"bounded task prompt","reference_output":"short canonical output","submission_ttl_seconds":3600}',
    "",
    `Default submission TTL seconds: ${params.defaultSubmissionTtlSeconds}`,
    params.openingPrompt?.trim()
      ? `Opening instructions: ${params.openingPrompt.trim()}`
      : "Opening instructions: Create one concise task suitable for automated judging.",
  ].join("\n");
}

export function parseTaskBountyDraft(raw: string): TaskBountyDraft {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) {
    throw new Error("Bounty draft model did not return a JSON object");
  }
  const parsed = JSON.parse(match[0]) as {
    title?: unknown;
    task_prompt?: unknown;
    reference_output?: unknown;
    submission_ttl_seconds?: unknown;
  };
  const title = typeof parsed.title === "string" ? parsed.title.trim() : "";
  const taskPrompt =
    typeof parsed.task_prompt === "string" ? parsed.task_prompt.trim() : "";
  const referenceOutput =
    typeof parsed.reference_output === "string"
      ? parsed.reference_output.trim()
      : "";
  if (!taskPrompt) {
    throw new Error("Bounty draft is missing task_prompt");
  }
  if (!referenceOutput) {
    throw new Error("Bounty draft is missing reference_output");
  }
  const submissionTtlSeconds =
    typeof parsed.submission_ttl_seconds === "number" &&
    Number.isFinite(parsed.submission_ttl_seconds) &&
    parsed.submission_ttl_seconds > 0
      ? Math.floor(parsed.submission_ttl_seconds)
      : undefined;
  return {
    title: title || taskPrompt.slice(0, 160),
    taskPrompt,
    referenceOutput,
    submissionTtlSeconds,
  };
}

export function buildTaskBountyJudgePrompt(params: {
  kind: BountyKind;
  title: string;
  taskPrompt: string;
  referenceOutput: string;
  candidateSubmission: string;
  proofUrl?: string | null;
  skillInstructions?: string;
}): string {
  return [
    `You are the host-side judge for a bounded ${labelForKind(params.kind)} bounty.`,
    "Decide whether the candidate submission should receive the reward.",
    "Be strict and deterministic.",
    params.kind === "social_proof"
      ? "For social proof bounties, only accept if the proof URL and the submission clearly satisfy the task prompt."
      : undefined,
    params.skillInstructions?.trim()
      ? `Skill instructions:\n${params.skillInstructions.trim()}`
      : undefined,
    "",
    "Return only a JSON object with this exact shape:",
    '{"decision":"accepted|rejected","confidence":0.0,"reason":"short explanation"}',
    "",
    `Title: ${params.title}`,
    `Task prompt: ${params.taskPrompt}`,
    `Reference output: ${params.referenceOutput}`,
    `Candidate submission: ${params.candidateSubmission}`,
    params.proofUrl ? `Proof URL: ${params.proofUrl}` : undefined,
  ]
    .filter(Boolean)
    .join("\n");
}

export function parseTaskBountyJudgeResult(raw: string): BountyJudgeResult {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) {
    throw new Error("Judge model did not return a JSON object");
  }
  const parsed = JSON.parse(match[0]) as Partial<BountyJudgeResult>;
  if (parsed.decision !== "accepted" && parsed.decision !== "rejected") {
    throw new Error("Judge result is missing a valid decision");
  }
  const confidence =
    typeof parsed.confidence === "number" && Number.isFinite(parsed.confidence)
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
