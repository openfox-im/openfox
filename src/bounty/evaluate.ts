import type {
  BountyJudgeResult,
  BountyRecord,
  BountySubmissionRecord,
  InferenceClient,
} from "../types.js";
import { buildQuestionBountyJudgePrompt, parseQuestionBountyJudgeResult } from "./skills/question-host.js";

export async function evaluateQuestionBountySubmission(params: {
  inference: InferenceClient;
  bounty: BountyRecord;
  submission: BountySubmissionRecord;
}): Promise<BountyJudgeResult> {
  const response = await params.inference.chat(
    [
      {
        role: "system",
        content: buildQuestionBountyJudgePrompt({
          question: params.bounty.question,
          referenceAnswer: params.bounty.referenceAnswer,
          candidateAnswer: params.submission.answer,
        }),
      },
    ],
    {
      temperature: 0,
      maxTokens: 256,
    },
  );

  return parseQuestionBountyJudgeResult(response.message.content || "");
}
