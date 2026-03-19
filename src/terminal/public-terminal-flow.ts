/**
 * Public Terminal Flow Handler
 *
 * Manages UX flows for public terminal (kiosk) interactions with step-up
 * authentication. Designed for short-lived, low-trust sessions with large-font
 * friendly display output.
 */

export type PublicTerminalStep =
  | "tap_identify"
  | "verify_identity"
  | "select_action"
  | "confirm_action"
  | "step_up_auth"
  | "execute"
  | "show_receipt";

export type StepUpMethod = "guardian_approval" | "biometric" | "secondary_device";

const DEFAULT_TTL_SECONDS = 120; // 2 minutes for public terminals
const STEP_UP_VALUE_THRESHOLD = "10000000000000000000"; // 10 TOS
const STEP_UP_ACTIONS = new Set(["stake", "delegate", "withdraw", "swap"]);

export interface PublicTerminalFlowState {
  flowId: string;
  step: PublicTerminalStep;
  terminalId: string;
  accountAddress?: string;
  selectedAction?: string;
  requiresStepUp: boolean;
  stepUpMethod?: StepUpMethod;
  maxValue: string;
  startedAt: number;
  expiresAt: number;
}

export class PublicTerminalFlowHandler {
  /** Start a public terminal interaction. */
  startFlow(terminalId: string, ttlSeconds?: number): PublicTerminalFlowState {
    const now = Math.floor(Date.now() / 1000);
    const ttl = ttlSeconds ?? DEFAULT_TTL_SECONDS;

    return {
      flowId: crypto.randomUUID(),
      step: "tap_identify",
      terminalId,
      requiresStepUp: false,
      maxValue: "50000000000000000000", // 50 TOS, matching kiosk adapter
      startedAt: now,
      expiresAt: now + ttl,
    };
  }

  /** Process the current step and advance the flow. */
  processStep(
    flow: PublicTerminalFlowState,
    input: Record<string, unknown>,
  ): { flow: PublicTerminalFlowState; prompt: string; options?: string[] } {
    if (this.timeRemaining(flow) <= 0) {
      return {
        flow: { ...flow, step: "show_receipt" },
        prompt: "Session expired. Please tap again to start over.",
      };
    }

    const updated = { ...flow };

    switch (flow.step) {
      case "tap_identify": {
        const address = typeof input["accountAddress"] === "string"
          ? (input["accountAddress"] as string)
          : undefined;
        if (!address) {
          return { flow, prompt: "Tap your card or scan to identify." };
        }
        updated.accountAddress = address;
        updated.step = "verify_identity";
        return {
          flow: updated,
          prompt: "Verifying identity...",
        };
      }

      case "verify_identity": {
        const verified = input["verified"] === true;
        if (!verified) {
          return {
            flow: { ...flow, step: "tap_identify" },
            prompt: "Verification failed. Please try again.",
          };
        }
        updated.step = "select_action";
        return {
          flow: updated,
          prompt: "What would you like to do?",
          options: ["transfer", "check_balance", "receive"],
        };
      }

      case "select_action": {
        const action = typeof input["action"] === "string"
          ? (input["action"] as string)
          : undefined;
        if (!action) {
          return {
            flow,
            prompt: "Please select an action.",
            options: ["transfer", "check_balance", "receive"],
          };
        }
        updated.selectedAction = action;
        const value = typeof input["value"] === "string"
          ? (input["value"] as string)
          : "0";
        const stepUp = this.evaluateStepUp(updated, action, value);
        updated.requiresStepUp = stepUp.required;
        if (stepUp.required) {
          updated.stepUpMethod = stepUp.method as StepUpMethod;
        }
        updated.step = "confirm_action";
        return {
          flow: updated,
          prompt: `Confirm: ${action}${value !== "0" ? ` for ${value} tomi` : ""}?`,
          options: ["confirm", "cancel"],
        };
      }

      case "confirm_action": {
        const confirmed = input["confirmed"] === true;
        if (!confirmed) {
          updated.step = "select_action";
          return {
            flow: updated,
            prompt: "Action cancelled. Select a new action.",
            options: ["transfer", "check_balance", "receive"],
          };
        }
        if (updated.requiresStepUp) {
          updated.step = "step_up_auth";
          return {
            flow: updated,
            prompt: `Additional verification required: ${updated.stepUpMethod ?? "guardian_approval"}.`,
          };
        }
        updated.step = "execute";
        return {
          flow: updated,
          prompt: "Processing...",
        };
      }

      case "step_up_auth": {
        const passed = input["stepUpPassed"] === true;
        if (!passed) {
          return {
            flow: { ...flow, step: "show_receipt" },
            prompt: "Step-up authentication failed. Session ended.",
          };
        }
        updated.step = "execute";
        return {
          flow: updated,
          prompt: "Authentication successful. Processing...",
        };
      }

      case "execute": {
        const success = input["success"] !== false;
        const txHash = typeof input["txHash"] === "string"
          ? (input["txHash"] as string)
          : undefined;
        updated.step = "show_receipt";
        if (success) {
          const short = txHash && txHash.length > 14
            ? `${txHash.slice(0, 6)}...${txHash.slice(-4)}`
            : txHash ?? "";
          return {
            flow: updated,
            prompt: `Done! ${updated.selectedAction ?? "Action"} complete.${short ? ` Tx: ${short}` : ""}`,
          };
        }
        return {
          flow: updated,
          prompt: "Transaction failed. Please try again at another terminal.",
        };
      }

      case "show_receipt": {
        return {
          flow,
          prompt: "Session complete. Please remove your card.",
        };
      }
    }
  }

  /** Determine if step-up authentication is needed for the given action and value. */
  evaluateStepUp(
    flow: PublicTerminalFlowState,
    action: string,
    value: string,
  ): { required: boolean; method: string; reason: string } {
    // High-value transactions always require step-up
    if (value && BigInt(value || "0") > BigInt(STEP_UP_VALUE_THRESHOLD)) {
      return {
        required: true,
        method: "secondary_device",
        reason: `Value exceeds public terminal threshold`,
      };
    }

    // Sensitive actions require step-up regardless of value
    if (STEP_UP_ACTIONS.has(action)) {
      return {
        required: true,
        method: "guardian_approval",
        reason: `Action "${action}" requires additional verification on public terminals`,
      };
    }

    // Value at or above max also requires step-up
    if (value && BigInt(value || "0") > BigInt(flow.maxValue)) {
      return {
        required: true,
        method: "guardian_approval",
        reason: "Value exceeds terminal maximum",
      };
    }

    return {
      required: false,
      method: "none",
      reason: "No step-up required",
    };
  }

  /** Generate terminal-appropriate display text (short, large font friendly). */
  formatDisplay(flow: PublicTerminalFlowState): {
    title: string;
    body: string;
    actions: string[];
  } {
    const short = (addr: string) =>
      addr.length > 14 ? `${addr.slice(0, 6)}...${addr.slice(-4)}` : addr;

    switch (flow.step) {
      case "tap_identify":
        return {
          title: "Welcome",
          body: "Tap card or scan to begin",
          actions: [],
        };

      case "verify_identity":
        return {
          title: "Verifying",
          body: flow.accountAddress ? `Account: ${short(flow.accountAddress)}` : "Please wait...",
          actions: [],
        };

      case "select_action":
        return {
          title: "Select Action",
          body: flow.accountAddress ? `Account: ${short(flow.accountAddress)}` : "",
          actions: ["Transfer", "Check Balance", "Receive"],
        };

      case "confirm_action":
        return {
          title: "Confirm",
          body: `Action: ${flow.selectedAction ?? "unknown"}`,
          actions: ["Confirm", "Cancel"],
        };

      case "step_up_auth":
        return {
          title: "Verify",
          body: `Additional auth: ${flow.stepUpMethod ?? "required"}`,
          actions: [],
        };

      case "execute":
        return {
          title: "Processing",
          body: "Please wait...",
          actions: [],
        };

      case "show_receipt":
        return {
          title: "Complete",
          body: "Remove your card",
          actions: [],
        };
    }
  }

  /** Time remaining in seconds before auto-cancel. */
  timeRemaining(flow: PublicTerminalFlowState): number {
    const now = Math.floor(Date.now() / 1000);
    return Math.max(0, flow.expiresAt - now);
  }
}
