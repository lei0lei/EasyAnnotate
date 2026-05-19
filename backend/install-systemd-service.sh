#!/usr/bin/env bash
# Install EasyAnnotate backend as a systemd service (auto-start on boot).
set -euo pipefail

BACKEND_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVICE_NAME="${SERVICE_NAME:-easyannotate-backend}"
SERVICE_USER="${SERVICE_USER:-$USER}"
SERVICE_GROUP="${SERVICE_GROUP:-$SERVICE_USER}"
HOST="${HOST:-0.0.0.0}"
PORT="${PORT:-8000}"
VENV_DIR="${VENV_DIR:-${BACKEND_ROOT}/.venv}"

if ! command -v systemctl >/dev/null 2>&1; then
  echo "ERROR: systemctl not found. This script only supports systemd." >&2
  exit 1
fi

if [[ ! -x "${VENV_DIR}/bin/python" ]]; then
  echo "ERROR: venv python not found: ${VENV_DIR}/bin/python" >&2
  echo "Run ./setup-linux-venv.sh first." >&2
  exit 1
fi

if [[ "$EUID" -ne 0 ]]; then
  SUDO="sudo"
else
  SUDO=""
fi

SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"

echo "==> Installing systemd unit: ${SERVICE_FILE}"
$SUDO tee "$SERVICE_FILE" >/dev/null <<EOF
[Unit]
Description=EasyAnnotate Backend (FastAPI)
After=network.target

[Service]
Type=simple
User=${SERVICE_USER}
Group=${SERVICE_GROUP}
WorkingDirectory=${BACKEND_ROOT}
Environment=PYTHONNOUSERSITE=1
ExecStart=${VENV_DIR}/bin/python -m uvicorn app.main:app --host ${HOST} --port ${PORT}
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

echo "==> Reloading systemd daemon"
$SUDO systemctl daemon-reload

echo "==> Enabling service at boot: ${SERVICE_NAME}"
$SUDO systemctl enable "${SERVICE_NAME}"

echo "==> Starting service now: ${SERVICE_NAME}"
$SUDO systemctl restart "${SERVICE_NAME}"

echo ""
echo "Done."
echo "Check status:"
echo "  systemctl status ${SERVICE_NAME} --no-pager"
echo "Logs:"
echo "  journalctl -u ${SERVICE_NAME} -f"
echo ""
echo "Optional env overrides when installing:"
echo "  SERVICE_NAME=easyannotate-backend"
echo "  SERVICE_USER=${SERVICE_USER}"
echo "  SERVICE_GROUP=${SERVICE_GROUP}"
echo "  HOST=${HOST}"
echo "  PORT=${PORT}"
echo "  VENV_DIR=${VENV_DIR}"
