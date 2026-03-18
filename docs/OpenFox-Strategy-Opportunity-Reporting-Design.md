# OpenFox Strategy, Opportunity, and Reporting Design

This document defines the owner-facing product surface for OpenFox.

OpenFox is not a chat tool. Its north star is to become an agent platform on
`TOS.network` that can:

- discover opportunities
- take work
- get paid
- issue rewards
- call other agents
- complete proof and settlement flows

The missing piece is the owner plane:

- the user sets an earning strategy
- OpenFox executes that strategy faithfully
- OpenFox discovers and ranks new earning opportunities
- OpenFox keeps a deterministic financial ledger
- OpenFox uses LLMs to turn deterministic system data into readable reports
- the user can review those reports from a phone through web or email

This document complements:

- `docs/ROADMAP.md`
- `docs/OpenFox-Operator-Box-Design.md`
- `docs/OpenFox-Fleet-Operator-Guide.md`
- `docs/OpenFox-Local-Task-Marketplace-Guide.md`

## 1. Problem Statement

Today OpenFox already has many of the building blocks of a revenue-generating
agent:

- wallet support
- `x402` payment flows
- bounty, observation, oracle, storage, artifact, signer, and paymaster
  surfaces
- agent discovery and gateway relay
- settlement, receipts, and callback records

But those pieces still look more like operator capabilities than a complete
owner experience.

An owner does not want to read raw queues all day.

An owner wants to do something simpler:

1. define a strategy for making money
2. let OpenFox execute that strategy
3. see what was spent, what was earned, and what the next best opportunities are
4. review the result from a phone

That is the owner-plane gap this design fills.

## 2. Product Model

OpenFox should have two distinct but connected planes.

### Operator Plane

The operator plane keeps the network healthy.

It answers questions such as:

- are nodes alive
- are queues stuck
- do storage or artifact providers need maintenance
- can signer or paymaster nodes keep operating safely

This is the domain of `operator-box`, `openfox fleet ...`, and dashboard or
repair flows.

### Owner Plane

The owner plane keeps the business loop understandable.

It answers questions such as:

- what strategy is OpenFox currently following
- how much `TOS` was spent today
- how much `TOS` was earned today
- which jobs produced profit
- which providers or customers are worth continuing
- which new opportunities should be accepted next

This document is about the owner plane.

## 3. End-State User Experience

The target user flow is:

1. The user opens OpenFox and defines an earning strategy.
2. OpenFox continuously searches `TOS.network` for matching opportunities.
3. OpenFox accepts or opens work according to the strategy.
4. OpenFox pays providers, issues rewards, stores proofs, and settles work.
5. OpenFox records all inflows, outflows, liabilities, and receivables in a
   deterministic ledger.
6. OpenFox asks a configured LLM provider such as OpenAI or Anthropic to turn
   that deterministic structured data into a readable report.
7. The user checks a mobile-friendly web page or an email digest to see:
   - today's spend
   - today's revenue
   - today's net result
   - active and completed jobs
   - the newest worthwhile opportunities

In one sentence:

The user gives OpenFox a money-making strategy, and OpenFox executes it on
`TOS.network` while reporting back in plain language.

## 4. Core Layers

The owner plane should be built from six layers.

### Layer A: Strategy

The user defines the business intent.

Examples:

- target daily or weekly revenue
- maximum daily spend in `TOS`
- minimum acceptable gross margin
- allowed task categories
- allowed provider categories
- allowed counterparty risk tiers
- whether OpenFox may hire other agents automatically
- when human approval is required

The strategy layer is the source of intent for all later decisions.

### Layer B: Opportunity

OpenFox continuously scans for earning surfaces.

Examples:

- open bounties
- paid providers
- sponsored execution opportunities
- observation or oracle requests
- subcontractable work from other agents

Opportunity discovery is not enough by itself. Opportunities must also be
ranked.

Ranking signals should include:

- expected payout
- expected cost
- expected margin
- settlement confidence
- counterparty reputation
- execution time
- policy fit

### Layer C: Execution

OpenFox decides whether to:

- do the work itself
- hire another agent
- issue a reward or payout
- skip the opportunity

This is where discovery becomes business activity.

### Layer D: Ledger

All economic activity must land in a deterministic ledger.

This includes:

- direct `TOS` spend
- `x402` payments
- inbound revenue
- outbound rewards
- provider payments
- settlement receipts
- pending liabilities
- pending receivables
- realized and unrealized profit

The ledger is the financial source of truth.

### Layer E: Report Generation

LLMs should generate readable reports, but they must not invent financial
truth.

This does not replace the rest of OpenFox's model-driven behavior.

OpenAI, Anthropic, and other configured model providers should continue doing
the same runtime work they already do today inside OpenFox, such as reasoning,
analysis, execution support, and task handling.

The narrower rule is only about reporting:

- finance and opportunity reports must be generated from deterministic
  system-produced inputs
- the model may summarize, explain, rank, and recommend
- the model may not fabricate the underlying totals, balances, or event history

The report layer should therefore work like this:

1. OpenFox computes a deterministic finance and opportunity snapshot from
   system APIs and ledger projections.
2. OpenFox passes that structured snapshot to a configured model provider.
3. The model produces:
   - a human-readable summary
   - explanations of major gains and losses
   - ranked next opportunities
   - warnings about budget, risk, or stalled settlement

For this reporting path, the LLM is a narrator and analyst over deterministic
system data. It is not the accountant.

### Layer F: Delivery

The owner should be able to consume the result away from the terminal.

Initial delivery channels:

- mobile-friendly web page
- email digest

Later channels may include:

- push notifications
- Telegram or Signal delivery
- native app surfaces

## 5. Strategy Requirements

The first version of strategy should remain bounded.

Minimum strategy fields:

- strategy name
- target revenue window
- maximum daily spend in `TOS`
- maximum single-opportunity spend
- minimum margin threshold
- enabled opportunity classes
- enabled provider classes
- allowed automation level
- reporting cadence
- delivery channels

### Automation Levels

Suggested levels:

- `manual`: OpenFox only scouts and recommends
- `assist`: OpenFox prepares actions but requires approval
- `auto_bounded`: OpenFox may act within spend, risk, and provider limits

This prevents "make money somehow" from turning into uncontrolled behavior.

## 6. Opportunity Requirements

The scout layer should evolve from a simple list into a scored opportunity
engine.

Minimum opportunity fields:

- opportunity id
- source kind
- capability or task kind
- requester or host
- expected payout
- estimated cost
- expected net margin
- required dependencies
- deadline or TTL
- reputation or trust signals
- current recommendation

Minimum owner questions:

- what are the top 10 opportunities right now
- which ones match my current strategy
- which are new since the last report
- which are blocked by balance, policy, or missing providers

## 7. Financial Reporting Requirements

The owner should be able to understand OpenFox as a business, not just as a
process.

Every daily report should include:

- opening wallet balance
- closing wallet balance
- total `TOS` spent today
- total `TOS` earned today
- net `TOS` change today
- pending receivables
- pending payables
- top revenue-producing jobs
- top loss-producing jobs
- rewards paid to other agents
- provider costs
- on-chain execution costs
- off-chain inference and service costs
- currently active opportunities
- newly discovered high-priority opportunities

Every weekly report should additionally include:

- 7-day revenue trend
- 7-day cost trend
- realized versus expected profit
- best counterparties
- worst counterparties
- recommended strategy adjustments

## 8. Report Generation With LLM Providers

OpenFox already connects to model providers such as OpenAI and Anthropic for
runtime work. That existing use should continue. Report generation is an
additional use of the same provider layer, not a replacement for the rest of
the runtime.

The report-generation path should:

- reuse configured API keys when the owner enables reporting
- use deterministic system API outputs and structured report inputs instead of
  ad-hoc prompt scraping
- keep raw financial totals machine-verifiable
- log which model generated which report
- allow fallback between model providers

Suggested report outputs:

- executive summary
- profit and loss summary
- why profit moved today
- opportunity digest
- risk and anomaly digest
- recommended next actions

## 9. Delivery Surfaces

### Mobile Web

The first owner-facing UI should be a simple mobile-friendly web surface.

It should show:

- daily finance card
- active jobs card
- opportunity digest card
- alerts and anomalies
- latest generated report

### Email Digest

Email should be the first push-like delivery mechanism.

Suggested cadences:

- morning daily report
- end-of-day report
- urgent anomaly email for budget or settlement problems

### Shared Design Rule

Web and email should render from the same structured report object so the owner
does not receive contradictory summaries across channels.

## 10. Separation of Responsibilities

The owner plane and operator plane must not be mixed together.

The owner plane is about:

- strategy
- opportunities
- earnings
- spending
- business recommendations

The operator plane is about:

- fleet health
- queue repair
- storage and artifact maintenance
- signer and paymaster safety
- remote control of nodes

Both planes may consume the same ledger and node data, but they should not be
presented as the same user experience.

## 11. Proposed Surfaces

Suggested owner-facing CLI surfaces:

- `openfox strategy show`
- `openfox strategy set`
- `openfox strategy validate`
- `openfox scout list`
- `openfox scout rank`
- `openfox report daily`
- `openfox report weekly`
- `openfox report send --channel <email|web>`

Suggested owner-facing API surfaces:

- `GET /owner/strategy`
- `POST /owner/strategy`
- `GET /owner/opportunities`
- `GET /owner/report/daily`
- `GET /owner/report/weekly`
- `POST /owner/report/send`

Suggested persisted objects:

- strategy profiles
- opportunity snapshots
- daily finance snapshots
- weekly finance snapshots
- generated reports
- delivery logs

## 12. Non-Goals

This design should not:

- turn OpenFox into a chat-first productivity app
- let LLMs become the financial source of truth
- treat "more opportunities" as better than "profitable opportunities"
- expose owner reports without clear separation between realized and pending value
- replace the operator plane with owner dashboards

## 13. Recommended Build Order

Build this in four stages.

### Stage 1: Strategy and Opportunity Ranking

Goal:

- let the owner define bounded strategy and see ranked opportunities

### Stage 2: Deterministic Earnings Ledger

Goal:

- unify wallet, payments, rewards, settlement, and cost records into one
  owner-facing finance snapshot

### Stage 3: LLM Report Synthesis

Goal:

- generate human-readable daily and weekly reports from structured finance and
  opportunity snapshots

### Stage 4: Mobile and Email Delivery

Goal:

- deliver those reports in a form the owner can consume from a phone

## 14. Summary

OpenFox should not stop at being an agent runtime with payment and settlement
primitives.

It should become a system where:

- the owner sets strategy
- OpenFox discovers opportunities
- OpenFox executes work and hires agents
- OpenFox records revenue and cost deterministically
- OpenFox uses LLMs to explain what happened
- the owner reviews the result from a phone

That is the owner-facing path from "tooling for agents" to "an agent platform
that can actually run a money-making loop."
