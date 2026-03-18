import { ulid } from "ulid";
import { keccak256, toHex, type Hex, type PrivateKeyAccount } from "tosdk";
import type { OpenFoxDatabase } from "../types.js";

export type GroupVisibility = "private" | "listed" | "public";
export type GroupJoinMode = "invite_only" | "request_approval";
export type GroupStatus = "active" | "archived";
export type GroupMembershipState = "active" | "left" | "removed" | "banned";
export type GroupEventSourceKind = "local" | "peer" | "gateway" | "relay" | "snapshot";
export type GroupReducerStatus = "accepted" | "pending" | "rejected";

export interface GroupRecord {
  groupId: string;
  name: string;
  description: string;
  visibility: GroupVisibility;
  joinMode: GroupJoinMode;
  status: GroupStatus;
  maxMembers: number;
  tnsName: string | null;
  tags: string[];
  avatarArtifactCid: string | null;
  rulesArtifactCid: string | null;
  creatorAddress: string;
  creatorAgentId: string | null;
  currentEpoch: number;
  currentPolicyHash: Hex;
  currentMembersRoot: Hex;
  pinnedAnnouncementId: string | null;
  latestSnapshotId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface GroupChannelRecord {
  channelId: string;
  groupId: string;
  name: string;
  description: string;
  visibility: string;
  status: GroupStatus;
  createdByAddress: string;
  createdAt: string;
  archivedAt: string | null;
}

export interface GroupAnnouncementRecord {
  announcementId: string;
  groupId: string;
  channelId: string | null;
  eventId: string;
  title: string;
  bodyText: string;
  pinned: boolean;
  postedByAddress: string;
  createdAt: string;
  redactedAt: string | null;
}

export interface GroupMemberRoleRecord {
  groupId: string;
  memberAddress: string;
  role: string;
  active: boolean;
  grantedByAddress: string;
  grantedAt: string;
  revokedAt: string | null;
  lastEventId: string;
}

export interface GroupProposalRecord {
  proposalId: string;
  groupId: string;
  proposalKind:
    | "invite"
    | "membership_remove"
    | "role_grant"
    | "role_revoke"
    | "policy_update";
  targetAddress: string | null;
  targetAgentId: string | null;
  targetTnsName: string | null;
  targetRoles: string[];
  openedByAddress: string;
  openedEventId: string;
  approvalCount: number;
  requiredApprovals: number;
  inviteAcceptedAt: string | null;
  status: "open" | "revoked" | "expired" | "committed" | "rejected";
  reason: string | null;
  expiresAt: string | null;
  committedEventId: string | null;
  updatedAt: string;
}

export interface GroupMemberRecord {
  groupId: string;
  memberAddress: string;
  memberAgentId: string | null;
  memberTnsName: string | null;
  displayName: string | null;
  membershipState: GroupMembershipState;
  joinedVia: "genesis" | "invite" | "join_request";
  joinedAt: string;
  leftAt: string | null;
  muteUntil: string | null;
  lastEventId: string;
  roles: string[];
}

export interface GroupEventRecord {
  eventId: string;
  groupId: string;
  kind: string;
  epoch: number;
  channelId: string | null;
  actorAddress: string;
  actorAgentId: string | null;
  parentEventIds: string[];
  payload: Record<string, unknown>;
  signature: Hex;
  eventHash: Hex;
  createdAt: string;
  expiresAt: string | null;
  receivedAt: string;
  sourceKind: GroupEventSourceKind;
  reducerStatus: GroupReducerStatus;
  rejectionReason: string | null;
}

export interface GroupDetail {
  group: GroupRecord;
  channels: GroupChannelRecord[];
  members: GroupMemberRecord[];
  announcements: GroupAnnouncementRecord[];
  recentEvents: GroupEventRecord[];
}

export interface CreateGroupInput {
  name: string;
  description?: string;
  visibility?: GroupVisibility;
  joinMode?: GroupJoinMode;
  maxMembers?: number;
  tnsName?: string;
  tags?: string[];
  actorAddress?: string;
  actorAgentId?: string;
  creatorDisplayName?: string;
  defaultChannels?: Array<{
    name: string;
    description?: string;
  }>;
}

export interface CreateGroupResult extends GroupDetail {
  createdEventId: string;
}

export interface CreateGroupChannelInput {
  groupId: string;
  name: string;
  description?: string;
  visibility?: string;
  actorAddress?: string;
  actorAgentId?: string;
}

export interface CreateGroupChannelResult {
  channel: GroupChannelRecord;
  event: GroupEventRecord;
}

export interface PostGroupAnnouncementInput {
  groupId: string;
  title: string;
  bodyText: string;
  channelName?: string;
  channelId?: string;
  pin?: boolean;
  actorAddress?: string;
  actorAgentId?: string;
}

export interface PostGroupAnnouncementResult {
  announcement: GroupAnnouncementRecord;
  events: GroupEventRecord[];
}

export interface SendGroupInviteInput {
  groupId: string;
  targetAddress: string;
  targetAgentId?: string;
  targetTnsName?: string;
  targetRoles?: string[];
  reason?: string;
  expiresAt?: string;
  actorAddress?: string;
  actorAgentId?: string;
}

export interface SendGroupInviteResult {
  proposal: GroupProposalRecord;
  events: GroupEventRecord[];
}

export interface AcceptGroupInviteInput {
  groupId: string;
  proposalId: string;
  actorAddress?: string;
  actorAgentId?: string;
  displayName?: string;
}

export interface AcceptGroupInviteResult {
  proposal: GroupProposalRecord;
  member: GroupMemberRecord;
  events: GroupEventRecord[];
}

export interface LeaveGroupInput {
  groupId: string;
  actorAddress?: string;
  actorAgentId?: string;
}

export interface LeaveGroupResult {
  member: GroupMemberRecord;
  events: GroupEventRecord[];
}

export interface RemoveGroupMemberInput {
  groupId: string;
  targetAddress: string;
  reason?: string;
  actorAddress?: string;
  actorAgentId?: string;
}

export interface RemoveGroupMemberResult {
  member: GroupMemberRecord;
  events: GroupEventRecord[];
}

export interface GroupMessageRecord {
  messageId: string;
  groupId: string;
  channelId: string;
  originalEventId: string;
  latestEventId: string;
  senderAddress: string;
  senderAgentId: string | null;
  replyToMessageId: string | null;
  ciphertext: string;
  previewText: string | null;
  mentions: string[];
  reactionSummary: Record<string, number>;
  redacted: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PostGroupMessageInput {
  groupId: string;
  text: string;
  channelName?: string;
  channelId?: string;
  replyToMessageId?: string;
  mentions?: string[];
  actorAddress?: string;
  actorAgentId?: string;
}

export interface PostGroupMessageResult {
  message: GroupMessageRecord;
  event: GroupEventRecord;
}

export interface EditGroupMessageInput {
  groupId: string;
  messageId: string;
  text: string;
  mentions?: string[];
  actorAddress?: string;
  actorAgentId?: string;
}

export interface EditGroupMessageResult {
  message: GroupMessageRecord;
  event: GroupEventRecord;
}

export interface ReactGroupMessageInput {
  groupId: string;
  messageId: string;
  reactionCode: string;
  actorAddress?: string;
  actorAgentId?: string;
}

export interface ReactGroupMessageResult {
  message: GroupMessageRecord;
  event: GroupEventRecord;
}

export interface RedactGroupMessageInput {
  groupId: string;
  messageId: string;
  actorAddress?: string;
  actorAgentId?: string;
}

export interface RedactGroupMessageResult {
  message: GroupMessageRecord;
  event: GroupEventRecord;
}

export interface MuteGroupMemberInput {
  groupId: string;
  targetAddress: string;
  until: string;
  reason?: string;
  actorAddress?: string;
  actorAgentId?: string;
}

export interface MuteGroupMemberResult {
  member: GroupMemberRecord;
  events: GroupEventRecord[];
}

export interface UnmuteGroupMemberInput {
  groupId: string;
  targetAddress: string;
  actorAddress?: string;
  actorAgentId?: string;
}

export interface UnmuteGroupMemberResult {
  member: GroupMemberRecord;
  events: GroupEventRecord[];
}

export interface GroupJoinRequestRecord {
  requestId: string;
  groupId: string;
  applicantAddress: string;
  applicantAgentId: string | null;
  applicantTnsName: string | null;
  requestedRoles: string[];
  requestMessage: string;
  openedEventId: string;
  approvalCount: number;
  requiredApprovals: number;
  status: "open" | "withdrawn" | "rejected" | "expired" | "committed";
  committedEventId: string | null;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RequestToJoinGroupInput {
  groupId: string;
  requestedRoles?: string[];
  message?: string;
  expiresAt?: string;
  actorAddress?: string;
  actorAgentId?: string;
  actorTnsName?: string;
}

export interface RequestToJoinGroupResult {
  request: GroupJoinRequestRecord;
  event: GroupEventRecord;
}

export interface ApproveGroupJoinRequestInput {
  groupId: string;
  requestId: string;
  actorAddress?: string;
  actorAgentId?: string;
  displayName?: string;
}

export interface ApproveGroupJoinRequestResult {
  request: GroupJoinRequestRecord;
  member: GroupMemberRecord;
  events: GroupEventRecord[];
}

export interface WithdrawGroupJoinRequestInput {
  groupId: string;
  requestId: string;
  actorAddress?: string;
  actorAgentId?: string;
}

export interface WithdrawGroupJoinRequestResult {
  request: GroupJoinRequestRecord;
  event: GroupEventRecord;
}

export interface BanGroupMemberInput {
  groupId: string;
  targetAddress: string;
  reason?: string;
  actorAddress?: string;
  actorAgentId?: string;
}

export interface BanGroupMemberResult {
  member: GroupMemberRecord;
  events: GroupEventRecord[];
}

export interface UnbanGroupMemberInput {
  groupId: string;
  targetAddress: string;
  actorAddress?: string;
  actorAgentId?: string;
}

export interface UnbanGroupMemberResult {
  member: GroupMemberRecord;
  events: GroupEventRecord[];
}

const textEncoder = new TextEncoder();
const DEFAULT_GROUP_MAX_MEMBERS = 256;
const DEFAULT_CHANNELS = [
  { name: "announcements", description: "Official community announcements" },
  { name: "general", description: "General Fox community discussion" },
] as const;

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([a], [b]) => a.localeCompare(b));
  return `{${entries
    .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
    .join(",")}}`;
}

function parseJsonSafe<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function nowIso(): string {
  return new Date().toISOString();
}

function normalizeAddressLike(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    throw new Error("address cannot be empty");
  }
  return normalized;
}

function normalizeOptionalText(value?: string | null): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function normalizeChannelName(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-");
  if (!normalized) {
    throw new Error("channel name cannot be empty");
  }
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(normalized)) {
    throw new Error(
      "channel name must match ^[a-z0-9][a-z0-9_-]{0,63}$ after normalization",
    );
  }
  return normalized;
}

function dedupeStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const normalized = value.trim();
    if (!normalized) continue;
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

function hashCanonical(value: unknown): Hex {
  return keccak256(toHex(textEncoder.encode(stableStringify(value)))) as Hex;
}

function buildDefaultPolicyHash(params: {
  visibility: GroupVisibility;
  joinMode: GroupJoinMode;
  maxMembers: number;
}): Hex {
  return hashCanonical({
    version: 1,
    visibility: params.visibility,
    join_mode: params.joinMode,
    max_members: params.maxMembers,
    thresholds: {
      invite: 1,
      metadata_update: 1,
      channel_create: 1,
      announcement_post: 1,
    },
    role_rules: {
      channel_create: ["owner", "admin", "moderator"],
      announcement_post: ["owner", "admin"],
    },
  });
}

function buildMembersRoot(
  members: Array<{ address: string; roles: string[] }>,
): Hex {
  return hashCanonical(
    members
      .map((member) => ({
        address: normalizeAddressLike(member.address),
        roles: [...new Set(member.roles.map((role) => role.trim()).filter(Boolean))].sort(),
      }))
      .sort((a, b) => a.address.localeCompare(b.address)),
  );
}

async function buildSignedGroupEvent(params: {
  account: PrivateKeyAccount;
  groupId: string;
  kind: string;
  epoch: number;
  actorAddress: string;
  actorAgentId?: string | null;
  channelId?: string | null;
  parentEventIds?: string[];
  payload: Record<string, unknown>;
  createdAt?: string;
  expiresAt?: string | null;
  sourceKind?: GroupEventSourceKind;
}): Promise<GroupEventRecord> {
  const createdAt = params.createdAt ?? nowIso();
  const unsigned = {
    version: 1,
    event_id: `gev_${ulid()}`,
    group_id: params.groupId,
    kind: params.kind,
    epoch: params.epoch,
    channel_id: params.channelId ?? null,
    actor_address: normalizeAddressLike(params.actorAddress),
    actor_agent_id: normalizeOptionalText(params.actorAgentId),
    parent_event_ids: params.parentEventIds ?? [],
    payload: params.payload,
    created_at: createdAt,
    expires_at: params.expiresAt ?? null,
  };
  const canonical = stableStringify(unsigned);
  const eventHash = hashCanonical(unsigned);
  const signature = await params.account.signMessage({
    message: `OpenFox:group:v1:${canonical}`,
  });

  return {
    eventId: unsigned.event_id,
    groupId: unsigned.group_id,
    kind: unsigned.kind,
    epoch: unsigned.epoch,
    channelId: unsigned.channel_id,
    actorAddress: unsigned.actor_address,
    actorAgentId: unsigned.actor_agent_id,
    parentEventIds: unsigned.parent_event_ids,
    payload: params.payload,
    signature: signature as Hex,
    eventHash,
    createdAt,
    expiresAt: unsigned.expires_at,
    receivedAt: createdAt,
    sourceKind: params.sourceKind ?? "local",
    reducerStatus: "accepted",
    rejectionReason: null,
  };
}

function insertGroupEvent(db: OpenFoxDatabase, event: GroupEventRecord): void {
  db.raw
    .prepare(
      `INSERT INTO group_events (
        event_id,
        group_id,
        kind,
        epoch,
        channel_id,
        actor_address,
        actor_agent_id,
        parent_event_ids_json,
        payload_json,
        signature,
        event_hash,
        created_at,
        expires_at,
        received_at,
        source_kind,
        reducer_status,
        rejection_reason
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      event.eventId,
      event.groupId,
      event.kind,
      event.epoch,
      event.channelId,
      event.actorAddress,
      event.actorAgentId,
      JSON.stringify(event.parentEventIds),
      JSON.stringify(event.payload),
      event.signature,
      event.eventHash,
      event.createdAt,
      event.expiresAt,
      event.receivedAt,
      event.sourceKind,
      event.reducerStatus,
      event.rejectionReason,
    );
}

function mapGroupRow(row: any): GroupRecord {
  return {
    groupId: row.group_id,
    name: row.name,
    description: row.description,
    visibility: row.visibility,
    joinMode: row.join_mode,
    status: row.status,
    maxMembers: row.max_members,
    tnsName: row.tns_name ?? null,
    tags: parseJsonSafe<string[]>(row.tags_json, []),
    avatarArtifactCid: row.avatar_artifact_cid ?? null,
    rulesArtifactCid: row.rules_artifact_cid ?? null,
    creatorAddress: row.creator_address,
    creatorAgentId: row.creator_agent_id ?? null,
    currentEpoch: row.current_epoch,
    currentPolicyHash: row.current_policy_hash as Hex,
    currentMembersRoot: row.current_members_root as Hex,
    pinnedAnnouncementId: row.pinned_announcement_id ?? null,
    latestSnapshotId: row.latest_snapshot_id ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapChannelRow(row: any): GroupChannelRecord {
  return {
    channelId: row.channel_id,
    groupId: row.group_id,
    name: row.name,
    description: row.description,
    visibility: row.visibility,
    status: row.status,
    createdByAddress: row.created_by_address,
    createdAt: row.created_at,
    archivedAt: row.archived_at ?? null,
  };
}

function mapAnnouncementRow(row: any): GroupAnnouncementRecord {
  return {
    announcementId: row.announcement_id,
    groupId: row.group_id,
    channelId: row.channel_id ?? null,
    eventId: row.event_id,
    title: row.title,
    bodyText: row.body_text,
    pinned: row.pinned === 1,
    postedByAddress: row.posted_by_address,
    createdAt: row.created_at,
    redactedAt: row.redacted_at ?? null,
  };
}

function mapRoleRow(row: any): GroupMemberRoleRecord {
  return {
    groupId: row.group_id,
    memberAddress: row.member_address,
    role: row.role,
    active: row.active === 1,
    grantedByAddress: row.granted_by_address,
    grantedAt: row.granted_at,
    revokedAt: row.revoked_at ?? null,
    lastEventId: row.last_event_id,
  };
}

function mapProposalRow(row: any): GroupProposalRecord {
  return {
    proposalId: row.proposal_id,
    groupId: row.group_id,
    proposalKind: row.proposal_kind,
    targetAddress: row.target_address ?? null,
    targetAgentId: row.target_agent_id ?? null,
    targetTnsName: row.target_tns_name ?? null,
    targetRoles: parseJsonSafe<string[]>(row.target_roles_json, []),
    openedByAddress: row.opened_by_address,
    openedEventId: row.opened_event_id,
    approvalCount: row.approval_count,
    requiredApprovals: row.required_approvals,
    inviteAcceptedAt: row.invite_accepted_at ?? null,
    status: row.status,
    reason: row.reason ?? null,
    expiresAt: row.expires_at ?? null,
    committedEventId: row.committed_event_id ?? null,
    updatedAt: row.updated_at,
  };
}

function mapMessageRow(row: any): GroupMessageRecord {
  return {
    messageId: row.message_id,
    groupId: row.group_id,
    channelId: row.channel_id,
    originalEventId: row.original_event_id,
    latestEventId: row.latest_event_id,
    senderAddress: row.sender_address,
    senderAgentId: row.sender_agent_id ?? null,
    replyToMessageId: row.reply_to_message_id ?? null,
    ciphertext: row.ciphertext,
    previewText: row.preview_text ?? null,
    mentions: parseJsonSafe<string[]>(row.mentions_json, []),
    reactionSummary: parseJsonSafe<Record<string, number>>(row.reaction_summary_json, {}),
    redacted: row.redacted === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapJoinRequestRow(row: any): GroupJoinRequestRecord {
  return {
    requestId: row.request_id,
    groupId: row.group_id,
    applicantAddress: row.applicant_address,
    applicantAgentId: row.applicant_agent_id ?? null,
    applicantTnsName: row.applicant_tns_name ?? null,
    requestedRoles: parseJsonSafe<string[]>(row.requested_roles_json, []),
    requestMessage: row.request_message,
    openedEventId: row.opened_event_id,
    approvalCount: row.approval_count,
    requiredApprovals: row.required_approvals,
    status: row.status,
    committedEventId: row.committed_event_id ?? null,
    expiresAt: row.expires_at ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapEventRow(row: any): GroupEventRecord {
  return {
    eventId: row.event_id,
    groupId: row.group_id,
    kind: row.kind,
    epoch: row.epoch,
    channelId: row.channel_id ?? null,
    actorAddress: row.actor_address,
    actorAgentId: row.actor_agent_id ?? null,
    parentEventIds: parseJsonSafe<string[]>(row.parent_event_ids_json, []),
    payload: parseJsonSafe<Record<string, unknown>>(row.payload_json, {}),
    signature: row.signature as Hex,
    eventHash: row.event_hash as Hex,
    createdAt: row.created_at,
    expiresAt: row.expires_at ?? null,
    receivedAt: row.received_at,
    sourceKind: row.source_kind,
    reducerStatus: row.reducer_status,
    rejectionReason: row.rejection_reason ?? null,
  };
}

function listRoleRowsForGroup(db: OpenFoxDatabase, groupId: string): GroupMemberRoleRecord[] {
  const rows = db.raw
    .prepare(
      `SELECT * FROM group_member_roles
       WHERE group_id = ? AND active = 1
       ORDER BY member_address ASC, role ASC`,
    )
    .all(groupId) as any[];
  return rows.map(mapRoleRow);
}

function requireGroup(db: OpenFoxDatabase, groupId: string): GroupRecord {
  const group = getGroup(db, groupId);
  if (!group) {
    throw new Error(`Group not found: ${groupId}`);
  }
  return group;
}

function requireProposal(
  db: OpenFoxDatabase,
  groupId: string,
  proposalId: string,
): GroupProposalRecord {
  const row = db.raw
    .prepare(
      `SELECT * FROM group_proposals
       WHERE group_id = ? AND proposal_id = ?`,
    )
    .get(groupId, proposalId) as any | undefined;
  if (!row) {
    throw new Error(`Proposal not found: ${proposalId}`);
  }
  return mapProposalRow(row);
}

function requireJoinRequest(
  db: OpenFoxDatabase,
  groupId: string,
  requestId: string,
): GroupJoinRequestRecord {
  const row = db.raw
    .prepare(
      `SELECT * FROM group_join_requests
       WHERE group_id = ? AND request_id = ?`,
    )
    .get(groupId, requestId) as any | undefined;
  if (!row) {
    throw new Error(`Join request not found: ${requestId}`);
  }
  return mapJoinRequestRow(row);
}

function ensureGroupWritable(group: GroupRecord): void {
  if (group.status !== "active") {
    throw new Error(`Group is not active: ${group.groupId}`);
  }
}

function requireActiveMembership(
  db: OpenFoxDatabase,
  groupId: string,
  memberAddress: string,
): GroupMemberRecord {
  const normalized = normalizeAddressLike(memberAddress);
  const row = db.raw
    .prepare(
      `SELECT member_address, membership_state
       FROM group_members
       WHERE group_id = ? AND member_address = ?`,
    )
    .get(groupId, normalized) as
    | { member_address: string; membership_state: GroupMembershipState }
    | undefined;
  if (!row) {
    throw new Error(`Member not found in ${groupId}: ${memberAddress}`);
  }
  if (row.membership_state !== "active") {
    throw new Error(
      `Member is not active in ${groupId}: ${memberAddress} (${row.membership_state})`,
    );
  }
  const member = listGroupMembers(db, groupId).find(
    (entry) => entry.memberAddress === normalized,
  );
  if (!member) {
    throw new Error(`Failed to resolve active member state: ${memberAddress}`);
  }
  return member;
}

function requirePostableMembership(
  db: OpenFoxDatabase,
  groupId: string,
  memberAddress: string,
): GroupMemberRecord {
  const member = requireActiveMembership(db, groupId, memberAddress);
  if (member.muteUntil && new Date(member.muteUntil).getTime() > Date.now()) {
    throw new Error(
      `member is muted in ${groupId} until ${member.muteUntil}: ${memberAddress}`,
    );
  }
  return member;
}

function getStoredMembershipState(
  db: OpenFoxDatabase,
  groupId: string,
  memberAddress: string,
): GroupMembershipState | null {
  const row = db.raw
    .prepare(
      `SELECT membership_state
       FROM group_members
       WHERE group_id = ? AND member_address = ?`,
    )
    .get(groupId, normalizeAddressLike(memberAddress)) as
    | { membership_state: GroupMembershipState }
    | undefined;
  return row?.membership_state ?? null;
}

function ensureGroupHasRole(
  db: OpenFoxDatabase,
  groupId: string,
  actorAddress: string,
  allowedRoles: string[],
): void {
  const normalized = normalizeAddressLike(actorAddress);
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

function findChannelRowByName(
  db: OpenFoxDatabase,
  groupId: string,
  channelName: string,
): GroupChannelRecord | undefined {
  const row = db.raw
    .prepare(
      `SELECT * FROM group_channels
       WHERE group_id = ? AND name = ? AND status = 'active'`,
    )
    .get(groupId, normalizeChannelName(channelName)) as any | undefined;
  return row ? mapChannelRow(row) : undefined;
}

function resolveGroupChannel(params: {
  db: OpenFoxDatabase;
  groupId: string;
  channelId?: string | null;
  channelName?: string | null;
  fallbackName?: string;
}): GroupChannelRecord {
  if (params.channelId) {
    const row = params.db.raw
      .prepare(
        `SELECT * FROM group_channels
         WHERE group_id = ? AND channel_id = ? AND status = 'active'`,
      )
      .get(params.groupId, params.channelId) as any | undefined;
    if (!row) {
      throw new Error(`Channel not found: ${params.channelId}`);
    }
    return mapChannelRow(row);
  }
  const byName = findChannelRowByName(
    params.db,
    params.groupId,
    params.channelName ?? params.fallbackName ?? "general",
  );
  if (!byName) {
    throw new Error(
      `Channel not found in ${params.groupId}: ${params.channelName ?? params.fallbackName ?? "general"}`,
    );
  }
  return byName;
}

function requireGroupMessage(
  db: OpenFoxDatabase,
  groupId: string,
  messageId: string,
): GroupMessageRecord {
  const row = db.raw
    .prepare(
      `SELECT * FROM group_messages
       WHERE group_id = ? AND message_id = ?`,
    )
    .get(groupId, messageId) as any | undefined;
  if (!row) {
    throw new Error(`Message not found: ${messageId}`);
  }
  return mapMessageRow(row);
}

function countActiveMembers(db: OpenFoxDatabase, groupId: string): number {
  const row = db.raw
    .prepare(
      `SELECT COUNT(*) AS count
       FROM group_members
       WHERE group_id = ? AND membership_state = 'active'`,
    )
    .get(groupId) as { count: number };
  return row.count;
}

function recomputeMembersRoot(db: OpenFoxDatabase, groupId: string): Hex {
  const activeMembers = db.raw
    .prepare(
      `SELECT member_address
       FROM group_members
       WHERE group_id = ? AND membership_state = 'active'
       ORDER BY member_address ASC`,
    )
    .all(groupId) as Array<{ member_address: string }>;
  const activeRoles = db.raw
    .prepare(
      `SELECT member_address, role
       FROM group_member_roles
       WHERE group_id = ? AND active = 1
       ORDER BY member_address ASC, role ASC`,
    )
    .all(groupId) as Array<{ member_address: string; role: string }>;
  const rolesByMember = new Map<string, string[]>();
  for (const row of activeRoles) {
    const roles = rolesByMember.get(row.member_address) ?? [];
    roles.push(row.role);
    rolesByMember.set(row.member_address, roles);
  }
  return buildMembersRoot(
    activeMembers.map((member) => ({
      address: member.member_address,
      roles: rolesByMember.get(member.member_address) ?? [],
    })),
  );
}

function refreshMessageReactionSummary(
  db: OpenFoxDatabase,
  groupId: string,
  messageId: string,
): Record<string, number> {
  const rows = db.raw
    .prepare(
      `SELECT reaction_code, COUNT(*) AS count
       FROM group_message_reactions
       WHERE group_id = ? AND message_id = ?
       GROUP BY reaction_code`,
    )
    .all(groupId, messageId) as Array<{ reaction_code: string; count: number }>;
  const summary: Record<string, number> = {};
  for (const row of rows) {
    summary[row.reaction_code] = row.count;
  }
  db.raw
    .prepare(
      `UPDATE group_messages
       SET reaction_summary_json = ?, updated_at = ?
       WHERE group_id = ? AND message_id = ?`,
    )
    .run(JSON.stringify(summary), nowIso(), groupId, messageId);
  return summary;
}

function upsertJoinRequestProjection(params: {
  db: OpenFoxDatabase;
  request: GroupJoinRequestRecord;
}): void {
  params.db.raw
    .prepare(
      `INSERT OR REPLACE INTO group_join_requests (
        request_id,
        group_id,
        applicant_address,
        applicant_agent_id,
        applicant_tns_name,
        requested_roles_json,
        request_message,
        opened_event_id,
        approval_count,
        required_approvals,
        status,
        committed_event_id,
        expires_at,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      params.request.requestId,
      params.request.groupId,
      params.request.applicantAddress,
      params.request.applicantAgentId,
      params.request.applicantTnsName,
      JSON.stringify(params.request.requestedRoles),
      params.request.requestMessage,
      params.request.openedEventId,
      params.request.approvalCount,
      params.request.requiredApprovals,
      params.request.status,
      params.request.committedEventId,
      params.request.expiresAt,
      params.request.createdAt,
      params.request.updatedAt,
    );
}

function upsertProposalProjection(params: {
  db: OpenFoxDatabase;
  proposal: GroupProposalRecord;
}): void {
  params.db.raw
    .prepare(
      `INSERT OR REPLACE INTO group_proposals (
        proposal_id,
        group_id,
        proposal_kind,
        target_address,
        target_agent_id,
        target_tns_name,
        target_roles_json,
        opened_by_address,
        opened_event_id,
        approval_count,
        required_approvals,
        invite_accepted_at,
        status,
        reason,
        expires_at,
        committed_event_id,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      params.proposal.proposalId,
      params.proposal.groupId,
      params.proposal.proposalKind,
      params.proposal.targetAddress,
      params.proposal.targetAgentId,
      params.proposal.targetTnsName,
      JSON.stringify(params.proposal.targetRoles),
      params.proposal.openedByAddress,
      params.proposal.openedEventId,
      params.proposal.approvalCount,
      params.proposal.requiredApprovals,
      params.proposal.inviteAcceptedAt,
      params.proposal.status,
      params.proposal.reason,
      params.proposal.expiresAt,
      params.proposal.committedEventId,
      params.proposal.updatedAt,
    );
}

function insertMemberProjection(params: {
  db: OpenFoxDatabase;
  groupId: string;
  memberAddress: string;
  memberAgentId?: string | null;
  displayName?: string | null;
  joinedVia: "genesis" | "invite" | "join_request";
  joinedAt: string;
  lastEventId: string;
}): void {
  params.db.raw
    .prepare(
      `INSERT OR REPLACE INTO group_members (
        group_id,
        member_address,
        member_agent_id,
        member_tns_name,
        display_name,
        membership_state,
        joined_via,
        joined_at,
        left_at,
        mute_until,
        last_event_id
      ) VALUES (?, ?, ?, ?, ?, 'active', ?, ?, NULL, NULL, ?)`,
    )
    .run(
      params.groupId,
      normalizeAddressLike(params.memberAddress),
      normalizeOptionalText(params.memberAgentId),
      null,
      normalizeOptionalText(params.displayName),
      params.joinedVia,
      params.joinedAt,
      params.lastEventId,
    );
}

function insertRoleProjection(params: {
  db: OpenFoxDatabase;
  groupId: string;
  memberAddress: string;
  role: string;
  grantedByAddress: string;
  grantedAt: string;
  lastEventId: string;
}): void {
  params.db.raw
    .prepare(
      `INSERT OR REPLACE INTO group_member_roles (
        group_id,
        member_address,
        role,
        active,
        granted_by_address,
        granted_at,
        revoked_at,
        last_event_id
      ) VALUES (?, ?, ?, 1, ?, ?, NULL, ?)`,
    )
    .run(
      params.groupId,
      normalizeAddressLike(params.memberAddress),
      params.role,
      normalizeAddressLike(params.grantedByAddress),
      params.grantedAt,
      params.lastEventId,
    );
}

function deactivateMemberRoles(params: {
  db: OpenFoxDatabase;
  groupId: string;
  memberAddress: string;
  revokedAt: string;
  lastEventId: string;
}): void {
  params.db.raw
    .prepare(
      `UPDATE group_member_roles
       SET active = 0, revoked_at = ?, last_event_id = ?
       WHERE group_id = ? AND member_address = ? AND active = 1`,
    )
    .run(
      params.revokedAt,
      params.lastEventId,
      params.groupId,
      normalizeAddressLike(params.memberAddress),
    );
}

function normalizeGroupRoles(input?: string[]): string[] {
  const roles = dedupeStrings((input ?? ["member"]).map((role) => role.trim().toLowerCase()));
  return roles.length ? roles : ["member"];
}

async function buildMembershipSystemNoticeEvent(params: {
  account: PrivateKeyAccount;
  group: GroupRecord;
  actorAddress: string;
  actorAgentId?: string | null;
  createdAt: string;
  parentEventIds: string[];
  noticeType: "member_joined" | "member_left" | "member_removed";
  memberAddress: string;
  memberRoles?: string[];
  reason?: string | null;
}): Promise<GroupEventRecord> {
  return buildSignedGroupEvent({
    account: params.account,
    groupId: params.group.groupId,
    kind: "system.notice.posted",
    epoch: params.group.currentEpoch,
    actorAddress: params.actorAddress,
    actorAgentId: params.actorAgentId,
    createdAt: params.createdAt,
    parentEventIds: params.parentEventIds,
    payload: {
      notice_type: params.noticeType,
      member_address: normalizeAddressLike(params.memberAddress),
      member_roles: params.memberRoles ?? [],
      reason: normalizeOptionalText(params.reason),
    },
  });
}

export async function createGroup(params: {
  db: OpenFoxDatabase;
  account: PrivateKeyAccount;
  input: CreateGroupInput;
}): Promise<CreateGroupResult> {
  const name = params.input.name.trim();
  if (!name) {
    throw new Error("group name cannot be empty");
  }

  const actorAddress = normalizeAddressLike(
    params.input.actorAddress ?? params.account.address,
  );
  const actorAgentId = normalizeOptionalText(params.input.actorAgentId);
  const createdAt = nowIso();
  const visibility = params.input.visibility ?? "listed";
  const joinMode = params.input.joinMode ?? "request_approval";
  const maxMembers = params.input.maxMembers ?? DEFAULT_GROUP_MAX_MEMBERS;
  if (!Number.isInteger(maxMembers) || maxMembers <= 0) {
    throw new Error("maxMembers must be a positive integer");
  }

  const requestedChannels =
    params.input.defaultChannels?.map((channel) => ({
      name: normalizeChannelName(channel.name),
      description: channel.description?.trim() || "",
    })) ?? [];
  const mergedChannels = [
    ...DEFAULT_CHANNELS.map((channel) => ({
      name: channel.name,
      description: channel.description,
    })),
    ...requestedChannels,
  ];
  const dedupedChannels = dedupeStrings(mergedChannels.map((channel) => channel.name)).map(
    (nameValue) =>
      mergedChannels.find((channel) => channel.name === nameValue) ?? {
        name: nameValue,
        description: "",
      },
  );

  const groupId = `grp_${ulid()}`;
  const policyHash = buildDefaultPolicyHash({
    visibility,
    joinMode,
    maxMembers,
  });
  const membersRoot = buildMembersRoot([
    { address: actorAddress, roles: ["owner", "admin", "member"] },
  ]);
  const createdEvent = await buildSignedGroupEvent({
    account: params.account,
    groupId,
    kind: "group.created",
    epoch: 1,
    actorAddress,
    actorAgentId,
    createdAt,
    payload: {
      group_id: groupId,
      name,
      description: params.input.description?.trim() || "",
      visibility,
      join_mode: joinMode,
      max_members: maxMembers,
      tns_name: normalizeOptionalText(params.input.tnsName),
      tags: dedupeStrings(params.input.tags ?? []),
      creator_display_name: normalizeOptionalText(params.input.creatorDisplayName),
      default_channels: dedupedChannels,
      policy_hash: policyHash,
      members_root: membersRoot,
    },
  });

  const channelRecords = dedupedChannels.map((channel) => ({
    channelId: `chn_${ulid()}`,
    groupId,
    name: channel.name,
    description: channel.description,
    visibility: "group",
    status: "active" as const,
    createdByAddress: actorAddress,
    createdAt,
    archivedAt: null,
  }));
  const channelEvents = await Promise.all(
    channelRecords.map((channel) =>
      buildSignedGroupEvent({
        account: params.account,
        groupId,
        kind: "channel.created",
        epoch: 1,
        actorAddress,
        actorAgentId,
        channelId: channel.channelId,
        parentEventIds: [createdEvent.eventId],
        createdAt,
        payload: {
          channel_id: channel.channelId,
          name: channel.name,
          description: channel.description,
          visibility: channel.visibility,
        },
      }),
    ),
  );

  params.db.runTransaction(() => {
    params.db.raw
      .prepare(
        `INSERT INTO groups (
          group_id,
          name,
          description,
          visibility,
          join_mode,
          status,
          max_members,
          tns_name,
          tags_json,
          avatar_artifact_cid,
          rules_artifact_cid,
          creator_address,
          creator_agent_id,
          current_epoch,
          current_policy_hash,
          current_members_root,
          pinned_announcement_id,
          latest_snapshot_id,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, NULL, NULL, ?, ?, 1, ?, ?, NULL, NULL, ?, ?)`,
      )
      .run(
        groupId,
        name,
        params.input.description?.trim() || "",
        visibility,
        joinMode,
        maxMembers,
        normalizeOptionalText(params.input.tnsName),
        JSON.stringify(dedupeStrings(params.input.tags ?? [])),
        actorAddress,
        actorAgentId,
        policyHash,
        membersRoot,
        createdAt,
        createdAt,
      );

    insertMemberProjection({
      db: params.db,
      groupId,
      memberAddress: actorAddress,
      memberAgentId: actorAgentId,
      displayName: params.input.creatorDisplayName,
      joinedVia: "genesis",
      joinedAt: createdAt,
      lastEventId: createdEvent.eventId,
    });

    for (const role of ["owner", "admin", "member"]) {
      insertRoleProjection({
        db: params.db,
        groupId,
        memberAddress: actorAddress,
        role,
        grantedByAddress: actorAddress,
        grantedAt: createdAt,
        lastEventId: createdEvent.eventId,
      });
    }

    const insertChannel = params.db.raw.prepare(
      `INSERT INTO group_channels (
        channel_id,
        group_id,
        name,
        description,
        visibility,
        status,
        created_by_address,
        created_at,
        archived_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const channel of channelRecords) {
      insertChannel.run(
        channel.channelId,
        channel.groupId,
        channel.name,
        channel.description,
        channel.visibility,
        channel.status,
        channel.createdByAddress,
        channel.createdAt,
        channel.archivedAt,
      );
    }

    insertGroupEvent(params.db, createdEvent);
    for (const channelEvent of channelEvents) {
      insertGroupEvent(params.db, channelEvent);
    }
  });

  const detail = getGroupDetail(params.db, groupId);
  if (!detail) {
    throw new Error(`failed to load created group: ${groupId}`);
  }
  return {
    ...detail,
    createdEventId: createdEvent.eventId,
  };
}

export function listGroups(
  db: OpenFoxDatabase,
  limit = 50,
): GroupRecord[] {
  const rows = db.raw
    .prepare("SELECT * FROM groups ORDER BY updated_at DESC LIMIT ?")
    .all(Math.max(1, limit)) as any[];
  return rows.map(mapGroupRow);
}

export function getGroup(
  db: OpenFoxDatabase,
  groupId: string,
): GroupRecord | undefined {
  const row = db.raw
    .prepare("SELECT * FROM groups WHERE group_id = ?")
    .get(groupId) as any | undefined;
  return row ? mapGroupRow(row) : undefined;
}

export function listGroupChannels(
  db: OpenFoxDatabase,
  groupId: string,
): GroupChannelRecord[] {
  const rows = db.raw
    .prepare(
      `SELECT * FROM group_channels
       WHERE group_id = ?
       ORDER BY created_at ASC`,
    )
    .all(groupId) as any[];
  return rows.map(mapChannelRow);
}

export function listGroupAnnouncements(
  db: OpenFoxDatabase,
  groupId: string,
  limit = 20,
): GroupAnnouncementRecord[] {
  const rows = db.raw
    .prepare(
      `SELECT * FROM group_announcements
       WHERE group_id = ?
       ORDER BY created_at DESC
       LIMIT ?`,
    )
    .all(groupId, Math.max(1, limit)) as any[];
  return rows.map(mapAnnouncementRow);
}

export function listGroupMessages(
  db: OpenFoxDatabase,
  groupId: string,
  options?: {
    channelId?: string;
    channelName?: string;
    limit?: number;
  },
): GroupMessageRecord[] {
  let channelId = options?.channelId;
  if (!channelId && options?.channelName) {
    channelId = findChannelRowByName(db, groupId, options.channelName)?.channelId;
  }
  const conditions = ["group_id = ?"];
  const values: unknown[] = [groupId];
  if (channelId) {
    conditions.push("channel_id = ?");
    values.push(channelId);
  }
  values.push(Math.max(1, options?.limit ?? 50));
  const rows = db.raw
    .prepare(
      `SELECT * FROM group_messages
       WHERE ${conditions.join(" AND ")}
       ORDER BY created_at ASC
       LIMIT ?`,
    )
    .all(...values) as any[];
  return rows.map(mapMessageRow);
}

export function listGroupProposals(
  db: OpenFoxDatabase,
  groupId: string,
  filters?: {
    proposalKind?: GroupProposalRecord["proposalKind"];
    status?: GroupProposalRecord["status"];
    limit?: number;
  },
): GroupProposalRecord[] {
  const conditions = ["group_id = ?"];
  const values: unknown[] = [groupId];
  if (filters?.proposalKind) {
    conditions.push("proposal_kind = ?");
    values.push(filters.proposalKind);
  }
  if (filters?.status) {
    conditions.push("status = ?");
    values.push(filters.status);
  }
  values.push(Math.max(1, filters?.limit ?? 50));
  const rows = db.raw
    .prepare(
      `SELECT * FROM group_proposals
       WHERE ${conditions.join(" AND ")}
       ORDER BY updated_at DESC
       LIMIT ?`,
    )
    .all(...values) as any[];
  return rows.map(mapProposalRow);
}

export function listGroupJoinRequests(
  db: OpenFoxDatabase,
  groupId: string,
  filters?: {
    status?: GroupJoinRequestRecord["status"];
    limit?: number;
  },
): GroupJoinRequestRecord[] {
  const conditions = ["group_id = ?"];
  const values: unknown[] = [groupId];
  if (filters?.status) {
    conditions.push("status = ?");
    values.push(filters.status);
  }
  values.push(Math.max(1, filters?.limit ?? 50));
  const rows = db.raw
    .prepare(
      `SELECT * FROM group_join_requests
       WHERE ${conditions.join(" AND ")}
       ORDER BY updated_at DESC
       LIMIT ?`,
    )
    .all(...values) as any[];
  return rows.map(mapJoinRequestRow);
}

export function listGroupMembers(
  db: OpenFoxDatabase,
  groupId: string,
): GroupMemberRecord[] {
  const roleRows = listRoleRowsForGroup(db, groupId);
  const rolesByMember = new Map<string, string[]>();
  for (const row of roleRows) {
    const roles = rolesByMember.get(row.memberAddress) ?? [];
    roles.push(row.role);
    rolesByMember.set(row.memberAddress, roles);
  }

  const rows = db.raw
    .prepare(
      `SELECT * FROM group_members
       WHERE group_id = ?
       ORDER BY joined_at ASC`,
    )
    .all(groupId) as any[];

  return rows.map((row) => ({
    groupId: row.group_id,
    memberAddress: row.member_address,
    memberAgentId: row.member_agent_id ?? null,
    memberTnsName: row.member_tns_name ?? null,
    displayName: row.display_name ?? null,
    membershipState: row.membership_state,
    joinedVia: row.joined_via,
    joinedAt: row.joined_at,
    leftAt: row.left_at ?? null,
    muteUntil: row.mute_until ?? null,
    lastEventId: row.last_event_id,
    roles: (rolesByMember.get(row.member_address) ?? []).sort(),
  }));
}

export function listGroupEvents(
  db: OpenFoxDatabase,
  groupId: string,
  limit = 50,
): GroupEventRecord[] {
  const rows = db.raw
    .prepare(
      `SELECT * FROM group_events
       WHERE group_id = ?
       ORDER BY created_at DESC, received_at DESC
       LIMIT ?`,
    )
    .all(groupId, Math.max(1, limit)) as any[];
  return rows.map(mapEventRow);
}

export function getGroupDetail(
  db: OpenFoxDatabase,
  groupId: string,
): GroupDetail | undefined {
  const group = getGroup(db, groupId);
  if (!group) return undefined;
  return {
    group,
    channels: listGroupChannels(db, groupId),
    members: listGroupMembers(db, groupId),
    announcements: listGroupAnnouncements(db, groupId, 20),
    recentEvents: listGroupEvents(db, groupId, 20),
  };
}

export async function createGroupChannel(params: {
  db: OpenFoxDatabase;
  account: PrivateKeyAccount;
  input: CreateGroupChannelInput;
}): Promise<CreateGroupChannelResult> {
  const group = requireGroup(params.db, params.input.groupId);
  ensureGroupWritable(group);
  const actorAddress = normalizeAddressLike(
    params.input.actorAddress ?? params.account.address,
  );
  ensureGroupHasRole(params.db, group.groupId, actorAddress, [
    "owner",
    "admin",
    "moderator",
  ]);

  const existing = findChannelRowByName(params.db, group.groupId, params.input.name);
  if (existing) {
    throw new Error(`channel already exists in ${group.groupId}: ${existing.name}`);
  }

  const createdAt = nowIso();
  const channel: GroupChannelRecord = {
    channelId: `chn_${ulid()}`,
    groupId: group.groupId,
    name: normalizeChannelName(params.input.name),
    description: params.input.description?.trim() || "",
    visibility: params.input.visibility?.trim() || "group",
    status: "active",
    createdByAddress: actorAddress,
    createdAt,
    archivedAt: null,
  };
  const event = await buildSignedGroupEvent({
    account: params.account,
    groupId: group.groupId,
    kind: "channel.created",
    epoch: group.currentEpoch,
    actorAddress,
    actorAgentId: params.input.actorAgentId,
    channelId: channel.channelId,
    createdAt,
    payload: {
      channel_id: channel.channelId,
      name: channel.name,
      description: channel.description,
      visibility: channel.visibility,
    },
  });

  params.db.runTransaction(() => {
    params.db.raw
      .prepare(
        `INSERT INTO group_channels (
          channel_id,
          group_id,
          name,
          description,
          visibility,
          status,
          created_by_address,
          created_at,
          archived_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
      )
      .run(
        channel.channelId,
        channel.groupId,
        channel.name,
        channel.description,
        channel.visibility,
        channel.status,
        channel.createdByAddress,
        channel.createdAt,
      );
    params.db.raw
      .prepare("UPDATE groups SET updated_at = ? WHERE group_id = ?")
      .run(createdAt, group.groupId);
    insertGroupEvent(params.db, event);
  });

  return { channel, event };
}

export async function postGroupAnnouncement(params: {
  db: OpenFoxDatabase;
  account: PrivateKeyAccount;
  input: PostGroupAnnouncementInput;
}): Promise<PostGroupAnnouncementResult> {
  const group = requireGroup(params.db, params.input.groupId);
  ensureGroupWritable(group);
  const actorAddress = normalizeAddressLike(
    params.input.actorAddress ?? params.account.address,
  );
  ensureGroupHasRole(params.db, group.groupId, actorAddress, ["owner", "admin"]);

  const title = params.input.title.trim();
  const bodyText = params.input.bodyText.trim();
  if (!title || !bodyText) {
    throw new Error("announcement title and body cannot be empty");
  }

  let channelId = normalizeOptionalText(params.input.channelId);
  if (!channelId) {
    const announcementsChannel = params.input.channelName
      ? findChannelRowByName(params.db, group.groupId, params.input.channelName)
      : findChannelRowByName(params.db, group.groupId, "announcements");
    channelId = announcementsChannel?.channelId ?? null;
  }

  const createdAt = nowIso();
  const announcementId = `ann_${ulid()}`;
  const postedEvent = await buildSignedGroupEvent({
    account: params.account,
    groupId: group.groupId,
    kind: "announcement.posted",
    epoch: group.currentEpoch,
    actorAddress,
    actorAgentId: params.input.actorAgentId,
    channelId,
    createdAt,
    payload: {
      announcement_id: announcementId,
      title,
      body_text: bodyText,
      pinned: params.input.pin === true,
    },
  });

  const events: GroupEventRecord[] = [postedEvent];
  const pinEvent =
    params.input.pin === true
      ? await buildSignedGroupEvent({
          account: params.account,
          groupId: group.groupId,
          kind: "announcement.pinned",
          epoch: group.currentEpoch,
          actorAddress,
          actorAgentId: params.input.actorAgentId,
          channelId,
          createdAt,
          parentEventIds: [postedEvent.eventId],
          payload: {
            announcement_id: announcementId,
          },
        })
      : null;
  if (pinEvent) {
    events.push(pinEvent);
  }

  const announcement: GroupAnnouncementRecord = {
    announcementId,
    groupId: group.groupId,
    channelId,
    eventId: postedEvent.eventId,
    title,
    bodyText,
    pinned: params.input.pin === true,
    postedByAddress: actorAddress,
    createdAt,
    redactedAt: null,
  };

  params.db.runTransaction(() => {
    params.db.raw
      .prepare(
        `INSERT INTO group_announcements (
          announcement_id,
          group_id,
          channel_id,
          event_id,
          title,
          body_text,
          pinned,
          posted_by_address,
          created_at,
          redacted_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
      )
      .run(
        announcement.announcementId,
        announcement.groupId,
        announcement.channelId,
        announcement.eventId,
        announcement.title,
        announcement.bodyText,
        announcement.pinned ? 1 : 0,
        announcement.postedByAddress,
        announcement.createdAt,
      );

    if (pinEvent) {
      params.db.raw
        .prepare("UPDATE group_announcements SET pinned = 0 WHERE group_id = ?")
        .run(group.groupId);
      params.db.raw
        .prepare("UPDATE group_announcements SET pinned = 1 WHERE announcement_id = ?")
        .run(announcementId);
      params.db.raw
        .prepare(
          "UPDATE groups SET pinned_announcement_id = ?, updated_at = ? WHERE group_id = ?",
        )
        .run(announcementId, createdAt, group.groupId);
    } else {
      params.db.raw
        .prepare("UPDATE groups SET updated_at = ? WHERE group_id = ?")
        .run(createdAt, group.groupId);
    }

    for (const event of events) {
      insertGroupEvent(params.db, event);
    }
  });

  return { announcement, events };
}

export async function sendGroupInvite(params: {
  db: OpenFoxDatabase;
  account: PrivateKeyAccount;
  input: SendGroupInviteInput;
}): Promise<SendGroupInviteResult> {
  const group = requireGroup(params.db, params.input.groupId);
  ensureGroupWritable(group);
  const actorAddress = normalizeAddressLike(
    params.input.actorAddress ?? params.account.address,
  );
  ensureGroupHasRole(params.db, group.groupId, actorAddress, ["owner", "admin"]);

  const targetAddress = normalizeAddressLike(params.input.targetAddress);
  if (targetAddress === actorAddress) {
    throw new Error("use group member leave for self-removal or keep creator as a member");
  }
  const activeMembers = countActiveMembers(params.db, group.groupId);
  if (activeMembers >= group.maxMembers) {
    throw new Error(`group is at capacity (${group.maxMembers})`);
  }
  const existingMember = params.db.raw
    .prepare(
      `SELECT membership_state
       FROM group_members
       WHERE group_id = ? AND member_address = ?`,
    )
    .get(group.groupId, targetAddress) as
    | { membership_state: GroupMembershipState }
    | undefined;
  if (existingMember?.membership_state === "active") {
    throw new Error(`target is already an active member of ${group.groupId}`);
  }
  if (existingMember?.membership_state === "banned") {
    throw new Error(`target is banned from ${group.groupId}`);
  }

  const proposalId = `gpr_${ulid()}`;
  const createdAt = nowIso();
  const targetRoles = normalizeGroupRoles(params.input.targetRoles);
  const expiresAt =
    normalizeOptionalText(params.input.expiresAt) ??
    new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  const proposedEvent = await buildSignedGroupEvent({
    account: params.account,
    groupId: group.groupId,
    kind: "invite.proposed",
    epoch: group.currentEpoch,
    actorAddress,
    actorAgentId: params.input.actorAgentId,
    createdAt,
    payload: {
      proposal_id: proposalId,
      target_address: targetAddress,
      target_agent_id: normalizeOptionalText(params.input.targetAgentId),
      target_tns_name: normalizeOptionalText(params.input.targetTnsName),
      target_roles: targetRoles,
      reason: normalizeOptionalText(params.input.reason),
      expires_at: expiresAt,
    },
  });
  const approvedEvent = await buildSignedGroupEvent({
    account: params.account,
    groupId: group.groupId,
    kind: "invite.approved",
    epoch: group.currentEpoch,
    actorAddress,
    actorAgentId: params.input.actorAgentId,
    createdAt,
    parentEventIds: [proposedEvent.eventId],
    payload: {
      proposal_id: proposalId,
      approval_count: 1,
      required_approvals: 1,
    },
  });

  const proposal: GroupProposalRecord = {
    proposalId,
    groupId: group.groupId,
    proposalKind: "invite",
    targetAddress,
    targetAgentId: normalizeOptionalText(params.input.targetAgentId),
    targetTnsName: normalizeOptionalText(params.input.targetTnsName),
    targetRoles,
    openedByAddress: actorAddress,
    openedEventId: proposedEvent.eventId,
    approvalCount: 1,
    requiredApprovals: 1,
    inviteAcceptedAt: null,
    status: "open",
    reason: normalizeOptionalText(params.input.reason),
    expiresAt,
    committedEventId: null,
    updatedAt: createdAt,
  };

  params.db.runTransaction(() => {
    upsertProposalProjection({
      db: params.db,
      proposal,
    });
    params.db.raw
      .prepare("UPDATE groups SET updated_at = ? WHERE group_id = ?")
      .run(createdAt, group.groupId);
    insertGroupEvent(params.db, proposedEvent);
    insertGroupEvent(params.db, approvedEvent);
  });

  return {
    proposal,
    events: [proposedEvent, approvedEvent],
  };
}

export async function acceptGroupInvite(params: {
  db: OpenFoxDatabase;
  account: PrivateKeyAccount;
  input: AcceptGroupInviteInput;
}): Promise<AcceptGroupInviteResult> {
  const group = requireGroup(params.db, params.input.groupId);
  ensureGroupWritable(group);
  const proposal = requireProposal(params.db, group.groupId, params.input.proposalId);
  if (proposal.proposalKind !== "invite") {
    throw new Error(`proposal is not an invite: ${proposal.proposalId}`);
  }
  if (proposal.status !== "open") {
    throw new Error(`invite is not open: ${proposal.proposalId}`);
  }
  const actorAddress = normalizeAddressLike(
    params.input.actorAddress ?? params.account.address,
  );
  if (proposal.targetAddress !== actorAddress) {
    throw new Error(`invite target mismatch for proposal ${proposal.proposalId}`);
  }
  const existingMember = params.db.raw
    .prepare(
      `SELECT membership_state
       FROM group_members
       WHERE group_id = ? AND member_address = ?`,
    )
    .get(group.groupId, actorAddress) as
    | { membership_state: GroupMembershipState }
    | undefined;
  if (existingMember?.membership_state === "active") {
    throw new Error(`target is already an active member of ${group.groupId}`);
  }
  if (existingMember?.membership_state === "banned") {
    throw new Error(`target is banned from ${group.groupId}`);
  }
  if (countActiveMembers(params.db, group.groupId) >= group.maxMembers) {
    throw new Error(`group is at capacity (${group.maxMembers})`);
  }

  const createdAt = nowIso();
  const acceptEvent = await buildSignedGroupEvent({
    account: params.account,
    groupId: group.groupId,
    kind: "invite.accepted",
    epoch: group.currentEpoch,
    actorAddress,
    actorAgentId: params.input.actorAgentId,
    createdAt,
    parentEventIds: [proposal.openedEventId],
    payload: {
      proposal_id: proposal.proposalId,
    },
  });
  const committedEvent = await buildSignedGroupEvent({
    account: params.account,
    groupId: group.groupId,
    kind: "membership.add.committed",
    epoch: group.currentEpoch,
    actorAddress,
    actorAgentId: params.input.actorAgentId,
    createdAt,
    parentEventIds: [acceptEvent.eventId],
    payload: {
      proposal_id: proposal.proposalId,
      member_address: actorAddress,
      roles: proposal.targetRoles,
      joined_via: "invite",
    },
  });
  const nextEpoch = group.currentEpoch + 1;
  const noticeEvent = await buildMembershipSystemNoticeEvent({
    account: params.account,
    group,
    actorAddress,
    actorAgentId: params.input.actorAgentId,
    createdAt,
    parentEventIds: [committedEvent.eventId],
    noticeType: "member_joined",
    memberAddress: actorAddress,
    memberRoles: proposal.targetRoles,
  });
  const epochEvent = await buildSignedGroupEvent({
    account: params.account,
    groupId: group.groupId,
    kind: "epoch.rotated",
    epoch: nextEpoch,
    actorAddress,
    actorAgentId: params.input.actorAgentId,
    createdAt,
    parentEventIds: [committedEvent.eventId],
    payload: {
      previous_epoch: group.currentEpoch,
      next_epoch: nextEpoch,
      reason: "membership_add",
      member_address: actorAddress,
    },
  });

  const updatedProposal: GroupProposalRecord = {
    ...proposal,
    inviteAcceptedAt: createdAt,
    status: "committed",
    committedEventId: committedEvent.eventId,
    updatedAt: createdAt,
  };

  params.db.runTransaction(() => {
    insertMemberProjection({
      db: params.db,
      groupId: group.groupId,
      memberAddress: actorAddress,
      memberAgentId: params.input.actorAgentId,
      displayName: params.input.displayName,
      joinedVia: "invite",
      joinedAt: createdAt,
      lastEventId: committedEvent.eventId,
    });
    for (const role of proposal.targetRoles) {
      insertRoleProjection({
        db: params.db,
        groupId: group.groupId,
        memberAddress: actorAddress,
        role,
        grantedByAddress: proposal.openedByAddress,
        grantedAt: createdAt,
        lastEventId: committedEvent.eventId,
      });
    }
    const membersRoot = recomputeMembersRoot(params.db, group.groupId);
    params.db.raw
      .prepare(
        `UPDATE groups
         SET current_epoch = ?, current_members_root = ?, updated_at = ?
         WHERE group_id = ?`,
      )
      .run(nextEpoch, membersRoot, createdAt, group.groupId);
    upsertProposalProjection({
      db: params.db,
      proposal: updatedProposal,
    });
    insertGroupEvent(params.db, acceptEvent);
    insertGroupEvent(params.db, committedEvent);
    insertGroupEvent(params.db, noticeEvent);
    insertGroupEvent(params.db, epochEvent);
  });

  const member = requireActiveMembership(params.db, group.groupId, actorAddress);
  return {
    proposal: updatedProposal,
    member,
    events: [acceptEvent, committedEvent, noticeEvent, epochEvent],
  };
}

export async function leaveGroup(params: {
  db: OpenFoxDatabase;
  account: PrivateKeyAccount;
  input: LeaveGroupInput;
}): Promise<LeaveGroupResult> {
  const group = requireGroup(params.db, params.input.groupId);
  ensureGroupWritable(group);
  const actorAddress = normalizeAddressLike(
    params.input.actorAddress ?? params.account.address,
  );
  requireActiveMembership(params.db, group.groupId, actorAddress);

  const createdAt = nowIso();
  const proposedEvent = await buildSignedGroupEvent({
    account: params.account,
    groupId: group.groupId,
    kind: "membership.leave.proposed",
    epoch: group.currentEpoch,
    actorAddress,
    actorAgentId: params.input.actorAgentId,
    createdAt,
    payload: {
      member_address: actorAddress,
    },
  });
  const committedEvent = await buildSignedGroupEvent({
    account: params.account,
    groupId: group.groupId,
    kind: "membership.leave.committed",
    epoch: group.currentEpoch,
    actorAddress,
    actorAgentId: params.input.actorAgentId,
    createdAt,
    parentEventIds: [proposedEvent.eventId],
    payload: {
      member_address: actorAddress,
    },
  });
  const nextEpoch = group.currentEpoch + 1;
  const noticeEvent = await buildMembershipSystemNoticeEvent({
    account: params.account,
    group,
    actorAddress,
    actorAgentId: params.input.actorAgentId,
    createdAt,
    parentEventIds: [committedEvent.eventId],
    noticeType: "member_left",
    memberAddress: actorAddress,
  });
  const epochEvent = await buildSignedGroupEvent({
    account: params.account,
    groupId: group.groupId,
    kind: "epoch.rotated",
    epoch: nextEpoch,
    actorAddress,
    actorAgentId: params.input.actorAgentId,
    createdAt,
    parentEventIds: [committedEvent.eventId],
    payload: {
      previous_epoch: group.currentEpoch,
      next_epoch: nextEpoch,
      reason: "membership_leave",
      member_address: actorAddress,
    },
  });

  params.db.runTransaction(() => {
    params.db.raw
      .prepare(
        `UPDATE group_members
         SET membership_state = 'left', left_at = ?, last_event_id = ?
         WHERE group_id = ? AND member_address = ?`,
      )
      .run(createdAt, committedEvent.eventId, group.groupId, actorAddress);
    deactivateMemberRoles({
      db: params.db,
      groupId: group.groupId,
      memberAddress: actorAddress,
      revokedAt: createdAt,
      lastEventId: committedEvent.eventId,
    });
    const membersRoot = recomputeMembersRoot(params.db, group.groupId);
    params.db.raw
      .prepare(
        `UPDATE groups
         SET current_epoch = ?, current_members_root = ?, updated_at = ?
         WHERE group_id = ?`,
      )
      .run(nextEpoch, membersRoot, createdAt, group.groupId);
    insertGroupEvent(params.db, proposedEvent);
    insertGroupEvent(params.db, committedEvent);
    insertGroupEvent(params.db, noticeEvent);
    insertGroupEvent(params.db, epochEvent);
  });

  const member = listGroupMembers(params.db, group.groupId).find(
    (entry) => entry.memberAddress === actorAddress,
  );
  if (!member) {
    throw new Error(`failed to reload member after leave: ${actorAddress}`);
  }
  return {
    member,
    events: [proposedEvent, committedEvent, noticeEvent, epochEvent],
  };
}

export async function removeGroupMember(params: {
  db: OpenFoxDatabase;
  account: PrivateKeyAccount;
  input: RemoveGroupMemberInput;
}): Promise<RemoveGroupMemberResult> {
  const group = requireGroup(params.db, params.input.groupId);
  ensureGroupWritable(group);
  const actorAddress = normalizeAddressLike(
    params.input.actorAddress ?? params.account.address,
  );
  ensureGroupHasRole(params.db, group.groupId, actorAddress, ["owner", "admin"]);
  const targetAddress = normalizeAddressLike(params.input.targetAddress);
  if (targetAddress === actorAddress) {
    throw new Error("use group member leave for self-removal");
  }
  if (targetAddress === group.creatorAddress) {
    throw new Error("refusing to remove the group creator from the initial implementation");
  }
  requireActiveMembership(params.db, group.groupId, targetAddress);

  const createdAt = nowIso();
  const proposedEvent = await buildSignedGroupEvent({
    account: params.account,
    groupId: group.groupId,
    kind: "membership.remove.proposed",
    epoch: group.currentEpoch,
    actorAddress,
    actorAgentId: params.input.actorAgentId,
    createdAt,
    payload: {
      member_address: targetAddress,
      reason: normalizeOptionalText(params.input.reason),
    },
  });
  const approvedEvent = await buildSignedGroupEvent({
    account: params.account,
    groupId: group.groupId,
    kind: "membership.remove.approved",
    epoch: group.currentEpoch,
    actorAddress,
    actorAgentId: params.input.actorAgentId,
    createdAt,
    parentEventIds: [proposedEvent.eventId],
    payload: {
      member_address: targetAddress,
      approval_count: 1,
      required_approvals: 1,
    },
  });
  const committedEvent = await buildSignedGroupEvent({
    account: params.account,
    groupId: group.groupId,
    kind: "membership.remove.committed",
    epoch: group.currentEpoch,
    actorAddress,
    actorAgentId: params.input.actorAgentId,
    createdAt,
    parentEventIds: [approvedEvent.eventId],
    payload: {
      member_address: targetAddress,
      reason: normalizeOptionalText(params.input.reason),
    },
  });
  const nextEpoch = group.currentEpoch + 1;
  const noticeEvent = await buildMembershipSystemNoticeEvent({
    account: params.account,
    group,
    actorAddress,
    actorAgentId: params.input.actorAgentId,
    createdAt,
    parentEventIds: [committedEvent.eventId],
    noticeType: "member_removed",
    memberAddress: targetAddress,
    reason: params.input.reason,
  });
  const epochEvent = await buildSignedGroupEvent({
    account: params.account,
    groupId: group.groupId,
    kind: "epoch.rotated",
    epoch: nextEpoch,
    actorAddress,
    actorAgentId: params.input.actorAgentId,
    createdAt,
    parentEventIds: [committedEvent.eventId],
    payload: {
      previous_epoch: group.currentEpoch,
      next_epoch: nextEpoch,
      reason: "membership_remove",
      member_address: targetAddress,
    },
  });

  params.db.runTransaction(() => {
    params.db.raw
      .prepare(
        `UPDATE group_members
         SET membership_state = 'removed', left_at = ?, last_event_id = ?
         WHERE group_id = ? AND member_address = ?`,
      )
      .run(createdAt, committedEvent.eventId, group.groupId, targetAddress);
    deactivateMemberRoles({
      db: params.db,
      groupId: group.groupId,
      memberAddress: targetAddress,
      revokedAt: createdAt,
      lastEventId: committedEvent.eventId,
    });
    const membersRoot = recomputeMembersRoot(params.db, group.groupId);
    params.db.raw
      .prepare(
        `UPDATE groups
         SET current_epoch = ?, current_members_root = ?, updated_at = ?
         WHERE group_id = ?`,
      )
      .run(nextEpoch, membersRoot, createdAt, group.groupId);
    insertGroupEvent(params.db, proposedEvent);
    insertGroupEvent(params.db, approvedEvent);
    insertGroupEvent(params.db, committedEvent);
    insertGroupEvent(params.db, noticeEvent);
    insertGroupEvent(params.db, epochEvent);
  });

  const member = listGroupMembers(params.db, group.groupId).find(
    (entry) => entry.memberAddress === targetAddress,
  );
  if (!member) {
    throw new Error(`failed to reload member after removal: ${targetAddress}`);
  }
  return {
    member,
    events: [proposedEvent, approvedEvent, committedEvent, noticeEvent, epochEvent],
  };
}

export async function requestToJoinGroup(params: {
  db: OpenFoxDatabase;
  account: PrivateKeyAccount;
  input: RequestToJoinGroupInput;
}): Promise<RequestToJoinGroupResult> {
  const group = requireGroup(params.db, params.input.groupId);
  ensureGroupWritable(group);
  if (group.joinMode !== "request_approval") {
    throw new Error(`group does not allow join requests: ${group.groupId}`);
  }
  const actorAddress = normalizeAddressLike(
    params.input.actorAddress ?? params.account.address,
  );
  const existingState = getStoredMembershipState(params.db, group.groupId, actorAddress);
  if (existingState === "active") {
    throw new Error(`actor is already a member of ${group.groupId}`);
  }
  if (existingState === "banned") {
    throw new Error(`actor is banned from ${group.groupId}`);
  }

  const requestId = `gjr_${ulid()}`;
  const createdAt = nowIso();
  const requestedRoles = normalizeGroupRoles(params.input.requestedRoles);
  const expiresAt =
    normalizeOptionalText(params.input.expiresAt) ??
    new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const event = await buildSignedGroupEvent({
    account: params.account,
    groupId: group.groupId,
    kind: "join.requested",
    epoch: group.currentEpoch,
    actorAddress,
    actorAgentId: params.input.actorAgentId,
    createdAt,
    payload: {
      request_id: requestId,
      applicant_address: actorAddress,
      applicant_agent_id: normalizeOptionalText(params.input.actorAgentId),
      applicant_tns_name: normalizeOptionalText(params.input.actorTnsName),
      requested_roles: requestedRoles,
      message: normalizeOptionalText(params.input.message) ?? "",
      request_expires_at: expiresAt,
    },
  });

  const request: GroupJoinRequestRecord = {
    requestId,
    groupId: group.groupId,
    applicantAddress: actorAddress,
    applicantAgentId: normalizeOptionalText(params.input.actorAgentId),
    applicantTnsName: normalizeOptionalText(params.input.actorTnsName),
    requestedRoles,
    requestMessage: normalizeOptionalText(params.input.message) ?? "",
    openedEventId: event.eventId,
    approvalCount: 0,
    requiredApprovals: 1,
    status: "open",
    committedEventId: null,
    expiresAt,
    createdAt,
    updatedAt: createdAt,
  };

  params.db.runTransaction(() => {
    upsertJoinRequestProjection({
      db: params.db,
      request,
    });
    params.db.raw
      .prepare("UPDATE groups SET updated_at = ? WHERE group_id = ?")
      .run(createdAt, group.groupId);
    insertGroupEvent(params.db, event);
  });

  return { request, event };
}

export async function approveGroupJoinRequest(params: {
  db: OpenFoxDatabase;
  account: PrivateKeyAccount;
  input: ApproveGroupJoinRequestInput;
}): Promise<ApproveGroupJoinRequestResult> {
  const group = requireGroup(params.db, params.input.groupId);
  ensureGroupWritable(group);
  const actorAddress = normalizeAddressLike(
    params.input.actorAddress ?? params.account.address,
  );
  ensureGroupHasRole(params.db, group.groupId, actorAddress, ["owner", "admin"]);
  const request = requireJoinRequest(params.db, group.groupId, params.input.requestId);
  if (request.status !== "open") {
    throw new Error(`join request is not open: ${request.requestId}`);
  }
  if (request.expiresAt && new Date(request.expiresAt).getTime() <= Date.now()) {
    throw new Error(`join request has expired: ${request.requestId}`);
  }
  const existingState = getStoredMembershipState(
    params.db,
    group.groupId,
    request.applicantAddress,
  );
  if (existingState === "active") {
    throw new Error(`applicant is already an active member of ${group.groupId}`);
  }
  if (existingState === "banned") {
    throw new Error(`applicant is banned from ${group.groupId}`);
  }
  if (countActiveMembers(params.db, group.groupId) >= group.maxMembers) {
    throw new Error(`group is at capacity (${group.maxMembers})`);
  }

  const createdAt = nowIso();
  const approvedEvent = await buildSignedGroupEvent({
    account: params.account,
    groupId: group.groupId,
    kind: "join.approved",
    epoch: group.currentEpoch,
    actorAddress,
    actorAgentId: params.input.actorAgentId,
    createdAt,
    parentEventIds: [request.openedEventId],
    payload: {
      request_id: request.requestId,
      approval_count: 1,
      required_approvals: 1,
    },
  });
  const committedEvent = await buildSignedGroupEvent({
    account: params.account,
    groupId: group.groupId,
    kind: "membership.add.committed",
    epoch: group.currentEpoch,
    actorAddress,
    actorAgentId: params.input.actorAgentId,
    createdAt,
    parentEventIds: [approvedEvent.eventId],
    payload: {
      request_id: request.requestId,
      member_address: request.applicantAddress,
      roles: request.requestedRoles,
      joined_via: "join_request",
    },
  });
  const nextEpoch = group.currentEpoch + 1;
  const noticeEvent = await buildMembershipSystemNoticeEvent({
    account: params.account,
    group,
    actorAddress,
    actorAgentId: params.input.actorAgentId,
    createdAt,
    parentEventIds: [committedEvent.eventId],
    noticeType: "member_joined",
    memberAddress: request.applicantAddress,
    memberRoles: request.requestedRoles,
  });
  const epochEvent = await buildSignedGroupEvent({
    account: params.account,
    groupId: group.groupId,
    kind: "epoch.rotated",
    epoch: nextEpoch,
    actorAddress,
    actorAgentId: params.input.actorAgentId,
    createdAt,
    parentEventIds: [committedEvent.eventId],
    payload: {
      previous_epoch: group.currentEpoch,
      next_epoch: nextEpoch,
      reason: "membership_add",
      member_address: request.applicantAddress,
    },
  });

  const updatedRequest: GroupJoinRequestRecord = {
    ...request,
    approvalCount: 1,
    status: "committed",
    committedEventId: committedEvent.eventId,
    updatedAt: createdAt,
  };

  params.db.runTransaction(() => {
    insertMemberProjection({
      db: params.db,
      groupId: group.groupId,
      memberAddress: request.applicantAddress,
      memberAgentId: request.applicantAgentId,
      displayName: params.input.displayName,
      joinedVia: "join_request",
      joinedAt: createdAt,
      lastEventId: committedEvent.eventId,
    });
    for (const role of request.requestedRoles) {
      insertRoleProjection({
        db: params.db,
        groupId: group.groupId,
        memberAddress: request.applicantAddress,
        role,
        grantedByAddress: actorAddress,
        grantedAt: createdAt,
        lastEventId: committedEvent.eventId,
      });
    }
    const membersRoot = recomputeMembersRoot(params.db, group.groupId);
    params.db.raw
      .prepare(
        `UPDATE groups
         SET current_epoch = ?, current_members_root = ?, updated_at = ?
         WHERE group_id = ?`,
      )
      .run(nextEpoch, membersRoot, createdAt, group.groupId);
    upsertJoinRequestProjection({
      db: params.db,
      request: updatedRequest,
    });
    insertGroupEvent(params.db, approvedEvent);
    insertGroupEvent(params.db, committedEvent);
    insertGroupEvent(params.db, noticeEvent);
    insertGroupEvent(params.db, epochEvent);
  });

  return {
    request: updatedRequest,
    member: requireActiveMembership(params.db, group.groupId, request.applicantAddress),
    events: [approvedEvent, committedEvent, noticeEvent, epochEvent],
  };
}

export async function withdrawGroupJoinRequest(params: {
  db: OpenFoxDatabase;
  account: PrivateKeyAccount;
  input: WithdrawGroupJoinRequestInput;
}): Promise<WithdrawGroupJoinRequestResult> {
  const group = requireGroup(params.db, params.input.groupId);
  ensureGroupWritable(group);
  const actorAddress = normalizeAddressLike(
    params.input.actorAddress ?? params.account.address,
  );
  const request = requireJoinRequest(params.db, group.groupId, params.input.requestId);
  if (request.status !== "open") {
    throw new Error(`join request is not open: ${request.requestId}`);
  }
  if (request.applicantAddress !== actorAddress) {
    throw new Error(`only the applicant can withdraw join request ${request.requestId}`);
  }
  const createdAt = nowIso();
  const event = await buildSignedGroupEvent({
    account: params.account,
    groupId: group.groupId,
    kind: "join.withdrawn",
    epoch: group.currentEpoch,
    actorAddress,
    actorAgentId: params.input.actorAgentId,
    createdAt,
    parentEventIds: [request.openedEventId],
    payload: {
      request_id: request.requestId,
    },
  });
  const updatedRequest: GroupJoinRequestRecord = {
    ...request,
    status: "withdrawn",
    updatedAt: createdAt,
  };

  params.db.runTransaction(() => {
    upsertJoinRequestProjection({
      db: params.db,
      request: updatedRequest,
    });
    params.db.raw
      .prepare("UPDATE groups SET updated_at = ? WHERE group_id = ?")
      .run(createdAt, group.groupId);
    insertGroupEvent(params.db, event);
  });

  return {
    request: updatedRequest,
    event,
  };
}

export async function banGroupMember(params: {
  db: OpenFoxDatabase;
  account: PrivateKeyAccount;
  input: BanGroupMemberInput;
}): Promise<BanGroupMemberResult> {
  const group = requireGroup(params.db, params.input.groupId);
  ensureGroupWritable(group);
  const actorAddress = normalizeAddressLike(
    params.input.actorAddress ?? params.account.address,
  );
  ensureGroupHasRole(params.db, group.groupId, actorAddress, [
    "owner",
    "admin",
    "moderator",
  ]);
  const targetAddress = normalizeAddressLike(params.input.targetAddress);
  if (targetAddress === actorAddress) {
    throw new Error("self-ban is not supported");
  }
  if (targetAddress === group.creatorAddress) {
    throw new Error("refusing to ban the group creator in the initial implementation");
  }
  requireActiveMembership(params.db, group.groupId, targetAddress);

  const createdAt = nowIso();
  const bannedEvent = await buildSignedGroupEvent({
    account: params.account,
    groupId: group.groupId,
    kind: "moderation.member.banned",
    epoch: group.currentEpoch,
    actorAddress,
    actorAgentId: params.input.actorAgentId,
    createdAt,
    payload: {
      target_address: targetAddress,
      reason: normalizeOptionalText(params.input.reason),
    },
  });
  const noticeEvent = await buildSignedGroupEvent({
    account: params.account,
    groupId: group.groupId,
    kind: "system.notice.posted",
    epoch: group.currentEpoch,
    actorAddress,
    actorAgentId: params.input.actorAgentId,
    createdAt,
    parentEventIds: [bannedEvent.eventId],
    payload: {
      notice_type: "member_banned",
      member_address: targetAddress,
      reason: normalizeOptionalText(params.input.reason),
    },
  });
  const nextEpoch = group.currentEpoch + 1;
  const epochEvent = await buildSignedGroupEvent({
    account: params.account,
    groupId: group.groupId,
    kind: "epoch.rotated",
    epoch: nextEpoch,
    actorAddress,
    actorAgentId: params.input.actorAgentId,
    createdAt,
    parentEventIds: [bannedEvent.eventId],
    payload: {
      previous_epoch: group.currentEpoch,
      next_epoch: nextEpoch,
      reason: "member_banned",
      member_address: targetAddress,
    },
  });

  params.db.runTransaction(() => {
    params.db.raw
      .prepare(
        `UPDATE group_members
         SET membership_state = 'banned', left_at = ?, mute_until = NULL, last_event_id = ?
         WHERE group_id = ? AND member_address = ?`,
      )
      .run(createdAt, bannedEvent.eventId, group.groupId, targetAddress);
    deactivateMemberRoles({
      db: params.db,
      groupId: group.groupId,
      memberAddress: targetAddress,
      revokedAt: createdAt,
      lastEventId: bannedEvent.eventId,
    });
    const membersRoot = recomputeMembersRoot(params.db, group.groupId);
    params.db.raw
      .prepare(
        `UPDATE groups
         SET current_epoch = ?, current_members_root = ?, updated_at = ?
         WHERE group_id = ?`,
      )
      .run(nextEpoch, membersRoot, createdAt, group.groupId);
    insertGroupEvent(params.db, bannedEvent);
    insertGroupEvent(params.db, noticeEvent);
    insertGroupEvent(params.db, epochEvent);
  });

  const member = listGroupMembers(params.db, group.groupId).find(
    (entry) => entry.memberAddress === targetAddress,
  );
  if (!member) {
    throw new Error(`failed to reload member after ban: ${targetAddress}`);
  }
  return {
    member,
    events: [bannedEvent, noticeEvent, epochEvent],
  };
}

export async function unbanGroupMember(params: {
  db: OpenFoxDatabase;
  account: PrivateKeyAccount;
  input: UnbanGroupMemberInput;
}): Promise<UnbanGroupMemberResult> {
  const group = requireGroup(params.db, params.input.groupId);
  ensureGroupWritable(group);
  const actorAddress = normalizeAddressLike(
    params.input.actorAddress ?? params.account.address,
  );
  ensureGroupHasRole(params.db, group.groupId, actorAddress, [
    "owner",
    "admin",
    "moderator",
  ]);
  const targetAddress = normalizeAddressLike(params.input.targetAddress);
  const state = getStoredMembershipState(params.db, group.groupId, targetAddress);
  if (state !== "banned") {
    throw new Error(`member is not banned in ${group.groupId}: ${targetAddress}`);
  }
  const createdAt = nowIso();
  const unbannedEvent = await buildSignedGroupEvent({
    account: params.account,
    groupId: group.groupId,
    kind: "moderation.member.unbanned",
    epoch: group.currentEpoch,
    actorAddress,
    actorAgentId: params.input.actorAgentId,
    createdAt,
    payload: {
      target_address: targetAddress,
    },
  });
  const noticeEvent = await buildSignedGroupEvent({
    account: params.account,
    groupId: group.groupId,
    kind: "system.notice.posted",
    epoch: group.currentEpoch,
    actorAddress,
    actorAgentId: params.input.actorAgentId,
    createdAt,
    parentEventIds: [unbannedEvent.eventId],
    payload: {
      notice_type: "member_unbanned",
      member_address: targetAddress,
    },
  });

  params.db.runTransaction(() => {
    params.db.raw
      .prepare(
        `UPDATE group_members
         SET membership_state = 'removed', mute_until = NULL, last_event_id = ?
         WHERE group_id = ? AND member_address = ?`,
      )
      .run(unbannedEvent.eventId, group.groupId, targetAddress);
    params.db.raw
      .prepare("UPDATE groups SET updated_at = ? WHERE group_id = ?")
      .run(createdAt, group.groupId);
    insertGroupEvent(params.db, unbannedEvent);
    insertGroupEvent(params.db, noticeEvent);
  });

  const member = listGroupMembers(params.db, group.groupId).find(
    (entry) => entry.memberAddress === targetAddress,
  );
  if (!member) {
    throw new Error(`failed to reload member after unban: ${targetAddress}`);
  }
  return {
    member,
    events: [unbannedEvent, noticeEvent],
  };
}

export async function postGroupMessage(params: {
  db: OpenFoxDatabase;
  account: PrivateKeyAccount;
  input: PostGroupMessageInput;
}): Promise<PostGroupMessageResult> {
  const group = requireGroup(params.db, params.input.groupId);
  ensureGroupWritable(group);
  const actorAddress = normalizeAddressLike(
    params.input.actorAddress ?? params.account.address,
  );
  const member = requirePostableMembership(params.db, group.groupId, actorAddress);
  const channel = resolveGroupChannel({
    db: params.db,
    groupId: group.groupId,
    channelId: params.input.channelId ?? null,
    channelName: params.input.channelName ?? null,
    fallbackName: "general",
  });
  const text = params.input.text.trim();
  if (!text) {
    throw new Error("message text cannot be empty");
  }
  const replyToMessageId = normalizeOptionalText(params.input.replyToMessageId);
  if (replyToMessageId) {
    const parent = requireGroupMessage(params.db, group.groupId, replyToMessageId);
    if (parent.channelId !== channel.channelId) {
      throw new Error("reply target must be in the same channel");
    }
  }
  const createdAt = nowIso();
  const messageId = `gmsg_${ulid()}`;
  const mentions = dedupeStrings((params.input.mentions ?? []).map(normalizeAddressLike));
  const kind = replyToMessageId ? "message.reply.posted" : "message.posted";
  const event = await buildSignedGroupEvent({
    account: params.account,
    groupId: group.groupId,
    kind,
    epoch: group.currentEpoch,
    actorAddress,
    actorAgentId: params.input.actorAgentId,
    channelId: channel.channelId,
    createdAt,
    payload: {
      message_id: messageId,
      channel_id: channel.channelId,
      ciphertext: text,
      plaintext_summary: text.slice(0, 280),
      mentions,
      reply_to: replyToMessageId,
    },
  });

  params.db.runTransaction(() => {
    params.db.raw
      .prepare(
        `INSERT INTO group_messages (
          message_id,
          group_id,
          channel_id,
          original_event_id,
          latest_event_id,
          sender_address,
          sender_agent_id,
          reply_to_message_id,
          ciphertext,
          preview_text,
          mentions_json,
          reaction_summary_json,
          redacted,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '{}', 0, ?, ?)`,
      )
      .run(
        messageId,
        group.groupId,
        channel.channelId,
        event.eventId,
        event.eventId,
        actorAddress,
        normalizeOptionalText(params.input.actorAgentId) ?? member.memberAgentId,
        replyToMessageId,
        text,
        text.slice(0, 280),
        JSON.stringify(mentions),
        createdAt,
        createdAt,
      );
    params.db.raw
      .prepare("UPDATE groups SET updated_at = ? WHERE group_id = ?")
      .run(createdAt, group.groupId);
    insertGroupEvent(params.db, event);
  });

  return {
    message: requireGroupMessage(params.db, group.groupId, messageId),
    event,
  };
}

export async function editGroupMessage(params: {
  db: OpenFoxDatabase;
  account: PrivateKeyAccount;
  input: EditGroupMessageInput;
}): Promise<EditGroupMessageResult> {
  const group = requireGroup(params.db, params.input.groupId);
  ensureGroupWritable(group);
  const actorAddress = normalizeAddressLike(
    params.input.actorAddress ?? params.account.address,
  );
  requirePostableMembership(params.db, group.groupId, actorAddress);
  const message = requireGroupMessage(params.db, group.groupId, params.input.messageId);
  if (message.senderAddress !== actorAddress) {
    throw new Error("only the original sender can edit a group message");
  }
  if (message.redacted) {
    throw new Error("cannot edit a redacted message");
  }
  const text = params.input.text.trim();
  if (!text) {
    throw new Error("message text cannot be empty");
  }
  const mentions = dedupeStrings((params.input.mentions ?? []).map(normalizeAddressLike));
  const createdAt = nowIso();
  const event = await buildSignedGroupEvent({
    account: params.account,
    groupId: group.groupId,
    kind: "message.edited",
    epoch: group.currentEpoch,
    actorAddress,
    actorAgentId: params.input.actorAgentId,
    channelId: message.channelId,
    createdAt,
    parentEventIds: [message.latestEventId],
    payload: {
      message_id: message.messageId,
      ciphertext: text,
      plaintext_summary: text.slice(0, 280),
      mentions,
    },
  });

  params.db.runTransaction(() => {
    params.db.raw
      .prepare(
        `UPDATE group_messages
         SET latest_event_id = ?, ciphertext = ?, preview_text = ?, mentions_json = ?, updated_at = ?
         WHERE group_id = ? AND message_id = ?`,
      )
      .run(
        event.eventId,
        text,
        text.slice(0, 280),
        JSON.stringify(mentions),
        createdAt,
        group.groupId,
        message.messageId,
      );
    params.db.raw
      .prepare("UPDATE groups SET updated_at = ? WHERE group_id = ?")
      .run(createdAt, group.groupId);
    insertGroupEvent(params.db, event);
  });

  return {
    message: requireGroupMessage(params.db, group.groupId, message.messageId),
    event,
  };
}

export async function reactGroupMessage(params: {
  db: OpenFoxDatabase;
  account: PrivateKeyAccount;
  input: ReactGroupMessageInput;
}): Promise<ReactGroupMessageResult> {
  const group = requireGroup(params.db, params.input.groupId);
  ensureGroupWritable(group);
  const actorAddress = normalizeAddressLike(
    params.input.actorAddress ?? params.account.address,
  );
  requirePostableMembership(params.db, group.groupId, actorAddress);
  const message = requireGroupMessage(params.db, group.groupId, params.input.messageId);
  const reactionCode = normalizeOptionalText(params.input.reactionCode)?.toLowerCase();
  if (!reactionCode) {
    throw new Error("reaction code cannot be empty");
  }
  const createdAt = nowIso();
  const event = await buildSignedGroupEvent({
    account: params.account,
    groupId: group.groupId,
    kind: "message.reaction.added",
    epoch: group.currentEpoch,
    actorAddress,
    actorAgentId: params.input.actorAgentId,
    channelId: message.channelId,
    createdAt,
    parentEventIds: [message.latestEventId],
    payload: {
      message_id: message.messageId,
      reaction_code: reactionCode,
    },
  });

  params.db.runTransaction(() => {
    params.db.raw
      .prepare(
        `INSERT OR REPLACE INTO group_message_reactions (
          group_id,
          message_id,
          reactor_address,
          reaction_code,
          event_id,
          created_at
        ) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        group.groupId,
        message.messageId,
        actorAddress,
        reactionCode,
        event.eventId,
        createdAt,
      );
    refreshMessageReactionSummary(params.db, group.groupId, message.messageId);
    params.db.raw
      .prepare("UPDATE groups SET updated_at = ? WHERE group_id = ?")
      .run(createdAt, group.groupId);
    insertGroupEvent(params.db, event);
  });

  return {
    message: requireGroupMessage(params.db, group.groupId, message.messageId),
    event,
  };
}

export async function redactGroupMessage(params: {
  db: OpenFoxDatabase;
  account: PrivateKeyAccount;
  input: RedactGroupMessageInput;
}): Promise<RedactGroupMessageResult> {
  const group = requireGroup(params.db, params.input.groupId);
  ensureGroupWritable(group);
  const actorAddress = normalizeAddressLike(
    params.input.actorAddress ?? params.account.address,
  );
  const message = requireGroupMessage(params.db, group.groupId, params.input.messageId);
  const canAdminRedact = (() => {
    try {
      ensureGroupHasRole(params.db, group.groupId, actorAddress, ["owner", "admin"]);
      return true;
    } catch {
      return false;
    }
  })();
  if (message.senderAddress !== actorAddress && !canAdminRedact) {
    throw new Error("only the sender or an admin can redact a group message");
  }
  const createdAt = nowIso();
  const event = await buildSignedGroupEvent({
    account: params.account,
    groupId: group.groupId,
    kind: "message.redacted",
    epoch: group.currentEpoch,
    actorAddress,
    actorAgentId: params.input.actorAgentId,
    channelId: message.channelId,
    createdAt,
    parentEventIds: [message.latestEventId],
    payload: {
      message_id: message.messageId,
    },
  });

  params.db.runTransaction(() => {
    params.db.raw
      .prepare(
        `UPDATE group_messages
         SET latest_event_id = ?, redacted = 1, preview_text = ?, updated_at = ?
         WHERE group_id = ? AND message_id = ?`,
      )
      .run(
        event.eventId,
        "[redacted]",
        createdAt,
        group.groupId,
        message.messageId,
      );
    params.db.raw
      .prepare("UPDATE groups SET updated_at = ? WHERE group_id = ?")
      .run(createdAt, group.groupId);
    insertGroupEvent(params.db, event);
  });

  return {
    message: requireGroupMessage(params.db, group.groupId, message.messageId),
    event,
  };
}

export async function muteGroupMember(params: {
  db: OpenFoxDatabase;
  account: PrivateKeyAccount;
  input: MuteGroupMemberInput;
}): Promise<MuteGroupMemberResult> {
  const group = requireGroup(params.db, params.input.groupId);
  ensureGroupWritable(group);
  const actorAddress = normalizeAddressLike(
    params.input.actorAddress ?? params.account.address,
  );
  ensureGroupHasRole(params.db, group.groupId, actorAddress, [
    "owner",
    "admin",
    "moderator",
  ]);
  const targetAddress = normalizeAddressLike(params.input.targetAddress);
  if (targetAddress === actorAddress) {
    throw new Error("self-mute is not supported");
  }
  requireActiveMembership(params.db, group.groupId, targetAddress);
  const muteUntil = new Date(params.input.until);
  if (Number.isNaN(muteUntil.getTime()) || muteUntil.getTime() <= Date.now()) {
    throw new Error("mute until must be a future ISO timestamp");
  }
  const createdAt = nowIso();
  const mutedEvent = await buildSignedGroupEvent({
    account: params.account,
    groupId: group.groupId,
    kind: "moderation.member.muted",
    epoch: group.currentEpoch,
    actorAddress,
    actorAgentId: params.input.actorAgentId,
    createdAt,
    payload: {
      target_address: targetAddress,
      reason: normalizeOptionalText(params.input.reason),
      mute_until: muteUntil.toISOString(),
    },
  });
  const noticeEvent = await buildSignedGroupEvent({
    account: params.account,
    groupId: group.groupId,
    kind: "system.notice.posted",
    epoch: group.currentEpoch,
    actorAddress,
    actorAgentId: params.input.actorAgentId,
    createdAt,
    parentEventIds: [mutedEvent.eventId],
    payload: {
      notice_type: "member_muted",
      member_address: targetAddress,
      mute_until: muteUntil.toISOString(),
      reason: normalizeOptionalText(params.input.reason),
    },
  });

  params.db.runTransaction(() => {
    params.db.raw
      .prepare(
        `UPDATE group_members
         SET mute_until = ?, last_event_id = ?
         WHERE group_id = ? AND member_address = ?`,
      )
      .run(muteUntil.toISOString(), mutedEvent.eventId, group.groupId, targetAddress);
    params.db.raw
      .prepare("UPDATE groups SET updated_at = ? WHERE group_id = ?")
      .run(createdAt, group.groupId);
    insertGroupEvent(params.db, mutedEvent);
    insertGroupEvent(params.db, noticeEvent);
  });

  return {
    member: requireActiveMembership(params.db, group.groupId, targetAddress),
    events: [mutedEvent, noticeEvent],
  };
}

export async function unmuteGroupMember(params: {
  db: OpenFoxDatabase;
  account: PrivateKeyAccount;
  input: UnmuteGroupMemberInput;
}): Promise<UnmuteGroupMemberResult> {
  const group = requireGroup(params.db, params.input.groupId);
  ensureGroupWritable(group);
  const actorAddress = normalizeAddressLike(
    params.input.actorAddress ?? params.account.address,
  );
  ensureGroupHasRole(params.db, group.groupId, actorAddress, [
    "owner",
    "admin",
    "moderator",
  ]);
  const targetAddress = normalizeAddressLike(params.input.targetAddress);
  requireActiveMembership(params.db, group.groupId, targetAddress);
  const createdAt = nowIso();
  const unmutedEvent = await buildSignedGroupEvent({
    account: params.account,
    groupId: group.groupId,
    kind: "moderation.member.unmuted",
    epoch: group.currentEpoch,
    actorAddress,
    actorAgentId: params.input.actorAgentId,
    createdAt,
    payload: {
      target_address: targetAddress,
    },
  });
  const noticeEvent = await buildSignedGroupEvent({
    account: params.account,
    groupId: group.groupId,
    kind: "system.notice.posted",
    epoch: group.currentEpoch,
    actorAddress,
    actorAgentId: params.input.actorAgentId,
    createdAt,
    parentEventIds: [unmutedEvent.eventId],
    payload: {
      notice_type: "member_unmuted",
      member_address: targetAddress,
    },
  });

  params.db.runTransaction(() => {
    params.db.raw
      .prepare(
        `UPDATE group_members
         SET mute_until = NULL, last_event_id = ?
         WHERE group_id = ? AND member_address = ?`,
      )
      .run(unmutedEvent.eventId, group.groupId, targetAddress);
    params.db.raw
      .prepare("UPDATE groups SET updated_at = ? WHERE group_id = ?")
      .run(createdAt, group.groupId);
    insertGroupEvent(params.db, unmutedEvent);
    insertGroupEvent(params.db, noticeEvent);
  });

  return {
    member: requireActiveMembership(params.db, group.groupId, targetAddress),
    events: [unmutedEvent, noticeEvent],
  };
}
