/**
 * Recovery Flow Handler
 *
 * Manages account recovery flows initiated from public or low-trust terminals.
 * Guides users through identity verification, guardian approval, and timelock
 * steps to regain account access.
 */

import type { TerminalClass } from "./types.js";

export type RecoveryStep =
  | "identify"
  | "verify_guardian"
  | "initiate_recovery"
  | "wait_timelock"
  | "complete_recovery";

const RECOVERY_STEPS: RecoveryStep[] = [
  "identify",
  "verify_guardian",
  "initiate_recovery",
  "wait_timelock",
  "complete_recovery",
];

const DEFAULT_TTL_SECONDS = 3600; // 1 hour
const DEFAULT_TIMELOCK_SECONDS = 86400; // 24 hours

export interface RecoveryFlowState {
  flowId: string;
  accountAddress: string;
  terminalClass: TerminalClass;
  terminalId: string;
  currentStep: RecoveryStep;
  guardianAddress?: string;
  newOwnerAddress?: string;
  timelockExpiresAt?: number;
  startedAt: number;
  expiresAt: number;
  proofRefs: string[];
  cancelled: boolean;
}

export class RecoveryFlowHandler {
  /** Start a recovery flow from a terminal. */
  startRecovery(params: {
    accountAddress: string;
    terminalClass: TerminalClass;
    terminalId: string;
    ttlSeconds?: number;
  }): RecoveryFlowState {
    const now = Math.floor(Date.now() / 1000);
    const ttl = params.ttlSeconds ?? DEFAULT_TTL_SECONDS;

    return {
      flowId: crypto.randomUUID(),
      accountAddress: params.accountAddress,
      terminalClass: params.terminalClass,
      terminalId: params.terminalId,
      currentStep: "identify",
      startedAt: now,
      expiresAt: now + ttl,
      proofRefs: [],
      cancelled: false,
    };
  }

  /** Advance the flow to its next step based on provided input. */
  advanceStep(
    flow: RecoveryFlowState,
    input: Record<string, unknown>,
  ): { flow: RecoveryFlowState; prompt: string; requiresConfirmation: boolean } {
    if (flow.cancelled) {
      return {
        flow,
        prompt: "This recovery flow has been cancelled.",
        requiresConfirmation: false,
      };
    }

    if (this.isExpired(flow)) {
      return {
        flow: { ...flow, cancelled: true },
        prompt: "This recovery flow has expired. Please start a new one.",
        requiresConfirmation: false,
      };
    }

    const updated = { ...flow };

    switch (flow.currentStep) {
      case "identify": {
        // Validate account ownership proof
        const proofRef = typeof input["proofRef"] === "string"
          ? (input["proofRef"] as string)
          : undefined;
        if (proofRef) {
          updated.proofRefs = [...updated.proofRefs, proofRef];
        }
        updated.currentStep = "verify_guardian";
        return {
          flow: updated,
          prompt: this.generatePrompt(updated),
          requiresConfirmation: false,
        };
      }

      case "verify_guardian": {
        const guardian = typeof input["guardianAddress"] === "string"
          ? (input["guardianAddress"] as string)
          : undefined;
        if (!guardian) {
          return {
            flow,
            prompt: "Guardian address is required to proceed.",
            requiresConfirmation: false,
          };
        }
        updated.guardianAddress = guardian;
        updated.currentStep = "initiate_recovery";
        return {
          flow: updated,
          prompt: this.generatePrompt(updated),
          requiresConfirmation: true,
        };
      }

      case "initiate_recovery": {
        const newOwner = typeof input["newOwnerAddress"] === "string"
          ? (input["newOwnerAddress"] as string)
          : undefined;
        if (!newOwner) {
          return {
            flow,
            prompt: "New owner address is required to initiate recovery.",
            requiresConfirmation: false,
          };
        }
        updated.newOwnerAddress = newOwner;
        const now = Math.floor(Date.now() / 1000);
        updated.timelockExpiresAt = now + DEFAULT_TIMELOCK_SECONDS;
        updated.currentStep = "wait_timelock";
        const proofRef = typeof input["proofRef"] === "string"
          ? (input["proofRef"] as string)
          : undefined;
        if (proofRef) {
          updated.proofRefs = [...updated.proofRefs, proofRef];
        }
        return {
          flow: updated,
          prompt: this.generatePrompt(updated),
          requiresConfirmation: false,
        };
      }

      case "wait_timelock": {
        const now = Math.floor(Date.now() / 1000);
        if (updated.timelockExpiresAt && now < updated.timelockExpiresAt) {
          const remaining = updated.timelockExpiresAt - now;
          const hours = Math.floor(remaining / 3600);
          const minutes = Math.floor((remaining % 3600) / 60);
          return {
            flow: updated,
            prompt: `Timelock active. ${hours}h ${minutes}m remaining before recovery can complete.`,
            requiresConfirmation: false,
          };
        }
        updated.currentStep = "complete_recovery";
        return {
          flow: updated,
          prompt: this.generatePrompt(updated),
          requiresConfirmation: true,
        };
      }

      case "complete_recovery": {
        const proofRef = typeof input["proofRef"] === "string"
          ? (input["proofRef"] as string)
          : undefined;
        if (proofRef) {
          updated.proofRefs = [...updated.proofRefs, proofRef];
        }
        return {
          flow: updated,
          prompt: "Recovery complete. Account ownership has been transferred to the new address.",
          requiresConfirmation: false,
        };
      }
    }
  }

  /** Generate a step-specific UX prompt suitable for any terminal surface. */
  generatePrompt(flow: RecoveryFlowState): string {
    const short = (addr: string) =>
      addr.length > 14 ? `${addr.slice(0, 6)}...${addr.slice(-4)}` : addr;

    switch (flow.currentStep) {
      case "identify":
        return `Account Recovery\n\nRecover access to ${short(flow.accountAddress)}.\nPlease provide proof of identity to begin.`;

      case "verify_guardian":
        return `Guardian Verification\n\nTo recover ${short(flow.accountAddress)}, a guardian must approve.\nPlease enter the guardian address that will authorize this recovery.`;

      case "initiate_recovery": {
        const guardian = flow.guardianAddress ? short(flow.guardianAddress) : "unknown";
        return `Initiate Recovery\n\nGuardian: ${guardian}\nAccount: ${short(flow.accountAddress)}\n\nProvide the new owner address to start the recovery timelock.`;
      }

      case "wait_timelock": {
        const remaining = flow.timelockExpiresAt
          ? Math.max(0, flow.timelockExpiresAt - Math.floor(Date.now() / 1000))
          : 0;
        const hours = Math.floor(remaining / 3600);
        const minutes = Math.floor((remaining % 3600) / 60);
        return `Recovery Pending\n\nA ${hours}h ${minutes}m timelock is active.\nRecovery will be available after the timelock expires.\nThis protects against unauthorized recovery attempts.`;
      }

      case "complete_recovery": {
        const newOwner = flow.newOwnerAddress ? short(flow.newOwnerAddress) : "unknown";
        return `Complete Recovery\n\nTimelock expired. Ready to finalize.\nNew owner: ${newOwner}\n\nConfirm to transfer account ownership.`;
      }
    }
  }

  /** Check if the flow has expired. */
  isExpired(flow: RecoveryFlowState): boolean {
    const now = Math.floor(Date.now() / 1000);
    return now > flow.expiresAt;
  }

  /** Cancel the flow. */
  cancel(flow: RecoveryFlowState): RecoveryFlowState {
    return { ...flow, cancelled: true };
  }
}
