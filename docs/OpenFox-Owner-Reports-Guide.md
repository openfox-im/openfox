# OpenFox Owner Reports Guide

This guide explains how to enable, generate, inspect, and deliver owner-facing
reports in OpenFox.

The owner report surface is meant for the operator or owner of an OpenFox node,
not for the model itself.

It turns deterministic local runtime state into:

- daily and weekly finance snapshots
- readable owner reports
- web and email delivery artifacts
- delivery logs and audit metadata

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
openfox report deliveries --channel web --json
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
- `GET /owner/reports`
- `GET /owner/reports/latest/daily`
- `GET /owner/reports/latest/weekly`
- `GET /owner/reports/:reportId`
- `GET /owner/deliveries`

If `authToken` is configured, callers must provide it via:

- `Authorization: Bearer ...`
- `x-openfox-owner-token: ...`
- `?token=...`

Use this when you want a phone-friendly report surface without opening the
terminal.

## 6. Email Delivery

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

## 7. Scheduled Generation and Delivery

OpenFox includes built-in heartbeat tasks for owner reporting:

- `generate_owner_reports`
- `deliver_owner_reports`

These can generate or deliver:

- morning reports
- end-of-day reports
- weekly reports
- anomaly-triggered reports

This means owner reports can keep flowing while OpenFox runs as a managed
service.

## 8. Operator API

The authenticated operator API also exposes owner-report data:

- `GET /operator/owner/reports`
- `GET /operator/owner/reports/latest?period=daily|weekly`
- `GET /operator/owner/report-deliveries`

These routes are useful for dashboards, control planes, and fleet tooling.

## 9. Practical Guidance

Start with this sequence:

1. Enable owner reports with `web.enabled = true`.
2. Keep `email.enabled = false` or `mode = "outbox"`.
3. Run:
   - `openfox report daily --json`
   - `openfox report send --channel web --period daily`
4. Verify:
   - `openfox doctor`
   - `openfox status --json`
   - `GET /owner/reports/latest/daily`
5. Only then enable scheduled delivery and optional email delivery.

This gives you a safe owner-facing reporting surface before introducing a full
delivery pipeline.
