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
    case "public_news_capture":
      return "public news capture";
    case "oracle_evidence_capture":
      return "oracle evidence capture";
    case "data_labeling":
      return "data labeling";
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
      : params.kind === "public_news_capture"
        ? "Return a concise capture summary that includes the key public facts requested by the host."
        : params.kind === "oracle_evidence_capture"
          ? "Return a concise evidence summary that directly supports the bounded question."
          : params.kind === "data_labeling"
            ? "Return structured labels for each dataset item matching the labeling instructions. Use the exact label set specified by the host."
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
