export function buildQuestionBountySolverPrompt(params: {
  question: string;
}): string {
  return [
    "You are solving a bounded question bounty.",
    "Return only the answer text with no explanation, no markdown, and no extra framing.",
    "",
    `Question: ${params.question}`,
  ].join("\n");
}
