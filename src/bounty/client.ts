import type { Address } from "tosdk";
import type { BountyRecord, InferenceClient } from "../types.js";
import { buildQuestionBountySolverPrompt } from "./skills/question-solver.js";
import { buildTaskBountySolverPrompt } from "./skills/task-solver.js";

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/$/, "");
}

export async function fetchRemoteBounties(baseUrl: string): Promise<BountyRecord[]> {
  const response = await fetch(`${normalizeBaseUrl(baseUrl)}/bounties`, {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`failed to fetch bounties: ${response.status}`);
  }
  const payload = (await response.json()) as { items?: BountyRecord[] };
  return payload.items ?? [];
}

export async function fetchRemoteBounty(baseUrl: string, bountyId: string): Promise<{
  bounty: BountyRecord;
  submissions?: unknown[];
  result?: unknown;
}> {
  const response = await fetch(`${normalizeBaseUrl(baseUrl)}/bounties/${bountyId}`, {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`failed to fetch bounty ${bountyId}: ${response.status}`);
  }
  return (await response.json()) as {
    bounty: BountyRecord;
    submissions?: unknown[];
    result?: unknown;
  };
}

export async function submitRemoteBountySubmission(params: {
  baseUrl: string;
  bountyId: string;
  solverAddress: Address;
  submissionText: string;
  solverAgentId?: string | null;
  proofUrl?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<unknown> {
  const response = await fetch(
    `${normalizeBaseUrl(params.baseUrl)}/bounties/${params.bountyId}/submit`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        solver_address: params.solverAddress,
        solver_agent_id: params.solverAgentId ?? null,
        submission_text: params.submissionText,
        proof_url: params.proofUrl ?? null,
        metadata: params.metadata ?? {},
      }),
    },
  );
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`failed to submit bounty answer: ${response.status} ${text}`);
  }
  return response.json();
}

export async function submitRemoteBountyAnswer(params: {
  baseUrl: string;
  bountyId: string;
  solverAddress: Address;
  answer: string;
  solverAgentId?: string | null;
  proofUrl?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<unknown> {
  return submitRemoteBountySubmission({
    ...params,
    submissionText: params.answer,
  });
}

export async function solveRemoteBounty(params: {
  baseUrl: string;
  bountyId: string;
  solverAddress: Address;
  solverAgentId?: string | null;
  inference: InferenceClient;
  skillInstructions?: string;
  proofUrl?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<{
  answer: string;
  submissionResult: unknown;
}> {
  const details = await fetchRemoteBounty(params.baseUrl, params.bountyId);
  const prompt =
    details.bounty.kind === "question"
      ? buildQuestionBountySolverPrompt({
          question: details.bounty.taskPrompt,
          skillInstructions: params.skillInstructions,
        })
      : buildTaskBountySolverPrompt({
          kind: details.bounty.kind,
          title: details.bounty.title,
          taskPrompt: details.bounty.taskPrompt,
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
      temperature: 0.2,
      maxTokens: 256,
    },
  );
  const answer = (response.message.content || "").trim();
  if (!answer) {
    throw new Error("solver model returned an empty answer");
  }
  const submissionResult = await submitRemoteBountySubmission({
    baseUrl: params.baseUrl,
    bountyId: params.bountyId,
    solverAddress: params.solverAddress,
    solverAgentId: params.solverAgentId,
    submissionText: answer,
    proofUrl: params.proofUrl,
    metadata: params.metadata,
  });
  return { answer, submissionResult };
}

export async function solveRemoteQuestionBounty(params: {
  baseUrl: string;
  bountyId: string;
  solverAddress: Address;
  solverAgentId?: string | null;
  inference: InferenceClient;
  skillInstructions?: string;
}): Promise<{
  answer: string;
  submissionResult: unknown;
}> {
  return solveRemoteBounty(params);
}
