#!/usr/bin/env bash
# One-shot Linux bootstrap for remote deployment without python-embed.
# - Creates venv
# - Installs backend deps (+ optional ML deps)
# - Creates external directory structure
# - Clones/updates repos under external/github
# - Does NOT download external/resources model files
set -euo pipefail

BACKEND_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV_DIR="${VENV_DIR:-${BACKEND_ROOT}/.venv}"
PYTHON_BIN="${PYTHON_BIN:-python3}"
INSTALL_ML="${INSTALL_ML:-1}"           # 1: install ML deps, 0: base API only
TORCH_CUDA="${TORCH_CUDA:-cu128}"       # e.g. cu128 / cu121 / cpu

if ! command -v "$PYTHON_BIN" >/dev/null 2>&1; then
  echo "ERROR: Python not found: ${PYTHON_BIN}" >&2
  exit 1
fi

if ! command -v git >/dev/null 2>&1; then
  echo "ERROR: git must be installed." >&2
  exit 1
fi

if ! command -v curl >/dev/null 2>&1; then
  echo "ERROR: curl must be installed." >&2
  exit 1
fi

echo "==> Backend root: ${BACKEND_ROOT}"
echo "==> Creating venv: ${VENV_DIR}"
"$PYTHON_BIN" -m venv "$VENV_DIR"
source "${VENV_DIR}/bin/activate"

echo "==> Upgrading pip/setuptools/wheel"
python -m pip install --upgrade pip setuptools wheel

echo "==> Creating external directory structure"
mkdir -p "${BACKEND_ROOT}/external/github"
mkdir -p "${BACKEND_ROOT}/external/resources"

clone_or_pull() {
  local url="$1"
  local dir="$2"
  local name="$3"
  if [[ -d "${dir}/.git" ]]; then
    echo "==> Updating ${name}"
    git -C "$dir" pull --ff-only
  else
    echo "==> Cloning ${name} -> ${dir}"
    git clone "$url" "$dir"
  fi
}

GH="${BACKEND_ROOT}/external/github"
clone_or_pull "https://github.com/facebookresearch/dinov2.git" "${GH}/dinov2" "DINOv2"
clone_or_pull "https://github.com/facebookresearch/sam2.git" "${GH}/sam2" "SAM2"
clone_or_pull "https://github.com/ultralytics/ultralytics.git" "${GH}/ultralytics" "Ultralytics"
clone_or_pull "https://github.com/ChaoningZhang/MobileSAM.git" "${GH}/mobilesam" "MobileSAM"
clone_or_pull "https://github.com/yformer/EfficientSAM.git" "${GH}/efficientsam" "EfficientSAM"

echo "==> Installing base API deps (requirements.txt)"
python -m pip install -r "${BACKEND_ROOT}/requirements.txt"

if [[ "$INSTALL_ML" == "1" ]]; then
  echo "==> Applying DINOv2 requirements patch (if script exists)"
  if [[ -f "${BACKEND_ROOT}/scripts/patch-dinov2-embed-requirements.sh" ]]; then
    "${BACKEND_ROOT}/scripts/patch-dinov2-embed-requirements.sh" "${GH}/dinov2" || true
  fi

  echo "==> Installing torch/torchvision (${TORCH_CUDA})"
  if [[ "${TORCH_CUDA}" == "cpu" ]]; then
    python -m pip install "torch>=2.5.1,<3" "torchvision>=0.20.1"
  else
    python -m pip install "torch>=2.5.1,<3" "torchvision>=0.20.1" --index-url "https://download.pytorch.org/whl/${TORCH_CUDA}"
  fi

  echo "==> Installing ML deps (requirements-ml-gpu.txt)"
  python -m pip install -r "${BACKEND_ROOT}/requirements-ml-gpu.txt"

  echo "==> Installing ML repos into venv"
  python -m pip install "${GH}/ultralytics"
  # DINOv2 metadata may pin old torch versions (e.g. 2.0.0).
  # We already installed torch/torchvision explicitly above, so skip dep resolution here.
  python -m pip install --no-deps "${GH}/dinov2"
  python -m pip install "${GH}/sam2"
  python -m pip install "${GH}/mobilesam"
  python -m pip install "${GH}/efficientsam"
else
  echo "==> INSTALL_ML=0, skip ML dependency installation"
fi

cat <<'EOF'

Done.
Next steps:
1) Copy model files manually into backend/external/resources/...
2) Start backend with:
   source backend/.venv/bin/activate
   cd backend
   python -m uvicorn app.main:app --host 0.0.0.0 --port 8000

Optional env:
- INSTALL_ML=0       # install base API only
- TORCH_CUDA=cpu     # CPU wheels
- TORCH_CUDA=cu128   # CUDA wheels (default)
- PYTHON_BIN=python3.11
- VENV_DIR=/path/to/venv
EOF
