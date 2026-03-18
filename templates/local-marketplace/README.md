# Local Marketplace

This template exports a local host / solver / scout stack for one machine.

Use it when you want to validate:

- task bounty publication
- solver automation
- opportunity scouting
- native TOS rewards on a local testnet

Files:

- `host.openfox.json`
- `solver.openfox.json`
- `scout.openfox.json`

Typical flow:

1. export the template directory
2. point each role at the same local RPC URL
3. replace the placeholder wallet addresses
4. run each role with its own config directory or copied config
5. use `openfox bounty ...` and `openfox scout list`
