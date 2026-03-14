/**
 * World Search — unified search across foxes, groups, and board items.
 *
 * Searches are performed against a denormalized search index
 * (`world_search_index`) and supplemented with live queries
 * against the directory tables. Results are ranked by relevance:
 * exact match > prefix match > contains.
 */

import type { OpenFoxConfig, OpenFoxDatabase } from "../types.js";

export type SearchResultKind = "fox" | "group" | "board_item";

export interface WorldSearchResult {
  resultId: string;
  kind: SearchResultKind;
  sourceId: string;
  title: string;
  summary: string;
  relevanceScore: number;
  matchedOn: string;
}

export interface WorldSearchResultSnapshot {
  generatedAt: string;
  query: string;
  results: WorldSearchResult[];
  summary: string;
}

function normalizeQuery(query: string): string {
  return query.trim().toLowerCase();
}

function scoreMatch(haystack: string, query: string): { score: number; matchedOn: string } | null {
  const h = haystack.toLowerCase();
  const q = query.toLowerCase();
  if (!h.includes(q)) return null;
  if (h === q) return { score: 100, matchedOn: haystack };
  if (h.startsWith(q)) return { score: 80, matchedOn: haystack };
  // word-boundary prefix: the query appears at the start of a word
  const wordBoundaryIdx = h.indexOf(` ${q}`);
  if (wordBoundaryIdx >= 0) return { score: 60, matchedOn: haystack };
  return { score: 40, matchedOn: haystack };
}

function bestScore(
  fields: Array<{ value: string | null | undefined; label: string }>,
  query: string,
): { score: number; matchedOn: string } | null {
  let best: { score: number; matchedOn: string } | null = null;
  for (const field of fields) {
    if (!field.value) continue;
    const result = scoreMatch(field.value, query);
    if (result && (!best || result.score > best.score)) {
      best = { score: result.score, matchedOn: field.label };
    }
  }
  return best;
}

function parseJsonSafe<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string" || value.trim().length === 0) {
    return fallback;
  }
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function searchFoxes(
  db: OpenFoxDatabase,
  _config: OpenFoxConfig,
  query: string,
  limit: number,
): WorldSearchResult[] {
  const normalized = normalizeQuery(query);
  if (!normalized) return [];

  // Gather all known fox addresses from multiple sources
  const addressRows = db.raw
    .prepare(
      `SELECT actor_address AS address FROM world_presence
       UNION
       SELECT member_address AS address FROM group_members`,
    )
    .all() as Array<{ address: string }>;

  // Also check fox_profiles if available
  let profileRows: Array<{ address: string; display_name: string | null; bio: string | null; tns_name: string | null; tags: string }> = [];
  try {
    profileRows = db.raw
      .prepare(`SELECT address, display_name, bio, tns_name, tags FROM fox_profiles`)
      .all() as typeof profileRows;
  } catch {
    // table may not exist in older schemas
  }

  const profileByAddress = new Map(profileRows.map((r) => [r.address.toLowerCase(), r]));

  const results: WorldSearchResult[] = [];
  const seen = new Set<string>();

  for (const row of addressRows) {
    const address = row.address.toLowerCase();
    if (seen.has(address)) continue;
    seen.add(address);

    // Resolve identity info from group_members or presence
    const memberRow = db.raw
      .prepare(
        `SELECT display_name, member_agent_id, member_tns_name
         FROM group_members
         WHERE member_address = ?
         ORDER BY joined_at DESC LIMIT 1`,
      )
      .get(address) as {
      display_name: string | null;
      member_agent_id: string | null;
      member_tns_name: string | null;
    } | undefined;

    const presenceRow = db.raw
      .prepare(
        `SELECT display_name, agent_id
         FROM world_presence
         WHERE actor_address = ?
         ORDER BY updated_at DESC LIMIT 1`,
      )
      .get(address) as {
      display_name: string | null;
      agent_id: string | null;
    } | undefined;

    const profile = profileByAddress.get(address);
    const displayName =
      profile?.display_name ||
      presenceRow?.display_name ||
      memberRow?.display_name ||
      address;
    const agentId = presenceRow?.agent_id || memberRow?.member_agent_id || null;
    const tnsName = profile?.tns_name || memberRow?.member_tns_name || null;
    const bio = profile?.bio || null;
    const tags = profile ? parseJsonSafe<string[]>(profile.tags, []).join(" ") : "";

    const match = bestScore(
      [
        { value: displayName, label: "display_name" },
        { value: tnsName, label: "tns_name" },
        { value: agentId, label: "agent_id" },
        { value: address, label: "address" },
        { value: bio, label: "bio" },
        { value: tags, label: "tags" },
      ],
      normalized,
    );

    if (match) {
      results.push({
        resultId: `search:fox:${address}`,
        kind: "fox",
        sourceId: address,
        title: displayName,
        summary: tnsName
          ? `${tnsName} (${address.slice(0, 10)}...)`
          : `${address.slice(0, 10)}...`,
        relevanceScore: match.score,
        matchedOn: match.matchedOn,
      });
    }
  }

  return results
    .sort((a, b) => b.relevanceScore - a.relevanceScore)
    .slice(0, limit);
}

function searchGroups(
  db: OpenFoxDatabase,
  query: string,
  limit: number,
): WorldSearchResult[] {
  const normalized = normalizeQuery(query);
  if (!normalized) return [];

  const groups = db.raw
    .prepare(
      `SELECT group_id, name, description, tags_json, tns_name
       FROM groups
       ORDER BY updated_at DESC`,
    )
    .all() as Array<{
    group_id: string;
    name: string;
    description: string;
    tags_json: string;
    tns_name: string | null;
  }>;

  const results: WorldSearchResult[] = [];
  for (const group of groups) {
    const tags = parseJsonSafe<string[]>(group.tags_json, []).join(" ");
    const match = bestScore(
      [
        { value: group.name, label: "name" },
        { value: group.description, label: "description" },
        { value: tags, label: "tags" },
        { value: group.tns_name, label: "tns_name" },
      ],
      normalized,
    );

    if (match) {
      results.push({
        resultId: `search:group:${group.group_id}`,
        kind: "group",
        sourceId: group.group_id,
        title: group.name,
        summary: group.description
          ? group.description.slice(0, 120)
          : `Group ${group.group_id.slice(0, 10)}...`,
        relevanceScore: match.score,
        matchedOn: match.matchedOn,
      });
    }
  }

  return results
    .sort((a, b) => b.relevanceScore - a.relevanceScore)
    .slice(0, limit);
}

function searchBoardItems(
  db: OpenFoxDatabase,
  query: string,
  limit: number,
): WorldSearchResult[] {
  const normalized = normalizeQuery(query);
  if (!normalized) return [];

  const results: WorldSearchResult[] = [];

  // Search bounties
  const bounties = db.raw
    .prepare(
      `SELECT bounty_id, title, task_prompt, kind, status
       FROM bounties
       ORDER BY created_at DESC
       LIMIT ?`,
    )
    .all(limit * 2) as Array<{
    bounty_id: string;
    title: string;
    task_prompt: string;
    kind: string;
    status: string;
  }>;

  for (const bounty of bounties) {
    const match = bestScore(
      [
        { value: bounty.title, label: "title" },
        { value: bounty.task_prompt, label: "summary" },
      ],
      normalized,
    );
    if (match) {
      results.push({
        resultId: `search:board_item:bounty:${bounty.bounty_id}`,
        kind: "board_item",
        sourceId: bounty.bounty_id,
        title: bounty.title,
        summary: `${bounty.kind} bounty (${bounty.status})`,
        relevanceScore: match.score,
        matchedOn: match.matchedOn,
      });
    }
  }

  // Search artifacts
  const artifacts = db.raw
    .prepare(
      `SELECT artifact_id, title, summary_text, kind, status
       FROM artifacts
       ORDER BY created_at DESC
       LIMIT ?`,
    )
    .all(limit * 2) as Array<{
    artifact_id: string;
    title: string;
    summary_text: string | null;
    kind: string;
    status: string;
  }>;

  for (const artifact of artifacts) {
    const match = bestScore(
      [
        { value: artifact.title, label: "title" },
        { value: artifact.summary_text, label: "summary" },
      ],
      normalized,
    );
    if (match) {
      results.push({
        resultId: `search:board_item:artifact:${artifact.artifact_id}`,
        kind: "board_item",
        sourceId: artifact.artifact_id,
        title: artifact.title,
        summary: `${artifact.kind} artifact (${artifact.status})`,
        relevanceScore: match.score,
        matchedOn: match.matchedOn,
      });
    }
  }

  return results
    .sort((a, b) => b.relevanceScore - a.relevanceScore)
    .slice(0, limit);
}

export function searchWorld(
  db: OpenFoxDatabase,
  config: OpenFoxConfig,
  query: string,
  options?: {
    kinds?: SearchResultKind[];
    limit?: number;
  },
): WorldSearchResult[] {
  const limit = Math.max(1, options?.limit ?? 20);
  const kinds = options?.kinds ?? ["fox", "group", "board_item"];
  const results: WorldSearchResult[] = [];

  if (kinds.includes("fox")) {
    results.push(...searchFoxes(db, config, query, limit));
  }
  if (kinds.includes("group")) {
    results.push(...searchGroups(db, query, limit));
  }
  if (kinds.includes("board_item")) {
    results.push(...searchBoardItems(db, query, limit));
  }

  return results
    .sort((a, b) => b.relevanceScore - a.relevanceScore)
    .slice(0, limit);
}

export function buildSearchResultSnapshot(
  db: OpenFoxDatabase,
  config: OpenFoxConfig,
  query: string,
  options?: {
    kinds?: SearchResultKind[];
    limit?: number;
  },
): WorldSearchResultSnapshot {
  const results = searchWorld(db, config, query, options);
  return {
    generatedAt: new Date().toISOString(),
    query,
    results,
    summary: results.length
      ? `Search for "${query}" returned ${results.length} result(s).`
      : `Search for "${query}" returned no results.`,
  };
}
