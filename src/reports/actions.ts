import { ulid } from "ulid";
import type {
  OpenFoxDatabase,
  OperatorApprovalRequestRecord,
  OwnerOpportunityActionKind,
  OwnerOpportunityActionRecord,
} from "../types.js";

function isActionKind(value: unknown): value is OwnerOpportunityActionKind {
  return value === "review" || value === "pursue" || value === "delegate";
}

function getActionPayloadRecord(
  request: OperatorApprovalRequestRecord,
): Record<string, unknown> {
  if (
    request.payload &&
    typeof request.payload === "object" &&
    !Array.isArray(request.payload)
  ) {
    return request.payload as Record<string, unknown>;
  }
  return {};
}

export function materializeApprovedOwnerOpportunityAction(params: {
  db: OpenFoxDatabase;
  requestId: string;
}): OwnerOpportunityActionRecord {
  const request = params.db.getOperatorApprovalRequest(params.requestId);
  if (!request) {
    throw new Error(`approval request not found: ${params.requestId}`);
  }
  if (request.kind !== "opportunity_action") {
    throw new Error(
      `approval request is not an opportunity action: ${params.requestId}`,
    );
  }
  if (request.status !== "approved") {
    throw new Error(
      `approval request is not approved: ${params.requestId} (${request.status})`,
    );
  }
  const existing = params.db.getOwnerOpportunityActionByRequestId(request.requestId);
  if (existing) {
    return existing;
  }

  const payload = getActionPayloadRecord(request);
  const alertId =
    typeof payload.alertId === "string" && payload.alertId.trim()
      ? payload.alertId.trim()
      : "";
  if (!alertId) {
    throw new Error(
      `approved opportunity action is missing alertId: ${params.requestId}`,
    );
  }

  const alert = params.db.getOwnerOpportunityAlert(alertId);
  const kind = isActionKind(payload.actionKind)
    ? payload.actionKind
    : alert?.actionKind && isActionKind(alert.actionKind)
      ? alert.actionKind
      : "review";
  const nowIso = new Date().toISOString();
  const record: OwnerOpportunityActionRecord = {
    actionId: `owner-action:${ulid()}`,
    alertId,
    requestId: request.requestId,
    kind,
    title:
      (typeof payload.title === "string" && payload.title.trim()) ||
      alert?.title ||
      `Owner action for ${alertId}`,
    summary:
      (typeof payload.summary === "string" && payload.summary.trim()) ||
      alert?.summary ||
      request.reason ||
      `Approved ${kind} action`,
    capability:
      typeof payload.capability === "string" && payload.capability.trim()
        ? payload.capability.trim()
        : alert?.capability ?? null,
    baseUrl:
      typeof payload.baseUrl === "string" && payload.baseUrl.trim()
        ? payload.baseUrl.trim()
        : alert?.baseUrl ?? null,
    requestedBy: request.requestedBy,
    approvedBy: request.decidedBy ?? null,
    approvedAt: request.decidedAt ?? null,
    decisionNote: request.decisionNote ?? null,
    payload,
    status: "queued",
    queuedAt: request.decidedAt || nowIso,
    createdAt: nowIso,
    updatedAt: nowIso,
    completedAt: null,
    cancelledAt: null,
  };
  params.db.upsertOwnerOpportunityAction(record);
  return params.db.getOwnerOpportunityAction(record.actionId) ?? record;
}

export function syncApprovedOwnerOpportunityActions(params: {
  db: OpenFoxDatabase;
  limit?: number;
}): { created: number; items: OwnerOpportunityActionRecord[] } {
  const limit = params.limit ?? 100;
  const approvals = params.db.listOperatorApprovalRequests(limit, {
    kind: "opportunity_action",
    status: "approved",
  });
  const items: OwnerOpportunityActionRecord[] = [];
  for (const request of approvals) {
    const existing = params.db.getOwnerOpportunityActionByRequestId(request.requestId);
    if (existing) continue;
    items.push(
      materializeApprovedOwnerOpportunityAction({
        db: params.db,
        requestId: request.requestId,
      }),
    );
  }
  return { created: items.length, items };
}
