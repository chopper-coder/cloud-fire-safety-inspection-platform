#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
if [[ $# -gt 0 ]]; then
  python "$SCRIPT_DIR/smoke_test.py" "$1"
else
  python "$SCRIPT_DIR/smoke_test.py"
fi
