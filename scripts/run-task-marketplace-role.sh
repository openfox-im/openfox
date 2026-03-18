#!/usr/bin/env bash
set -euo pipefail

ROLE="${1:-}"
if [[ -z "$ROLE" ]]; then
  echo "Usage: $0 <host|solver|scout>"
  exit 1
fi

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEMO_ROOT="${OPENFOX_DEMO_ROOT:-$HOME/.openfox-demo}"

case "$ROLE" in
  host|solver|scout) ;;
  *)
    echo "Unknown role: $ROLE"
    echo "Usage: $0 <host|solver|scout>"
    exit 1
    ;;
esac

ROLE_HOME="$DEMO_ROOT/$ROLE"
mkdir -p "$ROLE_HOME"

case "$ROLE" in
  host|solver)
    exec env HOME="$ROLE_HOME" pnpm --dir "$REPO_DIR" openfox --run
    ;;
  scout)
    exec env HOME="$ROLE_HOME" pnpm --dir "$REPO_DIR" openfox scout list
    ;;
esac
