# Public Fleet Operator

Use this template when you want to run and audit a multi-node public OpenFox
fleet with:

- storage providers
- artifact providers
- signer providers
- paymaster providers
- one or more gateway/runtime nodes

Files:

- `fleet.yml`
- `dashboard/README.md`
- `dashboard/export-dashboard.sh`
- `operator-notes.md`

Recommended flow:

1. export the template
2. replace all placeholder URLs, tokens, and addresses in `fleet.yml`
3. verify each node serves its authenticated operator API
4. run `openfox fleet doctor --manifest ./fleet.yml --json`
5. run `./dashboard/export-dashboard.sh`
6. use `openfox fleet ...`, `openfox storage maintain`, and `openfox artifacts maintain` for repairs
