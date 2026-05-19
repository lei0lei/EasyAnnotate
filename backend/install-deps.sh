#!/usr/bin/env bash
# Linux counterpart of install-deps.ps1 — FastAPI base deps into backend/python-embed.
set -euo pipefail

BACKEND_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EMBED_ROOT="${BACKEND_ROOT}/python-embed"
export PYTHONNOUSERSITE=1

PYTHON_EXE="$("${BACKEND_ROOT}/scripts/embed_python.sh" "$BACKEND_ROOT")"

"${BACKEND_ROOT}/scripts/enable_embed_site.sh" "$EMBED_ROOT"

if ! "$PYTHON_EXE" -m pip --version >/dev/null 2>&1; then
  echo "Installing pip into embeddable Python..."
  GET_PIP="$(mktemp "${TMPDIR:-/tmp}/get-pip-XXXXXX.py")"
  trap 'rm -f "$GET_PIP"' EXIT
  curl -fsSL "https://bootstrap.pypa.io/get-pip.py" -o "$GET_PIP"
  "$PYTHON_EXE" "$GET_PIP"
fi

"$PYTHON_EXE" -m pip install -r "${BACKEND_ROOT}/requirements.txt"
echo ""
echo "Done. Run ./start.sh to launch the API."
