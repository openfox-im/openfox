# OpenFox Third-Party Quickstart

This guide is for third-party builders who want to integrate OpenFox without
reading the implementation.

## Goal

Complete this path:

`setup -> fund -> discover provider -> pay in TOS -> receive a real result`

## 1. Install

```bash
git clone https://github.com/openfox-im/openfox
cd openfox
corepack enable
corepack prepare pnpm@10.28.1 --activate
pnpm install
pnpm build
```

## 2. Export a starting template

```bash
pnpm openfox templates list
pnpm openfox templates export third-party-quickstart --output ./my-openfox
```

Edit `./my-openfox/openfox.json` and replace the placeholder wallet fields.

## 3. Run onboarding

```bash
pnpm openfox onboard
pnpm openfox doctor
pnpm openfox wallet status
```

If you are on a local devnet:

```bash
pnpm openfox onboard --fund-local
```

If you are on a testnet:

```bash
pnpm openfox onboard --fund-testnet
```

## 4. Verify discovery and provider access

```bash
pnpm openfox status --json
pnpm openfox scout list
```

If you are operating a provider:

```bash
pnpm openfox payments list
pnpm openfox settlement list
pnpm openfox market list
```

## 5. Receive a real service result

For built-in paid services, use:

- `POST /observe`
- `GET /jobs/:id`
- `POST /oracle/quote`
- `POST /oracle/resolve`
- `GET /oracle/result/:id`

Server-side payment and replay handling are visible through:

```bash
pnpm openfox payments list --json
pnpm openfox payments retry --json
```

## Recommended next docs

- [OpenFox-Local-Task-Marketplace-Guide.md](./OpenFox-Local-Task-Marketplace-Guide.md)
- [OpenFox-Service-Operator-Guide.md](./OpenFox-Service-Operator-Guide.md)
- [OpenFox-Integration-Examples.md](./OpenFox-Integration-Examples.md)
