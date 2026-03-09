import type { BountyKind } from "../../types.js";

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

export function buildTaskBountySolverPrompt(params: {
  kind: BountyKind;
  title: string;
  taskPrompt: string;
  skillInstructions?: string;
}): string {
  return [
    `You are solving a bounded ${labelForKind(params.kind)} bounty.`,
    "Return only the submission text with no markdown and no extra framing.",
    params.kind === "social_proof"
      ? "If the task requires a proof URL, return the required text only. The caller may attach the proof URL separately."
      : undefined,
    params.skillInstructions?.trim()
      ? `Skill instructions:\n${params.skillInstructions.trim()}`
      : undefined,
    "",
    `Title: ${params.title}`,
    `Task prompt: ${params.taskPrompt}`,
  ]
    .filter(Boolean)
    .join("\n");
}
