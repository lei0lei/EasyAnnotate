#!/usr/bin/env bash
# Linux counterpart of start.ps1
set -euo pipefail

BACKEND_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EMBED_ROOT="${BACKEND_ROOT}/python-embed"
export PYTHONNOUSERSITE=1

PYTHON_EXE="$("${BACKEND_ROOT}/scripts/embed_python.sh" "$BACKEND_ROOT")"
cd "$BACKEND_ROOT"
exec "$PYTHON_EXE" -m uvicorn app.main:app --host 0.0.0.0 --port 8000
