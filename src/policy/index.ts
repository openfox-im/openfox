/**
 * Policy Module
 *
 * Barrel export for policy authoring, simulation, and templates.
 */

export {
  createPolicyFromTemplate,
  validatePolicy,
  explainPolicy,
  diffPolicies,
  type PolicyDraft,
  type TerminalPolicyConfig,
} from "./authoring.js";

export {
  simulateScenario,
  simulateBattery,
  formatSimulationResults,
  type SimulationScenario,
  type SimulationResult,
} from "./simulation.js";

export {
  POLICY_TEMPLATES,
  getTemplatesForAccountType,
  getTemplate,
  type PolicyTemplate,
} from "./templates.js";
