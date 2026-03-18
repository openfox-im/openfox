/**
 * Pipeline Module - Barrel Export
 *
 * GTOS 2046: End-to-end intent execution pipeline.
 */

export { IntentPipeline } from "./executor.js";
export type { ExecuteParams, ChainExecutor } from "./executor.js";
export type { PipelineConfig, PipelineResult, PipelineStep } from "./types.js";
export { createPipeline, createTerminalRegistry, createAuditJournal, createLivePipeline, createSponsoredPipeline } from "./factory.js";
export type { CreatePipelineOptions } from "./factory.js";
export { RPCChainExecutor } from "./chain-executor.js";
export type { ChainExecutorConfig } from "./chain-executor.js";
export { SponsoredChainExecutor } from "./sponsored-executor.js";
export type { SponsorConfig } from "./sponsored-executor.js";
