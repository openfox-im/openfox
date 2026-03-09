import type { Address } from "tosdk";
import { discoverCapabilityProviders } from "../agent-discovery/client.js";
import type {
  BountyConfig,
  BountyRecord,
  InferenceClient,
  OpenFoxConfig,
  OpenFoxDatabase,
  OpenFoxIdentity,
} from "../types.js";
import type { BountyEngine } from "./engine.js";
import {
  fetchRemoteBounties,
  solveRemoteQuestionBounty,
} from "./client.js";
import {
  buildQuestionBountyDraftPrompt,
  parseQuestionBountyDraft,
} from "./skills/question-host.js";

export interface BountyAutomationHandle {
  tick(): Promise<void>;
  close(): Promise<void>;
}

function attemptedKey(bountyId: string): string {
  return `bounty:attempted:${bountyId}`;
}

function completionKey(bountyId: string): string {
  return `bounty:completion:${bountyId}`;
}

function isHostWorkPending(
  db: OpenFoxDatabase,
  hostAddress: Address,
): boolean {
  return db
    .listBounties()
    .some(
      (bounty) =>
        bounty.hostAddress === hostAddress &&
        (bounty.status === "open" || bounty.status === "under_review"),
    );
}

export async function ensureAutoQuestionBountyOpen(params: {
  identity: OpenFoxIdentity;
  db: OpenFoxDatabase;
  inference: InferenceClient;
  bountyConfig: BountyConfig;
  engine: BountyEngine;
}): Promise<BountyRecord | null> {
  if (!params.bountyConfig.enabled || params.bountyConfig.role !== "host") {
    return null;
  }
  if (
    !params.bountyConfig.autoOpenOnStartup &&
    !params.bountyConfig.autoOpenWhenIdle
  ) {
    return null;
  }
  if (isHostWorkPending(params.db, params.identity.address)) {
    return null;
  }

  const response = await params.inference.chat(
    [
      {
        role: "system",
        content: buildQuestionBountyDraftPrompt({
          openingPrompt: params.bountyConfig.openingPrompt,
          defaultSubmissionTtlSeconds:
            params.bountyConfig.defaultSubmissionTtlSeconds,
        }),
      },
    ],
    {
      temperature: 0.3,
      maxTokens: 512,
    },
  );
  const draft = parseQuestionBountyDraft(response.message.content || "");
  const ttlSeconds =
    draft.submissionTtlSeconds ??
    params.bountyConfig.defaultSubmissionTtlSeconds;
  return params.engine.openQuestionBounty({
    question: draft.question,
    referenceAnswer: draft.referenceAnswer,
    rewardWei: params.bountyConfig.rewardWei,
    submissionDeadline: new Date(Date.now() + ttlSeconds * 1000).toISOString(),
  });
}

async function listCandidateBounties(params: {
  identity: OpenFoxIdentity;
  config: OpenFoxConfig;
  db: OpenFoxDatabase;
}): Promise<Array<{ baseUrl: string; bounty: BountyRecord }>> {
  const seen = new Set<string>();
  const candidates: Array<{ baseUrl: string; bounty: BountyRecord }> = [];

  const pushCandidates = async (baseUrl: string) => {
    const remote = await fetchRemoteBounties(baseUrl);
    for (const bounty of remote) {
      if (bounty.status !== "open") continue;
      if (bounty.hostAddress === params.identity.address) continue;
      if (params.db.getKV(attemptedKey(bounty.bountyId))) continue;
      const uniqueKey = `${baseUrl}:${bounty.bountyId}`;
      if (seen.has(uniqueKey)) continue;
      seen.add(uniqueKey);
      candidates.push({ baseUrl, bounty });
    }
  };

  if (params.config.bounty?.remoteBaseUrl) {
    await pushCandidates(params.config.bounty.remoteBaseUrl);
  }

  if (params.config.agentDiscovery?.enabled) {
    const capability =
      params.config.bounty?.discoveryCapability || "bounty.submit";
    const providers = await discoverCapabilityProviders({
      config: params.config,
      capability,
      db: params.db,
      limit: 10,
    });
    for (const provider of providers) {
      if (provider.search.primaryIdentity === params.identity.address) continue;
      try {
        await pushCandidates(provider.endpoint.url);
      } catch {
        continue;
      }
    }
  }

  return candidates.sort((left, right) =>
    left.bounty.createdAt.localeCompare(right.bounty.createdAt),
  );
}

export async function runSolverBountyPass(params: {
  identity: OpenFoxIdentity;
  config: OpenFoxConfig;
  db: OpenFoxDatabase;
  inference: InferenceClient;
}): Promise<{ baseUrl: string; bountyId: string; answer: string } | null> {
  if (!params.config.bounty?.enabled || params.config.bounty.role !== "solver") {
    return null;
  }
  const candidates = await listCandidateBounties(params);
  if (!candidates.length) {
    return null;
  }

  const target = candidates[0]!;
  params.db.setKV(
    attemptedKey(target.bounty.bountyId),
    JSON.stringify({
      at: new Date().toISOString(),
      baseUrl: target.baseUrl,
      status: "attempting",
    }),
  );

  try {
    const solved = await solveRemoteQuestionBounty({
      baseUrl: target.baseUrl,
      bountyId: target.bounty.bountyId,
      solverAddress: params.identity.address,
      solverAgentId: params.config.agentId || params.identity.sandboxId || null,
      inference: params.inference,
    });
    params.db.setKV(
      completionKey(target.bounty.bountyId),
      JSON.stringify({
        at: new Date().toISOString(),
        baseUrl: target.baseUrl,
        answer: solved.answer,
      }),
    );
    params.db.setKV(
      attemptedKey(target.bounty.bountyId),
      JSON.stringify({
        at: new Date().toISOString(),
        baseUrl: target.baseUrl,
        status: "submitted",
      }),
    );
    return {
      baseUrl: target.baseUrl,
      bountyId: target.bounty.bountyId,
      answer: solved.answer,
    };
  } catch (error) {
    params.db.setKV(
      attemptedKey(target.bounty.bountyId),
      JSON.stringify({
        at: new Date().toISOString(),
        baseUrl: target.baseUrl,
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    throw error;
  }
}

export function startBountyAutomation(params: {
  identity: OpenFoxIdentity;
  config: OpenFoxConfig;
  db: OpenFoxDatabase;
  inference: InferenceClient;
  engine?: BountyEngine;
  onEvent?: (message: string) => void;
}): BountyAutomationHandle {
  let interval: NodeJS.Timeout | undefined;
  let closed = false;
  let running = false;

  const runTick = async () => {
    if (closed || running) return;
    running = true;
    try {
      const bountyConfig = params.config.bounty;
      if (!bountyConfig?.enabled) return;

      if (
        bountyConfig.role === "host" &&
        params.engine &&
        (bountyConfig.autoOpenOnStartup || bountyConfig.autoOpenWhenIdle)
      ) {
        const opened = await ensureAutoQuestionBountyOpen({
          identity: params.identity,
          db: params.db,
          inference: params.inference,
          bountyConfig,
          engine: params.engine,
        });
        if (opened) {
          params.onEvent?.(
            `Auto-opened bounty ${opened.bountyId}: ${opened.question}`,
          );
        }
      }

      if (
        bountyConfig.role === "solver" &&
        (bountyConfig.autoSolveOnStartup || bountyConfig.autoSolveEnabled)
      ) {
        const solved = await runSolverBountyPass({
          identity: params.identity,
          config: params.config,
          db: params.db,
          inference: params.inference,
        });
        if (solved) {
          params.onEvent?.(
            `Auto-solved bounty ${solved.bountyId} via ${solved.baseUrl}`,
          );
        }
      }
    } catch (error) {
      params.onEvent?.(
        `Bounty automation error: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      running = false;
    }
  };

  void runTick();

  if (
    params.config.bounty?.enabled &&
    ((params.config.bounty.role === "host" &&
      params.config.bounty.autoOpenWhenIdle) ||
      (params.config.bounty.role === "solver" &&
        params.config.bounty.autoSolveEnabled))
  ) {
    interval = setInterval(
      () => void runTick(),
      Math.max(5, params.config.bounty.pollIntervalSeconds) * 1000,
    );
  }

  return {
    tick: async () => {
      await runTick();
    },
    close: async () => {
      closed = true;
      if (interval) {
        clearInterval(interval);
      }
    },
  };
}
