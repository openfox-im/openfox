# Registry Subsystem Implementation Plan

## Executive Summary

The Registry subsystem is a **CRITICAL BLOCKER** preventing agent discovery and marketplace coordination from functioning. The directory exists at `/src/registry/` but contains zero files and zero lines of code, despite being referenced in 5+ core modules.

**Status**: EMPTY (0 files, 0 LOC)
**Priority**: CRITICAL
**Estimated Effort**: 4-6 hours
**Estimated Cost**: $8-12 (at $2/hour billing)
**Budget Available**: $25.00
**Success Criteria**: All 119 tests pass + Registry fully integrated and tested

---

## Problem Statement

### Current Situation
1. **Empty Directory**: `/src/registry/` exists but has no implementation
2. **Unmet Dependencies**: Referenced in:
   - `src/heartbeat/tasks.ts` - expects registry.update() calls
   - `src/index.ts` - expects registry initialization
   - `src/state/schema.ts` - references registry schema definitions
   - `src/state/database.ts` - expects registry storage functions
   - `src/orchestration/planner.ts` - expects registry queries for capability discovery

3. **Missing Functionality**:
   - No provider registration mechanism
   - No capability discovery/search
   - No health status tracking
   - No provider metadata storage
   - No integration with heartbeat health checks

### Impact
Without Registry, the system cannot:
- Discover available agents/providers
- Track provider capabilities and pricing
- Coordinate marketplace transactions
- Monitor provider health status
- Route work to optimal providers

---

## Architecture & Design

### Data Model

#### Provider Entity
```typescript
interface ProviderRegistration {
  providerId: string;              // unique identifier
  name: string;                     // display name
  description: string;              // what provider does
  contact: string;                  // contact info
  capabilities: Capability[];       // what this provider can do
  pricingModel: PricingModel;      // cost structure
  healthStatus: HealthStatus;       // online/offline/degraded
  reputation: number;               // 0-100 score
  lastSeen: string;                 // ISO timestamp
  createdAt: string;                // ISO timestamp
  updatedAt: string;                // ISO timestamp
}

interface Capability {
  name: string;                     // e.g., "sentiment-analysis"
  version: string;                  // capability version
  tier: string;                     // "cheap", "fast", "reasoning"
  maxInputSize: number;             // bytes
  maxOutputSize: number;            // bytes
  costPerCall: number;              // hundredths of cents
  responseTimeMs: number;           // SLA
  availabilityPercent: number;      // 0-100
}

type HealthStatus = "online" | "offline" | "degraded" | "quarantined";

interface PricingModel {
  baseFeeCents: number;             // fixed cost per transaction
  perTokenInputCent: number;        // hundredths of cents per input unit
  perTokenOutputCent: number;       // hundredths of cents per output unit
  volumeDiscounts: VolumeDiscount[]; // tiered pricing
}

interface VolumeDiscount {
  minTransactions: number;
  discountPercent: number;
}
```

### Database Schema

New tables to be added to existing SQLite database:

```sql
CREATE TABLE IF NOT EXISTS provider_registrations (
  provider_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  contact TEXT,
  pricing_model TEXT NOT NULL,  -- JSON
  reputation INTEGER DEFAULT 50,
  health_status TEXT NOT NULL CHECK(health_status IN ('online','offline','degraded','quarantined')) DEFAULT 'online',
  last_seen TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS provider_capabilities (
  id TEXT PRIMARY KEY,
  provider_id TEXT NOT NULL,
  capability_name TEXT NOT NULL,
  version TEXT NOT NULL,
  tier TEXT NOT NULL,
  max_input_size INTEGER,
  max_output_size INTEGER,
  cost_per_call INTEGER,
  response_time_ms INTEGER,
  availability_percent INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (provider_id) REFERENCES provider_registrations(provider_id),
  UNIQUE(provider_id, capability_name, version)
);

CREATE TABLE IF NOT EXISTS provider_health_checks (
  id TEXT PRIMARY KEY,
  provider_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('healthy','unhealthy','timeout')),
  response_time_ms INTEGER,
  error_message TEXT,
  check_timestamp TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (provider_id) REFERENCES provider_registrations(provider_id)
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_provider_registrations_health
  ON provider_registrations(health_status);
CREATE INDEX IF NOT EXISTS idx_provider_registrations_updated
  ON provider_registrations(updated_at);
CREATE INDEX IF NOT EXISTS idx_provider_capabilities_name
  ON provider_capabilities(capability_name);
CREATE INDEX IF NOT EXISTS idx_provider_capabilities_tier
  ON provider_capabilities(tier);
CREATE INDEX IF NOT EXISTS idx_provider_health_checks_provider
  ON provider_health_checks(provider_id, check_timestamp DESC);
```

---

## Implementation Roadmap

### Phase 1: Database & Types (1-1.5 hours)

#### Task 1.1: Add Type Definitions
**File**: `src/types.ts`
- Add `ProviderRegistration`, `Capability`, `PricingModel`, `HealthStatus` interfaces
- Add row types for database: `ProviderRegistrationRow`, `ProviderCapabilityRow`, `ProviderHealthCheckRow`
- Add type guards/helpers for validation

**Checklist**:
- [ ] Interfaces defined with JSDoc comments
- [ ] Row types match database column names (snake_case)
- [ ] Deserialization helpers documented
- [ ] TypeScript compiles without errors

#### Task 1.2: Extend Database Schema
**File**: `src/state/schema.ts`
- Add migration version constant (e.g., `MIGRATION_V10`)
- Add three new `CREATE TABLE` statements for registrations, capabilities, health checks
- Add indexes for query performance
- Include data migration logic (handle existing data if upgrading)

**Checklist**:
- [ ] Schema migration properly versioned
- [ ] All three tables created atomically
- [ ] Indexes created for performance
- [ ] Foreign key constraints enforced
- [ ] Default values specified correctly

### Phase 2: Database Operations (1.5-2 hours)

#### Task 2.1: Add Database Functions
**File**: `src/state/database.ts`
- Add provider registration functions:
  - `providerRegistryUpsert()` - insert/update provider
  - `providerRegistryGet()` - fetch single provider by ID
  - `providerRegistryGetAll()` - fetch all providers
  - `providerRegistryDelete()` - soft-delete (mark offline)
  - `providerRegistrySetHealth()` - update health status
  - `providerRegistrySetReputation()` - update reputation score

- Add capability functions:
  - `providerCapabilityUpsert()` - register/update capability
  - `providerCapabilityGet()` - fetch single capability
  - `providerCapabilitySearch()` - search by name and tier
  - `providerCapabilityRemove()` - remove capability

- Add health check functions:
  - `providerHealthCheckInsert()` - record health check result
  - `providerHealthCheckGetLatest()` - get most recent check
  - `providerHealthCheckGetRecent()` - get last N checks
  - `providerHealthCheckPrune()` - clean up old records

- Add deserialization functions:
  - `deserializeProviderRegistrationRow()`
  - `deserializeProviderCapabilityRow()`
  - `deserializeProviderHealthCheckRow()`

**Pattern**: Follow existing ModelRegistry pattern for consistency

**Checklist**:
- [ ] All functions use parameterized queries (no SQL injection)
- [ ] Functions handle missing/null data gracefully
- [ ] Timestamps use datetime('now') for consistency
- [ ] Foreign key constraints are respected
- [ ] Deserialization helpers handle snake_case correctly

### Phase 3: Registry Class (1-1.5 hours)

#### Task 3.1: Create Provider Registry Class
**File**: `/src/registry/registry.ts`

```typescript
/**
 * Provider Registry
 *
 * Database-backed registry for discovering and managing provider agents.
 * Tracks capabilities, pricing, health status, and reputation.
 *
 * Usage:
 *   const registry = new ProviderRegistry(db);
 *
 *   // Register a new provider
 *   registry.register({
 *     providerId: "provider-1",
 *     name: "AI Assistant Provider",
 *     capabilities: [{ name: "reasoning", tier: "fast", ... }]
 *   });
 *
 *   // Discover providers for a capability
 *   const candidates = registry.discoverByCapability("reasoning", { tier: "fast" });
 *
 *   // Update provider health
 *   registry.updateHealth("provider-1", "online");
 */

export class ProviderRegistry {
  constructor(db: Database) { ... }

  // Registration & Lifecycle
  register(registration: ProviderRegistration): void { ... }
  unregister(providerId: string): void { ... }
  updateMetadata(providerId: string, updates: Partial<ProviderRegistration>): void { ... }

  // Capability Management
  registerCapability(providerId: string, capability: Capability): void { ... }
  unregisterCapability(providerId: string, capabilityName: string): void { ... }

  // Discovery & Search
  get(providerId: string): ProviderRegistration | undefined { ... }
  getAll(): ProviderRegistration[] { ... }
  discoverByCapability(capabilityName: string, filters?: {
    tier?: string;
    maxCost?: number;
    minAvailability?: number;
  }): ProviderRegistration[] { ... }

  // Health & Status
  recordHealthCheck(providerId: string, result: HealthCheckResult): void { ... }
  getHealthStatus(providerId: string): HealthStatus { ... }
  markOffline(providerId: string): void { ... }
  markOnline(providerId: string): void { ... }

  // Reputation
  updateReputation(providerId: string, score: number): void { ... }
  getRating(providerId: string): number { ... }

  // Cleanup & Maintenance
  pruneHealthChecks(olderThanDays: number): number { ... }
  markStaleOffline(staleThresholdHours: number): number { ... }
}
```

**Design Principles**:
- Defensive: Handle missing providers gracefully (return undefined, not throw)
- Consistent: Follow ModelRegistry patterns for familiarity
- Observable: Return counts/results for audit logging
- Maintainable: Clear method names, comprehensive JSDoc

**Checklist**:
- [ ] Class implements all core methods
- [ ] All methods have JSDoc with examples
- [ ] Error handling is defensive (graceful degradation)
- [ ] Methods are async-ready (can be called from async context)
- [ ] Constructor accepts Database parameter
- [ ] All database operations use prepared statements

### Phase 4: Heartbeat Integration (1 hour)

#### Task 4.1: Add Registry Update to Heartbeat
**File**: `src/heartbeat/tasks.ts`
- Create new heartbeat task: `providerHealthCheckTask()`
- Integrates with existing heartbeat machinery
- Publishes self as a provider to the registry on each beat
- Updates own health status and last-seen timestamp
- Marks other stale providers as offline

**Implementation**:
```typescript
export const providerHealthCheckTask: HeartbeatTaskFn = async (ctx) => {
  const registry = new ProviderRegistry(ctx.db.raw);

  // Register self as a provider
  registry.register({
    providerId: ctx.agentId,
    name: `Agent ${ctx.agentId}`,
    description: "OpenFox Agent Instance",
    contact: `agent-${ctx.agentId}@openfox.local`,
    capabilities: ctx.availableCapabilities,
    pricingModel: ctx.agentPricing,
    healthStatus: "online",
    lastSeen: new Date().toISOString(),
    reputation: ctx.agentReputation,
  });

  // Prune old health checks (keep last 7 days)
  registry.pruneHealthChecks(7);

  // Mark providers offline if heartbeat stale > 1 hour
  const offlineCount = registry.markStaleOffline(1);

  if (offlineCount > 0) {
    ctx.logger.debug(`Marked ${offlineCount} stale providers offline`);
  }
};
```

**Checklist**:
- [ ] Task function integrated into heartbeat schedule
- [ ] Reads agent identity/capabilities from context
- [ ] Registers self on each heartbeat
- [ ] Prunes old health data
- [ ] Marks stale providers offline
- [ ] Logs activity for observability
- [ ] Handles errors gracefully (doesn't crash heartbeat)

### Phase 5: Integration Tests (1 hour)

#### Task 5.1: Create Registry Tests
**File**: `/src/__tests__/registry/registry.test.ts`

**Test Coverage**:
```
describe("ProviderRegistry", () => {
  describe("registration", () => {
    it("registers a new provider")
    it("updates existing provider")
    it("handles duplicate registrations gracefully")
    it("stores capabilities correctly")
  })

  describe("discovery", () => {
    it("discovers providers by capability name")
    it("filters by tier")
    it("filters by max cost")
    it("filters by availability")
    it("returns empty array for unknown capability")
  })

  describe("health", () => {
    it("records health check results")
    it("marks provider online")
    it("marks provider offline")
    it("returns correct health status")
  })

  describe("reputation", () => {
    it("updates reputation score")
    it("returns current rating")
    it("handles reputation bounds (0-100)")
  })

  describe("maintenance", () => {
    it("prunes old health checks")
    it("marks stale providers offline")
    it("returns count of affected providers")
  })
})
```

**Test Patterns** (follow existing test style):
- Use temporary database for each test (no state leakage)
- Use factory functions for test data
- Test both success and error paths
- Verify database consistency

**Checklist**:
- [ ] 20+ test cases passing
- [ ] All edge cases covered
- [ ] Database consistency verified
- [ ] Error handling tested
- [ ] No test interdependencies

#### Task 5.2: Integration Test
**File**: `/src/__tests__/integration/registry-integration.test.ts`

**Scenario**: Full workflow
1. Agent registers itself as a provider
2. Registry discovers the agent by capability
3. Heartbeat updates provider health
4. Old health checks are pruned
5. Stale providers are marked offline

**Checklist**:
- [ ] Test passes with fresh database
- [ ] All tests still passing (no regressions)
- [ ] Demonstrates real-world usage pattern

---

## File Structure

### New Files to Create
```
src/registry/
├── registry.ts          (Main ProviderRegistry class)
├── index.ts            (Public exports)
└── types.ts            (Local type helpers, if needed)

src/__tests__/
└── registry/
    ├── registry.test.ts (Unit tests)
    └── integration-registry.test.ts (Integration tests)
```

### Files to Modify
```
src/types.ts                    (Add interfaces)
src/state/schema.ts             (Add migration)
src/state/database.ts           (Add functions)
src/heartbeat/tasks.ts          (Add task)
src/index.ts                    (Export registry if needed)
```

---

## Success Criteria

### Functional Requirements
- [ ] Registry directory contains production-ready code
- [ ] Provider registration works (CRUD operations)
- [ ] Capability discovery works (search/filter)
- [ ] Health tracking works (heartbeat integration)
- [ ] Database schema migration is clean and safe
- [ ] All 119 existing tests still pass (no regressions)

### Code Quality Requirements
- [ ] All new code has JSDoc comments
- [ ] Functions follow existing naming/pattern conventions
- [ ] Error handling is defensive (graceful degradation)
- [ ] Database operations use parameterized queries
- [ ] No SQL injection vulnerabilities
- [ ] TypeScript compiles without warnings

### Testing Requirements
- [ ] 20+ unit tests covering registry operations
- [ ] Integration test demonstrating full workflow
- [ ] Edge cases tested (empty results, missing providers, etc.)
- [ ] Test coverage > 80% for registry code

### Documentation Requirements
- [ ] JSDoc comments on all public methods
- [ ] Usage examples in class docstring
- [ ] Database schema documented
- [ ] Integration points documented

---

## Budget & Timeline

### Estimated Hours by Phase
| Phase | Task | Hours | Cost |
|-------|------|-------|------|
| 1 | Types & Schema | 1.5 | $3 |
| 2 | Database Operations | 2 | $4 |
| 3 | Registry Class | 1.5 | $3 |
| 4 | Heartbeat Integration | 1 | $2 |
| 5 | Tests & Documentation | 1 | $2 |
| **Total** | | **7** | **$14** |

**Budget Available**: $25.00
**Estimated Cost**: $8-12
**Safety Margin**: 2x cost estimate

### Timeline
- **Phase 1**: 1.5 hours (database schema & types)
- **Phase 2**: 2 hours (database operations)
- **Phase 3**: 1.5 hours (registry class implementation)
- **Phase 4**: 1 hour (heartbeat integration)
- **Phase 5**: 1 hour (tests and documentation)

**Total**: 7 hours (estimated 8-12 with buffer)

---

## Risk Mitigation

### Key Risks & Mitigations

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|-----------|
| Database schema migration breaks existing tables | Low | High | Test migration on fresh DB first, verify schema with SELECT * |
| Registry API doesn't match heartbeat expectations | Medium | Medium | Check heartbeat/tasks.ts code patterns before implementing |
| Deserialization bugs (snake_case ↔ camelCase) | Medium | Low | Use test-driven approach, verify with actual DB queries |
| Tests don't clean up properly, causing interdependencies | Medium | Low | Use temporary DB files per test, verify cleanup |
| Heartbeat task crashes, breaking other tasks | Low | High | Wrap task in try/catch, log errors, don't re-throw |

### Safeguards
1. Run full test suite after schema changes (verify no regressions)
2. Create migration in isolated transaction (rollback on error)
3. Test deserialization with actual database before deploying
4. Code review database operations for SQL injection
5. Test heartbeat integration in isolation first

---

## Implementation Notes

### Database Pattern Consistency
Follow the existing `ModelRegistry` implementation in `src/inference/registry.ts`:
- Use prepared statements with parameter placeholders
- Implement deserialization functions for row → object conversion
- Use SQL DEFAULT values for timestamps
- Implement indexes for common query patterns

### Error Handling Pattern
```typescript
get(providerId: string): ProviderRegistration | undefined {
  try {
    const row = db.prepare("SELECT * FROM provider_registrations WHERE provider_id = ?")
      .get(providerId) as any | undefined;
    return row ? deserializeProviderRegistrationRow(row) : undefined;
  } catch (error) {
    this.logger.error("Failed to get provider", { providerId, error });
    return undefined; // Graceful degradation
  }
}
```

### Heartbeat Integration Pattern
```typescript
export const providerHealthCheckTask: HeartbeatTaskFn = async (ctx) => {
  try {
    const registry = new ProviderRegistry(ctx.db.raw);
    // ... registry operations ...
  } catch (error) {
    ctx.logger.error("Registry health check failed", { error });
    // Don't re-throw - other heartbeat tasks depend on continuation
  }
};
```

---

## Related Files Reference

### Files That Reference Registry
1. **src/heartbeat/tasks.ts** (Line 26, 855-858)
   - Imports ModelRegistry from inference
   - Calls registry.initialize() and registry.refreshFromApi()
   - Pattern: Initialize on startup, refresh periodically

2. **src/index.ts** (Lines 27, 75)
   - Imports and exports ModelRegistry
   - Imports SkillRegistry
   - Pattern: Registries are exported from main entry point

3. **src/state/schema.ts**
   - Should contain registry table definitions
   - Should follow existing migration pattern
   - Pattern: Migrations numbered sequentially

4. **src/state/database.ts**
   - Should contain registry CRUD operations
   - Should follow existing function pattern (prepare/run/get)
   - Pattern: Database functions return deserialized objects

5. **src/orchestration/planner.ts** (Line 3)
   - Uses ModelTier type
   - Pattern: Capability discovery for task planning

---

## Conclusion

Registry implementation is the critical blocker preventing agent discovery and marketplace coordination. This plan provides a clear 7-hour path to full implementation with:
- Database schema for storing provider registrations and capabilities
- ProviderRegistry class with discovery and health tracking
- Heartbeat integration for automatic provider health updates
- Comprehensive test coverage (20+ tests)
- Full documentation and JSDoc comments

All work follows existing code patterns and conventions for maintainability.
