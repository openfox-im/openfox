---
name: claude
description: "Claude Code inference backend — invokes the locally installed Claude Code CLI as a bounded inference provider. Uses the operator's existing Claude subscription (Max/Pro) via Claude Code's native OAuth authentication. Supports chat completions, structured JSON output, and model selection."
provider-backends:
  chat:
    entry: scripts/chat.mjs
    description: "Send a chat completion request through Claude Code CLI (print mode)"
  structured:
    entry: scripts/structured.mjs
    description: "Send a chat completion request with JSON schema validation via Claude Code CLI"
---
