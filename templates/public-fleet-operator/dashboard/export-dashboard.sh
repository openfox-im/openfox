#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MANIFEST_PATH="${1:-"$ROOT_DIR/fleet.yml"}"
OUTPUT_DIR="${2:-"$ROOT_DIR/dashboard"}"

mkdir -p "$OUTPUT_DIR"

openfox dashboard export \
  --manifest "$MANIFEST_PATH" \
  --format json \
  --output "$OUTPUT_DIR/fleet-dashboard.json"

openfox dashboard export \
  --manifest "$MANIFEST_PATH" \
  --format html \
  --output "$OUTPUT_DIR/fleet-dashboard.html"

echo "Exported dashboard artifacts to $OUTPUT_DIR"
