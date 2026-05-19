#!/usr/bin/env bash
# Print absolute path to the embeddable interpreter under backend/python-embed/bin/.
# Usage: embed_python.sh [backend_root]
set -euo pipefail

BACKEND_ROOT="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
EMBED_ROOT="${BACKEND_ROOT}/python-embed"

for c in \
  "${EMBED_ROOT}/bin/python3" \
  "${EMBED_ROOT}/bin/python3.13" \
  "${EMBED_ROOT}/bin/python3.12" \
  "${EMBED_ROOT}/bin/python3.11" \
  "${EMBED_ROOT}/bin/python3.10"; do
  if [[ -x "$c" ]]; then
    echo "$c"
    exit 0
  fi
done

echo "ERROR: no executable Python under ${EMBED_ROOT}/bin/python3* (unpack Linux embeddable build here)." >&2
exit 1
