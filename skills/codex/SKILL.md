---
name: codex
description: "OpenAI Codex CLI inference backend — invokes the locally installed Codex CLI (codex exec) as a bounded inference provider. Uses the operator's existing ChatGPT Plus/Pro subscription via Codex's native authentication. Supports chat completions, structured JSON output via output-schema, and code review."
provider-backends:
  chat:
    entry: scripts/chat.mjs
    description: "Send a chat completion request through Codex CLI (exec mode, JSONL output)"
  structured:
    entry: scripts/structured.mjs
    description: "Send a chat completion request with JSON schema validation via Codex CLI --output-schema"
  review:
    entry: scripts/review.mjs
    description: "Run a code review via Codex CLI (codex exec review)"
---
