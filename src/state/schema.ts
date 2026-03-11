/**
 * OpenFox SQLite Schema
 *
 * All tables for the openfox's persistent state.
 * The database IS the openfox's memory.
 */

export const SCHEMA_VERSION = 29;

export const CREATE_TABLES = `
  -- Schema version tracking
  CREATE TABLE IF NOT EXISTS schema_version (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Core identity key-value store
  CREATE TABLE IF NOT EXISTS identity (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  -- Agent reasoning turns (the thinking/action log)
  -- Application-level validation: state must be a valid AgentState ('setup','waking','running','sleeping','low_compute','critical','dead')
  CREATE TABLE IF NOT EXISTS turns (
    id TEXT PRIMARY KEY,
    timestamp TEXT NOT NULL,
    state TEXT NOT NULL,
    input TEXT,
    input_source TEXT,
    thinking TEXT NOT NULL,
    tool_calls TEXT NOT NULL DEFAULT '[]',
    token_usage TEXT NOT NULL DEFAULT '{}',
    cost_cents INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Tool call results (denormalized for fast lookup)
  CREATE TABLE IF NOT EXISTS tool_calls (
    id TEXT PRIMARY KEY,
    turn_id TEXT NOT NULL REFERENCES turns(id),
    name TEXT NOT NULL,
    arguments TEXT NOT NULL DEFAULT '{}',
    result TEXT NOT NULL DEFAULT '',
    duration_ms INTEGER NOT NULL DEFAULT 0,
    error TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Heartbeat configuration entries
  -- Application-level validation: enabled must be 0 or 1 (boolean integer)
  CREATE TABLE IF NOT EXISTS heartbeat_entries (
    name TEXT PRIMARY KEY,
    schedule TEXT NOT NULL,
    task TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    last_run TEXT,
    next_run TEXT,
    params TEXT DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Financial transaction log
  -- Application-level validation: type must be one of 'transfer_out','transfer_in','credit_purchase','topup','x402_payment','inference'
  CREATE TABLE IF NOT EXISTS transactions (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    amount_cents INTEGER,
    balance_after_cents INTEGER,
    description TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Installed tools and MCP servers
  CREATE TABLE IF NOT EXISTS installed_tools (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    config TEXT DEFAULT '{}',
    installed_at TEXT NOT NULL DEFAULT (datetime('now')),
    enabled INTEGER NOT NULL DEFAULT 1
  );

  -- Self-modification audit log (append-only)
  CREATE TABLE IF NOT EXISTS modifications (
    id TEXT PRIMARY KEY,
    timestamp TEXT NOT NULL,
    type TEXT NOT NULL,
    description TEXT NOT NULL,
    file_path TEXT,
    diff TEXT,
    reversible INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- General key-value store for arbitrary state
  CREATE TABLE IF NOT EXISTS kv (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Installed skills
  CREATE TABLE IF NOT EXISTS skills (
    name TEXT PRIMARY KEY,
    description TEXT NOT NULL DEFAULT '',
    auto_activate INTEGER NOT NULL DEFAULT 1,
    requires TEXT DEFAULT '{}',
    instructions TEXT NOT NULL DEFAULT '',
    source TEXT NOT NULL DEFAULT 'builtin',
    path TEXT NOT NULL DEFAULT '',
    enabled INTEGER NOT NULL DEFAULT 1,
    installed_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Spawned child openfox agents
  -- Application-level validation: status must be one of 'spawning','running','sleeping','dead','unknown'
  CREATE TABLE IF NOT EXISTS children (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    address TEXT NOT NULL,
    sandbox_id TEXT NOT NULL,
    genesis_prompt TEXT NOT NULL,
    creator_message TEXT,
    funded_amount_cents INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'spawning',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_checked TEXT
  );

  -- Reputation feedback received and given
  -- Application-level validation: score must be 1-5
  CREATE TABLE IF NOT EXISTS reputation (
    id TEXT PRIMARY KEY,
    from_agent TEXT NOT NULL,
    to_agent TEXT NOT NULL,
    score INTEGER NOT NULL,
    comment TEXT NOT NULL DEFAULT '',
    tx_hash TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Indices for common queries
  CREATE INDEX IF NOT EXISTS idx_turns_timestamp ON turns(timestamp);
  CREATE INDEX IF NOT EXISTS idx_turns_state ON turns(state);
  CREATE INDEX IF NOT EXISTS idx_tool_calls_turn ON tool_calls(turn_id);
  CREATE INDEX IF NOT EXISTS idx_transactions_type ON transactions(type);
  CREATE INDEX IF NOT EXISTS idx_modifications_type ON modifications(type);

  -- Operator control audit log
  CREATE TABLE IF NOT EXISTS operator_control_events (
    event_id TEXT PRIMARY KEY,
    action TEXT NOT NULL CHECK(action IN ('pause','resume','drain','maintain_storage','maintain_artifacts','quarantine_provider','retry_payments','retry_settlement','retry_market','retry_signer','retry_paymaster')),
    status TEXT NOT NULL CHECK(status IN ('applied','noop','failed')),
    actor TEXT NOT NULL,
    reason TEXT,
    summary TEXT,
    result_json TEXT,
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_operator_control_events_created
    ON operator_control_events(created_at DESC);

  CREATE INDEX IF NOT EXISTS idx_operator_control_events_action
    ON operator_control_events(action, created_at DESC);

  CREATE INDEX IF NOT EXISTS idx_operator_control_events_status
    ON operator_control_events(status, created_at DESC);

  CREATE TABLE IF NOT EXISTS operator_approval_requests (
    request_id TEXT PRIMARY KEY,
    kind TEXT NOT NULL CHECK(kind IN ('treasury_policy_change','spend_cap_change','signer_policy_change','paymaster_policy_change')),
    scope TEXT NOT NULL,
    requested_by TEXT NOT NULL,
    reason TEXT,
    payload_json TEXT,
    status TEXT NOT NULL CHECK(status IN ('pending','approved','rejected','expired')),
    expires_at TEXT,
    created_at TEXT NOT NULL,
    decided_at TEXT,
    decided_by TEXT,
    decision_note TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_operator_approval_requests_created
    ON operator_approval_requests(created_at DESC);

  CREATE INDEX IF NOT EXISTS idx_operator_approval_requests_status
    ON operator_approval_requests(status, created_at DESC);

  CREATE INDEX IF NOT EXISTS idx_operator_approval_requests_kind
    ON operator_approval_requests(kind, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_skills_enabled ON skills(enabled);
  CREATE INDEX IF NOT EXISTS idx_children_status ON children(status);
  CREATE INDEX IF NOT EXISTS idx_reputation_to ON reputation(to_agent);

  -- Inbox messages table
  CREATE TABLE IF NOT EXISTS inbox_messages (
    id TEXT PRIMARY KEY,
    from_address TEXT NOT NULL,
    content TEXT NOT NULL,
    received_at TEXT NOT NULL DEFAULT (datetime('now')),
    processed_at TEXT,
    reply_to TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_inbox_unprocessed
    ON inbox_messages(received_at) WHERE processed_at IS NULL;

  CREATE TABLE IF NOT EXISTS campaigns (
    campaign_id TEXT PRIMARY KEY,
    host_agent_id TEXT NOT NULL,
    host_address TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    budget_wei TEXT NOT NULL,
    max_open_bounties INTEGER NOT NULL,
    allowed_kinds_json TEXT NOT NULL DEFAULT '[]',
    metadata_json TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL CHECK(status IN ('open','paused','exhausted','completed')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_campaigns_status ON campaigns(status, created_at);

  -- Bounty engine
  CREATE TABLE IF NOT EXISTS bounties (
    bounty_id TEXT PRIMARY KEY,
    campaign_id TEXT REFERENCES campaigns(campaign_id) ON DELETE SET NULL,
    host_agent_id TEXT NOT NULL,
    host_address TEXT NOT NULL,
    kind TEXT NOT NULL CHECK(kind IN ('question','translation','social_proof','problem_solving','public_news_capture','oracle_evidence_capture')),
    title TEXT NOT NULL,
    task_prompt TEXT NOT NULL,
    reference_output TEXT NOT NULL,
    skill_name TEXT,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    policy_json TEXT NOT NULL DEFAULT '{}',
    reward_wei TEXT NOT NULL,
    submission_deadline TEXT NOT NULL,
    judge_mode TEXT NOT NULL CHECK(judge_mode IN ('local_model')),
    status TEXT NOT NULL CHECK(status IN ('open','submitted','under_review','approved','rejected','paid','expired')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_bounties_status ON bounties(status, created_at);

  CREATE TABLE IF NOT EXISTS bounty_submissions (
    submission_id TEXT PRIMARY KEY,
    bounty_id TEXT NOT NULL REFERENCES bounties(bounty_id) ON DELETE CASCADE,
    solver_agent_id TEXT,
    solver_address TEXT NOT NULL,
    submission_text TEXT NOT NULL,
    proof_url TEXT,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL CHECK(status IN ('submitted','accepted','rejected')),
    submitted_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_bounty_submissions_bounty ON bounty_submissions(bounty_id, submitted_at);

  CREATE TABLE IF NOT EXISTS bounty_results (
    bounty_id TEXT PRIMARY KEY REFERENCES bounties(bounty_id) ON DELETE CASCADE,
    winning_submission_id TEXT,
    decision TEXT NOT NULL CHECK(decision IN ('accepted','rejected')),
    confidence REAL NOT NULL,
    judge_reason TEXT NOT NULL,
    payout_tx_hash TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS settlement_receipts (
    receipt_id TEXT PRIMARY KEY,
    kind TEXT NOT NULL CHECK(kind IN ('bounty','observation','oracle')),
    subject_id TEXT NOT NULL,
    receipt_json TEXT NOT NULL,
    receipt_hash TEXT NOT NULL,
    artifact_url TEXT,
    payment_tx_hash TEXT,
    payout_tx_hash TEXT,
    settlement_tx_hash TEXT,
    settlement_receipt_json TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE UNIQUE INDEX IF NOT EXISTS idx_settlement_subject
    ON settlement_receipts(kind, subject_id);

  CREATE TABLE IF NOT EXISTS settlement_callbacks (
    callback_id TEXT PRIMARY KEY,
    receipt_id TEXT NOT NULL,
    kind TEXT NOT NULL CHECK(kind IN ('bounty','observation','oracle')),
    subject_id TEXT NOT NULL,
    contract_address TEXT NOT NULL,
    payload_mode TEXT NOT NULL CHECK(payload_mode IN ('canonical_receipt','receipt_hash')),
    payload_hex TEXT NOT NULL,
    payload_hash TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('pending','confirmed','failed')),
    attempt_count INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL DEFAULT 3,
    callback_tx_hash TEXT,
    callback_receipt_json TEXT,
    last_error TEXT,
    next_attempt_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE UNIQUE INDEX IF NOT EXISTS idx_settlement_callback_receipt
    ON settlement_callbacks(receipt_id);

  CREATE INDEX IF NOT EXISTS idx_settlement_callback_status
    ON settlement_callbacks(status, kind, next_attempt_at);

  CREATE TABLE IF NOT EXISTS market_bindings (
    binding_id TEXT PRIMARY KEY,
    kind TEXT NOT NULL CHECK(kind IN ('bounty','observation','oracle')),
    subject_id TEXT NOT NULL,
    receipt_json TEXT NOT NULL,
    receipt_hash TEXT NOT NULL,
    callback_target TEXT,
    callback_tx_hash TEXT,
    callback_receipt_json TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE UNIQUE INDEX IF NOT EXISTS idx_market_binding_subject
    ON market_bindings(kind, subject_id);

  CREATE TABLE IF NOT EXISTS market_contract_callbacks (
    callback_id TEXT PRIMARY KEY,
    binding_id TEXT NOT NULL,
    kind TEXT NOT NULL CHECK(kind IN ('bounty','observation','oracle')),
    subject_id TEXT NOT NULL,
    contract_address TEXT NOT NULL,
    package_name TEXT NOT NULL,
    function_signature TEXT NOT NULL,
    payload_mode TEXT NOT NULL CHECK(payload_mode IN ('canonical_binding','binding_hash')),
    payload_hex TEXT NOT NULL,
    payload_hash TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('pending','confirmed','failed')),
    attempt_count INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL DEFAULT 3,
    callback_tx_hash TEXT,
    callback_receipt_json TEXT,
    last_error TEXT,
    next_attempt_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE UNIQUE INDEX IF NOT EXISTS idx_market_callback_binding
    ON market_contract_callbacks(binding_id);

  CREATE INDEX IF NOT EXISTS idx_market_callback_status
    ON market_contract_callbacks(status, kind, next_attempt_at);

  CREATE TABLE IF NOT EXISTS x402_payments (
    payment_id TEXT PRIMARY KEY,
    service_kind TEXT NOT NULL CHECK(service_kind IN ('observation','oracle','signer','paymaster','gateway_request','gateway_session','storage')),
    request_key TEXT NOT NULL,
    request_hash TEXT NOT NULL,
    payer_address TEXT NOT NULL,
    provider_address TEXT NOT NULL,
    chain_id TEXT NOT NULL,
    tx_nonce TEXT NOT NULL,
    tx_hash TEXT NOT NULL UNIQUE,
    raw_transaction TEXT NOT NULL,
    amount_wei TEXT NOT NULL,
    confirmation_policy TEXT NOT NULL CHECK(confirmation_policy IN ('broadcast','receipt')),
    status TEXT NOT NULL CHECK(status IN ('verified','submitted','confirmed','failed','replaced')),
    attempt_count INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL DEFAULT 5,
    receipt_json TEXT,
    last_error TEXT,
    next_attempt_at TEXT,
    bound_kind TEXT,
    bound_subject_id TEXT,
    artifact_url TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_x402_payment_request
    ON x402_payments(service_kind, request_key, updated_at DESC);

  CREATE INDEX IF NOT EXISTS idx_x402_payment_status
    ON x402_payments(status, service_kind, next_attempt_at);

  CREATE INDEX IF NOT EXISTS idx_x402_payment_binding
    ON x402_payments(bound_kind, bound_subject_id);

  CREATE TABLE IF NOT EXISTS signer_quotes (
    quote_id TEXT PRIMARY KEY,
    provider_address TEXT NOT NULL,
    wallet_address TEXT NOT NULL,
    requester_address TEXT NOT NULL,
    target_address TEXT NOT NULL,
    value_wei TEXT NOT NULL,
    data_hex TEXT NOT NULL,
    gas TEXT NOT NULL,
    policy_id TEXT NOT NULL,
    policy_hash TEXT NOT NULL,
    scope_hash TEXT NOT NULL,
    delegate_identity TEXT,
    trust_tier TEXT NOT NULL CHECK(trust_tier IN ('self_hosted','org_trusted','public_low_trust')),
    amount_wei TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('quoted','used','expired')),
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_signer_quotes_status
    ON signer_quotes(status, expires_at DESC);

  CREATE INDEX IF NOT EXISTS idx_signer_quotes_requester
    ON signer_quotes(requester_address, updated_at DESC);

  CREATE TABLE IF NOT EXISTS signer_executions (
    execution_id TEXT PRIMARY KEY,
    quote_id TEXT NOT NULL,
    request_key TEXT NOT NULL,
    request_hash TEXT NOT NULL,
    provider_address TEXT NOT NULL,
    wallet_address TEXT NOT NULL,
    requester_address TEXT NOT NULL,
    target_address TEXT NOT NULL,
    value_wei TEXT NOT NULL,
    data_hex TEXT NOT NULL,
    gas TEXT NOT NULL,
    policy_id TEXT NOT NULL,
    policy_hash TEXT NOT NULL,
    scope_hash TEXT NOT NULL,
    delegate_identity TEXT,
    trust_tier TEXT NOT NULL CHECK(trust_tier IN ('self_hosted','org_trusted','public_low_trust')),
    request_nonce TEXT NOT NULL,
    request_expires_at INTEGER NOT NULL,
    reason TEXT,
    payment_id TEXT,
    submitted_tx_hash TEXT,
    submitted_receipt_json TEXT,
    receipt_hash TEXT,
    status TEXT NOT NULL CHECK(status IN ('pending','submitted','confirmed','failed','rejected')),
    last_error TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE UNIQUE INDEX IF NOT EXISTS idx_signer_executions_request_key
    ON signer_executions(request_key);

  CREATE INDEX IF NOT EXISTS idx_signer_executions_status
    ON signer_executions(status, updated_at DESC);

  CREATE TABLE IF NOT EXISTS paymaster_quotes (
    quote_id TEXT PRIMARY KEY,
    chain_id TEXT NOT NULL,
    provider_address TEXT NOT NULL,
    sponsor_address TEXT NOT NULL,
    sponsor_signer_type TEXT NOT NULL DEFAULT 'secp256k1',
    wallet_address TEXT NOT NULL,
    requester_address TEXT NOT NULL,
    requester_signer_type TEXT NOT NULL DEFAULT 'secp256k1',
    target_address TEXT NOT NULL,
    value_wei TEXT NOT NULL,
    data_hex TEXT NOT NULL,
    gas TEXT NOT NULL,
    policy_id TEXT NOT NULL,
    policy_hash TEXT NOT NULL,
    scope_hash TEXT NOT NULL,
    delegate_identity TEXT,
    trust_tier TEXT NOT NULL CHECK(trust_tier IN ('self_hosted','org_trusted','public_low_trust')),
    amount_wei TEXT NOT NULL,
    sponsor_nonce TEXT NOT NULL,
    sponsor_expiry INTEGER NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('quoted','used','expired')),
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_paymaster_quotes_status
    ON paymaster_quotes(status, expires_at DESC);

  CREATE INDEX IF NOT EXISTS idx_paymaster_quotes_requester
    ON paymaster_quotes(requester_address, updated_at DESC);

  CREATE TABLE IF NOT EXISTS paymaster_authorizations (
    authorization_id TEXT PRIMARY KEY,
    quote_id TEXT NOT NULL,
    chain_id TEXT NOT NULL,
    request_key TEXT NOT NULL,
    request_hash TEXT NOT NULL,
    provider_address TEXT NOT NULL,
    sponsor_address TEXT NOT NULL,
    sponsor_signer_type TEXT NOT NULL DEFAULT 'secp256k1',
    wallet_address TEXT NOT NULL,
    requester_address TEXT NOT NULL,
    requester_signer_type TEXT NOT NULL DEFAULT 'secp256k1',
    target_address TEXT NOT NULL,
    value_wei TEXT NOT NULL,
    data_hex TEXT NOT NULL,
    gas TEXT NOT NULL,
    policy_id TEXT NOT NULL,
    policy_hash TEXT NOT NULL,
    scope_hash TEXT NOT NULL,
    delegate_identity TEXT,
    trust_tier TEXT NOT NULL CHECK(trust_tier IN ('self_hosted','org_trusted','public_low_trust')),
    request_nonce TEXT NOT NULL,
    request_expires_at INTEGER NOT NULL,
    execution_nonce TEXT NOT NULL,
    sponsor_nonce TEXT NOT NULL,
    sponsor_expiry INTEGER NOT NULL,
    reason TEXT,
    payment_id TEXT,
    execution_signature_json TEXT,
    sponsor_signature_json TEXT,
    submitted_tx_hash TEXT,
    submitted_receipt_json TEXT,
    receipt_hash TEXT,
    status TEXT NOT NULL CHECK(status IN ('authorized','submitted','confirmed','failed','rejected','expired')),
    last_error TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE UNIQUE INDEX IF NOT EXISTS idx_paymaster_authorizations_request_key
    ON paymaster_authorizations(request_key);

  CREATE INDEX IF NOT EXISTS idx_paymaster_authorizations_status
    ON paymaster_authorizations(status, updated_at DESC);

  CREATE TABLE IF NOT EXISTS storage_quotes (
    quote_id TEXT PRIMARY KEY,
    requester_address TEXT NOT NULL,
    provider_address TEXT NOT NULL,
    cid TEXT NOT NULL,
    bundle_kind TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    ttl_seconds INTEGER NOT NULL,
    amount_wei TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('quoted','used','expired')),
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_storage_quotes_status
    ON storage_quotes(status, expires_at);

  CREATE TABLE IF NOT EXISTS storage_leases (
    lease_id TEXT PRIMARY KEY,
    quote_id TEXT,
    cid TEXT NOT NULL,
    bundle_hash TEXT NOT NULL,
    bundle_kind TEXT NOT NULL,
    requester_address TEXT NOT NULL,
    provider_address TEXT NOT NULL,
    provider_base_url TEXT,
    size_bytes INTEGER NOT NULL,
    ttl_seconds INTEGER NOT NULL,
    amount_wei TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('quoted','active','expired','released')),
    storage_path TEXT NOT NULL,
    request_key TEXT NOT NULL,
    payment_id TEXT,
    receipt_json TEXT NOT NULL,
    receipt_hash TEXT NOT NULL,
    anchor_tx_hash TEXT,
    anchor_receipt_json TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE UNIQUE INDEX IF NOT EXISTS idx_storage_leases_request
    ON storage_leases(request_key);

  CREATE INDEX IF NOT EXISTS idx_storage_leases_cid
    ON storage_leases(cid, status, created_at DESC);

  CREATE TABLE IF NOT EXISTS storage_renewals (
    renewal_id TEXT PRIMARY KEY,
    lease_id TEXT NOT NULL,
    cid TEXT NOT NULL,
    requester_address TEXT NOT NULL,
    provider_address TEXT NOT NULL,
    provider_base_url TEXT,
    previous_expires_at TEXT NOT NULL,
    renewed_expires_at TEXT NOT NULL,
    added_ttl_seconds INTEGER NOT NULL,
    amount_wei TEXT NOT NULL,
    payment_id TEXT,
    receipt_json TEXT NOT NULL,
    receipt_hash TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_storage_renewals_lease
    ON storage_renewals(lease_id, created_at DESC);

  CREATE INDEX IF NOT EXISTS idx_storage_renewals_cid
    ON storage_renewals(cid, created_at DESC);

  CREATE TABLE IF NOT EXISTS storage_audits (
    audit_id TEXT PRIMARY KEY,
    lease_id TEXT NOT NULL,
    cid TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('verified','failed')),
    challenge_nonce TEXT NOT NULL,
    response_hash TEXT NOT NULL,
    details_json TEXT,
    checked_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_storage_audits_lease
    ON storage_audits(lease_id, checked_at DESC);

  CREATE TABLE IF NOT EXISTS storage_anchors (
    anchor_id TEXT PRIMARY KEY,
    lease_id TEXT NOT NULL,
    summary_json TEXT NOT NULL,
    summary_hash TEXT NOT NULL,
    anchor_tx_hash TEXT,
    anchor_receipt_json TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE UNIQUE INDEX IF NOT EXISTS idx_storage_anchors_lease
    ON storage_anchors(lease_id);

  CREATE TABLE IF NOT EXISTS artifacts (
    artifact_id TEXT PRIMARY KEY,
    kind TEXT NOT NULL CHECK(kind IN ('public_news.capture','oracle.evidence','oracle.aggregate','committee.vote')),
    title TEXT NOT NULL,
    lease_id TEXT NOT NULL,
    quote_id TEXT,
    cid TEXT NOT NULL,
    bundle_hash TEXT NOT NULL,
    provider_base_url TEXT NOT NULL,
    provider_address TEXT NOT NULL,
    requester_address TEXT NOT NULL,
    source_url TEXT,
    subject_id TEXT,
    summary_text TEXT,
    result_digest TEXT,
    metadata_json TEXT,
    status TEXT NOT NULL CHECK(status IN ('stored','verified','anchored','failed')),
    verification_id TEXT,
    anchor_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_artifacts_kind_status
    ON artifacts(kind, status, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_artifacts_source_url
    ON artifacts(source_url);
  CREATE INDEX IF NOT EXISTS idx_artifacts_subject_id
    ON artifacts(subject_id);
  CREATE INDEX IF NOT EXISTS idx_artifacts_title
    ON artifacts(title);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_artifacts_lease
    ON artifacts(lease_id);

  CREATE TABLE IF NOT EXISTS artifact_verifications (
    verification_id TEXT PRIMARY KEY,
    artifact_id TEXT NOT NULL,
    receipt_json TEXT NOT NULL,
    receipt_hash TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE UNIQUE INDEX IF NOT EXISTS idx_artifact_verifications_artifact
    ON artifact_verifications(artifact_id);

  CREATE TABLE IF NOT EXISTS artifact_anchors (
    anchor_id TEXT PRIMARY KEY,
    artifact_id TEXT NOT NULL,
    summary_json TEXT NOT NULL,
    summary_hash TEXT NOT NULL,
    anchor_tx_hash TEXT,
    anchor_receipt_json TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE UNIQUE INDEX IF NOT EXISTS idx_artifact_anchors_artifact
    ON artifact_anchors(artifact_id);

  CREATE TABLE IF NOT EXISTS execution_trails (
    trail_id TEXT PRIMARY KEY,
    subject_kind TEXT NOT NULL CHECK(subject_kind IN ('storage_lease','storage_renewal','storage_audit','storage_anchor','artifact','artifact_verification','artifact_anchor')),
    subject_id TEXT NOT NULL,
    execution_kind TEXT NOT NULL CHECK(execution_kind IN ('signer_execution','paymaster_authorization')),
    execution_record_id TEXT NOT NULL,
    execution_tx_hash TEXT,
    execution_receipt_hash TEXT,
    link_mode TEXT NOT NULL CHECK(link_mode IN ('direct','derived')),
    source_subject_kind TEXT,
    source_subject_id TEXT,
    metadata_json TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE UNIQUE INDEX IF NOT EXISTS idx_execution_trails_subject_execution
    ON execution_trails(subject_kind, subject_id, execution_kind, execution_record_id);

  CREATE INDEX IF NOT EXISTS idx_execution_trails_subject
    ON execution_trails(subject_kind, subject_id, updated_at DESC);

  CREATE INDEX IF NOT EXISTS idx_execution_trails_execution
    ON execution_trails(execution_kind, execution_record_id, updated_at DESC);

  CREATE INDEX IF NOT EXISTS idx_signer_executions_tx_hash
    ON signer_executions(submitted_tx_hash);

  CREATE INDEX IF NOT EXISTS idx_signer_executions_receipt_hash
    ON signer_executions(receipt_hash);

  CREATE INDEX IF NOT EXISTS idx_paymaster_authorizations_tx_hash
    ON paymaster_authorizations(submitted_tx_hash);

  CREATE INDEX IF NOT EXISTS idx_paymaster_authorizations_receipt_hash
    ON paymaster_authorizations(receipt_hash);
`;

export const MIGRATION_V17 = `
  CREATE TABLE IF NOT EXISTS x402_payments (
    payment_id TEXT PRIMARY KEY,
    service_kind TEXT NOT NULL CHECK(service_kind IN ('observation','oracle','signer','gateway_request','gateway_session')),
    request_key TEXT NOT NULL,
    request_hash TEXT NOT NULL,
    payer_address TEXT NOT NULL,
    provider_address TEXT NOT NULL,
    chain_id TEXT NOT NULL,
    tx_nonce TEXT NOT NULL,
    tx_hash TEXT NOT NULL UNIQUE,
    raw_transaction TEXT NOT NULL,
    amount_wei TEXT NOT NULL,
    confirmation_policy TEXT NOT NULL CHECK(confirmation_policy IN ('broadcast','receipt')),
    status TEXT NOT NULL CHECK(status IN ('verified','submitted','confirmed','failed','replaced')),
    attempt_count INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL DEFAULT 5,
    receipt_json TEXT,
    last_error TEXT,
    next_attempt_at TEXT,
    bound_kind TEXT,
    bound_subject_id TEXT,
    artifact_url TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_x402_payment_request
    ON x402_payments(service_kind, request_key, updated_at DESC);

  CREATE INDEX IF NOT EXISTS idx_x402_payment_status
    ON x402_payments(status, service_kind, next_attempt_at);

  CREATE INDEX IF NOT EXISTS idx_x402_payment_binding
    ON x402_payments(bound_kind, bound_subject_id);
`;

export const MIGRATION_V18 = `
  CREATE TABLE IF NOT EXISTS x402_payments_v18 (
    payment_id TEXT PRIMARY KEY,
    service_kind TEXT NOT NULL CHECK(service_kind IN ('observation','oracle','signer','gateway_request','gateway_session','storage')),
    request_key TEXT NOT NULL,
    request_hash TEXT NOT NULL,
    payer_address TEXT NOT NULL,
    provider_address TEXT NOT NULL,
    chain_id TEXT NOT NULL,
    tx_nonce TEXT NOT NULL,
    tx_hash TEXT NOT NULL UNIQUE,
    raw_transaction TEXT NOT NULL,
    amount_wei TEXT NOT NULL,
    confirmation_policy TEXT NOT NULL CHECK(confirmation_policy IN ('broadcast','receipt')),
    status TEXT NOT NULL CHECK(status IN ('verified','submitted','confirmed','failed','replaced')),
    attempt_count INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL DEFAULT 5,
    receipt_json TEXT,
    last_error TEXT,
    next_attempt_at TEXT,
    bound_kind TEXT,
    bound_subject_id TEXT,
    artifact_url TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  INSERT INTO x402_payments_v18 (
    payment_id, service_kind, request_key, request_hash, payer_address,
    provider_address, chain_id, tx_nonce, tx_hash, raw_transaction,
    amount_wei, confirmation_policy, status, attempt_count, max_attempts,
    receipt_json, last_error, next_attempt_at, bound_kind, bound_subject_id,
    artifact_url, created_at, updated_at
  )
  SELECT
    payment_id, service_kind, request_key, request_hash, payer_address,
    provider_address, chain_id, tx_nonce, tx_hash, raw_transaction,
    amount_wei, confirmation_policy, status, attempt_count, max_attempts,
    receipt_json, last_error, next_attempt_at, bound_kind, bound_subject_id,
    artifact_url, created_at, updated_at
  FROM x402_payments;

  DROP TABLE x402_payments;
  ALTER TABLE x402_payments_v18 RENAME TO x402_payments;

  CREATE INDEX IF NOT EXISTS idx_x402_payment_request
    ON x402_payments(service_kind, request_key, updated_at DESC);

  CREATE INDEX IF NOT EXISTS idx_x402_payment_status
    ON x402_payments(status, service_kind, next_attempt_at);

  CREATE INDEX IF NOT EXISTS idx_x402_payment_binding
    ON x402_payments(bound_kind, bound_subject_id);

  CREATE TABLE IF NOT EXISTS storage_quotes (
    quote_id TEXT PRIMARY KEY,
    requester_address TEXT NOT NULL,
    provider_address TEXT NOT NULL,
    cid TEXT NOT NULL,
    bundle_kind TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    ttl_seconds INTEGER NOT NULL,
    amount_wei TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('quoted','used','expired')),
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_storage_quotes_status
    ON storage_quotes(status, expires_at);

  CREATE TABLE IF NOT EXISTS storage_leases (
    lease_id TEXT PRIMARY KEY,
    quote_id TEXT,
    cid TEXT NOT NULL,
    bundle_hash TEXT NOT NULL,
    bundle_kind TEXT NOT NULL,
    requester_address TEXT NOT NULL,
    provider_address TEXT NOT NULL,
    provider_base_url TEXT,
    size_bytes INTEGER NOT NULL,
    ttl_seconds INTEGER NOT NULL,
    amount_wei TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('quoted','active','expired','released')),
    storage_path TEXT NOT NULL,
    request_key TEXT NOT NULL,
    payment_id TEXT,
    receipt_json TEXT NOT NULL,
    receipt_hash TEXT NOT NULL,
    anchor_tx_hash TEXT,
    anchor_receipt_json TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE UNIQUE INDEX IF NOT EXISTS idx_storage_leases_request
    ON storage_leases(request_key);

  CREATE INDEX IF NOT EXISTS idx_storage_leases_cid
    ON storage_leases(cid, status, created_at DESC);

  CREATE TABLE IF NOT EXISTS storage_renewals (
    renewal_id TEXT PRIMARY KEY,
    lease_id TEXT NOT NULL,
    cid TEXT NOT NULL,
    requester_address TEXT NOT NULL,
    provider_address TEXT NOT NULL,
    provider_base_url TEXT,
    previous_expires_at TEXT NOT NULL,
    renewed_expires_at TEXT NOT NULL,
    added_ttl_seconds INTEGER NOT NULL,
    amount_wei TEXT NOT NULL,
    payment_id TEXT,
    receipt_json TEXT NOT NULL,
    receipt_hash TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_storage_renewals_lease
    ON storage_renewals(lease_id, created_at DESC);

  CREATE INDEX IF NOT EXISTS idx_storage_renewals_cid
    ON storage_renewals(cid, created_at DESC);

  CREATE TABLE IF NOT EXISTS storage_audits (
    audit_id TEXT PRIMARY KEY,
    lease_id TEXT NOT NULL,
    cid TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('verified','failed')),
    challenge_nonce TEXT NOT NULL,
    response_hash TEXT NOT NULL,
    details_json TEXT,
    checked_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_storage_audits_lease
    ON storage_audits(lease_id, checked_at DESC);

  CREATE TABLE IF NOT EXISTS storage_anchors (
    anchor_id TEXT PRIMARY KEY,
    lease_id TEXT NOT NULL,
    summary_json TEXT NOT NULL,
    summary_hash TEXT NOT NULL,
    anchor_tx_hash TEXT,
    anchor_receipt_json TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE UNIQUE INDEX IF NOT EXISTS idx_storage_anchors_lease
    ON storage_anchors(lease_id);
`;

export const MIGRATION_V19 = `
  CREATE TABLE IF NOT EXISTS artifacts (
    artifact_id TEXT PRIMARY KEY,
    kind TEXT NOT NULL CHECK(kind IN ('public_news.capture','oracle.evidence','oracle.aggregate','committee.vote')),
    title TEXT NOT NULL,
    lease_id TEXT NOT NULL,
    quote_id TEXT,
    cid TEXT NOT NULL,
    bundle_hash TEXT NOT NULL,
    provider_base_url TEXT NOT NULL,
    provider_address TEXT NOT NULL,
    requester_address TEXT NOT NULL,
    source_url TEXT,
    subject_id TEXT,
    summary_text TEXT,
    result_digest TEXT,
    metadata_json TEXT,
    status TEXT NOT NULL CHECK(status IN ('stored','verified','anchored','failed')),
    verification_id TEXT,
    anchor_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_artifacts_kind_status
    ON artifacts(kind, status, created_at DESC);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_artifacts_lease
    ON artifacts(lease_id);

  CREATE TABLE IF NOT EXISTS artifact_verifications (
    verification_id TEXT PRIMARY KEY,
    artifact_id TEXT NOT NULL,
    receipt_json TEXT NOT NULL,
    receipt_hash TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE UNIQUE INDEX IF NOT EXISTS idx_artifact_verifications_artifact
    ON artifact_verifications(artifact_id);

  CREATE TABLE IF NOT EXISTS artifact_anchors (
    anchor_id TEXT PRIMARY KEY,
    artifact_id TEXT NOT NULL,
    summary_json TEXT NOT NULL,
    summary_hash TEXT NOT NULL,
    anchor_tx_hash TEXT,
    anchor_receipt_json TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE UNIQUE INDEX IF NOT EXISTS idx_artifact_anchors_artifact
    ON artifact_anchors(artifact_id);
`;

export const MIGRATION_V20 = `
  ALTER TABLE bounty_results RENAME TO bounty_results_old;
  ALTER TABLE bounty_submissions RENAME TO bounty_submissions_old;
  ALTER TABLE bounties RENAME TO bounties_old;

  CREATE TABLE bounties (
    bounty_id TEXT PRIMARY KEY,
    host_agent_id TEXT NOT NULL,
    host_address TEXT NOT NULL,
    kind TEXT NOT NULL CHECK(kind IN ('question','translation','social_proof','problem_solving','public_news_capture','oracle_evidence_capture')),
    title TEXT NOT NULL,
    task_prompt TEXT NOT NULL,
    reference_output TEXT NOT NULL,
    skill_name TEXT,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    policy_json TEXT NOT NULL DEFAULT '{}',
    reward_wei TEXT NOT NULL,
    submission_deadline TEXT NOT NULL,
    judge_mode TEXT NOT NULL CHECK(judge_mode IN ('local_model')),
    status TEXT NOT NULL CHECK(status IN ('open','submitted','under_review','approved','rejected','paid','expired')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_bounties_status ON bounties(status, created_at);

  INSERT INTO bounties (
    bounty_id,
    host_agent_id,
    host_address,
    kind,
    title,
    task_prompt,
    reference_output,
    skill_name,
    metadata_json,
    policy_json,
    reward_wei,
    submission_deadline,
    judge_mode,
    status,
    created_at,
    updated_at
  )
  SELECT
    bounty_id,
    host_agent_id,
    host_address,
    CASE
      WHEN kind IN ('question','translation','social_proof','problem_solving','public_news_capture','oracle_evidence_capture') THEN kind
      ELSE 'question'
    END,
    title,
    task_prompt,
    reference_output,
    skill_name,
    metadata_json,
    policy_json,
    reward_wei,
    submission_deadline,
    judge_mode,
    status,
    created_at,
    updated_at
  FROM bounties_old;

  CREATE TABLE bounty_submissions (
    submission_id TEXT PRIMARY KEY,
    bounty_id TEXT NOT NULL REFERENCES bounties(bounty_id) ON DELETE CASCADE,
    solver_agent_id TEXT,
    solver_address TEXT NOT NULL,
    submission_text TEXT NOT NULL,
    proof_url TEXT,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL CHECK(status IN ('submitted','accepted','rejected')),
    submitted_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_bounty_submissions_bounty ON bounty_submissions(bounty_id, submitted_at);

  INSERT INTO bounty_submissions (
    submission_id,
    bounty_id,
    solver_agent_id,
    solver_address,
    submission_text,
    proof_url,
    metadata_json,
    status,
    submitted_at,
    updated_at
  )
  SELECT
    submission_id,
    bounty_id,
    solver_agent_id,
    solver_address,
    submission_text,
    proof_url,
    metadata_json,
    status,
    submitted_at,
    updated_at
  FROM bounty_submissions_old;

  CREATE TABLE bounty_results (
    bounty_id TEXT PRIMARY KEY REFERENCES bounties(bounty_id) ON DELETE CASCADE,
    winning_submission_id TEXT,
    decision TEXT NOT NULL CHECK(decision IN ('accepted','rejected')),
    confidence REAL NOT NULL,
    judge_reason TEXT NOT NULL,
    payout_tx_hash TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  INSERT INTO bounty_results (
    bounty_id,
    winning_submission_id,
    decision,
    confidence,
    judge_reason,
    payout_tx_hash,
    created_at,
    updated_at
  )
  SELECT
    bounty_id,
    winning_submission_id,
    decision,
    confidence,
    judge_reason,
    payout_tx_hash,
    created_at,
    updated_at
  FROM bounty_results_old;

  DROP TABLE bounty_results_old;
  DROP TABLE bounty_submissions_old;
  DROP TABLE bounties_old;

  CREATE INDEX IF NOT EXISTS idx_artifacts_source_url
    ON artifacts(source_url);
  CREATE INDEX IF NOT EXISTS idx_artifacts_subject_id
    ON artifacts(subject_id);
  CREATE INDEX IF NOT EXISTS idx_artifacts_title
    ON artifacts(title);
`;

export const MIGRATION_V21 = `
  ALTER TABLE storage_leases ADD COLUMN provider_base_url TEXT;

  CREATE TABLE IF NOT EXISTS storage_renewals (
    renewal_id TEXT PRIMARY KEY,
    lease_id TEXT NOT NULL,
    cid TEXT NOT NULL,
    requester_address TEXT NOT NULL,
    provider_address TEXT NOT NULL,
    provider_base_url TEXT,
    previous_expires_at TEXT NOT NULL,
    renewed_expires_at TEXT NOT NULL,
    added_ttl_seconds INTEGER NOT NULL,
    amount_wei TEXT NOT NULL,
    payment_id TEXT,
    receipt_json TEXT NOT NULL,
    receipt_hash TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_storage_renewals_lease
    ON storage_renewals(lease_id, created_at DESC);

  CREATE INDEX IF NOT EXISTS idx_storage_renewals_cid
    ON storage_renewals(cid, created_at DESC);
`;

export const MIGRATION_V22 = `
  CREATE TABLE IF NOT EXISTS x402_payments_v22 (
    payment_id TEXT PRIMARY KEY,
    service_kind TEXT NOT NULL CHECK(service_kind IN ('observation','oracle','signer','gateway_request','gateway_session','storage')),
    request_key TEXT NOT NULL,
    request_hash TEXT NOT NULL,
    payer_address TEXT NOT NULL,
    provider_address TEXT NOT NULL,
    chain_id TEXT NOT NULL,
    tx_nonce TEXT NOT NULL,
    tx_hash TEXT NOT NULL UNIQUE,
    raw_transaction TEXT NOT NULL,
    amount_wei TEXT NOT NULL,
    confirmation_policy TEXT NOT NULL CHECK(confirmation_policy IN ('broadcast','receipt')),
    status TEXT NOT NULL CHECK(status IN ('verified','submitted','confirmed','failed','replaced')),
    attempt_count INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL DEFAULT 5,
    receipt_json TEXT,
    last_error TEXT,
    next_attempt_at TEXT,
    bound_kind TEXT,
    bound_subject_id TEXT,
    artifact_url TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  INSERT INTO x402_payments_v22 (
    payment_id, service_kind, request_key, request_hash, payer_address,
    provider_address, chain_id, tx_nonce, tx_hash, raw_transaction,
    amount_wei, confirmation_policy, status, attempt_count, max_attempts,
    receipt_json, last_error, next_attempt_at, bound_kind, bound_subject_id,
    artifact_url, created_at, updated_at
  )
  SELECT
    payment_id, service_kind, request_key, request_hash, payer_address,
    provider_address, chain_id, tx_nonce, tx_hash, raw_transaction,
    amount_wei, confirmation_policy, status, attempt_count, max_attempts,
    receipt_json, last_error, next_attempt_at, bound_kind, bound_subject_id,
    artifact_url, created_at, updated_at
  FROM x402_payments;

  DROP TABLE x402_payments;
  ALTER TABLE x402_payments_v22 RENAME TO x402_payments;

  CREATE INDEX IF NOT EXISTS idx_x402_payment_request
    ON x402_payments(service_kind, request_key, updated_at DESC);

  CREATE INDEX IF NOT EXISTS idx_x402_payment_status
    ON x402_payments(status, service_kind, next_attempt_at);

  CREATE INDEX IF NOT EXISTS idx_x402_payment_binding
    ON x402_payments(bound_kind, bound_subject_id);

  CREATE TABLE IF NOT EXISTS signer_quotes (
    quote_id TEXT PRIMARY KEY,
    provider_address TEXT NOT NULL,
    wallet_address TEXT NOT NULL,
    requester_address TEXT NOT NULL,
    target_address TEXT NOT NULL,
    value_wei TEXT NOT NULL,
    data_hex TEXT NOT NULL,
    gas TEXT NOT NULL,
    policy_id TEXT NOT NULL,
    policy_hash TEXT NOT NULL,
    scope_hash TEXT NOT NULL,
    delegate_identity TEXT,
    trust_tier TEXT NOT NULL CHECK(trust_tier IN ('self_hosted','org_trusted','public_low_trust')),
    amount_wei TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('quoted','used','expired')),
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_signer_quotes_status
    ON signer_quotes(status, expires_at DESC);

  CREATE INDEX IF NOT EXISTS idx_signer_quotes_requester
    ON signer_quotes(requester_address, updated_at DESC);

  CREATE TABLE IF NOT EXISTS signer_executions (
    execution_id TEXT PRIMARY KEY,
    quote_id TEXT NOT NULL,
    request_key TEXT NOT NULL,
    request_hash TEXT NOT NULL,
    provider_address TEXT NOT NULL,
    wallet_address TEXT NOT NULL,
    requester_address TEXT NOT NULL,
    target_address TEXT NOT NULL,
    value_wei TEXT NOT NULL,
    data_hex TEXT NOT NULL,
    gas TEXT NOT NULL,
    policy_id TEXT NOT NULL,
    policy_hash TEXT NOT NULL,
    scope_hash TEXT NOT NULL,
    delegate_identity TEXT,
    trust_tier TEXT NOT NULL CHECK(trust_tier IN ('self_hosted','org_trusted','public_low_trust')),
    request_nonce TEXT NOT NULL,
    request_expires_at INTEGER NOT NULL,
    reason TEXT,
    payment_id TEXT,
    submitted_tx_hash TEXT,
    submitted_receipt_json TEXT,
    receipt_hash TEXT,
    status TEXT NOT NULL CHECK(status IN ('pending','submitted','confirmed','failed','rejected')),
    last_error TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE UNIQUE INDEX IF NOT EXISTS idx_signer_executions_request_key
    ON signer_executions(request_key);

  CREATE INDEX IF NOT EXISTS idx_signer_executions_status
    ON signer_executions(status, updated_at DESC);
`;

export const MIGRATION_V23 = `
  CREATE TABLE IF NOT EXISTS x402_payments_v23 (
    payment_id TEXT PRIMARY KEY,
    service_kind TEXT NOT NULL CHECK(service_kind IN ('observation','oracle','signer','paymaster','gateway_request','gateway_session','storage')),
    request_key TEXT NOT NULL,
    request_hash TEXT NOT NULL,
    payer_address TEXT NOT NULL,
    provider_address TEXT NOT NULL,
    chain_id TEXT NOT NULL,
    tx_nonce TEXT NOT NULL,
    tx_hash TEXT NOT NULL UNIQUE,
    raw_transaction TEXT NOT NULL,
    amount_wei TEXT NOT NULL,
    confirmation_policy TEXT NOT NULL CHECK(confirmation_policy IN ('broadcast','receipt')),
    status TEXT NOT NULL CHECK(status IN ('verified','submitted','confirmed','failed','replaced')),
    attempt_count INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL DEFAULT 5,
    receipt_json TEXT,
    last_error TEXT,
    next_attempt_at TEXT,
    bound_kind TEXT,
    bound_subject_id TEXT,
    artifact_url TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  INSERT INTO x402_payments_v23 (
    payment_id, service_kind, request_key, request_hash, payer_address,
    provider_address, chain_id, tx_nonce, tx_hash, raw_transaction,
    amount_wei, confirmation_policy, status, attempt_count, max_attempts,
    receipt_json, last_error, next_attempt_at, bound_kind, bound_subject_id,
    artifact_url, created_at, updated_at
  )
  SELECT
    payment_id, service_kind, request_key, request_hash, payer_address,
    provider_address, chain_id, tx_nonce, tx_hash, raw_transaction,
    amount_wei, confirmation_policy, status, attempt_count, max_attempts,
    receipt_json, last_error, next_attempt_at, bound_kind, bound_subject_id,
    artifact_url, created_at, updated_at
  FROM x402_payments;

  DROP TABLE x402_payments;
  ALTER TABLE x402_payments_v23 RENAME TO x402_payments;

  CREATE INDEX IF NOT EXISTS idx_x402_payment_request
    ON x402_payments(service_kind, request_key, updated_at DESC);

  CREATE INDEX IF NOT EXISTS idx_x402_payment_status
    ON x402_payments(status, service_kind, next_attempt_at);

  CREATE INDEX IF NOT EXISTS idx_x402_payment_binding
    ON x402_payments(bound_kind, bound_subject_id);

  CREATE TABLE IF NOT EXISTS paymaster_quotes (
    quote_id TEXT PRIMARY KEY,
    provider_address TEXT NOT NULL,
    sponsor_address TEXT NOT NULL,
    sponsor_signer_type TEXT NOT NULL DEFAULT 'secp256k1',
    wallet_address TEXT NOT NULL,
    requester_address TEXT NOT NULL,
    requester_signer_type TEXT NOT NULL DEFAULT 'secp256k1',
    target_address TEXT NOT NULL,
    value_wei TEXT NOT NULL,
    data_hex TEXT NOT NULL,
    gas TEXT NOT NULL,
    policy_id TEXT NOT NULL,
    policy_hash TEXT NOT NULL,
    scope_hash TEXT NOT NULL,
    delegate_identity TEXT,
    trust_tier TEXT NOT NULL CHECK(trust_tier IN ('self_hosted','org_trusted','public_low_trust')),
    amount_wei TEXT NOT NULL,
    sponsor_nonce TEXT NOT NULL,
    sponsor_expiry INTEGER NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('quoted','used','expired')),
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_paymaster_quotes_status
    ON paymaster_quotes(status, expires_at DESC);

  CREATE INDEX IF NOT EXISTS idx_paymaster_quotes_requester
    ON paymaster_quotes(requester_address, updated_at DESC);

  CREATE TABLE IF NOT EXISTS paymaster_authorizations (
    authorization_id TEXT PRIMARY KEY,
    quote_id TEXT NOT NULL,
    request_key TEXT NOT NULL,
    request_hash TEXT NOT NULL,
    provider_address TEXT NOT NULL,
    sponsor_address TEXT NOT NULL,
    sponsor_signer_type TEXT NOT NULL DEFAULT 'secp256k1',
    wallet_address TEXT NOT NULL,
    requester_address TEXT NOT NULL,
    requester_signer_type TEXT NOT NULL DEFAULT 'secp256k1',
    target_address TEXT NOT NULL,
    value_wei TEXT NOT NULL,
    data_hex TEXT NOT NULL,
    gas TEXT NOT NULL,
    policy_id TEXT NOT NULL,
    policy_hash TEXT NOT NULL,
    scope_hash TEXT NOT NULL,
    delegate_identity TEXT,
    trust_tier TEXT NOT NULL CHECK(trust_tier IN ('self_hosted','org_trusted','public_low_trust')),
    request_nonce TEXT NOT NULL,
    request_expires_at INTEGER NOT NULL,
    sponsor_nonce TEXT NOT NULL,
    sponsor_expiry INTEGER NOT NULL,
    reason TEXT,
    payment_id TEXT,
    execution_signature_json TEXT,
    sponsor_signature_json TEXT,
    submitted_tx_hash TEXT,
    submitted_receipt_json TEXT,
    receipt_hash TEXT,
    status TEXT NOT NULL CHECK(status IN ('authorized','submitted','confirmed','failed','rejected','expired')),
    last_error TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE UNIQUE INDEX IF NOT EXISTS idx_paymaster_authorizations_request_key
    ON paymaster_authorizations(request_key);

  CREATE INDEX IF NOT EXISTS idx_paymaster_authorizations_status
    ON paymaster_authorizations(status, updated_at DESC);
`;

export const MIGRATION_V24 = `
  ALTER TABLE paymaster_quotes
    ADD COLUMN chain_id TEXT NOT NULL DEFAULT '0';

  ALTER TABLE paymaster_authorizations
    ADD COLUMN chain_id TEXT NOT NULL DEFAULT '0';

  ALTER TABLE paymaster_authorizations
    ADD COLUMN execution_nonce TEXT NOT NULL DEFAULT '0';
`;

export const MIGRATION_V26 = `
  CREATE TABLE IF NOT EXISTS execution_trails (
    trail_id TEXT PRIMARY KEY,
    subject_kind TEXT NOT NULL CHECK(subject_kind IN ('storage_lease','storage_renewal','storage_audit','storage_anchor','artifact','artifact_verification','artifact_anchor')),
    subject_id TEXT NOT NULL,
    execution_kind TEXT NOT NULL CHECK(execution_kind IN ('signer_execution','paymaster_authorization')),
    execution_record_id TEXT NOT NULL,
    execution_tx_hash TEXT,
    execution_receipt_hash TEXT,
    link_mode TEXT NOT NULL CHECK(link_mode IN ('direct','derived')),
    source_subject_kind TEXT,
    source_subject_id TEXT,
    metadata_json TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE UNIQUE INDEX IF NOT EXISTS idx_execution_trails_subject_execution
    ON execution_trails(subject_kind, subject_id, execution_kind, execution_record_id);

  CREATE INDEX IF NOT EXISTS idx_execution_trails_subject
    ON execution_trails(subject_kind, subject_id, updated_at DESC);

  CREATE INDEX IF NOT EXISTS idx_execution_trails_execution
    ON execution_trails(execution_kind, execution_record_id, updated_at DESC);

  CREATE INDEX IF NOT EXISTS idx_signer_executions_tx_hash
    ON signer_executions(submitted_tx_hash);

  CREATE INDEX IF NOT EXISTS idx_signer_executions_receipt_hash
    ON signer_executions(receipt_hash);

  CREATE INDEX IF NOT EXISTS idx_paymaster_authorizations_tx_hash
    ON paymaster_authorizations(submitted_tx_hash);

  CREATE INDEX IF NOT EXISTS idx_paymaster_authorizations_receipt_hash
    ON paymaster_authorizations(receipt_hash);
`;

export const MIGRATION_V27 = `
  CREATE TABLE IF NOT EXISTS campaigns (
    campaign_id TEXT PRIMARY KEY,
    host_agent_id TEXT NOT NULL,
    host_address TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    budget_wei TEXT NOT NULL,
    max_open_bounties INTEGER NOT NULL,
    allowed_kinds_json TEXT NOT NULL DEFAULT '[]',
    metadata_json TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL CHECK(status IN ('open','paused','exhausted','completed')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_campaigns_status
    ON campaigns(status, created_at);

  ALTER TABLE bounties
    ADD COLUMN campaign_id TEXT REFERENCES campaigns(campaign_id) ON DELETE SET NULL;

  CREATE INDEX IF NOT EXISTS idx_bounties_campaign
    ON bounties(campaign_id, created_at);
`;

export const MIGRATION_V28 = `
  CREATE TABLE IF NOT EXISTS operator_control_events (
    event_id TEXT PRIMARY KEY,
    action TEXT NOT NULL CHECK(action IN ('pause','resume','drain','retry_payments','retry_settlement','retry_market','retry_signer','retry_paymaster')),
    status TEXT NOT NULL CHECK(status IN ('applied','noop','failed')),
    actor TEXT NOT NULL,
    reason TEXT,
    summary TEXT,
    result_json TEXT,
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_operator_control_events_created
    ON operator_control_events(created_at DESC);

  CREATE INDEX IF NOT EXISTS idx_operator_control_events_action
    ON operator_control_events(action, created_at DESC);

  CREATE INDEX IF NOT EXISTS idx_operator_control_events_status
    ON operator_control_events(status, created_at DESC);
`;

export const MIGRATION_V29 = `
  ALTER TABLE operator_control_events RENAME TO operator_control_events_legacy;

  CREATE TABLE operator_control_events (
    event_id TEXT PRIMARY KEY,
    action TEXT NOT NULL CHECK(action IN ('pause','resume','drain','maintain_storage','maintain_artifacts','quarantine_provider','retry_payments','retry_settlement','retry_market','retry_signer','retry_paymaster')),
    status TEXT NOT NULL CHECK(status IN ('applied','noop','failed')),
    actor TEXT NOT NULL,
    reason TEXT,
    summary TEXT,
    result_json TEXT,
    created_at TEXT NOT NULL
  );

  INSERT INTO operator_control_events (
    event_id, action, status, actor, reason, summary, result_json, created_at
  )
  SELECT
    event_id, action, status, actor, reason, summary, result_json, created_at
  FROM operator_control_events_legacy;

  DROP TABLE operator_control_events_legacy;

  CREATE INDEX IF NOT EXISTS idx_operator_control_events_created
    ON operator_control_events(created_at DESC);

  CREATE INDEX IF NOT EXISTS idx_operator_control_events_action
    ON operator_control_events(action, created_at DESC);

  CREATE INDEX IF NOT EXISTS idx_operator_control_events_status
    ON operator_control_events(status, created_at DESC);

  CREATE TABLE IF NOT EXISTS operator_approval_requests (
    request_id TEXT PRIMARY KEY,
    kind TEXT NOT NULL CHECK(kind IN ('treasury_policy_change','spend_cap_change','signer_policy_change','paymaster_policy_change')),
    scope TEXT NOT NULL,
    requested_by TEXT NOT NULL,
    reason TEXT,
    payload_json TEXT,
    status TEXT NOT NULL CHECK(status IN ('pending','approved','rejected','expired')),
    expires_at TEXT,
    created_at TEXT NOT NULL,
    decided_at TEXT,
    decided_by TEXT,
    decision_note TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_operator_approval_requests_created
    ON operator_approval_requests(created_at DESC);

  CREATE INDEX IF NOT EXISTS idx_operator_approval_requests_status
    ON operator_approval_requests(status, created_at DESC);

  CREATE INDEX IF NOT EXISTS idx_operator_approval_requests_kind
    ON operator_approval_requests(kind, created_at DESC);
`;

export const MIGRATION_V3 = `
  CREATE TABLE IF NOT EXISTS inbox_messages (
    id TEXT PRIMARY KEY,
    from_address TEXT NOT NULL,
    content TEXT NOT NULL,
    received_at TEXT NOT NULL DEFAULT (datetime('now')),
    processed_at TEXT,
    reply_to TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_inbox_unprocessed
    ON inbox_messages(received_at) WHERE processed_at IS NULL;
`;

export const MIGRATION_V4 = `
  -- Policy decisions table
  CREATE TABLE IF NOT EXISTS policy_decisions (
    id TEXT PRIMARY KEY,
    turn_id TEXT,
    tool_name TEXT NOT NULL,
    tool_args_hash TEXT NOT NULL,
    risk_level TEXT NOT NULL CHECK(risk_level IN ('safe','caution','dangerous','forbidden')),
    decision TEXT NOT NULL CHECK(decision IN ('allow','deny','quarantine')),
    rules_evaluated TEXT NOT NULL DEFAULT '[]',
    rules_triggered TEXT NOT NULL DEFAULT '[]',
    reason TEXT NOT NULL DEFAULT '',
    latency_ms INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_policy_decisions_turn ON policy_decisions(turn_id);
  CREATE INDEX IF NOT EXISTS idx_policy_decisions_tool ON policy_decisions(tool_name);
  CREATE INDEX IF NOT EXISTS idx_policy_decisions_decision ON policy_decisions(decision);

  -- Spend tracking table
  CREATE TABLE IF NOT EXISTS spend_tracking (
    id TEXT PRIMARY KEY,
    tool_name TEXT NOT NULL,
    amount_cents INTEGER NOT NULL,
    recipient TEXT,
    domain TEXT,
    category TEXT NOT NULL CHECK(category IN ('transfer','x402','inference','other')),
    window_hour TEXT NOT NULL,
    window_day TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_spend_hour ON spend_tracking(category, window_hour);
  CREATE INDEX IF NOT EXISTS idx_spend_day ON spend_tracking(category, window_day);

  -- Heartbeat schedule (Phase 1.1)
  CREATE TABLE IF NOT EXISTS heartbeat_schedule (
    task_name TEXT PRIMARY KEY,
    cron_expression TEXT NOT NULL,
    interval_ms INTEGER,
    enabled INTEGER NOT NULL DEFAULT 1,
    priority INTEGER NOT NULL DEFAULT 0,
    timeout_ms INTEGER NOT NULL DEFAULT 30000,
    max_retries INTEGER NOT NULL DEFAULT 1,
    tier_minimum TEXT NOT NULL DEFAULT 'dead'
      CHECK(tier_minimum IN ('dead','critical','low_compute','normal','high')),
    last_run_at TEXT,
    next_run_at TEXT,
    last_result TEXT CHECK(last_result IN ('success','failure','timeout','skipped') OR last_result IS NULL),
    last_error TEXT,
    run_count INTEGER NOT NULL DEFAULT 0,
    fail_count INTEGER NOT NULL DEFAULT 0,
    lease_owner TEXT,
    lease_expires_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Heartbeat history (Phase 1.1)
  CREATE TABLE IF NOT EXISTS heartbeat_history (
    id TEXT PRIMARY KEY,
    task_name TEXT NOT NULL REFERENCES heartbeat_schedule(task_name),
    started_at TEXT NOT NULL,
    completed_at TEXT,
    result TEXT NOT NULL CHECK(result IN ('success','failure','timeout','skipped')),
    duration_ms INTEGER,
    error TEXT,
    idempotency_key TEXT UNIQUE,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_hb_history_task ON heartbeat_history(task_name, started_at);

  -- Wake events (Phase 1.1)
  CREATE TABLE IF NOT EXISTS wake_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source TEXT NOT NULL,
    reason TEXT NOT NULL,
    payload TEXT DEFAULT '{}',
    consumed_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_wake_unconsumed ON wake_events(created_at) WHERE consumed_at IS NULL;

  -- Heartbeat dedup (Phase 1.1)
  CREATE TABLE IF NOT EXISTS heartbeat_dedup (
    dedup_key TEXT PRIMARY KEY,
    task_name TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_dedup_expires ON heartbeat_dedup(expires_at);

  -- Data migration: heartbeat_entries -> heartbeat_schedule
  INSERT OR IGNORE INTO heartbeat_schedule (task_name, cron_expression, enabled, last_run_at, next_run_at)
  SELECT name, schedule, enabled, last_run, next_run FROM heartbeat_entries;
`;

// Inbox modifications for V4 (ALTER TABLE must be run separately from CREATE TABLE)
export const MIGRATION_V4_ALTER = `
  ALTER TABLE inbox_messages ADD COLUMN to_address TEXT;
`;

export const MIGRATION_V4_ALTER2 = `
  ALTER TABLE inbox_messages ADD COLUMN raw_content TEXT;
`;

// Inbox state machine columns (Phase 1.2)
// Note: SQLite ALTER TABLE ADD COLUMN cannot include CHECK constraints,
// so status validation is enforced at the application level.
export const MIGRATION_V4_ALTER_INBOX_STATUS = `
  ALTER TABLE inbox_messages ADD COLUMN status TEXT DEFAULT 'received';
`;

export const MIGRATION_V4_ALTER_INBOX_RETRY = `
  ALTER TABLE inbox_messages ADD COLUMN retry_count INTEGER DEFAULT 0;
`;

export const MIGRATION_V4_ALTER_INBOX_MAX_RETRIES = `
  ALTER TABLE inbox_messages ADD COLUMN max_retries INTEGER DEFAULT 3;
`;

export const MIGRATION_V2 = `
  CREATE TABLE IF NOT EXISTS skills (
    name TEXT PRIMARY KEY,
    description TEXT NOT NULL DEFAULT '',
    auto_activate INTEGER NOT NULL DEFAULT 1,
    requires TEXT DEFAULT '{}',
    instructions TEXT NOT NULL DEFAULT '',
    source TEXT NOT NULL DEFAULT 'builtin',
    path TEXT NOT NULL DEFAULT '',
    enabled INTEGER NOT NULL DEFAULT 1,
    installed_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS children (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    address TEXT NOT NULL,
    sandbox_id TEXT NOT NULL,
    genesis_prompt TEXT NOT NULL,
    creator_message TEXT,
    funded_amount_cents INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'spawning',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_checked TEXT
  );

  CREATE TABLE IF NOT EXISTS reputation (
    id TEXT PRIMARY KEY,
    from_agent TEXT NOT NULL,
    to_agent TEXT NOT NULL,
    score INTEGER NOT NULL,
    comment TEXT NOT NULL DEFAULT '',
    tx_hash TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_skills_enabled ON skills(enabled);
  CREATE INDEX IF NOT EXISTS idx_children_status ON children(status);
  CREATE INDEX IF NOT EXISTS idx_reputation_to ON reputation(to_agent);
`;

// === Phase 2.1 + 2.2: Soul + Memory Tables ===

export const MIGRATION_V5 = `
  -- === Phase 2.1: Soul System ===

  CREATE TABLE IF NOT EXISTS soul_history (
    id TEXT PRIMARY KEY,
    version INTEGER NOT NULL,
    content TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    change_source TEXT NOT NULL CHECK(change_source IN ('agent','human','system','genesis','reflection')),
    change_reason TEXT,
    previous_version_id TEXT REFERENCES soul_history(id),
    approved_by TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_soul_version ON soul_history(version);

  -- === Phase 2.2: Memory System ===

  CREATE TABLE IF NOT EXISTS working_memory (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    content TEXT NOT NULL,
    content_type TEXT NOT NULL CHECK(content_type IN ('goal','observation','plan','reflection','task','decision','note','summary')),
    priority REAL NOT NULL DEFAULT 0.5,
    token_count INTEGER NOT NULL DEFAULT 0,
    expires_at TEXT,
    source_turn TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_wm_session ON working_memory(session_id, priority);

  CREATE TABLE IF NOT EXISTS episodic_memory (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    summary TEXT NOT NULL,
    detail TEXT,
    outcome TEXT CHECK(outcome IN ('success','failure','partial','neutral') OR outcome IS NULL),
    importance REAL NOT NULL DEFAULT 0.5,
    embedding_key TEXT,
    token_count INTEGER NOT NULL DEFAULT 0,
    accessed_count INTEGER NOT NULL DEFAULT 0,
    last_accessed_at TEXT,
    classification TEXT NOT NULL DEFAULT 'maintenance' CHECK(classification IN ('strategic','productive','communication','maintenance','idle','error')),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_episodic_type ON episodic_memory(event_type);
  CREATE INDEX IF NOT EXISTS idx_episodic_importance ON episodic_memory(importance);
  CREATE INDEX IF NOT EXISTS idx_episodic_classification ON episodic_memory(classification);

  CREATE TABLE IF NOT EXISTS session_summaries (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL UNIQUE,
    summary TEXT NOT NULL,
    key_decisions TEXT NOT NULL DEFAULT '[]',
    tools_used TEXT NOT NULL DEFAULT '[]',
    outcomes TEXT NOT NULL DEFAULT '[]',
    turn_count INTEGER NOT NULL DEFAULT 0,
    total_tokens INTEGER NOT NULL DEFAULT 0,
    total_cost_cents INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS semantic_memory (
    id TEXT PRIMARY KEY,
    category TEXT NOT NULL CHECK(category IN ('self','environment','financial','agent','domain','procedural_ref','creator')),
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    confidence REAL NOT NULL DEFAULT 1.0,
    source TEXT NOT NULL,
    embedding_key TEXT,
    last_verified_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(category, key)
  );

  CREATE INDEX IF NOT EXISTS idx_semantic_category ON semantic_memory(category);

  CREATE TABLE IF NOT EXISTS procedural_memory (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    description TEXT NOT NULL,
    steps TEXT NOT NULL,
    success_count INTEGER NOT NULL DEFAULT 0,
    failure_count INTEGER NOT NULL DEFAULT 0,
    last_used_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS relationship_memory (
    id TEXT PRIMARY KEY,
    entity_address TEXT NOT NULL UNIQUE,
    entity_name TEXT,
    relationship_type TEXT NOT NULL,
    trust_score REAL NOT NULL DEFAULT 0.5,
    interaction_count INTEGER NOT NULL DEFAULT 0,
    last_interaction_at TEXT,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_rel_trust ON relationship_memory(trust_score);
`;

// === Phase 2.3: Inference & Model Strategy Tables ===

export const MIGRATION_V6 = `
  -- === Phase 2.3: Inference & Model Strategy ===

  CREATE TABLE IF NOT EXISTS inference_costs (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    turn_id TEXT,
    model TEXT NOT NULL,
    provider TEXT NOT NULL,
    input_tokens INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    cost_cents INTEGER NOT NULL DEFAULT 0,
    latency_ms INTEGER NOT NULL DEFAULT 0,
    tier TEXT NOT NULL,
    task_type TEXT NOT NULL CHECK(task_type IN ('agent_turn','heartbeat_triage','safety_check','summarization','planning')),
    cache_hit INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_inf_session ON inference_costs(session_id);
  CREATE INDEX IF NOT EXISTS idx_inf_model ON inference_costs(model);
  CREATE INDEX IF NOT EXISTS idx_inf_created ON inference_costs(created_at);
  CREATE INDEX IF NOT EXISTS idx_inf_task ON inference_costs(task_type);

  CREATE TABLE IF NOT EXISTS model_registry (
    model_id TEXT PRIMARY KEY,
    provider TEXT NOT NULL,
    display_name TEXT NOT NULL,
    tier_minimum TEXT NOT NULL DEFAULT 'normal',
    cost_per_1k_input INTEGER NOT NULL DEFAULT 0,
    cost_per_1k_output INTEGER NOT NULL DEFAULT 0,
    max_tokens INTEGER NOT NULL DEFAULT 4096,
    context_window INTEGER NOT NULL DEFAULT 128000,
    supports_tools INTEGER NOT NULL DEFAULT 1,
    supports_vision INTEGER NOT NULL DEFAULT 0,
    parameter_style TEXT NOT NULL DEFAULT 'max_tokens' CHECK(parameter_style IN ('max_tokens','max_completion_tokens')),
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`;

// === Phase 3: Replication + Social ===

export const MIGRATION_V7 = `
  -- === Phase 3.1: Replication Lifecycle ===

  CREATE TABLE IF NOT EXISTS child_lifecycle_events (
    id TEXT PRIMARY KEY,
    child_id TEXT NOT NULL,
    from_state TEXT NOT NULL,
    to_state TEXT NOT NULL CHECK(to_state IN (
      'requested','sandbox_created','runtime_ready','wallet_verified',
      'funded','starting','healthy','unhealthy','stopped','failed','cleaned_up'
    )),
    reason TEXT,
    metadata TEXT DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_child_events ON child_lifecycle_events(child_id, created_at);

  -- === Phase 3.2: On-chain Activity ===

  CREATE TABLE IF NOT EXISTS onchain_transactions (
    id TEXT PRIMARY KEY,
    tx_hash TEXT NOT NULL UNIQUE,
    chain TEXT NOT NULL,
    operation TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('pending','confirmed','failed')),
    gas_used INTEGER,
    metadata TEXT DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_onchain_status ON onchain_transactions(status);
`;

// === Phase 4.1: Observability ===

export const MIGRATION_V8 = `
  -- === Phase 4.1: Observability ===

  CREATE TABLE IF NOT EXISTS metric_snapshots (
    id TEXT PRIMARY KEY,
    snapshot_at TEXT NOT NULL,
    metrics_json TEXT NOT NULL DEFAULT '[]',
    alerts_json TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_metric_snapshots_at ON metric_snapshots(snapshot_at);
`;

// === Plan A: Orchestration + Memory ===

export const MIGRATION_V9 = `
  -- Schema version: 9
  -- Tables: goals, task_graph, event_stream

  CREATE TABLE goals (
    id TEXT PRIMARY KEY,                    -- ULID
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',  -- active|completed|failed|paused
    strategy TEXT,
    expected_revenue_cents INTEGER DEFAULT 0,
    actual_revenue_cents INTEGER DEFAULT 0,
    created_at TEXT NOT NULL,
    deadline TEXT,
    completed_at TEXT
  );

  CREATE TABLE task_graph (
    id TEXT PRIMARY KEY,                    -- ULID
    parent_id TEXT,                         -- parent task (decomposition)
    goal_id TEXT NOT NULL REFERENCES goals(id),
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending', -- pending|assigned|running|completed|failed|blocked|cancelled
    assigned_to TEXT,                       -- agent wallet address (0x...)
    agent_role TEXT,                        -- predefined role name
    priority INTEGER DEFAULT 50,           -- 0-100
    dependencies TEXT DEFAULT '[]',        -- JSON array of task IDs
    result TEXT,                           -- JSON TaskResult
    estimated_cost_cents INTEGER DEFAULT 0,
    actual_cost_cents INTEGER DEFAULT 0,
    max_retries INTEGER DEFAULT 3,
    retry_count INTEGER DEFAULT 0,
    timeout_ms INTEGER DEFAULT 300000,
    created_at TEXT NOT NULL,
    started_at TEXT,
    completed_at TEXT
  );

  CREATE INDEX idx_task_graph_goal ON task_graph(goal_id);
  CREATE INDEX idx_task_graph_status ON task_graph(status);
  CREATE INDEX idx_task_graph_assigned ON task_graph(assigned_to);

  CREATE TABLE event_stream (
    id TEXT PRIMARY KEY,                    -- ULID
    type TEXT NOT NULL,                     -- EventType enum
    agent_address TEXT NOT NULL,
    goal_id TEXT,
    task_id TEXT,
    content TEXT NOT NULL,
    token_count INTEGER NOT NULL,
    compacted_to TEXT,
    created_at TEXT NOT NULL
  );

  CREATE INDEX idx_events_agent ON event_stream(agent_address, created_at);
  CREATE INDEX idx_events_goal ON event_stream(goal_id, created_at);
  CREATE INDEX idx_events_type ON event_stream(type, created_at);
`;

// Role column for children table (must be separate statement for SQLite ALTER)
export const MIGRATION_V9_ALTER_CHILDREN_ROLE = `
  ALTER TABLE children ADD COLUMN role TEXT DEFAULT 'generalist';
`;

export const MIGRATION_V10 = `
  -- Schema version: 10
  -- Tables: knowledge_store

  CREATE TABLE knowledge_store (
    id TEXT PRIMARY KEY,                    -- ULID
    category TEXT NOT NULL,                 -- market|technical|social|financial|operational
    key TEXT NOT NULL,
    content TEXT NOT NULL,
    source TEXT NOT NULL,                   -- agent address that contributed
    confidence REAL DEFAULT 1.0,
    last_verified TEXT NOT NULL,
    access_count INTEGER DEFAULT 0,
    token_count INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    expires_at TEXT
  );

  CREATE INDEX idx_knowledge_category ON knowledge_store(category);
  CREATE INDEX idx_knowledge_key ON knowledge_store(key);
`;

export const MIGRATION_V11 = `
  DROP TABLE IF EXISTS registry;
  DROP TABLE IF EXISTS discovered_agents_cache;
`;

export const MIGRATION_V12 = `
  CREATE TABLE IF NOT EXISTS bounties (
    bounty_id TEXT PRIMARY KEY,
    host_agent_id TEXT NOT NULL,
    host_address TEXT NOT NULL,
    kind TEXT NOT NULL CHECK(kind IN ('question')),
    question TEXT NOT NULL,
    reference_answer TEXT NOT NULL,
    reward_wei TEXT NOT NULL,
    submission_deadline TEXT NOT NULL,
    judge_mode TEXT NOT NULL CHECK(judge_mode IN ('local_model')),
    status TEXT NOT NULL CHECK(status IN ('open','submitted','under_review','approved','rejected','paid','expired')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_bounties_status ON bounties(status, created_at);

  CREATE TABLE IF NOT EXISTS bounty_submissions (
    submission_id TEXT PRIMARY KEY,
    bounty_id TEXT NOT NULL REFERENCES bounties(bounty_id) ON DELETE CASCADE,
    solver_agent_id TEXT,
    solver_address TEXT NOT NULL,
    answer TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('submitted','accepted','rejected')),
    submitted_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_bounty_submissions_bounty ON bounty_submissions(bounty_id, submitted_at);

  CREATE TABLE IF NOT EXISTS bounty_results (
    bounty_id TEXT PRIMARY KEY REFERENCES bounties(bounty_id) ON DELETE CASCADE,
    winning_submission_id TEXT,
    decision TEXT NOT NULL CHECK(decision IN ('accepted','rejected')),
    confidence REAL NOT NULL,
    judge_reason TEXT NOT NULL,
    payout_tx_hash TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
`;

export const MIGRATION_V13 = `
  ALTER TABLE bounty_results RENAME TO bounty_results_old;
  ALTER TABLE bounty_submissions RENAME TO bounty_submissions_old;
  ALTER TABLE bounties RENAME TO bounties_old;

  CREATE TABLE bounties (
    bounty_id TEXT PRIMARY KEY,
    host_agent_id TEXT NOT NULL,
    host_address TEXT NOT NULL,
    kind TEXT NOT NULL CHECK(kind IN ('question','translation','social_proof','problem_solving','public_news_capture','oracle_evidence_capture')),
    title TEXT NOT NULL,
    task_prompt TEXT NOT NULL,
    reference_output TEXT NOT NULL,
    skill_name TEXT,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    policy_json TEXT NOT NULL DEFAULT '{}',
    reward_wei TEXT NOT NULL,
    submission_deadline TEXT NOT NULL,
    judge_mode TEXT NOT NULL CHECK(judge_mode IN ('local_model')),
    status TEXT NOT NULL CHECK(status IN ('open','submitted','under_review','approved','rejected','paid','expired')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_bounties_status ON bounties(status, created_at);

  INSERT INTO bounties (
    bounty_id,
    host_agent_id,
    host_address,
    kind,
    title,
    task_prompt,
    reference_output,
    skill_name,
    metadata_json,
    policy_json,
    reward_wei,
    submission_deadline,
    judge_mode,
    status,
    created_at,
    updated_at
  )
  SELECT
    bounty_id,
    host_agent_id,
    host_address,
    CASE
      WHEN kind IN ('question','translation','social_proof','problem_solving','public_news_capture','oracle_evidence_capture') THEN kind
      ELSE 'question'
    END,
    substr(question, 1, 160),
    question,
    reference_answer,
    NULL,
    '{}',
    '{"maxSubmissionsPerSolver":1,"solverCooldownSeconds":3600,"maxAutoPayPerSolverPerDayWei":"1000000000000000000","trustedProofUrlPrefixes":["https://x.com/","https://twitter.com/","https://www.x.com/","https://www.twitter.com/"]}',
    reward_wei,
    submission_deadline,
    judge_mode,
    status,
    created_at,
    updated_at
  FROM bounties_old;

  CREATE TABLE bounty_submissions (
    submission_id TEXT PRIMARY KEY,
    bounty_id TEXT NOT NULL REFERENCES bounties(bounty_id) ON DELETE CASCADE,
    solver_agent_id TEXT,
    solver_address TEXT NOT NULL,
    submission_text TEXT NOT NULL,
    proof_url TEXT,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL CHECK(status IN ('submitted','accepted','rejected')),
    submitted_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_bounty_submissions_bounty ON bounty_submissions(bounty_id, submitted_at);

  INSERT INTO bounty_submissions (
    submission_id,
    bounty_id,
    solver_agent_id,
    solver_address,
    submission_text,
    proof_url,
    metadata_json,
    status,
    submitted_at,
    updated_at
  )
  SELECT
    submission_id,
    bounty_id,
    solver_agent_id,
    solver_address,
    answer,
    NULL,
    '{}',
    status,
    submitted_at,
    updated_at
  FROM bounty_submissions_old;

  CREATE TABLE bounty_results (
    bounty_id TEXT PRIMARY KEY REFERENCES bounties(bounty_id) ON DELETE CASCADE,
    winning_submission_id TEXT,
    decision TEXT NOT NULL CHECK(decision IN ('accepted','rejected')),
    confidence REAL NOT NULL,
    judge_reason TEXT NOT NULL,
    payout_tx_hash TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  INSERT INTO bounty_results (
    bounty_id,
    winning_submission_id,
    decision,
    confidence,
    judge_reason,
    payout_tx_hash,
    created_at,
    updated_at
  )
  SELECT
    bounty_id,
    winning_submission_id,
    decision,
    confidence,
    judge_reason,
    payout_tx_hash,
    created_at,
    updated_at
  FROM bounty_results_old;

  DROP TABLE bounty_results_old;
  DROP TABLE bounty_submissions_old;
  DROP TABLE bounties_old;
`;

export const MIGRATION_V14 = `
  CREATE TABLE IF NOT EXISTS settlement_receipts (
    receipt_id TEXT PRIMARY KEY,
    kind TEXT NOT NULL CHECK(kind IN ('bounty','observation','oracle')),
    subject_id TEXT NOT NULL,
    receipt_json TEXT NOT NULL,
    receipt_hash TEXT NOT NULL,
    artifact_url TEXT,
    payment_tx_hash TEXT,
    payout_tx_hash TEXT,
    settlement_tx_hash TEXT,
    settlement_receipt_json TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE UNIQUE INDEX IF NOT EXISTS idx_settlement_subject
    ON settlement_receipts(kind, subject_id);
`;

export const MIGRATION_V15 = `
  CREATE TABLE IF NOT EXISTS settlement_callbacks (
    callback_id TEXT PRIMARY KEY,
    receipt_id TEXT NOT NULL,
    kind TEXT NOT NULL CHECK(kind IN ('bounty','observation','oracle')),
    subject_id TEXT NOT NULL,
    contract_address TEXT NOT NULL,
    payload_mode TEXT NOT NULL CHECK(payload_mode IN ('canonical_receipt','receipt_hash')),
    payload_hex TEXT NOT NULL,
    payload_hash TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('pending','confirmed','failed')),
    attempt_count INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL DEFAULT 3,
    callback_tx_hash TEXT,
    callback_receipt_json TEXT,
    last_error TEXT,
    next_attempt_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE UNIQUE INDEX IF NOT EXISTS idx_settlement_callback_receipt
    ON settlement_callbacks(receipt_id);

  CREATE INDEX IF NOT EXISTS idx_settlement_callback_status
    ON settlement_callbacks(status, kind, next_attempt_at);
`;

export const MIGRATION_V16 = `
  CREATE TABLE IF NOT EXISTS market_bindings (
    binding_id TEXT PRIMARY KEY,
    kind TEXT NOT NULL CHECK(kind IN ('bounty','observation','oracle')),
    subject_id TEXT NOT NULL,
    receipt_json TEXT NOT NULL,
    receipt_hash TEXT NOT NULL,
    callback_target TEXT,
    callback_tx_hash TEXT,
    callback_receipt_json TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE UNIQUE INDEX IF NOT EXISTS idx_market_binding_subject
    ON market_bindings(kind, subject_id);

  CREATE TABLE IF NOT EXISTS market_contract_callbacks (
    callback_id TEXT PRIMARY KEY,
    binding_id TEXT NOT NULL,
    kind TEXT NOT NULL CHECK(kind IN ('bounty','observation','oracle')),
    subject_id TEXT NOT NULL,
    contract_address TEXT NOT NULL,
    package_name TEXT NOT NULL,
    function_signature TEXT NOT NULL,
    payload_mode TEXT NOT NULL CHECK(payload_mode IN ('canonical_binding','binding_hash')),
    payload_hex TEXT NOT NULL,
    payload_hash TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('pending','confirmed','failed')),
    attempt_count INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL DEFAULT 3,
    callback_tx_hash TEXT,
    callback_receipt_json TEXT,
    last_error TEXT,
    next_attempt_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE UNIQUE INDEX IF NOT EXISTS idx_market_callback_binding
    ON market_contract_callbacks(binding_id);

  CREATE INDEX IF NOT EXISTS idx_market_callback_status
    ON market_contract_callbacks(status, kind, next_attempt_at);
`;
