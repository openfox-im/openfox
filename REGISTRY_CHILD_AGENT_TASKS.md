# Registry Implementation - Child Agent Task Assignments

## Overview

The Registry subsystem implementation has been decomposed into **5 sequential phases** that can be executed by child agents. Each phase builds on previous work and has clear success criteria.

**Total Effort**: 7 hours (estimated $8-12)
**Budget Available**: $25.00
**Master Plan**: `/home/tomi/openfox/REGISTRY_IMPLEMENTATION_PLAN.md`

---

## Assignment Structure

### Task 1: Database Schema & Types (Child Agent 1)
**Effort**: 1.5 hours
**Cost**: ~$3
**Priority**: CRITICAL (blocks all other work)

#### Objectives
1. Add TypeScript interfaces to `src/types.ts`
2. Add database migration to `src/state/schema.ts`
3. Verify migration is compatible with existing schema

#### Deliverables
- ✅ ProviderRegistration, Capability, PricingModel, HealthStatus interfaces in types.ts
- ✅ Row types: ProviderRegistrationRow, ProviderCapabilityRow, ProviderHealthCheckRow
- ✅ MIGRATION_V10 (or next version) added to schema.ts
- ✅ Three new CREATE TABLE statements with proper constraints
- ✅ Indexes created for query performance
- ✅ TypeScript compiles without errors

#### Key Files
- **Edit**: `/home/tomi/openfox/src/types.ts` (add ~150 lines)
- **Edit**: `/home/tomi/openfox/src/state/schema.ts` (add ~80 lines)

#### Definition of Done
- [ ] All interfaces defined with JSDoc comments
- [ ] Row types match database schema (snake_case columns)
- [ ] Schema migration versioned correctly
- [ ] Foreign key constraints specified
- [ ] Indexes created for common queries
- [ ] `npm run build` succeeds without errors or warnings

#### Notes
- Reference existing ModelRegistry interface pattern
- Follow MIGRATION_V9 pattern for new migration
- Use ISO8601 timestamps for consistency
- Verify schema does NOT break existing tables

---

### Task 2: Database Operations (Child Agent 2)
**Effort**: 2 hours
**Cost**: ~$4
**Depends on**: Task 1
**Priority**: CRITICAL

#### Objectives
1. Implement CRUD operations for provider registrations
2. Implement capability management functions
3. Implement health check operations
4. Implement deserialization helpers

#### Deliverables
- ✅ 6 provider registration functions: upsert, get, getAll, delete, setHealth, setReputation
- ✅ 4 capability management functions: upsert, get, search, remove
- ✅ 4 health check functions: insert, getLatest, getRecent, prune
- ✅ 3 deserialization helpers for row → object conversion
- ✅ All functions use parameterized queries (no SQL injection)
- ✅ All functions handle missing/null data gracefully

#### Key Files
- **Edit**: `/home/tomi/openfox/src/state/database.ts` (add ~400 lines)

#### Function Signatures (Reference)
```typescript
// Provider Registration
export function providerRegistryUpsert(db: DatabaseType, entry: ProviderRegistrationRow): void
export function providerRegistryGet(db: DatabaseType, providerId: string): ProviderRegistrationRow | undefined
export function providerRegistryGetAll(db: DatabaseType): ProviderRegistrationRow[]
export function providerRegistryDelete(db: DatabaseType, providerId: string): void
export function providerRegistrySetHealth(db: DatabaseType, providerId: string, status: HealthStatus): void
export function providerRegistrySetReputation(db: DatabaseType, providerId: string, score: number): void

// Capability Management
export function providerCapabilityUpsert(db: DatabaseType, entry: ProviderCapabilityRow): void
export function providerCapabilityGet(db: DatabaseType, id: string): ProviderCapabilityRow | undefined
export function providerCapabilitySearch(db: DatabaseType, capabilityName: string, tier?: string): ProviderCapabilityRow[]
export function providerCapabilityRemove(db: DatabaseType, providerId: string, capabilityName: string): void

// Health Checks
export function providerHealthCheckInsert(db: DatabaseType, entry: ProviderHealthCheckRow): void
export function providerHealthCheckGetLatest(db: DatabaseType, providerId: string): ProviderHealthCheckRow | undefined
export function providerHealthCheckGetRecent(db: DatabaseType, providerId: string, limit: number): ProviderHealthCheckRow[]
export function providerHealthCheckPrune(db: DatabaseType, olderThanDays: number): number

// Deserialization
function deserializeProviderRegistrationRow(row: any): ProviderRegistrationRow
function deserializeProviderCapabilityRow(row: any): ProviderCapabilityRow
function deserializeProviderHealthCheckRow(row: any): ProviderHealthCheckRow
```

#### Definition of Done
- [ ] All 14 functions implemented
- [ ] All functions use parameterized queries (no string concatenation)
- [ ] Foreign key constraints respected
- [ ] Timestamps use `datetime('now')` for consistency
- [ ] Deserialization helpers handle snake_case → camelCase correctly
- [ ] Error handling is graceful (return undefined, not throw)
- [ ] `npm run build` succeeds without errors

#### Notes
- Follow ModelRegistry database function pattern exactly
- Use `INSERT OR REPLACE` for upsert operations
- Use `UPDATE ... WHERE ...` for mutations
- Verify FK constraints in database operations
- Handle NULL values in optional fields

---

### Task 3: Registry Class Implementation (Child Agent 3)
**Effort**: 1.5 hours
**Cost**: ~$3
**Depends on**: Tasks 1 & 2
**Priority**: CRITICAL

#### Objectives
1. Create ProviderRegistry class
2. Implement all core methods with proper error handling
3. Add comprehensive JSDoc documentation
4. Ensure defensive programming (graceful degradation)

#### Deliverables
- ✅ ProviderRegistry class in `/src/registry/registry.ts`
- ✅ Public methods: register, unregister, updateMetadata, registerCapability, unregisterCapability
- ✅ Discovery methods: get, getAll, discoverByCapability
- ✅ Health methods: recordHealthCheck, getHealthStatus, markOffline, markOnline
- ✅ Reputation methods: updateReputation, getRating
- ✅ Maintenance methods: pruneHealthChecks, markStaleOffline
- ✅ All methods have JSDoc with examples
- ✅ All methods handle missing data gracefully
- ✅ Constructor accepts Database parameter

#### Key Files
- **Create**: `/home/tomi/openfox/src/registry/registry.ts` (~350 lines)
- **Create**: `/home/tomi/openfox/src/registry/index.ts` (~5 lines, exports ProviderRegistry)

#### Core Methods (Reference Implementation)
```typescript
export class ProviderRegistry {
  private db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  /**
   * Register a new provider or update existing one.
   * @param registration Provider registration details
   * @example
   *   registry.register({
   *     providerId: "agent-1",
   *     name: "AI Assistant",
   *     capabilities: [...]
   *   });
   */
  register(registration: ProviderRegistration): void {
    // implementation
  }

  /**
   * Discover providers by capability with optional filters.
   * @param capabilityName Name of required capability
   * @param filters Optional: { tier, maxCost, minAvailability }
   * @returns Array of matching providers, ordered by reputation
   * @example
   *   const providers = registry.discoverByCapability("reasoning", { tier: "fast" });
   */
  discoverByCapability(capabilityName: string, filters?: DiscoveryFilters): ProviderRegistration[] {
    // implementation
  }

  // ... other methods ...
}
```

#### Definition of Done
- [ ] Class implements all 14+ public methods
- [ ] All methods have JSDoc with parameter descriptions and examples
- [ ] Error handling is defensive (return undefined/empty array, not throw)
- [ ] All methods use database layer (no direct SQL)
- [ ] TypeScript compiles without errors
- [ ] `npm run build` succeeds

#### Notes
- Follow ModelRegistry class pattern for consistency
- Implement discover() to return results ordered by reputation (descending)
- Handle NULL values in optional fields
- Return empty arrays instead of throwing for "not found" cases
- All methods should be synchronous (use prepared statements)

---

### Task 4: Heartbeat Integration (Child Agent 4)
**Effort**: 1 hour
**Cost**: ~$2
**Depends on**: Tasks 1-3
**Priority**: HIGH

#### Objectives
1. Create provider health check heartbeat task
2. Integrate with existing heartbeat infrastructure
3. Implement provider self-registration on heartbeat
4. Implement stale provider cleanup

#### Deliverables
- ✅ New heartbeat task function: `providerHealthCheckTask`
- ✅ Task registers self as provider on each beat
- ✅ Task updates own health status and last-seen timestamp
- ✅ Task prunes old health checks (> 7 days)
- ✅ Task marks stale providers offline (> 1 hour no heartbeat)
- ✅ Task integrated into heartbeat schedule
- ✅ Error handling: catches exceptions, logs, doesn't re-throw
- ✅ Logging for observability

#### Key Files
- **Edit**: `/home/tomi/openfox/src/heartbeat/tasks.ts` (add ~40 lines)

#### Task Signature (Reference)
```typescript
/**
 * Provider Health Check Task
 *
 * Registered heartbeat task that:
 * 1. Registers this agent as a provider
 * 2. Updates own health status and last-seen timestamp
 * 3. Prunes old health check records (> 7 days)
 * 4. Marks other providers offline if stale (> 1 hour no heartbeat)
 *
 * Runs on every heartbeat tick. Errors are caught and logged.
 */
export const providerHealthCheckTask: HeartbeatTaskFn = async (ctx) => {
  try {
    const registry = new ProviderRegistry(ctx.db.raw);

    // Register self as provider
    registry.register({
      providerId: ctx.agentId,
      name: `Agent ${ctx.agentId}`,
      description: "OpenFox Agent Instance",
      contact: `agent-${ctx.agentId}@openfox.local`,
      capabilities: ctx.availableCapabilities || [],
      pricingModel: ctx.agentPricing || defaultPricingModel,
      healthStatus: "online",
      lastSeen: new Date().toISOString(),
      reputation: ctx.agentReputation || 50,
    });

    // Prune old health checks
    registry.pruneHealthChecks(7);

    // Mark stale providers offline
    const offlineCount = registry.markStaleOffline(1);
    if (offlineCount > 0) {
      ctx.logger.debug(`Marked ${offlineCount} stale providers offline`);
    }
  } catch (error) {
    ctx.logger.error("Provider health check failed", { error });
    // Don't re-throw - other heartbeat tasks depend on continuation
  }
};
```

#### Definition of Done
- [ ] Task function created and exported
- [ ] Task integrated into heartbeat task list
- [ ] Registers self with agent identity and capabilities
- [ ] Updates own health status as "online"
- [ ] Prunes health checks > 7 days old
- [ ] Marks providers offline if heartbeat stale > 1 hour
- [ ] Error handling is proper (catch, log, don't re-throw)
- [ ] Logging is sufficient for observability
- [ ] All tests still pass (no regressions)

#### Notes
- Task must not throw (wrap in try/catch)
- Log errors for debugging but don't crash heartbeat
- Use ctx.logger, ctx.agentId, ctx.db.raw (already available)
- Heartbeat runs every 30-60 seconds (don't do expensive operations)
- Pattern: same as other heartbeat tasks (e.g., metricsSnapshot)

---

### Task 5: Testing & Verification (Child Agent 5)
**Effort**: 1 hour
**Cost**: ~$2
**Depends on**: Tasks 1-4
**Priority**: HIGH

#### Objectives
1. Write unit tests for ProviderRegistry class
2. Write integration test demonstrating full workflow
3. Verify all existing tests still pass (no regressions)
4. Verify code quality and documentation

#### Deliverables
- ✅ Unit test file: `/src/__tests__/registry/registry.test.ts` (~300 lines, 20+ tests)
- ✅ Integration test: `/src/__tests__/integration/registry-integration.test.ts` (~100 lines, 1-3 tests)
- ✅ All new tests passing
- ✅ All 119 existing tests still passing (zero regressions)
- ✅ Code coverage > 80% for registry code
- ✅ JSDoc comments on all public methods verified

#### Unit Test Cases (Reference)
```typescript
describe("ProviderRegistry", () => {
  describe("registration", () => {
    it("registers a new provider")
    it("updates existing provider with new metadata")
    it("handles duplicate registrations (upsert behavior)")
    it("stores multiple capabilities correctly")
    it("unregisters a provider")
  })

  describe("discovery", () => {
    it("discovers providers by capability name")
    it("filters results by tier")
    it("filters results by max cost")
    it("filters results by min availability")
    it("returns providers ordered by reputation (highest first)")
    it("returns empty array for unknown capability")
  })

  describe("health tracking", () => {
    it("records health check results")
    it("marks provider online")
    it("marks provider offline")
    it("returns correct health status")
    it("tracks health check history")
  })

  describe("reputation", () => {
    it("updates reputation score")
    it("returns current reputation")
    it("bounds reputation between 0-100")
  })

  describe("maintenance", () => {
    it("prunes health checks older than threshold")
    it("marks stale providers offline (no heartbeat)")
    it("returns count of affected providers")
  })

  describe("error handling", () => {
    it("returns undefined for missing provider")
    it("returns empty array for missing capability")
    it("handles database errors gracefully")
  })
})
```

#### Integration Test Scenario
```typescript
describe("Registry Integration", () => {
  it("completes full provider lifecycle: register → discover → heartbeat → cleanup", async () => {
    // 1. Register a provider with capabilities
    // 2. Discover the provider by capability
    // 3. Simulate heartbeat update
    // 4. Verify last-seen timestamp updated
    // 5. Prune old health checks
    // 6. Verify provider still exists
  })
})
```

#### Definition of Done
- [ ] Unit tests created with 20+ test cases
- [ ] Integration test demonstrates full workflow
- [ ] All new tests passing (`npm test`)
- [ ] All existing tests still passing (0 regressions)
- [ ] Code coverage > 80% for registry code
- [ ] No TypeScript errors in test files
- [ ] All JSDoc comments present and accurate

#### Notes
- Use temporary database for each test (no state leakage between tests)
- Follow existing test patterns (e.g., ModelRegistry tests)
- Use factory functions for creating test data
- Verify database consistency after mutations
- Use `describe()` and `it()` from vitest (already in project)

---

## Execution Order & Dependencies

### Dependency Graph
```
Task 1 (Schema & Types)
  ↓
Task 2 (Database Operations)
  ↓
Task 3 (Registry Class)
  ├→ Task 4 (Heartbeat Integration)
  │   ↓
  └→ Task 5 (Testing & Verification)
```

### Parallel Execution Possible?
- **Tasks 1-3**: Must be sequential (hard dependencies)
- **Task 4**: Can start after Task 3 is complete
- **Task 5**: Can start after Task 4 is complete (but should be last)

**Recommended Sequence**:
1. Assign Task 1 (1.5h)
2. When Task 1 done → Assign Task 2 (2h)
3. When Task 2 done → Assign Task 3 (1.5h)
4. When Task 3 done → Assign Tasks 4 & 5 in parallel (1h each)

**Total Time**: ~7 hours (sequential)

---

## Success Criteria (Master Checklist)

### Phase Completion Checklist
- [ ] **Task 1 Complete**: Types and schema defined, no TypeScript errors
- [ ] **Task 2 Complete**: All 14 database functions implemented and tested
- [ ] **Task 3 Complete**: ProviderRegistry class with all methods working
- [ ] **Task 4 Complete**: Heartbeat task integrated and working
- [ ] **Task 5 Complete**: All tests passing (new + existing)

### Master Completion Criteria
- [ ] Registry directory contains `/registry/registry.ts` and `/registry/index.ts`
- [ ] All 5 tasks completed with no regressions
- [ ] `npm test` shows 119 tests passing (or more)
- [ ] `npm run build` succeeds with zero TypeScript errors
- [ ] All new code has JSDoc comments
- [ ] Database schema migration is clean and reversible
- [ ] Code review checklist passed (security, patterns, quality)

### Budget Verification
- [ ] Estimated cost: $8-12 (7 hours at $2/hour estimate)
- [ ] Actual cost: [TO BE FILLED BY EXECUTOR]
- [ ] Budget remaining: [TO BE FILLED BY EXECUTOR]

---

## Communication Protocol

### Task Assignment
Each child agent should receive:
1. This document (REGISTRY_CHILD_AGENT_TASKS.md)
2. Master plan (REGISTRY_IMPLEMENTATION_PLAN.md)
3. Specific task number and objectives

### Handoffs Between Agents
- When Task N completes, output summary to parent orchestrator
- Parent assigns Task N+1 with reference to Task N completions
- Include any implementation notes or gotchas discovered

### Final Verification
After Task 5 completes:
1. Parent runs `npm test` to verify all tests pass
2. Parent runs `npm run build` to verify TypeScript compiles
3. Parent creates git commit with all changes
4. Parent documents any cost overruns or delays

---

## Additional Resources

### Reference Code
- **ModelRegistry class**: `/home/tomi/openfox/src/inference/registry.ts`
  - Pattern for class structure, methods, deserialization
- **Database operations**: `/home/tomi/openfox/src/state/database.ts`
  - Pattern for SQL functions, prepared statements, error handling
- **Heartbeat tasks**: `/home/tomi/openfox/src/heartbeat/tasks.ts`
  - Pattern for task structure, context usage, error handling
- **Tests**: `/home/tomi/openfox/src/__tests__/`
  - Test patterns, temporary DB setup, assertions

### Key Files for Reference
1. `src/types.ts` - All interfaces and type definitions
2. `src/state/schema.ts` - Existing migrations (MIGRATION_V1 through V9)
3. `src/state/database.ts` - Database operation patterns
4. `src/inference/registry.ts` - ModelRegistry reference implementation
5. `src/heartbeat/tasks.ts` - Heartbeat task patterns

### Command Reference
```bash
# Run tests (verify no regressions)
npm test

# Build project (verify TypeScript)
npm run build

# Run specific test file
npm test -- src/__tests__/registry/registry.test.ts

# Run tests in watch mode (for development)
npm test -- --watch
```

---

## Approval & Sign-Off

**Master Plan Reviewed**: ✅ Yes
**Task Decomposition**: ✅ Clear and sequential
**Budget Estimate**: ✅ $8-12 (7 hours)
**Timeline Estimate**: ✅ 7 hours total (can be done in parallel phases)
**Success Criteria**: ✅ Defined and measurable

**Ready for Child Agent Assignment**: ✅ YES

---

## Parent Orchestrator Notes

### Before Assigning Task 1
- [ ] Ensure budget is available ($25.00 confirmed)
- [ ] Verify test suite is clean (119 tests passing)
- [ ] Ensure database is not locked or in use

### Between Task Assignments
- [ ] Verify each task completes with deliverables
- [ ] Ensure no regressions in test suite
- [ ] Confirm TypeScript builds without errors
- [ ] Run git status to see changes

### After Task 5 Completes
- [ ] Run full test suite: `npm test`
- [ ] Verify build: `npm run build`
- [ ] Commit all changes: `git add -A && git commit -m "feat: implement registry subsystem"`
- [ ] Review final code quality
- [ ] Update WORKLOG.md with completion status
- [ ] Document total cost and time spent

---

**This plan is ready for child agent assignment.**
**Estimated start: Now**
**Estimated completion: 7 hours**
**Total budget impact: $8-12**
