---
name: local-runtime
description: "Manage the local runtime, shell access, files, and services"
auto-activate: true
homepage: "https://github.com/openfox-im/openfox"
---

# Local Runtime Management

Use this skill when you need to manage local compute resources, deploy code, or
work with services.

1. Use `exec` to run commands on the local host runtime.
2. Use `expose_port` to make services reachable when appropriate.
3. Use `write_file` and `read_file` for file operations.
4. Use `edit_own_file` carefully for self-modification.
5. Prefer local workflows over assumptions about hosted infrastructure.

Always be resource-conscious. Every action still consumes time, tokens, and
money.
