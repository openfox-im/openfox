import {
  getGroup,
  listGroupJoinRequests,
  listGroupMembers,
  listGroupProposals,
  type GroupJoinRequestRecord,
  type GroupProposalRecord,
} from "../group/store.js";
import type { OpenFoxDatabase } from "../types.js";
import {
  escapeHtml,
  renderMetaWorldPageFrame,
} from "./render.js";

export interface GroupGovernanceSnapshot {
  generatedAt: string;
  groupId: string;
  groupName: string;
  summary: string;
  openProposals: GroupProposalRecord[];
  recentProposals: GroupProposalRecord[];
  openJoinRequests: GroupJoinRequestRecord[];
  recentJoinRequests: GroupJoinRequestRecord[];
  counts: {
    openProposalCount: number;
    openJoinRequestCount: number;
    inviteProposalCount: number;
    membershipRemoveProposalCount: number;
    roleProposalCount: number;
    policyUpdateProposalCount: number;
  };
}

function countByProposalKind(
  proposals: GroupProposalRecord[],
): GroupGovernanceSnapshot["counts"] {
  let inviteProposalCount = 0;
  let membershipRemoveProposalCount = 0;
  let roleProposalCount = 0;
  let policyUpdateProposalCount = 0;

  for (const proposal of proposals) {
    if (proposal.proposalKind === "invite") {
      inviteProposalCount += 1;
      continue;
    }
    if (proposal.proposalKind === "membership_remove") {
      membershipRemoveProposalCount += 1;
      continue;
    }
    if (
      proposal.proposalKind === "role_grant" ||
      proposal.proposalKind === "role_revoke"
    ) {
      roleProposalCount += 1;
      continue;
    }
    if (proposal.proposalKind === "policy_update") {
      policyUpdateProposalCount += 1;
    }
  }

  return {
    openProposalCount: proposals.length,
    openJoinRequestCount: 0,
    inviteProposalCount,
    membershipRemoveProposalCount,
    roleProposalCount,
    policyUpdateProposalCount,
  };
}

export function buildGroupGovernanceSnapshot(
  db: OpenFoxDatabase,
  options: {
    groupId: string;
    proposalLimit?: number;
    joinRequestLimit?: number;
  },
): GroupGovernanceSnapshot {
  const group = getGroup(db, options.groupId);
  if (!group) {
    throw new Error(`group not found: ${options.groupId}`);
  }
  const proposalLimit = Math.max(1, options.proposalLimit ?? 20);
  const joinRequestLimit = Math.max(1, options.joinRequestLimit ?? 20);
  const openProposals = listGroupProposals(db, options.groupId, {
    status: "open",
    limit: proposalLimit,
  });
  const recentProposals = listGroupProposals(db, options.groupId, {
    limit: proposalLimit,
  });
  const openJoinRequests = listGroupJoinRequests(db, options.groupId, {
    status: "open",
    limit: joinRequestLimit,
  });
  const recentJoinRequests = listGroupJoinRequests(db, options.groupId, {
    limit: joinRequestLimit,
  });

  const counts = countByProposalKind(openProposals);
  counts.openJoinRequestCount = openJoinRequests.length;
  const activeMemberCount = listGroupMembers(db, options.groupId).filter(
    (member) => member.membershipState === "active",
  ).length;

  return {
    generatedAt: new Date().toISOString(),
    groupId: options.groupId,
    groupName: group.name,
    summary: `${counts.openProposalCount} open proposal(s), ${counts.openJoinRequestCount} open join request(s), ${activeMemberCount} active member(s).`,
    openProposals,
    recentProposals,
    openJoinRequests,
    recentJoinRequests,
    counts,
  };
}

export function buildGroupGovernanceHtml(
  snapshot: GroupGovernanceSnapshot,
  options?: {
    homeHref?: string;
    groupPageHref?: string;
    foxDirectoryHref?: string;
    groupDirectoryHref?: string;
    searchHref?: string;
  },
): string {
  const proposalItems = snapshot.openProposals
    .slice(0, 12)
    .map((proposal) => {
      const target =
        proposal.targetAgentId ||
        proposal.targetTnsName ||
        proposal.targetAddress ||
        "group policy";
      return `<li><strong>${escapeHtml(proposal.proposalKind)}</strong><span>${escapeHtml(target)} · approvals ${proposal.approvalCount}/${proposal.requiredApprovals}</span></li>`;
    })
    .join("");
  const joinRequestItems = snapshot.openJoinRequests
    .slice(0, 12)
    .map((request) => {
      const applicant =
        request.applicantAgentId ||
        request.applicantTnsName ||
        request.applicantAddress;
      const roles = request.requestedRoles.join(", ") || "member";
      return `<li><strong>${escapeHtml(applicant)}</strong><span>${escapeHtml(roles)} · approvals ${request.approvalCount}/${request.requiredApprovals}</span></li>`;
    })
    .join("");

  return renderMetaWorldPageFrame({
    title: `Governance · ${snapshot.groupName} · OpenFox metaWorld`,
    eyebrow: "OpenFox Group Governance",
    heading: snapshot.groupName,
    lede: snapshot.summary,
    generatedAt: snapshot.generatedAt,
    metrics: [
      { label: "Open proposals", value: snapshot.counts.openProposalCount },
      { label: "Open join requests", value: snapshot.counts.openJoinRequestCount },
      { label: "Invite proposals", value: snapshot.counts.inviteProposalCount },
      { label: "Role proposals", value: snapshot.counts.roleProposalCount },
    ],
    navLinks: [
      { label: "World Shell", href: options?.homeHref ?? "/" },
      { label: "Group Page", href: options?.groupPageHref ?? "#" },
      { label: "Fox Directory", href: options?.foxDirectoryHref ?? "/directory/foxes" },
      { label: "Group Directory", href: options?.groupDirectoryHref ?? "/directory/groups" },
      { label: "Search", href: options?.searchHref ?? "/search" },
    ],
    sections: [
      `<section class="grid">
        <section class="panel">
          <div class="section-head">
            <h3>Open Proposals</h3>
            <span>${snapshot.openProposals.length}</span>
          </div>
          <ul class="directory-list">${proposalItems || '<li class="empty">No open proposals.</li>'}</ul>
        </section>
        <section class="panel">
          <div class="section-head">
            <h3>Open Join Requests</h3>
            <span>${snapshot.openJoinRequests.length}</span>
          </div>
          <ul class="directory-list">${joinRequestItems || '<li class="empty">No open join requests.</li>'}</ul>
        </section>
      </section>`,
    ],
  });
}
