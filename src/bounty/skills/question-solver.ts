export function buildQuestionBountySolverPrompt(params: {
  question: string;
  skillInstructions?: string;
}): string {
  return [
    "You are solving a bounded question bounty.",
    "Return only the answer text with no explanation, no markdown, and no extra framing.",
    params.skillInstructions?.trim()
      ? `Skill instructions:\n${params.skillInstructions.trim()}`
      : undefined,
    "",
    `Question: ${params.question}`,
  ].join("\n");
}
