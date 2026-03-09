import type {
  BountyJudgeResult,
  BountyRecord,
  BountySubmissionRecord,
  InferenceClient,
} from "../types.js";
import {
  buildQuestionBountyJudgePrompt,
  parseQuestionBountyJudgeResult,
} from "./skills/question-host.js";
import {
  buildTaskBountyJudgePrompt,
  parseTaskBountyJudgeResult,
} from "./skills/task-host.js";

export async function evaluateBountySubmission(params: {
  inference: InferenceClient;
  bounty: BountyRecord;
  submission: BountySubmissionRecord;
  skillInstructions?: string;
}): Promise<BountyJudgeResult> {
  const prompt =
    params.bounty.kind === "question"
      ? buildQuestionBountyJudgePrompt({
          question: params.bounty.taskPrompt,
          referenceAnswer: params.bounty.referenceOutput,
          candidateAnswer: params.submission.submissionText,
          skillInstructions: params.skillInstructions,
        })
      : buildTaskBountyJudgePrompt({
          kind: params.bounty.kind,
          title: params.bounty.title,
          taskPrompt: params.bounty.taskPrompt,
          referenceOutput: params.bounty.referenceOutput,
          candidateSubmission: params.submission.submissionText,
          proofUrl: params.submission.proofUrl,
          skillInstructions: params.skillInstructions,
        });

  const response = await params.inference.chat(
    [
      {
        role: "system",
        content: prompt,
      },
    ],
    {
      temperature: 0,
      maxTokens: 256,
    },
  );

  return params.bounty.kind === "question"
    ? parseQuestionBountyJudgeResult(response.message.content || "")
    : parseTaskBountyJudgeResult(response.message.content || "");
}
