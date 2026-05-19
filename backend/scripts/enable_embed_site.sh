#!/usr/bin/env bash
# Linux counterpart of enable_embed_site.ps1 — uncomment or append `import site` in python*._pth.
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <embed_root>" >&2
  exit 1
fi

EMBED_ROOT="$1"
shopt -s nullglob
found_any=false
for pth in "${EMBED_ROOT}"/python*._pth; do
  [[ -f "$pth" ]] || continue
  found_any=true
  if grep -qE '^[[:space:]]*import site[[:space:]]*$' "$pth"; then
    echo "Already enabled: $(basename "$pth")"
    continue
  fi
  if grep -qE '^[[:space:]]*#import site[[:space:]]*$' "$pth"; then
    sed -i 's/^[[:space:]]*#import site[[:space:]]*$/import site/' "$pth"
  else
    printf '\nimport site\n' >> "$pth"
  fi
  echo "Enabled site-packages: $(basename "$pth")"
done

if [[ "$found_any" == false ]]; then
  echo "No python*._pth under $EMBED_ROOT — skip (non-embed layout?)" >&2
fi
