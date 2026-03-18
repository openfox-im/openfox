# metaWorld Local Demo

Use this template when you want a packaged local multi-node OpenFox `metaWorld`
bundle instead of a static config skeleton.

Unlike the static templates, this export path generates:

- seeded SQLite state
- three separate node homes (`alpha`, `beta`, `observer`)
- prebuilt static site exports for each node
- helper scripts for serving and validating the bundle
- a `metaworld-demo.json` manifest describing the replicated Fox world

Export it with:

```bash
pnpm openfox templates export metaworld-local-demo --output ./tmp/openfox-metaworld-demo --force
```

This delegates to:

```bash
pnpm openfox world demo export --output-dir ./tmp/openfox-metaworld-demo --force
```

Then validate the result with:

```bash
./tmp/openfox-metaworld-demo/scripts/validate.sh
```
