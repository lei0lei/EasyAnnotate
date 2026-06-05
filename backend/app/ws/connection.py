"""Shared WebSocket connection state for /api/v1/ws."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from fastapi import WebSocket


@dataclass
class WsConnection:
    websocket: WebSocket
    client_id: str | None = None
    pending_sam_prepare: Any | None = None
    pending_yolo_chunk: Any | None = None
    pending_yolo_base_model: Any | None = None
