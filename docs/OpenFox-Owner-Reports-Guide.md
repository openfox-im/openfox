# OpenFox Owner Reports Guide

This guide explains how to enable, generate, inspect, and deliver owner-facing
reports in OpenFox.

The owner report surface is meant for the operator or owner of an OpenFox node,
not for the model itself.

It turns deterministic local runtime state into:

- daily and weekly finance snapshots
- readable owner reports
- actionable owner opportunity alerts
- web and email delivery artifacts
- delivery logs and audit metadata
- owner approval inbox actions

## 1. What Owner Reports Do

Owner reports combine three inputs:

- deterministic finance snapshots
- the current strategy profile
- current opportunity summaries

OpenFox then produces one report object per period:

- `daily`
- `weekly`

The deterministic totals remain the source of truth. Generated prose is a
human-friendly explanation layer on top of those totals.

## 2. Enable Owner Reports

Example `openfox.json` fragment:

```json
{
  "ownerReports": {
    "enabled": true,
    "generateWithInference": true,
    "persistSnapshots": true,
    "autoDeliverChannels": ["web"],
    "web": {
      "enabled": true,
      "bindHost": "127.0.0.1",
      "port": 4894,
      "pathPrefix": "/owner",
      "authToken": "replace-me",
      "outputDir": "~/.openfox/reports/web"
    },
    "email": {
      "enabled": false,
      "mode": "outbox",
      "from": "openfox@localhost",
      "to": "owner@localhost",
      "outboxDir": "~/.openfox/reports/outbox",
      "sendmailPath": "/usr/sbin/sendmail"
    },
    "schedule": {
      "enabled": true,
      "morningHourUtc": 8,
      "endOfDayHourUtc": 22,
      "weeklyDayUtc": 1,
      "weeklyHourUtc": 9,
      "anomalyDeliveryEnabled": true
    },
    "alerts": {
      "enabled": true,
      "minStrategyScore": 1000,
      "minMarginBps": 500,
      "maxItemsPerRun": 5,
      "requireStrategyMatched": true,
      "dedupeHours": 24
    }
  }
}
```

Recommended starting point:

- enable `web`
- keep `email.mode = "outbox"` first
- enable `generateWithInference` only when a provider is configured

## 3. CLI Surface

Generate reports:

```bash
openfox report daily
openfox report daily --json
openfox report weekly
openfox report weekly --json
```

Inspect stored reports:

```bash
openfox report list --period daily
openfox report get --report-id <report-id> --json
openfox report alerts --status unread --json
openfox report alerts-generate --json
openfox report alert-read <alert-id>
openfox report alert-dismiss <alert-id>
openfox report alert-request-action <alert-id> --action review
openfox report actions --status queued --json
openfox report action-complete <action-id> --result-kind report --result-ref report://owner/daily/latest --note "captured in report"
openfox report action-cancel <action-id> --note "not worth pursuing right now"
openfox report deliveries --channel web --json
openfox report approvals --status pending --json
openfox report approve <request-id>
openfox report reject <request-id>
```

Deliver stored or latest reports:

```bash
openfox report send --channel web --period daily
openfox report send --channel email --period weekly
openfox report send --channel web --report-id <report-id>
```

Useful operator checks:

```bash
openfox status --json
openfox doctor
openfox health --json
```

## 4. Report Generation Model

OpenFox supports two generation modes:

- deterministic-only fallback
- deterministic inputs plus inference-generated narrative

When `generateWithInference` is enabled, OpenFox uses the configured inference
backend to produce:

- overview
- gains summary
- losses summary
- opportunity digest
- anomaly commentary
- next-step recommendations

Every generated report records:

- provider
- model
- input hash
- generation timestamp

If no inference backend is configured, OpenFox still produces a deterministic
report object and text output.

## 5. Web Delivery

When web delivery is enabled, OpenFox writes report artifacts into the web
output directory and serves them through the embedded owner-report server.

Routes:

- `GET /owner/healthz`
- `GET /owner/`
- `GET /owner/alerts`
- `GET /owner/reports`
- `GET /owner/reports/latest/daily`
- `GET /owner/reports/latest/weekly`
- `GET /owner/reports/:reportId`
- `GET /owner/deliveries`
- `GET /owner/approvals`
- `GET /owner/actions`
- `POST /owner/alerts/:alertId/read`
- `POST /owner/alerts/:alertId/dismiss`
- `POST /owner/approvals/:requestId/approve`
- `POST /owner/approvals/:requestId/reject`
- `POST /owner/actions/:actionId/complete`
- `POST /owner/actions/:actionId/cancel`

If `authToken` is configured, callers must provide it via:

- `Authorization: Bearer ...`
- `x-openfox-owner-token: ...`
- `?token=...`

Use this when you want a phone-friendly report surface without opening the
terminal.

## 6. Owner Approval Inbox

OpenFox already has bounded operator approvals through the autopilot system.

The owner-report surface now exposes those approvals in a simpler owner-facing
form:

- `openfox report approvals`
- `openfox report approve <request-id>`
- `openfox report reject <request-id>`
- `GET /owner/approvals`
- `POST /owner/approvals/:requestId/approve`
- `POST /owner/approvals/:requestId/reject`

This is meant for mobile review and bounded decisions, not broad operator
reconfiguration.

The approval inbox uses the same underlying approval records as:

- `openfox autopilot approvals`
- `openfox autopilot approve`
- `openfox autopilot reject`

So owner-facing approval actions and operator-facing approval actions stay in
sync.

## 7. Owner Opportunity Alerts

OpenFox also exposes a bounded owner opportunity alert queue built from:

- ranked scout results
- the current strategy profile
- local dedupe windows
- bounded per-run alert limits

This turns opportunity discovery into an owner-facing action queue instead of
an unbounded stream of notifications.

CLI surface:

```bash
openfox report alerts --status unread --json
openfox report alerts-generate --json
openfox report alert-read <alert-id>
openfox report alert-dismiss <alert-id>
```

Owner-web routes:

- `GET /owner/alerts`
- `POST /owner/alerts/:alertId/read`
- `POST /owner/alerts/:alertId/dismiss`
- `POST /owner/alerts/:alertId/request-action`

## 8. Owner Opportunity Actions

Approved `opportunity_action` requests can now materialize into one bounded
owner action queue.

CLI surface:

```bash
openfox report actions --status queued --json
openfox report action-execute <action-id>
openfox report action-complete <action-id>
openfox report action-cancel <action-id>
```

Owner-web routes:

- `GET /owner/actions`
- `POST /owner/actions/:actionId/complete`
- `POST /owner/actions/:actionId/cancel`

Operator API:

- `GET /operator/owner/actions`

This keeps the owner-facing flow bounded:

- scout and strategy generate alerts
- the owner queues one bounded action request from an alert
- the owner approves or rejects that request
- approved requests materialize into queued owner actions
- queued actions can then be executed, completed, or cancelled without
  rereading the raw approval inbox

Bounded remote execution currently supports:

- `pursue` actions targeting remote bounty and campaign hosts
- `delegate` actions targeting remote observation, oracle, and provider-style
  endpoints

When an action is completed or cancelled, OpenFox can also persist one bounded
resolution payload:

- `resultKind`
- `resultRef`
- `note`

Examples:

- `resultKind=report`, `resultRef=report://owner/daily/latest`
- `resultKind=bounty`, `resultRef=bounty://host/queued-1`
- `resultKind=provider_call`, `resultRef=https://provider.example/jobs/123`

Operator API route:

- `GET /operator/owner/alerts`

Each alert includes:

- opportunity kind
- bounded summary
- suggested action
- stable opportunity hash
- alert status: `unread`, `read`, or `dismissed`
- optional queued action metadata:
  - `actionKind`
  - `actionRequestId`
  - `actionRequestedAt`

When the owner decides that an alert deserves follow-up, OpenFox can queue a
bounded approval request from that alert:

```bash
openfox report alert-request-action <alert-id> --action review
```

Supported action kinds:

- `review`
- `pursue`
- `delegate`

This reuses the same approval inbox as the operator autopilot and owner mobile
approval surface. It does not create a separate action queue system.

When enabled, OpenFox runs the built-in heartbeat task:

- `generate_owner_opportunity_alerts`

This keeps the owner alert queue updated while OpenFox runs as a managed
service.

Owner alerts and report inputs now also carry execution-capable templates for
bounded opportunity classes:

- `bounty` opportunities can map directly to `pursue -> remote_bounty_solve`
- `campaign` opportunities can map directly to `pursue -> remote_campaign_solve`
- `oracle` provider opportunities can map directly to
  `delegate -> remote_oracle_request`
- `observation` provider opportunities are marked as execution-capable but
  require an explicit `targetUrl` before auto-execution

When `ownerReports.actionExecution.autoQueueFollowUps = true`, successful
remote campaign execution can automatically queue one bounded follow-up action
for another open campaign bounty. Follow-up depth is capped by
`maxFollowUpDepth`, and each run is capped by `maxFollowUpsPerRun`.

## 8. Email Delivery

Email delivery supports two modes:

- `outbox`
- `sendmail`

In `outbox` mode, OpenFox writes:

- `.txt`
- `.html`
- `.eml`

files into the configured outbox directory.

This is the safest default because it lets the operator inspect rendered output
before wiring a real mail pipeline.

In `sendmail` mode, OpenFox writes those artifacts and then invokes the
configured sendmail binary.

## 9. Scheduled Generation and Delivery

OpenFox includes built-in heartbeat tasks for owner reporting:

- `generate_owner_reports`
- `deliver_owner_reports`
- `generate_owner_opportunity_alerts`

These can generate or deliver:

- morning reports
- end-of-day reports
- weekly reports
- anomaly-triggered reports

This means owner reports can keep flowing while OpenFox runs as a managed
service.

## 10. Operator API

The authenticated operator API also exposes owner-report data:

- `GET /operator/owner/reports`
- `GET /operator/owner/reports/latest?period=daily|weekly`
- `GET /operator/owner/report-deliveries`
- `GET /operator/owner/alerts`

These routes are useful for dashboards, control planes, and fleet tooling.

## 11. Practical Guidance

Start with this sequence:

1. Enable owner reports with `web.enabled = true`.
2. Keep `email.enabled = false` or `mode = "outbox"`.
3. Run:
   - `openfox report daily --json`
   - `openfox report alerts-generate --json`
   - `openfox report alerts --status unread --json`
   - `openfox report send --channel web --period daily`
   - `openfox report approvals --status pending --json`
4. Verify:
   - `openfox doctor`
   - `openfox status --json`
   - `GET /owner/alerts`
   - `GET /owner/reports/latest/daily`
   - `GET /owner/approvals`
5. Only then enable scheduled delivery and optional email delivery.

This gives you a safe owner-facing reporting surface before introducing a full
delivery pipeline.
