#!/usr/bin/env bash
# Linux counterpart of install-resources.ps1
set -euo pipefail

BACKEND_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EMBED_ROOT="${BACKEND_ROOT}/python-embed"
export PYTHONNOUSERSITE=1

PYTHON_EXE="$("${BACKEND_ROOT}/scripts/embed_python.sh" "$BACKEND_ROOT")"

ARGS=("${BACKEND_ROOT}/scripts/install_resources.py")
if [[ "${1:-}" == "--force" ]]; then
  ARGS+=("--force")
fi

exec "$PYTHON_EXE" "${ARGS[@]}"
