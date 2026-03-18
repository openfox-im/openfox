# Public Fleet Operator Notes

This template is for operators who already run multiple public OpenFox nodes
and want one reusable control-plane bundle.

## Replace Before Use

- all `baseUrl` values in `fleet.yml`
- all `authToken` values in `fleet.yml`
- any role names that do not match your deployment

## Suggested Validation Flow

1. verify every node serves its authenticated operator API
2. run `openfox fleet status --manifest ./fleet.yml`
3. run `openfox fleet doctor --manifest ./fleet.yml --json`
4. export a dashboard snapshot
5. use `openfox fleet repair ...` only after reviewing the dashboard

## Recommended Commands

```bash
openfox fleet status --manifest ./fleet.yml
openfox fleet health --manifest ./fleet.yml
openfox fleet doctor --manifest ./fleet.yml --json
openfox fleet storage --manifest ./fleet.yml
openfox fleet lease-health --manifest ./fleet.yml
openfox fleet artifacts --manifest ./fleet.yml
openfox fleet signer --manifest ./fleet.yml
openfox fleet paymaster --manifest ./fleet.yml
openfox fleet providers --manifest ./fleet.yml
openfox dashboard show --manifest ./fleet.yml
```

## Maintenance Commands

```bash
openfox fleet repair storage --manifest ./fleet.yml
openfox fleet repair artifacts --manifest ./fleet.yml
openfox dashboard export --manifest ./fleet.yml --format json --output ./dashboard/fleet-dashboard.json
openfox dashboard export --manifest ./fleet.yml --format html --output ./dashboard/fleet-dashboard.html
```
