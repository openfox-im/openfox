/**
 * Intent Module - Barrel Export
 *
 * GTOS 2046 Phase 0+1: Intent lifecycle, boundary types, and persistence.
 */

export * from "./types.js";
export * from "./intent.js";
export * from "./plan.js";
export * from "./approval.js";
export * from "./receipt.js";
export { createIntentStore, type IntentStore, type IntentListFilter } from "./store.js";
export * from "./explain.js";
export * from "./policy-presets.js";
export * from "./escalation.js";
export * from "./bridge.js";
export * from "./envelope-emitter.js";
export * from "./metadata-consumer.js";
export * from "./metadata-loader.js";
