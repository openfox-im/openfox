/**
 * OpenFox SQLite Schema
 *
 * All tables for the openfox's persistent state.
 * The database IS the openfox's memory.
 */

export const SCHEMA_VERSION = 52;

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
    role TEXT DEFAULT 'generalist',
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
    kind TEXT NOT NULL CHECK(kind IN ('treasury_policy_change','spend_cap_change','signer_policy_change','paymaster_policy_change','opportunity_action')),
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
    reply_to TEXT,
    to_address TEXT,
    raw_content TEXT,
    status TEXT DEFAULT 'received',
    retry_count INTEGER DEFAULT 0,
    max_retries INTEGER DEFAULT 3
  );

  CREATE INDEX IF NOT EXISTS idx_inbox_unprocessed
    ON inbox_messages(received_at) WHERE processed_at IS NULL;

  CREATE TABLE IF NOT EXISTS campaigns (
    campaign_id TEXT PRIMARY KEY,
    host_agent_id TEXT NOT NULL,
    host_address TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    budget_tomi TEXT NOT NULL,
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
    kind TEXT NOT NULL CHECK(kind IN ('question','translation','social_proof','problem_solving','public_news_capture','oracle_evidence_capture','data_labeling')),
    title TEXT NOT NULL,
    task_prompt TEXT NOT NULL,
    reference_output TEXT NOT NULL,
    skill_name TEXT,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    policy_json TEXT NOT NULL DEFAULT '{}',
    reward_tomi TEXT NOT NULL,
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
    amount_tomi TEXT NOT NULL,
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

  CREATE TABLE IF NOT EXISTS owner_finance_snapshots (
    snapshot_id TEXT PRIMARY KEY,
    period_kind TEXT NOT NULL CHECK(period_kind IN ('daily','weekly')),
    period_start TEXT NOT NULL,
    period_end TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE UNIQUE INDEX IF NOT EXISTS idx_owner_finance_snapshot_period
    ON owner_finance_snapshots(period_kind, period_start);

  CREATE TABLE IF NOT EXISTS owner_reports (
    report_id TEXT PRIMARY KEY,
    period_kind TEXT NOT NULL CHECK(period_kind IN ('daily','weekly')),
    finance_snapshot_id TEXT NOT NULL,
    provider TEXT,
    model TEXT,
    input_hash TEXT NOT NULL,
    generation_status TEXT NOT NULL CHECK(generation_status IN ('generated','deterministic_only')),
    payload_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_owner_reports_period
    ON owner_reports(period_kind, created_at DESC);

  CREATE TABLE IF NOT EXISTS owner_report_deliveries (
    delivery_id TEXT PRIMARY KEY,
    report_id TEXT NOT NULL,
    channel TEXT NOT NULL CHECK(channel IN ('web','email')),
    status TEXT NOT NULL CHECK(status IN ('pending','delivered','failed')),
    target TEXT NOT NULL,
    rendered_path TEXT,
    metadata_json TEXT,
    last_error TEXT,
    delivered_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_owner_report_deliveries_report
    ON owner_report_deliveries(report_id, created_at DESC);

  CREATE INDEX IF NOT EXISTS idx_owner_report_deliveries_channel
    ON owner_report_deliveries(channel, status, created_at DESC);

  CREATE TABLE IF NOT EXISTS owner_opportunity_alerts (
    alert_id TEXT PRIMARY KEY,
    opportunity_hash TEXT NOT NULL,
    kind TEXT NOT NULL,
    provider_class TEXT NOT NULL,
    trust_tier TEXT NOT NULL,
    title TEXT NOT NULL,
    summary TEXT NOT NULL,
    suggested_action TEXT NOT NULL,
    capability TEXT,
    base_url TEXT,
    reward_tomi TEXT,
    estimated_cost_tomi TEXT NOT NULL,
    margin_tomi TEXT NOT NULL,
    margin_bps INTEGER NOT NULL,
    strategy_score REAL,
    strategy_matched INTEGER NOT NULL DEFAULT 0,
    strategy_reasons_json TEXT NOT NULL DEFAULT '[]',
    payload_json TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL CHECK(status IN ('unread','read','dismissed')),
    action_kind TEXT,
    action_request_id TEXT,
    action_requested_at TEXT,
    read_at TEXT,
    dismissed_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_owner_opportunity_alerts_status
    ON owner_opportunity_alerts(status, created_at DESC);

  CREATE INDEX IF NOT EXISTS idx_owner_opportunity_alerts_hash
    ON owner_opportunity_alerts(opportunity_hash, created_at DESC);

  CREATE TABLE IF NOT EXISTS owner_opportunity_actions (
    action_id TEXT PRIMARY KEY,
    alert_id TEXT NOT NULL,
    request_id TEXT NOT NULL,
    kind TEXT NOT NULL CHECK(kind IN ('review','pursue','delegate')),
    title TEXT NOT NULL,
    summary TEXT NOT NULL,
    capability TEXT,
    base_url TEXT,
    requested_by TEXT NOT NULL,
    approved_by TEXT,
    approved_at TEXT,
    decision_note TEXT,
    payload_json TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL CHECK(status IN ('queued','completed','cancelled')),
    resolution_kind TEXT CHECK(resolution_kind IN ('note','bounty','campaign','provider_call','artifact','report','other')),
    resolution_ref TEXT,
    resolution_note TEXT,
    queued_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    completed_at TEXT,
    cancelled_at TEXT
  );

  CREATE UNIQUE INDEX IF NOT EXISTS idx_owner_opportunity_actions_request
    ON owner_opportunity_actions(request_id);

  CREATE UNIQUE INDEX IF NOT EXISTS idx_owner_opportunity_actions_alert
    ON owner_opportunity_actions(alert_id);

  CREATE INDEX IF NOT EXISTS idx_owner_opportunity_actions_status
    ON owner_opportunity_actions(status, created_at DESC);

  CREATE TABLE IF NOT EXISTS owner_opportunity_action_executions (
    execution_id TEXT PRIMARY KEY,
    action_id TEXT NOT NULL,
    kind TEXT NOT NULL CHECK(kind IN ('remote_bounty_solve','remote_campaign_solve','remote_observation_request','remote_oracle_request')),
    target_kind TEXT NOT NULL CHECK(target_kind IN ('bounty','campaign','provider')),
    target_ref TEXT NOT NULL,
    remote_base_url TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('running','completed','failed','skipped')),
    request_payload_json TEXT NOT NULL DEFAULT '{}',
    result_payload_json TEXT,
    execution_ref TEXT,
    error_message TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    completed_at TEXT,
    failed_at TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_owner_opportunity_action_executions_action
    ON owner_opportunity_action_executions(action_id, created_at DESC);

  CREATE INDEX IF NOT EXISTS idx_owner_opportunity_action_executions_status
    ON owner_opportunity_action_executions(status, created_at DESC);

  CREATE TABLE IF NOT EXISTS signer_quotes (
    quote_id TEXT PRIMARY KEY,
    provider_address TEXT NOT NULL,
    wallet_address TEXT NOT NULL,
    requester_address TEXT NOT NULL,
    target_address TEXT NOT NULL,
    value_tomi TEXT NOT NULL,
    data_hex TEXT NOT NULL,
    gas TEXT NOT NULL,
    policy_id TEXT NOT NULL,
    policy_hash TEXT NOT NULL,
    scope_hash TEXT NOT NULL,
    delegate_identity TEXT,
    trust_tier TEXT NOT NULL CHECK(trust_tier IN ('self_hosted','org_trusted','public_low_trust')),
    amount_tomi TEXT NOT NULL,
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
    value_tomi TEXT NOT NULL,
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
    value_tomi TEXT NOT NULL,
    data_hex TEXT NOT NULL,
    gas TEXT NOT NULL,
    policy_id TEXT NOT NULL,
    policy_hash TEXT NOT NULL,
    scope_hash TEXT NOT NULL,
    delegate_identity TEXT,
    trust_tier TEXT NOT NULL CHECK(trust_tier IN ('self_hosted','org_trusted','public_low_trust')),
    amount_tomi TEXT NOT NULL,
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
    value_tomi TEXT NOT NULL,
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
    amount_tomi TEXT NOT NULL,
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
    amount_tomi TEXT NOT NULL,
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
    amount_tomi TEXT NOT NULL,
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

  -- Policy decisions
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

  -- Spend tracking
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

  -- Heartbeat schedule
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

  -- Heartbeat history
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

  -- Wake events
  CREATE TABLE IF NOT EXISTS wake_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source TEXT NOT NULL,
    reason TEXT NOT NULL,
    payload TEXT DEFAULT '{}',
    consumed_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_wake_unconsumed ON wake_events(created_at) WHERE consumed_at IS NULL;

  -- Heartbeat dedup
  CREATE TABLE IF NOT EXISTS heartbeat_dedup (
    dedup_key TEXT PRIMARY KEY,
    task_name TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_dedup_expires ON heartbeat_dedup(expires_at);

  -- Soul history
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

  -- Working memory
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

  -- Episodic memory
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

  -- Session summaries
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

  -- Semantic memory
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

  -- Procedural memory
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

  -- Relationship memory
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

  -- Inference costs
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

  -- Model registry
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

  -- Child lifecycle events
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

  -- On-chain transactions
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

  -- Metric snapshots
  CREATE TABLE IF NOT EXISTS metric_snapshots (
    id TEXT PRIMARY KEY,
    snapshot_at TEXT NOT NULL,
    metrics_json TEXT NOT NULL DEFAULT '[]',
    alerts_json TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_metric_snapshots_at ON metric_snapshots(snapshot_at);

  -- Goals
  CREATE TABLE IF NOT EXISTS goals (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    strategy TEXT,
    expected_revenue_cents INTEGER DEFAULT 0,
    actual_revenue_cents INTEGER DEFAULT 0,
    created_at TEXT NOT NULL,
    deadline TEXT,
    completed_at TEXT
  );

  -- Task graph
  CREATE TABLE IF NOT EXISTS task_graph (
    id TEXT PRIMARY KEY,
    parent_id TEXT,
    goal_id TEXT NOT NULL REFERENCES goals(id),
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    assigned_to TEXT,
    agent_role TEXT,
    priority INTEGER DEFAULT 50,
    dependencies TEXT DEFAULT '[]',
    result TEXT,
    estimated_cost_cents INTEGER DEFAULT 0,
    actual_cost_cents INTEGER DEFAULT 0,
    max_retries INTEGER DEFAULT 3,
    retry_count INTEGER DEFAULT 0,
    timeout_ms INTEGER DEFAULT 300000,
    created_at TEXT NOT NULL,
    started_at TEXT,
    completed_at TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_task_graph_goal ON task_graph(goal_id);
  CREATE INDEX IF NOT EXISTS idx_task_graph_status ON task_graph(status);
  CREATE INDEX IF NOT EXISTS idx_task_graph_assigned ON task_graph(assigned_to);

  -- Event stream
  CREATE TABLE IF NOT EXISTS event_stream (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    agent_address TEXT NOT NULL,
    goal_id TEXT,
    task_id TEXT,
    content TEXT NOT NULL,
    token_count INTEGER NOT NULL,
    compacted_to TEXT,
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_events_agent ON event_stream(agent_address, created_at);
  CREATE INDEX IF NOT EXISTS idx_events_goal ON event_stream(goal_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_events_type ON event_stream(type, created_at);

  -- Knowledge store
  CREATE TABLE IF NOT EXISTS knowledge_store (
    id TEXT PRIMARY KEY,
    category TEXT NOT NULL,
    key TEXT NOT NULL,
    content TEXT NOT NULL,
    source TEXT NOT NULL,
    confidence REAL DEFAULT 1.0,
    last_verified TEXT NOT NULL,
    access_count INTEGER DEFAULT 0,
    token_count INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    expires_at TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_knowledge_category ON knowledge_store(category);
  CREATE INDEX IF NOT EXISTS idx_knowledge_key ON knowledge_store(key);

  CREATE INDEX IF NOT EXISTS idx_bounties_campaign
    ON bounties(campaign_id, created_at);

  -- Group v0: local community state
  CREATE TABLE IF NOT EXISTS groups (
    group_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    visibility TEXT NOT NULL CHECK(visibility IN ('private','listed','public')),
    join_mode TEXT NOT NULL CHECK(join_mode IN ('invite_only','request_approval')),
    status TEXT NOT NULL CHECK(status IN ('active','archived')) DEFAULT 'active',
    max_members INTEGER NOT NULL DEFAULT 256,
    tns_name TEXT,
    tags_json TEXT NOT NULL DEFAULT '[]',
    avatar_artifact_cid TEXT,
    rules_artifact_cid TEXT,
    creator_address TEXT NOT NULL,
    creator_agent_id TEXT,
    current_epoch INTEGER NOT NULL DEFAULT 1,
    current_policy_hash TEXT NOT NULL,
    current_members_root TEXT NOT NULL,
    pinned_announcement_id TEXT,
    latest_snapshot_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_groups_visibility
    ON groups(visibility, status, updated_at DESC);

  CREATE TABLE IF NOT EXISTS group_channels (
    channel_id TEXT PRIMARY KEY,
    group_id TEXT NOT NULL REFERENCES groups(group_id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    parent_channel_id TEXT,
    visibility TEXT NOT NULL DEFAULT 'group',
    status TEXT NOT NULL CHECK(status IN ('active','archived')) DEFAULT 'active',
    created_by_address TEXT NOT NULL,
    created_at TEXT NOT NULL,
    archived_at TEXT
  );

  CREATE UNIQUE INDEX IF NOT EXISTS idx_group_channels_name
    ON group_channels(group_id, name);

  CREATE TABLE IF NOT EXISTS group_members (
    group_id TEXT NOT NULL REFERENCES groups(group_id) ON DELETE CASCADE,
    member_address TEXT NOT NULL,
    member_agent_id TEXT,
    member_tns_name TEXT,
    display_name TEXT,
    membership_state TEXT NOT NULL CHECK(
      membership_state IN ('active','left','removed','banned')
    ) DEFAULT 'active',
    joined_via TEXT NOT NULL CHECK(
      joined_via IN ('genesis','invite','join_request')
    ),
    joined_at TEXT NOT NULL,
    left_at TEXT,
    mute_until TEXT,
    last_event_id TEXT NOT NULL,
    PRIMARY KEY (group_id, member_address)
  );

  CREATE INDEX IF NOT EXISTS idx_group_members_state
    ON group_members(group_id, membership_state, joined_at DESC);

  CREATE TABLE IF NOT EXISTS group_member_roles (
    group_id TEXT NOT NULL REFERENCES groups(group_id) ON DELETE CASCADE,
    member_address TEXT NOT NULL,
    role TEXT NOT NULL,
    active INTEGER NOT NULL CHECK(active IN (0,1)) DEFAULT 1,
    granted_by_address TEXT NOT NULL,
    granted_at TEXT NOT NULL,
    revoked_at TEXT,
    last_event_id TEXT NOT NULL,
    PRIMARY KEY (group_id, member_address, role)
  );

  CREATE INDEX IF NOT EXISTS idx_group_member_roles_active
    ON group_member_roles(group_id, role, active);

  CREATE TABLE IF NOT EXISTS group_events (
    event_id TEXT PRIMARY KEY,
    group_id TEXT NOT NULL REFERENCES groups(group_id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    epoch INTEGER NOT NULL,
    channel_id TEXT,
    actor_address TEXT NOT NULL,
    actor_agent_id TEXT,
    parent_event_ids_json TEXT NOT NULL DEFAULT '[]',
    payload_json TEXT NOT NULL,
    signature TEXT NOT NULL,
    event_hash TEXT NOT NULL,
    created_at TEXT NOT NULL,
    expires_at TEXT,
    received_at TEXT NOT NULL DEFAULT (datetime('now')),
    source_kind TEXT NOT NULL CHECK(
      source_kind IN ('local','peer','gateway','relay','snapshot')
    ) DEFAULT 'local',
    reducer_status TEXT NOT NULL CHECK(
      reducer_status IN ('accepted','pending','rejected')
    ) DEFAULT 'accepted',
    rejection_reason TEXT
  );

  CREATE UNIQUE INDEX IF NOT EXISTS idx_group_events_hash
    ON group_events(group_id, event_hash);

  CREATE INDEX IF NOT EXISTS idx_group_events_created
    ON group_events(group_id, created_at ASC);

  CREATE INDEX IF NOT EXISTS idx_group_events_kind
    ON group_events(group_id, kind, created_at DESC);

  CREATE TABLE IF NOT EXISTS group_proposals (
    proposal_id TEXT PRIMARY KEY,
    group_id TEXT NOT NULL REFERENCES groups(group_id) ON DELETE CASCADE,
    proposal_kind TEXT NOT NULL CHECK(
      proposal_kind IN (
        'invite',
        'membership_remove',
        'role_grant',
        'role_revoke',
        'policy_update'
      )
    ),
    target_address TEXT,
    target_agent_id TEXT,
    target_tns_name TEXT,
    target_roles_json TEXT NOT NULL DEFAULT '[]',
    opened_by_address TEXT NOT NULL,
    opened_event_id TEXT NOT NULL,
    approval_count INTEGER NOT NULL DEFAULT 0,
    required_approvals INTEGER NOT NULL DEFAULT 1,
    invite_accepted_at TEXT,
    status TEXT NOT NULL CHECK(
      status IN ('open','revoked','expired','committed','rejected')
    ) DEFAULT 'open',
    reason TEXT,
    expires_at TEXT,
    committed_event_id TEXT,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_group_proposals_open
    ON group_proposals(group_id, status, updated_at DESC);

  CREATE TABLE IF NOT EXISTS group_join_requests (
    request_id TEXT PRIMARY KEY,
    group_id TEXT NOT NULL REFERENCES groups(group_id) ON DELETE CASCADE,
    applicant_address TEXT NOT NULL,
    applicant_agent_id TEXT,
    applicant_tns_name TEXT,
    requested_roles_json TEXT NOT NULL DEFAULT '[]',
    request_message TEXT NOT NULL DEFAULT '',
    opened_event_id TEXT NOT NULL,
    approval_count INTEGER NOT NULL DEFAULT 0,
    required_approvals INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL CHECK(
      status IN ('open','withdrawn','rejected','expired','committed')
    ) DEFAULT 'open',
    committed_event_id TEXT,
    expires_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_group_join_requests_open
    ON group_join_requests(group_id, status, created_at DESC);

  CREATE TABLE IF NOT EXISTS group_announcements (
    announcement_id TEXT PRIMARY KEY,
    group_id TEXT NOT NULL REFERENCES groups(group_id) ON DELETE CASCADE,
    channel_id TEXT REFERENCES group_channels(channel_id) ON DELETE SET NULL,
    event_id TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    body_text TEXT NOT NULL,
    pinned INTEGER NOT NULL CHECK(pinned IN (0,1)) DEFAULT 0,
    posted_by_address TEXT NOT NULL,
    created_at TEXT NOT NULL,
    redacted_at TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_group_announcements_created
    ON group_announcements(group_id, created_at DESC);

  CREATE TABLE IF NOT EXISTS group_messages (
    message_id TEXT PRIMARY KEY,
    group_id TEXT NOT NULL REFERENCES groups(group_id) ON DELETE CASCADE,
    channel_id TEXT NOT NULL REFERENCES group_channels(channel_id) ON DELETE CASCADE,
    original_event_id TEXT NOT NULL UNIQUE,
    latest_event_id TEXT NOT NULL,
    sender_address TEXT NOT NULL,
    sender_agent_id TEXT,
    reply_to_message_id TEXT,
    ciphertext TEXT NOT NULL,
    preview_text TEXT,
    mentions_json TEXT NOT NULL DEFAULT '[]',
    reaction_summary_json TEXT NOT NULL DEFAULT '{}',
    redacted INTEGER NOT NULL CHECK(redacted IN (0,1)) DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_group_messages_timeline
    ON group_messages(group_id, channel_id, created_at ASC);

  CREATE TABLE IF NOT EXISTS group_message_reactions (
    group_id TEXT NOT NULL REFERENCES groups(group_id) ON DELETE CASCADE,
    message_id TEXT NOT NULL REFERENCES group_messages(message_id) ON DELETE CASCADE,
    reactor_address TEXT NOT NULL,
    reaction_code TEXT NOT NULL,
    event_id TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL,
    PRIMARY KEY (group_id, message_id, reactor_address, reaction_code)
  );

  CREATE INDEX IF NOT EXISTS idx_group_message_reactions_message
    ON group_message_reactions(group_id, message_id, created_at ASC);

  CREATE TABLE IF NOT EXISTS group_snapshots (
    snapshot_id TEXT PRIMARY KEY,
    group_id TEXT NOT NULL REFERENCES groups(group_id) ON DELETE CASCADE,
    as_of_event_id TEXT NOT NULL,
    snapshot_hash TEXT NOT NULL,
    snapshot_cid TEXT,
    members_json TEXT NOT NULL,
    roles_json TEXT NOT NULL,
    channels_json TEXT NOT NULL,
    announcements_json TEXT NOT NULL,
    current_epoch INTEGER NOT NULL,
    published_by_address TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_group_snapshots_recent
    ON group_snapshots(group_id, created_at DESC);

  CREATE TABLE IF NOT EXISTS group_sync_state (
    group_id TEXT NOT NULL REFERENCES groups(group_id) ON DELETE CASCADE,
    peer_ref TEXT NOT NULL,
    source_kind TEXT NOT NULL CHECK(
      source_kind IN ('peer','gateway','relay','storage')
    ),
    last_event_id TEXT,
    last_snapshot_id TEXT,
    last_sync_at TEXT,
    last_success_at TEXT,
    last_error TEXT,
    PRIMARY KEY (group_id, peer_ref, source_kind)
  );

  CREATE TABLE IF NOT EXISTS group_epoch_keys (
    group_id TEXT NOT NULL REFERENCES groups(group_id) ON DELETE CASCADE,
    epoch INTEGER NOT NULL,
    recipient_address TEXT NOT NULL,
    wrapped_key_ciphertext TEXT NOT NULL,
    key_hash TEXT NOT NULL,
    source_event_id TEXT NOT NULL,
    delivered_at TEXT,
    PRIMARY KEY (group_id, epoch, recipient_address)
  );

  CREATE INDEX IF NOT EXISTS idx_group_epoch_keys_pending
    ON group_epoch_keys(group_id, epoch, delivered_at);

  CREATE TABLE IF NOT EXISTS group_sync_peers (
    group_id TEXT NOT NULL REFERENCES groups(group_id) ON DELETE CASCADE,
    peer_address TEXT NOT NULL,
    peer_endpoint TEXT NOT NULL,
    last_sync_at TEXT,
    last_cursor TEXT,
    sync_kind TEXT NOT NULL CHECK(
      sync_kind IN ('peer','gateway','relay','storage')
    ),
    PRIMARY KEY (group_id, peer_address, sync_kind)
  );

  CREATE INDEX IF NOT EXISTS idx_group_sync_peers_group
    ON group_sync_peers(group_id, last_sync_at DESC);

  CREATE TABLE IF NOT EXISTS world_notification_state (
    notification_id TEXT PRIMARY KEY,
    read_at TEXT,
    dismissed_at TEXT,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_world_notification_state_unread
    ON world_notification_state(read_at, dismissed_at, updated_at DESC);

  CREATE TABLE IF NOT EXISTS world_presence (
    actor_address TEXT NOT NULL,
    scope_kind TEXT NOT NULL CHECK(scope_kind IN ('world','group')),
    scope_ref TEXT NOT NULL DEFAULT '',
    agent_id TEXT,
    display_name TEXT,
    status TEXT NOT NULL CHECK(status IN ('online','busy','away','recently_active')),
    summary TEXT,
    source_kind TEXT NOT NULL CHECK(source_kind IN ('self','peer','relay','snapshot')),
    last_seen_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (actor_address, scope_kind, scope_ref)
  );

  CREATE INDEX IF NOT EXISTS idx_world_presence_scope
    ON world_presence(scope_kind, scope_ref, expires_at DESC, updated_at DESC);

  -- Group moderation: warnings
  CREATE TABLE IF NOT EXISTS group_warnings (
    warning_id TEXT PRIMARY KEY,
    group_id TEXT NOT NULL REFERENCES groups(group_id) ON DELETE CASCADE,
    target_address TEXT NOT NULL,
    issuer_address TEXT NOT NULL,
    severity TEXT NOT NULL CHECK(severity IN ('mild','moderate','severe')) DEFAULT 'mild',
    reason TEXT NOT NULL,
    escalation_action TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_group_warnings_target
    ON group_warnings(group_id, target_address, created_at DESC);

  -- Group moderation: reports
  CREATE TABLE IF NOT EXISTS group_reports (
    report_id TEXT PRIMARY KEY,
    group_id TEXT NOT NULL REFERENCES groups(group_id) ON DELETE CASCADE,
    reporter_address TEXT NOT NULL,
    target_address TEXT,
    message_id TEXT,
    category TEXT NOT NULL CHECK(category IN ('spam','harassment','off_topic','illegal','other')),
    reason TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('open','resolved','dismissed')) DEFAULT 'open',
    resolver_address TEXT,
    resolution TEXT,
    resolution_note TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    resolved_at TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_group_reports_status
    ON group_reports(group_id, status, created_at DESC);

  -- Group moderation: appeals
  CREATE TABLE IF NOT EXISTS group_appeals (
    appeal_id TEXT PRIMARY KEY,
    group_id TEXT NOT NULL REFERENCES groups(group_id) ON DELETE CASCADE,
    appealer_address TEXT NOT NULL,
    action_kind TEXT NOT NULL CHECK(action_kind IN ('mute','ban','warning')),
    reason TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('pending','approved','rejected')) DEFAULT 'pending',
    resolver_address TEXT,
    decision TEXT,
    resolution_note TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    resolved_at TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_group_appeals_status
    ON group_appeals(group_id, status, created_at DESC);

  -- Group moderation: rate limit configuration
  CREATE TABLE IF NOT EXISTS group_rate_limits (
    group_id TEXT PRIMARY KEY REFERENCES groups(group_id) ON DELETE CASCADE,
    max_per_minute INTEGER NOT NULL DEFAULT 10,
    max_per_hour INTEGER NOT NULL DEFAULT 100
  );

  -- World follows: follow foxes and groups
  CREATE TABLE IF NOT EXISTS world_follows (
    follower_address TEXT NOT NULL,
    target_address TEXT DEFAULT '',
    target_group_id TEXT DEFAULT '',
    follow_kind TEXT NOT NULL CHECK(follow_kind IN ('fox','group')),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (follower_address, follow_kind, target_address, target_group_id)
  );

  CREATE INDEX IF NOT EXISTS idx_world_follows_follower
    ON world_follows(follower_address, follow_kind, created_at DESC);

  CREATE INDEX IF NOT EXISTS idx_world_follows_target_fox
    ON world_follows(target_address, follow_kind, created_at DESC);

  CREATE INDEX IF NOT EXISTS idx_world_follows_target_group
    ON world_follows(target_group_id, follow_kind, created_at DESC);

  -- World subscriptions: notification preferences per feed
  CREATE TABLE IF NOT EXISTS world_subscriptions (
    subscription_id TEXT PRIMARY KEY,
    subscriber_address TEXT NOT NULL,
    feed_kind TEXT NOT NULL CHECK(feed_kind IN ('fox','group','board')),
    target_id TEXT NOT NULL,
    notify_on TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_world_subscriptions_subscriber
    ON world_subscriptions(subscriber_address, feed_kind, created_at DESC);

  CREATE INDEX IF NOT EXISTS idx_world_subscriptions_target
    ON world_subscriptions(feed_kind, target_id, created_at DESC);

  -- World search index: denormalized searchable text
  CREATE TABLE IF NOT EXISTS world_search_index (
    entry_id TEXT PRIMARY KEY,
    entry_kind TEXT NOT NULL CHECK(entry_kind IN ('fox','group','board_item')),
    searchable_text TEXT NOT NULL,
    source_id TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_world_search_index_kind
    ON world_search_index(entry_kind, updated_at DESC);

  -- Fox public profiles: publishable identity metadata
  CREATE TABLE IF NOT EXISTS fox_profiles (
    address TEXT PRIMARY KEY,
    display_name TEXT,
    bio TEXT,
    avatar_url TEXT,
    avatar_cid TEXT,
    website_url TEXT,
    tns_name TEXT,
    tags TEXT NOT NULL DEFAULT '[]',
    social_links TEXT NOT NULL DEFAULT '[]',
    published_cid TEXT,
    published_at TEXT,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Group public profiles: publishable group identity metadata
  CREATE TABLE IF NOT EXISTS group_profiles (
    group_id TEXT PRIMARY KEY,
    avatar_url TEXT,
    avatar_cid TEXT,
    rules_url TEXT,
    published_cid TEXT,
    published_at TEXT,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (group_id) REFERENCES groups(group_id)
  );

  -- Group treasury: operational treasury accounts for groups
  CREATE TABLE IF NOT EXISTS group_treasury (
    group_id TEXT PRIMARY KEY,
    treasury_address TEXT NOT NULL,
    balance_tomi TEXT NOT NULL DEFAULT '0',
    last_synced_at TEXT,
    spend_policy_json TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','frozen','closed')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  -- Group budget lines: per-group spending categories with caps
  CREATE TABLE IF NOT EXISTS group_budget_lines (
    group_id TEXT NOT NULL,
    line_name TEXT NOT NULL,
    cap_tomi TEXT NOT NULL,
    period TEXT NOT NULL DEFAULT 'monthly' CHECK (period IN ('daily','weekly','monthly','epoch')),
    spent_tomi TEXT NOT NULL DEFAULT '0',
    period_start TEXT NOT NULL,
    requires_supermajority INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (group_id, line_name)
  );

  -- Group treasury log: inflow/outflow transaction history
  CREATE TABLE IF NOT EXISTS group_treasury_log (
    log_id TEXT PRIMARY KEY,
    group_id TEXT NOT NULL,
    direction TEXT NOT NULL CHECK (direction IN ('inflow','outflow')),
    amount_tomi TEXT NOT NULL,
    counterparty TEXT,
    budget_line TEXT,
    proposal_id TEXT,
    tx_hash TEXT,
    memo TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_treasury_log_group ON group_treasury_log(group_id, created_at);

  -- Generalized intents: work requests, opportunities, procurements, collaborations
  CREATE TABLE IF NOT EXISTS world_intents (
    intent_id TEXT PRIMARY KEY,
    publisher_address TEXT NOT NULL,
    group_id TEXT,
    kind TEXT NOT NULL CHECK (kind IN ('work','opportunity','procurement','collaboration','custom')),
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    requirements_json TEXT NOT NULL DEFAULT '[]',
    budget_tomi TEXT,
    budget_line TEXT,
    budget_token TEXT DEFAULT 'TOS',
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','matching','matched','in_progress','review','completed','cancelled','expired')),
    matched_solver_address TEXT,
    matched_at TEXT,
    completed_at TEXT,
    settlement_proposal_id TEXT,
    settlement_tx_hash TEXT,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_intents_status ON world_intents(status, kind);
  CREATE INDEX IF NOT EXISTS idx_intents_group ON world_intents(group_id, status);
  CREATE INDEX IF NOT EXISTS idx_intents_publisher ON world_intents(publisher_address);

  -- Intent responses: solver proposals for intents
  CREATE TABLE IF NOT EXISTS world_intent_responses (
    response_id TEXT PRIMARY KEY,
    intent_id TEXT NOT NULL,
    solver_address TEXT NOT NULL,
    proposal_text TEXT NOT NULL DEFAULT '',
    proposed_amount_tomi TEXT,
    capability_refs_json TEXT DEFAULT '[]',
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','rejected','withdrawn')),
    artifact_ids_json TEXT DEFAULT '[]',
    review_status TEXT CHECK (review_status IN ('pending','approved','revision_requested','rejected')),
    review_note TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(intent_id, solver_address)
  );
  CREATE INDEX IF NOT EXISTS idx_intent_responses_intent ON world_intent_responses(intent_id, status);

  -- Group governance v2: proposals with quorum + threshold voting
  CREATE TABLE IF NOT EXISTS group_governance_proposals (
    proposal_id TEXT PRIMARY KEY,
    group_id TEXT NOT NULL,
    proposal_type TEXT NOT NULL CHECK (proposal_type IN ('spend','policy_change','member_action','config_change','treasury_config','external_action')),
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    params_json TEXT NOT NULL DEFAULT '{}',
    proposer_address TEXT NOT NULL,
    opened_event_id TEXT NOT NULL,
    quorum INTEGER NOT NULL DEFAULT 1,
    threshold_numerator INTEGER NOT NULL DEFAULT 2,
    threshold_denominator INTEGER NOT NULL DEFAULT 3,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','approved','rejected','expired','executed')),
    votes_approve INTEGER NOT NULL DEFAULT 0,
    votes_reject INTEGER NOT NULL DEFAULT 0,
    votes_total INTEGER NOT NULL DEFAULT 0,
    resolved_event_id TEXT,
    executed_event_id TEXT,
    execution_result_json TEXT,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_gov_proposals_group ON group_governance_proposals(group_id, status);

  CREATE TABLE IF NOT EXISTS group_governance_votes (
    vote_id TEXT PRIMARY KEY,
    proposal_id TEXT NOT NULL,
    group_id TEXT NOT NULL,
    voter_address TEXT NOT NULL,
    vote TEXT NOT NULL CHECK (vote IN ('approve','reject')),
    reason TEXT,
    event_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE(proposal_id, voter_address)
  );
  CREATE INDEX IF NOT EXISTS idx_gov_votes_proposal ON group_governance_votes(proposal_id);

  CREATE TABLE IF NOT EXISTS group_governance_policy (
    group_id TEXT NOT NULL,
    proposal_type TEXT NOT NULL,
    quorum INTEGER NOT NULL DEFAULT 1,
    threshold_numerator INTEGER NOT NULL DEFAULT 2,
    threshold_denominator INTEGER NOT NULL DEFAULT 3,
    allowed_proposer_roles TEXT NOT NULL DEFAULT '["owner","admin"]',
    allowed_voter_roles TEXT NOT NULL DEFAULT '["owner","admin"]',
    default_duration_hours INTEGER NOT NULL DEFAULT 168,
    PRIMARY KEY (group_id, proposal_type)
  );

  CREATE TABLE IF NOT EXISTS group_subgroups (
    parent_group_id TEXT NOT NULL,
    child_group_id TEXT NOT NULL,
    relationship TEXT NOT NULL DEFAULT 'child' CHECK (relationship IN ('child','affiliate')),
    treasury_mode TEXT NOT NULL DEFAULT 'independent' CHECK (treasury_mode IN ('shared','independent','sub_budget')),
    sub_budget_line TEXT,
    policy_mode TEXT NOT NULL DEFAULT 'inherit' CHECK (policy_mode IN ('inherit','override')),
    created_at TEXT NOT NULL,
    PRIMARY KEY (parent_group_id, child_group_id)
  );

  -- Global reputation graph: multi-dimensional scoring
  CREATE TABLE IF NOT EXISTS world_reputation_scores (
    address TEXT NOT NULL,
    entity_type TEXT NOT NULL CHECK (entity_type IN ('fox','group')),
    dimension TEXT NOT NULL,
    score REAL NOT NULL DEFAULT 0.0,
    event_count INTEGER NOT NULL DEFAULT 0,
    last_updated TEXT NOT NULL,
    PRIMARY KEY (address, dimension)
  );
  CREATE INDEX IF NOT EXISTS idx_reputation_entity ON world_reputation_scores(entity_type, dimension, score DESC);

  CREATE TABLE IF NOT EXISTS world_reputation_events (
    event_id TEXT PRIMARY KEY,
    target_address TEXT NOT NULL,
    target_type TEXT NOT NULL CHECK (target_type IN ('fox','group')),
    dimension TEXT NOT NULL,
    delta REAL NOT NULL,
    source_type TEXT NOT NULL CHECK (source_type IN ('intent_completion','settlement','moderation','peer_endorsement','governance_participation')),
    source_ref TEXT,
    issuer_group_id TEXT,
    issuer_address TEXT NOT NULL,
    signature TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_rep_events_target ON world_reputation_events(target_address, dimension);
  CREATE INDEX IF NOT EXISTS idx_rep_events_source ON world_reputation_events(source_type, source_ref);

  -- Group chain commitments: on-chain anchoring records
  CREATE TABLE IF NOT EXISTS group_chain_commitments (
    commitment_id TEXT PRIMARY KEY,
    group_id TEXT NOT NULL,
    action_type TEXT NOT NULL CHECK (action_type IN ('register','state_commit')),
    epoch INTEGER NOT NULL,
    members_root TEXT NOT NULL,
    events_merkle_root TEXT,
    treasury_balance_tomi TEXT,
    tx_hash TEXT NOT NULL,
    block_number INTEGER,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_chain_commits_group ON group_chain_commitments(group_id, epoch);

  -- World federation peers: remote MetaWorld nodes
  CREATE TABLE IF NOT EXISTS world_federation_peers (
    peer_id TEXT PRIMARY KEY,
    peer_url TEXT NOT NULL UNIQUE,
    peer_address TEXT,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','unreachable','banned')),
    last_sync_at TEXT,
    last_cursor TEXT,
    failure_count INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  -- World federation events: cross-node event log
  CREATE TABLE IF NOT EXISTS world_federation_events (
    event_id TEXT PRIMARY KEY,
    peer_id TEXT NOT NULL,
    event_type TEXT NOT NULL CHECK (event_type IN ('group_registered','fox_profile_updated','intent_published','settlement_completed','reputation_attestation')),
    payload_json TEXT NOT NULL,
    received_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_fed_events_type ON world_federation_events(event_type, received_at);

  -- World federation outbound queue: local events pending broadcast to peers
  CREATE TABLE IF NOT EXISTS world_federation_outbound (
    outbound_id TEXT PRIMARY KEY,
    event_type TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','failed')),
    created_at TEXT NOT NULL,
    sent_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_fed_outbound_status ON world_federation_outbound(status, created_at);

  -- GTOS 2046 Phase 0+1: Intent pipeline tables (v48)
  CREATE TABLE IF NOT EXISTS intents (
    intent_id TEXT PRIMARY KEY,
    schema_version TEXT NOT NULL,
    action TEXT NOT NULL,
    requester TEXT NOT NULL,
    actor_agent_id TEXT NOT NULL,
    terminal_class TEXT NOT NULL,
    trust_tier INTEGER NOT NULL,
    params TEXT NOT NULL,
    constraints TEXT,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    status TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_intents_status ON intents(status, created_at);
  CREATE INDEX IF NOT EXISTS idx_intents_requester ON intents(requester, status);

  CREATE TABLE IF NOT EXISTS plans (
    plan_id TEXT PRIMARY KEY,
    intent_id TEXT NOT NULL,
    schema_version TEXT NOT NULL,
    provider TEXT NOT NULL,
    sponsor TEXT,
    artifact_ref TEXT,
    abi_ref TEXT,
    policy_hash TEXT NOT NULL,
    sponsor_policy_hash TEXT,
    effects_hash TEXT,
    estimated_gas INTEGER NOT NULL,
    estimated_value TEXT NOT NULL,
    route TEXT,
    fallback_plan_id TEXT,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    status TEXT NOT NULL,
    FOREIGN KEY (intent_id) REFERENCES intents(intent_id)
  );
  CREATE INDEX IF NOT EXISTS idx_plans_intent ON plans(intent_id, status);

  CREATE TABLE IF NOT EXISTS approvals (
    approval_id TEXT PRIMARY KEY,
    intent_id TEXT NOT NULL,
    plan_id TEXT NOT NULL,
    schema_version TEXT NOT NULL,
    approver TEXT NOT NULL,
    approver_role TEXT NOT NULL,
    account_id TEXT NOT NULL,
    terminal_class TEXT NOT NULL,
    trust_tier INTEGER NOT NULL,
    policy_hash TEXT NOT NULL,
    approval_proof_ref TEXT,
    scope TEXT,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    status TEXT NOT NULL,
    FOREIGN KEY (intent_id) REFERENCES intents(intent_id),
    FOREIGN KEY (plan_id) REFERENCES plans(plan_id)
  );
  CREATE INDEX IF NOT EXISTS idx_approvals_intent ON approvals(intent_id, status);

  CREATE TABLE IF NOT EXISTS execution_receipts (
    receipt_id TEXT PRIMARY KEY,
    intent_id TEXT NOT NULL,
    plan_id TEXT NOT NULL,
    approval_id TEXT NOT NULL,
    schema_version TEXT NOT NULL,
    tx_hash TEXT NOT NULL,
    block_number INTEGER NOT NULL,
    block_hash TEXT NOT NULL,
    from_addr TEXT NOT NULL,
    to_addr TEXT NOT NULL,
    sponsor TEXT,
    actor_agent_id TEXT NOT NULL,
    terminal_class TEXT NOT NULL,
    trust_tier INTEGER NOT NULL,
    policy_hash TEXT NOT NULL,
    sponsor_policy_hash TEXT,
    artifact_ref TEXT,
    effects_hash TEXT,
    gas_used INTEGER NOT NULL,
    value TEXT NOT NULL,
    receipt_status TEXT NOT NULL,
    proof_ref TEXT,
    receipt_ref TEXT,
    settled_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_receipts_intent ON execution_receipts(intent_id);
  CREATE INDEX IF NOT EXISTS idx_receipts_tx ON execution_receipts(tx_hash);

  -- GTOS 2046 Phase 5: Sponsor attribution tracking (v49)
  CREATE TABLE IF NOT EXISTS sponsor_attributions (
    intent_id TEXT NOT NULL,
    plan_id TEXT NOT NULL,
    sponsor_address TEXT NOT NULL,
    sponsor_name TEXT,
    fee_charged TEXT NOT NULL,
    fee_display TEXT NOT NULL,
    policy_hash TEXT NOT NULL,
    selected_at INTEGER NOT NULL,
    settled_at INTEGER,
    status TEXT NOT NULL CHECK(status IN ('selected','submitted','settled','failed')),
    PRIMARY KEY (intent_id, plan_id)
  );
  CREATE INDEX IF NOT EXISTS idx_sponsor_attr_address ON sponsor_attributions(sponsor_address, selected_at DESC);
  CREATE INDEX IF NOT EXISTS idx_sponsor_attr_status ON sponsor_attributions(status, selected_at DESC);

  -- GTOS 2046 Phase 6: Append-only audit journal (v50)
  CREATE TABLE IF NOT EXISTS audit_journal (
    entry_id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    timestamp INTEGER NOT NULL,
    intent_id TEXT,
    plan_id TEXT,
    approval_id TEXT,
    receipt_id TEXT,
    actor_address TEXT,
    actor_role TEXT,
    terminal_class TEXT,
    terminal_id TEXT,
    trust_tier INTEGER,
    policy_hash TEXT,
    policy_decision TEXT,
    tx_hash TEXT,
    sponsor_address TEXT,
    value TEXT,
    summary TEXT NOT NULL,
    details TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_audit_journal_intent ON audit_journal(intent_id);
  CREATE INDEX IF NOT EXISTS idx_audit_journal_kind ON audit_journal(kind);
  CREATE INDEX IF NOT EXISTS idx_audit_journal_timestamp ON audit_journal(timestamp);
  CREATE INDEX IF NOT EXISTS idx_audit_journal_actor ON audit_journal(actor_address);
  CREATE INDEX IF NOT EXISTS idx_audit_journal_terminal ON audit_journal(terminal_class);
  CREATE INDEX IF NOT EXISTS idx_audit_journal_sponsor ON audit_journal(sponsor_address);

  -- GTOS 2046 Phase 7: Persistent terminal sessions (v51)
  CREATE TABLE IF NOT EXISTS terminal_sessions (
    session_id TEXT PRIMARY KEY,
    terminal_class TEXT NOT NULL,
    trust_tier INTEGER NOT NULL,
    terminal_id TEXT NOT NULL,
    connected_at INTEGER NOT NULL,
    last_active_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    metadata TEXT NOT NULL DEFAULT '{}',
    revoked INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_terminal_sessions_terminal ON terminal_sessions(terminal_id);
  CREATE INDEX IF NOT EXISTS idx_terminal_sessions_expires ON terminal_sessions(expires_at);
  CREATE INDEX IF NOT EXISTS idx_terminal_sessions_revoked ON terminal_sessions(revoked);

  -- P2P Agent Mail (v52)
  CREATE TABLE IF NOT EXISTS mail_messages (
    id TEXT PRIMARY KEY,
    thread_id TEXT NOT NULL,
    in_reply_to TEXT,
    from_address TEXT NOT NULL,
    to_addresses TEXT NOT NULL,
    cc_addresses TEXT DEFAULT '[]',
    subject TEXT NOT NULL DEFAULT '',
    body TEXT NOT NULL DEFAULT '',
    body_html TEXT DEFAULT '',
    folder TEXT NOT NULL DEFAULT 'inbox',
    status TEXT NOT NULL DEFAULT 'unread',
    sender_signature TEXT NOT NULL,
    has_attachments INTEGER NOT NULL DEFAULT 0,
    attachments_json TEXT DEFAULT '[]',
    size_bytes INTEGER NOT NULL DEFAULT 0,
    sent_at TEXT NOT NULL,
    received_at TEXT NOT NULL DEFAULT (datetime('now')),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS mail_threads (
    id TEXT PRIMARY KEY,
    subject TEXT NOT NULL DEFAULT '',
    participants TEXT NOT NULL DEFAULT '[]',
    message_count INTEGER NOT NULL DEFAULT 0,
    unread_count INTEGER NOT NULL DEFAULT 0,
    last_message_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_mail_messages_thread ON mail_messages(thread_id);
  CREATE INDEX IF NOT EXISTS idx_mail_messages_folder ON mail_messages(folder, received_at DESC);
  CREATE INDEX IF NOT EXISTS idx_mail_messages_from ON mail_messages(from_address);
  CREATE INDEX IF NOT EXISTS idx_mail_messages_status ON mail_messages(status);
  CREATE INDEX IF NOT EXISTS idx_mail_threads_last ON mail_threads(last_message_at DESC);
`;
