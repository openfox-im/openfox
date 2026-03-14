/**
 * OpenFox Nested Channels & Subgroups
 *
 * Provides hierarchical channel trees within groups and parent/child
 * relationships between groups (subgroups).
 */

import { ulid } from "ulid";
import type { PrivateKeyAccount } from "tosdk";
import { createLogger } from "../observability/logger.js";
import type { OpenFoxDatabase } from "../types.js";
import {
  createGroup,
  getGroup,
  type GroupRecord,
  type GroupChannelRecord,
  type CreateGroupInput,
  type CreateGroupResult,
} from "./store.js";
import {
  getGovernancePolicy,
  type GovernancePolicyRecord,
  type GovernanceProposalType,
} from "./governance.js";

const logger = createLogger("group-hierarchy");

// ─── Types ──────────────────────────────────────────────────────

export interface ChannelTreeNode {
  channelId: string;
  name: string;
  description: string | null;
  parentChannelId: string | null;
  children: ChannelTreeNode[];
  depth: number;
}

export interface SubgroupRecord {
  parentGroupId: string;
  childGroupId: string;
  relationship: "child" | "affiliate";
  treasuryMode: "shared" | "independent" | "sub_budget";
  subBudgetLine: string | null;
  policyMode: "inherit" | "override";
  createdAt: string;
}

// ─── Channel Tree ───────────────────────────────────────────────

function buildTree(
  channels: Array<{
    channelId: string;
    name: string;
    description: string | null;
    parentChannelId: string | null;
  }>,
): ChannelTreeNode[] {
  const map = new Map<string, ChannelTreeNode>();
  const roots: ChannelTreeNode[] = [];

  // First pass: create nodes
  for (const ch of channels) {
    map.set(ch.channelId, {
      channelId: ch.channelId,
      name: ch.name,
      description: ch.description,
      parentChannelId: ch.parentChannelId,
      children: [],
      depth: 0,
    });
  }

  // Second pass: link parents
  map.forEach((node) => {
    if (node.parentChannelId && map.has(node.parentChannelId)) {
      const parent = map.get(node.parentChannelId)!;
      parent.children.push(node);
      node.depth = parent.depth + 1;
    } else {
      roots.push(node);
    }
  });

  // Third pass: fix depths for deeper nesting
  function fixDepths(node: ChannelTreeNode, depth: number): void {
    node.depth = depth;
    for (const child of node.children) {
      fixDepths(child, depth + 1);
    }
  }
  for (const root of roots) {
    fixDepths(root, 0);
  }

  return roots;
}

export function listChannelTree(
  db: OpenFoxDatabase,
  groupId: string,
): ChannelTreeNode[] {
  const rows = db.raw
    .prepare(
      `SELECT channel_id, name, description, parent_channel_id
       FROM group_channels
       WHERE group_id = ? AND status = 'active'
       ORDER BY created_at ASC`,
    )
    .all(groupId) as Array<{
    channel_id: string;
    name: string;
    description: string;
    parent_channel_id: string | null;
  }>;

  const channels = rows.map((r) => ({
    channelId: r.channel_id,
    name: r.name,
    description: r.description || null,
    parentChannelId: r.parent_channel_id ?? null,
  }));

  return buildTree(channels);
}

export function createNestedChannel(
  db: OpenFoxDatabase,
  groupId: string,
  name: string,
  description: string | null,
  parentChannelId: string,
  createdByAddress: string,
): GroupChannelRecord & { parentChannelId: string } {
  // Validate parent exists and belongs to the same group
  const parent = db.raw
    .prepare(
      `SELECT channel_id, group_id FROM group_channels
       WHERE channel_id = ? AND status = 'active'`,
    )
    .get(parentChannelId) as
    | { channel_id: string; group_id: string }
    | undefined;

  if (!parent) {
    throw new Error(`Parent channel not found: ${parentChannelId}`);
  }
  if (parent.group_id !== groupId) {
    throw new Error(
      `Parent channel ${parentChannelId} does not belong to group ${groupId}`,
    );
  }

  // Check name uniqueness within group
  const existing = db.raw
    .prepare(
      `SELECT 1 FROM group_channels
       WHERE group_id = ? AND name = ? AND status = 'active'`,
    )
    .get(groupId, name.trim().toLowerCase().replace(/\s+/g, "-"));
  if (existing) {
    throw new Error(`Channel name already exists in group ${groupId}: ${name}`);
  }

  const channelId = `chn_${ulid()}`;
  const normalizedName = name.trim().toLowerCase().replace(/\s+/g, "-");
  const createdAt = new Date().toISOString();

  db.raw
    .prepare(
      `INSERT INTO group_channels (
        channel_id,
        group_id,
        name,
        description,
        parent_channel_id,
        visibility,
        status,
        created_by_address,
        created_at,
        archived_at
      ) VALUES (?, ?, ?, ?, ?, 'group', 'active', ?, ?, NULL)`,
    )
    .run(
      channelId,
      groupId,
      normalizedName,
      description?.trim() || "",
      parentChannelId,
      createdByAddress,
      createdAt,
    );

  db.raw
    .prepare("UPDATE groups SET updated_at = ? WHERE group_id = ?")
    .run(createdAt, groupId);

  logger.info(
    `created nested channel ${channelId} under parent ${parentChannelId} in group ${groupId}`,
  );

  return {
    channelId,
    groupId,
    name: normalizedName,
    description: description?.trim() || "",
    visibility: "group",
    status: "active",
    createdByAddress,
    createdAt,
    archivedAt: null,
    parentChannelId,
  };
}

export function getChannelPath(db: OpenFoxDatabase, channelId: string): string {
  const visited = new Set<string>();
  const parts: string[] = [];
  let currentId: string | null = channelId;

  while (currentId) {
    if (visited.has(currentId)) {
      break; // prevent infinite loop on circular references
    }
    visited.add(currentId);

    const row = db.raw
      .prepare(
        `SELECT name, parent_channel_id FROM group_channels WHERE channel_id = ?`,
      )
      .get(currentId) as
      | { name: string; parent_channel_id: string | null }
      | undefined;

    if (!row) {
      break;
    }

    parts.unshift(row.name);
    currentId = row.parent_channel_id ?? null;
  }

  return `#${parts.join("/")}`;
}

// ─── Subgroups ──────────────────────────────────────────────────

function mapSubgroupRow(row: any): SubgroupRecord {
  return {
    parentGroupId: row.parent_group_id,
    childGroupId: row.child_group_id,
    relationship: row.relationship,
    treasuryMode: row.treasury_mode,
    subBudgetLine: row.sub_budget_line ?? null,
    policyMode: row.policy_mode,
    createdAt: row.created_at,
  };
}

function ensureGroupHasRole(
  db: OpenFoxDatabase,
  groupId: string,
  actorAddress: string,
  allowedRoles: string[],
): void {
  const normalized = actorAddress.trim().toLowerCase();
  const row = db.raw
    .prepare(
      `SELECT 1
       FROM group_member_roles
       WHERE group_id = ? AND member_address = ? AND active = 1 AND role IN (${allowedRoles
         .map(() => "?")
         .join(",")})
       LIMIT 1`,
    )
    .get(groupId, normalized, ...allowedRoles) as { 1: number } | undefined;
  if (!row) {
    throw new Error(
      `actor ${normalized} is missing a required role in ${groupId}: ${allowedRoles.join(", ")}`,
    );
  }
}

export async function createSubgroup(
  db: OpenFoxDatabase,
  params: {
    account: PrivateKeyAccount;
    parentGroupId: string;
    childName: string;
    relationship: "child" | "affiliate";
    treasuryMode: "shared" | "independent" | "sub_budget";
    subBudgetLine?: string;
    policyMode: "inherit" | "override";
    creatorAddress: string;
    creatorAgentId?: string;
    description?: string;
  },
): Promise<{ childGroup: CreateGroupResult; subgroupRecord: SubgroupRecord }> {
  const parentGroup = getGroup(db, params.parentGroupId);
  if (!parentGroup) {
    throw new Error(`Parent group not found: ${params.parentGroupId}`);
  }

  ensureGroupHasRole(db, params.parentGroupId, params.creatorAddress, [
    "owner",
  ]);

  const childInput: CreateGroupInput = {
    name: params.childName,
    description: params.description || "",
    visibility: parentGroup.visibility,
    joinMode: parentGroup.joinMode,
    actorAddress: params.creatorAddress,
    actorAgentId: params.creatorAgentId,
  };

  const childResult = await createGroup({
    db,
    account: params.account,
    input: childInput,
  });

  const createdAt = new Date().toISOString();

  db.raw
    .prepare(
      `INSERT INTO group_subgroups (
        parent_group_id,
        child_group_id,
        relationship,
        treasury_mode,
        sub_budget_line,
        policy_mode,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      params.parentGroupId,
      childResult.group.groupId,
      params.relationship,
      params.treasuryMode,
      params.subBudgetLine ?? null,
      params.policyMode,
      createdAt,
    );

  const subgroupRecord: SubgroupRecord = {
    parentGroupId: params.parentGroupId,
    childGroupId: childResult.group.groupId,
    relationship: params.relationship,
    treasuryMode: params.treasuryMode,
    subBudgetLine: params.subBudgetLine ?? null,
    policyMode: params.policyMode,
    createdAt,
  };

  // Emit subgroup.created event via group_events
  const createdEventId = `gev_${ulid()}`;
  const createdEventHash = `0x${ulid()}`;
  db.raw
    .prepare(
      `INSERT INTO group_events (
        event_id, group_id, kind, epoch, channel_id,
        actor_address, actor_agent_id, parent_event_ids_json,
        payload_json, signature, event_hash,
        created_at, expires_at, received_at, source_kind,
        reducer_status, rejection_reason
      ) VALUES (?, ?, 'subgroup.created', 1, NULL,
        ?, ?, '[]',
        ?, '', ?,
        ?, NULL, ?, 'local',
        'accepted', NULL)`,
    )
    .run(
      createdEventId,
      params.parentGroupId,
      params.creatorAddress.trim().toLowerCase(),
      params.creatorAgentId ?? null,
      JSON.stringify({
        parent_group_id: params.parentGroupId,
        child_group_id: childResult.group.groupId,
        relationship: params.relationship,
        treasury_mode: params.treasuryMode,
        policy_mode: params.policyMode,
      }),
      createdEventHash,
      createdAt,
      createdAt,
    );

  logger.info(
    `created subgroup ${childResult.group.groupId} under parent ${params.parentGroupId}`,
  );

  return { childGroup: childResult, subgroupRecord };
}

export function listSubgroups(
  db: OpenFoxDatabase,
  parentGroupId: string,
): SubgroupRecord[] {
  const rows = db.raw
    .prepare(
      `SELECT * FROM group_subgroups
       WHERE parent_group_id = ?
       ORDER BY created_at ASC`,
    )
    .all(parentGroupId) as any[];
  return rows.map(mapSubgroupRow);
}

export function getParentGroup(
  db: OpenFoxDatabase,
  childGroupId: string,
): SubgroupRecord | null {
  const row = db.raw
    .prepare(
      `SELECT * FROM group_subgroups
       WHERE child_group_id = ?`,
    )
    .get(childGroupId) as any | undefined;
  return row ? mapSubgroupRow(row) : null;
}

export function removeSubgroup(
  db: OpenFoxDatabase,
  parentGroupId: string,
  childGroupId: string,
  actorAddress: string,
): void {
  ensureGroupHasRole(db, parentGroupId, actorAddress, ["owner"]);

  const existing = db.raw
    .prepare(
      `SELECT 1 FROM group_subgroups
       WHERE parent_group_id = ? AND child_group_id = ?`,
    )
    .get(parentGroupId, childGroupId);
  if (!existing) {
    throw new Error(
      `Subgroup relationship not found: ${parentGroupId} -> ${childGroupId}`,
    );
  }

  const now = new Date().toISOString();

  db.raw
    .prepare(
      `DELETE FROM group_subgroups
       WHERE parent_group_id = ? AND child_group_id = ?`,
    )
    .run(parentGroupId, childGroupId);

  // Emit subgroup.removed event
  const removedEventId = `gev_${ulid()}`;
  const removedEventHash = `0x${ulid()}`;
  db.raw
    .prepare(
      `INSERT INTO group_events (
        event_id, group_id, kind, epoch, channel_id,
        actor_address, actor_agent_id, parent_event_ids_json,
        payload_json, signature, event_hash,
        created_at, expires_at, received_at, source_kind,
        reducer_status, rejection_reason
      ) VALUES (?, ?, 'subgroup.removed', 1, NULL,
        ?, NULL, '[]',
        ?, '', ?,
        ?, NULL, ?, 'local',
        'accepted', NULL)`,
    )
    .run(
      removedEventId,
      parentGroupId,
      actorAddress.trim().toLowerCase(),
      JSON.stringify({
        parent_group_id: parentGroupId,
        child_group_id: childGroupId,
      }),
      removedEventHash,
      now,
      now,
    );

  logger.info(
    `removed subgroup relationship ${parentGroupId} -> ${childGroupId}`,
  );
}

export function getEffectiveGovernancePolicy(
  db: OpenFoxDatabase,
  groupId: string,
  proposalType: GovernanceProposalType,
): GovernancePolicyRecord {
  // Check if this group has a parent with policy_mode='inherit'
  const parentRel = getParentGroup(db, groupId);
  if (parentRel && parentRel.policyMode === "inherit") {
    // Read policy from parent group
    return getGovernancePolicy(db, parentRel.parentGroupId, proposalType);
  }
  // Otherwise read from own group
  return getGovernancePolicy(db, groupId, proposalType);
}
