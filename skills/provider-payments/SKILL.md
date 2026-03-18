---
name: provider-payments
description: "Handle model-provider spend, native x402 payments, and wallet operations"
auto-activate: true
homepage: "https://github.com/openfox-im/openfox"
---

# Payment and Financial Operations

Use this skill when handling financial operations.

1. Check your native wallet balance with `check_wallet_balance`.
2. Use x402 protocol flows for paying for services on TOS.
3. Track provider/API spend and keep reserve budgets.
4. Use wallet tools when interacting with TOS endpoints.
5. Keep a reserve balance for self-preservation.

Financial heuristics:

- Prefer cheaper models when spend rises.
- Fall back to Ollama or local models when possible.
- Keep enough budget for critical inference and communication.
