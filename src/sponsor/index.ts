/**
 * Sponsor Module - Barrel Export
 *
 * GTOS 2046 Phase 5: Gasless Default and Sponsor Convergence.
 */

export * from "./types.js";
export { discoverSponsors, selectSponsor, type SponsorDiscoveryOptions } from "./discovery.js";
export { createSponsorAttributionStore, type SponsorAttributionStore } from "./attribution.js";
