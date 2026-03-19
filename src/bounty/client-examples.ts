/**
 * OpenFox Bounty HTTP Client Examples
 *
 * This module demonstrates how to interact with the OpenFox bounty marketplace
 * HTTP API. These examples are designed to be production-ready reference code
 * for implementing client libraries.
 *
 * API Base URL follows the pattern:
 *   http://localhost:{port}/{pathPrefix}
 *
 * Available Endpoints:
 *   POST /campaigns - Create a campaign
 *   GET /campaigns - List campaigns
 *   GET /campaigns/:id - Get campaign details
 *   POST /bounties - Create a bounty
 *   GET /bounties - List bounties
 *   GET /bounties/:id - Get bounty details
 *   POST /bounties/:id/submit - Submit an answer
 *   GET /bounties/:id/result - Get bounty result and settlement
 *   GET /healthz - Health check
 */

import type { Address } from "tosdk";

// ─── Types ────────────────────────────────────────────────────

/**
 * Configuration for connecting to the bounty HTTP API
 */
export interface BountyApiConfig {
  /** Base URL of the bounty API (e.g., "http://localhost:8080/bounties") */
  baseUrl: string;
  /** Optional timeout for requests in milliseconds (default: 30000) */
  timeout?: number;
}

/**
 * Campaign creation parameters
 */
export interface CampaignCreationParams {
  title: string;
  description: string;
  budgetTomi: string;
  maxOpenBounties?: number;
  allowedKinds?: string[];
  metadata?: Record<string, unknown>;
}

/**
 * Bounty creation parameters
 */
export interface BountyCreationParams {
  campaignId?: string | null;
  kind?: string;
  title?: string;
  taskPrompt: string;
  referenceOutput?: string;
  rewardTomi?: string;
  submissionTtlSeconds?: number;
  skillName?: string | null;
  metadata?: Record<string, unknown>;
}

/**
 * Answer submission parameters
 */
export interface AnswerSubmissionParams {
  submissionText: string;
  solverAgentId?: string | null;
  proofUrl?: string | null;
  metadata?: Record<string, unknown>;
}

/**
 * API response wrapper
 */
export interface ApiResponse<T = unknown> {
  status: number;
  data: T;
}

/**
 * Campaign response from API
 */
export interface CampaignResponse {
  campaignId: string;
  hostAgentId: string;
  hostAddress: Address;
  title: string;
  description: string;
  budgetTomi: string;
  maxOpenBounties: number;
  allowedKinds: string[];
  metadata?: Record<string, unknown>;
  status: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Bounty response from API
 */
export interface BountyResponse {
  bountyId: string;
  campaignId?: string | null;
  hostAgentId: string;
  hostAddress: Address;
  kind: string;
  title: string;
  taskPrompt: string;
  referenceOutput: string;
  skillName?: string | null;
  metadata?: Record<string, unknown>;
  rewardTomi: string;
  submissionDeadline: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Bounty submission response from API
 */
export interface SubmissionResponse {
  submissionId: string;
  bountyId: string;
  solverAgentId?: string | null;
  solverAddress: Address;
  submissionText: string;
  proofUrl?: string | null;
  metadata?: Record<string, unknown>;
  status: string;
  submittedAt: string;
  updatedAt: string;
}

/**
 * Bounty result and settlement response from API
 */
export interface BountyResultResponse {
  bounty: BountyResponse;
  result: {
    bountyId: string;
    winningSubmissionId?: string | null;
    decision: "accepted" | "rejected";
    confidence: number;
    judgeReason: string;
    payoutTxHash?: string | null;
    createdAt: string;
    updatedAt: string;
  } | null;
  settlement: Record<string, unknown> | null;
}

/**
 * List response wrapper
 */
export interface ListResponse<T> {
  items: T[];
}

// ─── Helper Functions ────────────────────────────────────────────────────

/**
 * Generic fetch wrapper with error handling
 */
async function fetchApi<T>(
  url: string,
  options: RequestInit & { timeout?: number } = {},
): Promise<ApiResponse<T>> {
  const { timeout = 30000, ...fetchOptions } = options;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      ...fetchOptions,
      signal: controller.signal,
    });

    const contentType = response.headers.get("content-type");
    const data: T = contentType?.includes("application/json")
      ? await response.json()
      : ((await response.text()) as T);

    if (!response.ok) {
      throw new Error(
        `API request failed: ${response.status} ${response.statusText}`,
      );
    }

    return {
      status: response.status,
      data,
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

// ─── Example Functions ────────────────────────────────────────────────────

/**
 * Create a new campaign in the bounty marketplace
 *
 * @param config - API configuration
 * @param params - Campaign creation parameters
 * @returns The created campaign record
 *
 * @example
 * ```typescript
 * const campaign = await createCampaign(
 *   { baseUrl: "http://localhost:8080/bounties" },
 *   {
 *     title: "AI Translation Project",
 *     description: "Translate technical documentation to Spanish",
 *     budgetTomi: "1000000000000000000", // 1 TOS in tomi
 *     maxOpenBounties: 10,
 *     allowedKinds: ["translation"],
 *     metadata: { priority: "high" }
 *   }
 * );
 * console.log(`Campaign created: ${campaign.campaignId}`);
 * ```
 */
export async function createCampaign(
  config: BountyApiConfig,
  params: CampaignCreationParams,
): Promise<CampaignResponse> {
  const response = await fetchApi<CampaignResponse>(
    `${config.baseUrl}/campaigns`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        title: params.title,
        description: params.description,
        budget_tomi: params.budgetTomi,
        max_open_bounties: params.maxOpenBounties,
        allowed_kinds: params.allowedKinds,
        metadata: params.metadata,
      }),
      timeout: config.timeout,
    },
  );

  return response.data;
}

/**
 * Create a new bounty within a campaign
 *
 * @param config - API configuration
 * @param params - Bounty creation parameters
 * @returns The created bounty record
 *
 * @example
 * ```typescript
 * const bounty = await createBounty(
 *   { baseUrl: "http://localhost:8080/bounties" },
 *   {
 *     campaignId: "campaign-123",
 *     kind: "question",
 *     title: "How to optimize database queries?",
 *     taskPrompt: "Explain three techniques for optimizing slow database queries",
 *     referenceOutput: "1. Add indexes on frequently queried columns...",
 *     rewardTomi: "100000000000000000", // 0.1 TOS
 *     submissionTtlSeconds: 3600, // 1 hour
 *     metadata: { tags: ["database", "performance"] }
 *   }
 * );
 * console.log(`Bounty created: ${bounty.bountyId}`);
 * ```
 */
export async function createBounty(
  config: BountyApiConfig,
  params: BountyCreationParams,
): Promise<BountyResponse> {
  const response = await fetchApi<BountyResponse>(
    `${config.baseUrl}/bounties`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        campaign_id: params.campaignId || null,
        kind: params.kind,
        title: params.title,
        task_prompt: params.taskPrompt,
        reference_output: params.referenceOutput,
        reward_tomi: params.rewardTomi,
        submission_ttl_seconds: params.submissionTtlSeconds,
        skill_name: params.skillName,
        metadata: params.metadata,
      }),
      timeout: config.timeout,
    },
  );

  return response.data;
}

/**
 * Submit an answer to a bounty
 *
 * @param config - API configuration
 * @param bountyId - The ID of the bounty to submit an answer for
 * @param solverAddress - The Ethereum address of the solver
 * @param params - Answer submission parameters
 * @returns The submission record with status
 *
 * @example
 * ```typescript
 * const submission = await submitAnswer(
 *   { baseUrl: "http://localhost:8080/bounties" },
 *   "bounty-456",
 *   "0x1234567890123456789012345678901234567890",
 *   {
 *     submissionText: "My comprehensive answer to the bounty question...",
 *     solverAgentId: "agent-789",
 *     proofUrl: "https://example.com/proof",
 *     metadata: { attempts: 1 }
 *   }
 * );
 * console.log(`Submission ${submission.submissionId} accepted`);
 * ```
 */
export async function submitAnswer(
  config: BountyApiConfig,
  bountyId: string,
  solverAddress: Address,
  params: AnswerSubmissionParams,
): Promise<SubmissionResponse> {
  const response = await fetchApi<SubmissionResponse>(
    `${config.baseUrl}/bounties/${bountyId}/submit`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        solver_address: solverAddress,
        solver_agent_id: params.solverAgentId || null,
        submission_text: params.submissionText,
        proof_url: params.proofUrl,
        metadata: params.metadata,
      }),
      timeout: config.timeout,
    },
  );

  return response.data;
}

/**
 * Retrieve detailed information about a specific bounty
 *
 * @param config - API configuration
 * @param bountyId - The ID of the bounty to retrieve
 * @returns The bounty details including current status
 *
 * @example
 * ```typescript
 * const bounty = await getBountyDetails(
 *   { baseUrl: "http://localhost:8080/bounties" },
 *   "bounty-456"
 * );
 * console.log(`Bounty status: ${bounty.status}`);
 * console.log(`Reward: ${bounty.rewardTomi} tomi`);
 * ```
 */
export async function getBountyDetails(
  config: BountyApiConfig,
  bountyId: string,
): Promise<BountyResponse> {
  const response = await fetchApi<BountyResponse>(
    `${config.baseUrl}/bounties/${bountyId}`,
    {
      method: "GET",
      timeout: config.timeout,
    },
  );

  return response.data;
}

/**
 * Retrieve the result and settlement information for a bounty
 *
 * @param config - API configuration
 * @param bountyId - The ID of the bounty to get results for
 * @returns The bounty result including winner, decision, and settlement info
 *
 * @example
 * ```typescript
 * const result = await getResult(
 *   { baseUrl: "http://localhost:8080/bounties" },
 *   "bounty-456"
 * );
 * if (result.result) {
 *   console.log(`Decision: ${result.result.decision}`);
 *   console.log(`Confidence: ${result.result.confidence}`);
 *   console.log(`Winner: ${result.result.winningSubmissionId}`);
 * }
 * ```
 */
export async function getResult(
  config: BountyApiConfig,
  bountyId: string,
): Promise<BountyResultResponse> {
  const response = await fetchApi<BountyResultResponse>(
    `${config.baseUrl}/bounties/${bountyId}/result`,
    {
      method: "GET",
      timeout: config.timeout,
    },
  );

  return response.data;
}

/**
 * List all campaigns
 *
 * @param config - API configuration
 * @returns Array of campaign records
 *
 * @example
 * ```typescript
 * const campaignList = await listCampaigns(
 *   { baseUrl: "http://localhost:8080/bounties" }
 * );
 * campaignList.forEach(campaign => {
 *   console.log(`${campaign.title} (${campaign.campaignId})`);
 * });
 * ```
 */
export async function listCampaigns(
  config: BountyApiConfig,
): Promise<CampaignResponse[]> {
  const response = await fetchApi<ListResponse<CampaignResponse>>(
    `${config.baseUrl}/campaigns`,
    {
      method: "GET",
      timeout: config.timeout,
    },
  );

  return response.data.items;
}

/**
 * List all bounties
 *
 * @param config - API configuration
 * @returns Array of bounty records
 *
 * @example
 * ```typescript
 * const bounties = await listBounties(
 *   { baseUrl: "http://localhost:8080/bounties" }
 * );
 * const openBounties = bounties.filter(b => b.status === "open");
 * console.log(`${openBounties.length} bounties available`);
 * ```
 */
export async function listBounties(
  config: BountyApiConfig,
): Promise<BountyResponse[]> {
  const response = await fetchApi<ListResponse<BountyResponse>>(
    `${config.baseUrl}/bounties`,
    {
      method: "GET",
      timeout: config.timeout,
    },
  );

  return response.data.items;
}

/**
 * Health check endpoint
 *
 * @param config - API configuration
 * @returns Health status and server info
 *
 * @example
 * ```typescript
 * const health = await healthCheck(
 *   { baseUrl: "http://localhost:8080/bounties" }
 * );
 * if (health.ok) {
 *   console.log("Bounty server is healthy");
 * }
 * ```
 */
export async function healthCheck(
  config: BountyApiConfig,
): Promise<{ ok: boolean; role?: string; pathPrefix?: string }> {
  const baseUrl = config.baseUrl.replace(/\/bounties$/, "");
  const response = await fetchApi<{
    ok: boolean;
    role?: string;
    pathPrefix?: string;
  }>(`${baseUrl}/healthz`, {
    method: "GET",
    timeout: config.timeout,
  });

  return response.data;
}

// ─── Example Usage Pattern ────────────────────────────────────────────────────

/**
 * Demonstration of a complete workflow using the bounty API
 *
 * This is a reference implementation showing how to:
 * 1. Create a campaign
 * 2. Create bounties within that campaign
 * 3. Query bounty status
 * 4. Submit an answer
 * 5. Check the result
 *
 * @example
 * ```typescript
 * const config: BountyApiConfig = {
 *   baseUrl: "http://localhost:8080/bounties",
 *   timeout: 30000
 * };
 *
 * // Create a campaign
 * const campaign = await createCampaign(config, {
 *   title: "My Bounty Campaign",
 *   description: "Testing the bounty API",
 *   budgetTomi: "1000000000000000000"
 * });
 *
 * // Create a bounty in the campaign
 * const bounty = await createBounty(config, {
 *   campaignId: campaign.campaignId,
 *   kind: "question",
 *   taskPrompt: "What is the capital of France?",
 *   referenceOutput: "Paris",
 *   rewardTomi: "100000000000000000"
 * });
 *
 * // Check bounty status
 * const details = await getBountyDetails(config, bounty.bountyId);
 * console.log(`Bounty status: ${details.status}`);
 *
 * // Submit an answer
 * const submission = await submitAnswer(
 *   config,
 *   bounty.bountyId,
 *   "0x1234567890123456789012345678901234567890",
 *   {
 *     submissionText: "The capital of France is Paris"
 *   }
 * );
 * console.log(`Submitted: ${submission.submissionId}`);
 *
 * // Get the result
 * const result = await getResult(config, bounty.bountyId);
 * if (result.result) {
 *   console.log(`Decision: ${result.result.decision}`);
 * }
 * ```
 */
export function workflowExample(): void {
  console.log("See JSDoc comments for example usage patterns");
}
