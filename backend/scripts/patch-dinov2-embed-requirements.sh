#!/usr/bin/env bash
# Linux counterpart of patch-dinov2-embed-requirements.ps1
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <dinov2_root>" >&2
  exit 1
fi

DINOV2_ROOT="$1"
REQ="${DINOV2_ROOT}/requirements.txt"

cat > "$REQ" << 'EOF'
# Patched by EasyAnnotate: torch/torchvision from install-ml-gpu-deps; omit cuml/xformers.
# UTF-8 without BOM (dinov2 setup may read this with locale encoding).
omegaconf
torchmetrics>=0.10.3
fvcore
iopath
submitit
EOF

echo "Patched DINOv2 requirements: $REQ"
