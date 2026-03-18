/**
 * Plan Lifecycle State Machine
 *
 * Creates and manages PlanRecord transitions for intent execution plans.
 */

import { ulid } from "ulid";
import { BOUNDARY_SCHEMA_VERSION, type PlanRecord, type PlanStatus } from "./types.js";

const VALID_PLAN_TRANSITIONS: Record<PlanStatus, PlanStatus[]> = {
  draft: ["ready", "expired"],
  ready: ["approved", "expired"],
  approved: ["executing", "expired"],
  executing: ["completed", "failed"],
  completed: [],
  failed: [],
  expired: [],
};

export function createPlan(params: {
  intentId: string;
  provider: string;
  sponsor?: string;
  artifactRef?: string;
  abiRef?: string;
  policyHash: string;
  sponsorPolicyHash?: string;
  effectsHash?: string;
  estimatedGas: number;
  estimatedValue: string;
  route?: PlanRecord["route"];
  ttlSeconds?: number;
}): PlanRecord {
  const now = Math.floor(Date.now() / 1000);
  return {
    planId: ulid(),
    intentId: params.intentId,
    schemaVersion: BOUNDARY_SCHEMA_VERSION,
    provider: params.provider,
    sponsor: params.sponsor,
    artifactRef: params.artifactRef,
    abiRef: params.abiRef,
    policyHash: params.policyHash,
    sponsorPolicyHash: params.sponsorPolicyHash,
    effectsHash: params.effectsHash,
    estimatedGas: params.estimatedGas,
    estimatedValue: params.estimatedValue,
    route: params.route,
    createdAt: now,
    expiresAt: now + (params.ttlSeconds ?? 120),
    status: "draft",
  };
}

export function transitionPlan(plan: PlanRecord, newStatus: PlanStatus): PlanRecord {
  const allowed = VALID_PLAN_TRANSITIONS[plan.status];
  if (!allowed || !allowed.includes(newStatus)) {
    throw new Error(`Invalid plan transition: ${plan.status} → ${newStatus}`);
  }
  return { ...plan, status: newStatus };
}

export function isPlanExpired(plan: PlanRecord): boolean {
  return Math.floor(Date.now() / 1000) > plan.expiresAt;
}
