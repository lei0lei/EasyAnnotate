#!/usr/bin/env bash
# Linux counterpart of install-ml-gpu-deps.ps1 — PyTorch (CUDA) + Ultralytics + DINOv2 + SAM2 + MobileSAM + EfficientSAM.
set -euo pipefail

TORCH_CUDA="${1:-cu128}"

BACKEND_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EMBED_ROOT="${BACKEND_ROOT}/python-embed"
export PYTHONNOUSERSITE=1

PYTHON_EXE="$("${BACKEND_ROOT}/scripts/embed_python.sh" "$BACKEND_ROOT")"

if ! "$PYTHON_EXE" -c "import sys; raise SystemExit(0 if sys.version_info >= (3, 10) else 1)"; then
  echo "ERROR: SAM2/DINOv2 need Python 3.10+. Use python-embed 3.10+." >&2
  exit 1
fi

"${BACKEND_ROOT}/scripts/enable_embed_site.sh" "$EMBED_ROOT"

if ! "$PYTHON_EXE" -m pip --version >/dev/null 2>&1; then
  echo "Installing pip into embeddable Python..."
  GET_PIP="$(mktemp "${TMPDIR:-/tmp}/get-pip-XXXXXX.py")"
  trap 'rm -f "$GET_PIP"' EXIT
  curl -fsSL "https://bootstrap.pypa.io/get-pip.py" -o "$GET_PIP"
  "$PYTHON_EXE" "$GET_PIP"
fi

if ! command -v git >/dev/null 2>&1; then
  echo "ERROR: git must be on PATH to clone external/github." >&2
  exit 1
fi

GH="${BACKEND_ROOT}/external/github"
mkdir -p "$GH"

clone_or_pull() {
  local url="$1"
  local dir="$2"
  local name="$3"
  if [[ -d "${dir}/.git" ]]; then
    echo "Updating ${name} ..."
    git -C "$dir" pull --ff-only
  else
    echo "Cloning ${name} into ${dir} ..."
    git clone "$url" "$dir"
  fi
}

clone_or_pull "https://github.com/facebookresearch/dinov2.git" "${GH}/dinov2" "DINOv2"
"${BACKEND_ROOT}/scripts/patch-dinov2-embed-requirements.sh" "${GH}/dinov2"

clone_or_pull "https://github.com/facebookresearch/sam2.git" "${GH}/sam2" "SAM 2"
clone_or_pull "https://github.com/ultralytics/ultralytics.git" "${GH}/ultralytics" "Ultralytics YOLO"
clone_or_pull "https://github.com/ChaoningZhang/MobileSAM.git" "${GH}/mobilesam" "MobileSAM"
clone_or_pull "https://github.com/yformer/EfficientSAM.git" "${GH}/efficientsam" "EfficientSAM"

echo ""
echo "=== Base API deps (requirements.txt) ==="
"$PYTHON_EXE" -m pip install -r "${BACKEND_ROOT}/requirements.txt"

echo ""
echo "=== PyTorch + torchvision (${TORCH_CUDA}) into embed ==="
INDEX_URL="https://download.pytorch.org/whl/${TORCH_CUDA}"
"$PYTHON_EXE" -m pip install "torch>=2.5.1,<3" "torchvision>=0.20.1" --index-url "$INDEX_URL"

echo ""
echo "=== Vision deps (requirements-ml-gpu.txt) ==="
"$PYTHON_EXE" -m pip install -r "${BACKEND_ROOT}/requirements-ml-gpu.txt"

export SAM2_BUILD_CUDA="${SAM2_BUILD_CUDA:-0}"
echo ""
echo "SAM2_BUILD_CUDA=${SAM2_BUILD_CUDA} (set SAM2_BUILD_CUDA=1 before this script to build SAM2 CUDA ext)"

echo ""
echo "=== Ultralytics YOLO (pip install into site-packages) ==="
"$PYTHON_EXE" -m pip install "${GH}/ultralytics"

echo ""
echo "=== DINOv2 (pip install into site-packages) ==="
# DINOv2 package metadata may pin torch==2.0.0; torch is managed explicitly above.
"$PYTHON_EXE" -m pip install --no-deps "${GH}/dinov2"

echo ""
echo "=== SAM 2 (pip install into site-packages) ==="
"$PYTHON_EXE" -m pip install "${GH}/sam2"

echo ""
echo "=== MobileSAM (pip install into site-packages) ==="
"$PYTHON_EXE" -m pip install "${GH}/mobilesam"

echo ""
echo "=== EfficientSAM (pip install into site-packages) ==="
"$PYTHON_EXE" -m pip install "${GH}/efficientsam"

echo ""
echo "Done. Run ./start.sh to launch the API."
