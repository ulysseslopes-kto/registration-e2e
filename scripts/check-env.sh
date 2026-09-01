#!/usr/bin/env bash
# Fails fast with a clear message instead of Cypress's cryptic
# "bad option: --no-sandbox" when ELECTRON_RUN_AS_NODE is set — see README.md.
if [ -n "$ELECTRON_RUN_AS_NODE" ]; then
  echo "error: ELECTRON_RUN_AS_NODE is set — Cypress's Electron binary will fail to start." >&2
  echo "  Run: unset ELECTRON_RUN_AS_NODE" >&2
  echo "  See README.md for details." >&2
  exit 1
fi
