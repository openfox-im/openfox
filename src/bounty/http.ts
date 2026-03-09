import http, { type IncomingMessage, type ServerResponse } from "http";
import { URL } from "url";
import type { BountyEngine } from "./engine.js";
import type { Address } from "tosdk";
import type { BountyConfig } from "../types.js";

const BODY_LIMIT_BYTES = 128 * 1024;

function json(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Content-Length", Buffer.byteLength(payload));
  res.end(payload);
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > BODY_LIMIT_BYTES) {
      throw new Error("request body too large");
    }
    chunks.push(buffer);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

function parsePath(pathPrefix: string, pathname: string): string[] {
  const normalizedPrefix = pathPrefix.startsWith("/") ? pathPrefix : `/${pathPrefix}`;
  if (!pathname.startsWith(normalizedPrefix)) return [];
  const remainder = pathname.slice(normalizedPrefix.length).replace(/^\/+/, "");
  return remainder ? remainder.split("/") : [];
}

export interface BountyHttpServer {
  url: string;
  close(): Promise<void>;
}

export async function startBountyHttpServer(params: {
  bountyConfig: BountyConfig;
  engine: BountyEngine;
}): Promise<BountyHttpServer> {
  const pathPrefix = params.bountyConfig.pathPrefix.startsWith("/")
    ? params.bountyConfig.pathPrefix
    : `/${params.bountyConfig.pathPrefix}`;
  const healthzPath = `${pathPrefix}/healthz`;

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
      if (req.method === "GET" && url.pathname === healthzPath) {
        json(res, 200, { ok: true, role: params.bountyConfig.role, pathPrefix });
        return;
      }

      const parts = parsePath(pathPrefix, url.pathname);
      if (parts.length === 1 && parts[0] === "bounties" && req.method === "GET") {
        json(res, 200, { items: params.engine.listBounties() });
        return;
      }

      if (parts.length === 1 && parts[0] === "bounties" && req.method === "POST") {
        const body = (await readJsonBody(req)) as Record<string, unknown>;
        const ttlSeconds =
          typeof body.submission_ttl_seconds === "number" &&
          Number.isFinite(body.submission_ttl_seconds)
            ? body.submission_ttl_seconds
            : params.bountyConfig.defaultSubmissionTtlSeconds;
        const deadline = new Date(Date.now() + ttlSeconds * 1000).toISOString();
        const kind =
          typeof body.kind === "string" && body.kind.trim()
            ? body.kind.trim()
            : params.bountyConfig.defaultKind;
        const taskPrompt =
          typeof body.task_prompt === "string" && body.task_prompt.trim()
            ? body.task_prompt.trim()
            : String(body.question || "").trim();
        const referenceOutput =
          typeof body.reference_output === "string" && body.reference_output.trim()
            ? body.reference_output.trim()
            : String(body.reference_answer || "").trim();
        const bounty = params.engine.openBounty({
          kind: kind as any,
          title:
            typeof body.title === "string" && body.title.trim()
              ? body.title.trim()
              : taskPrompt.slice(0, 160),
          taskPrompt,
          referenceOutput,
          rewardWei:
            typeof body.reward_wei === "string" && body.reward_wei.trim()
              ? body.reward_wei.trim()
              : params.bountyConfig.rewardWei,
          submissionDeadline: deadline,
          skillName:
            typeof body.skill_name === "string" && body.skill_name.trim()
              ? body.skill_name.trim()
              : null,
          metadata:
            typeof body.metadata === "object" && body.metadata !== null
              ? (body.metadata as Record<string, unknown>)
              : {},
        });
        json(res, 201, bounty);
        return;
      }

      if (parts.length === 2 && parts[0] === "bounties" && req.method === "GET") {
        const details = params.engine.getBountyDetails(parts[1]!);
        if (!details) {
          json(res, 404, { error: "bounty not found" });
          return;
        }
        json(res, 200, details);
        return;
      }

      if (
        parts.length === 3 &&
        parts[0] === "bounties" &&
        parts[2] === "submit" &&
        req.method === "POST"
      ) {
        const body = (await readJsonBody(req)) as Record<string, unknown>;
        const result = await params.engine.submitAnswer({
          bountyId: parts[1]!,
          solverAgentId:
            typeof body.solver_agent_id === "string"
              ? body.solver_agent_id
              : null,
          solverAddress: String(body.solver_address || "") as Address,
          answer:
            typeof body.submission_text === "string"
              ? body.submission_text
              : String(body.answer || ""),
          proofUrl:
            typeof body.proof_url === "string" && body.proof_url.trim()
              ? body.proof_url.trim()
              : null,
          metadata:
            typeof body.metadata === "object" && body.metadata !== null
              ? (body.metadata as Record<string, unknown>)
              : {},
        });
        json(res, 200, result);
        return;
      }

      if (
        parts.length === 3 &&
        parts[0] === "bounties" &&
        parts[2] === "result" &&
        req.method === "GET"
      ) {
        const details = params.engine.getBountyDetails(parts[1]!);
        if (!details) {
          json(res, 404, { error: "bounty not found" });
          return;
        }
        json(res, 200, {
          bounty: details.bounty,
          result: details.result ?? null,
        });
        return;
      }

      json(res, 404, { error: "not found" });
    } catch (error) {
      json(res, 400, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  await new Promise<void>((resolve) =>
    server.listen(params.bountyConfig.port, params.bountyConfig.bindHost, resolve),
  );

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("failed to resolve bounty server address");
  }
  const url = `http://${params.bountyConfig.bindHost}:${address.port}${pathPrefix}`;
  return {
    url,
    close: async () =>
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}
