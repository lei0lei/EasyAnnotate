"""Shared WebSocket JSON reply helpers."""

from __future__ import annotations

import json
from typing import Any

from fastapi import WebSocket

from app.ws.connection import WsConnection


async def ws_send(websocket: WebSocket, msg: dict[str, Any]) -> None:
    await websocket.send_text(json.dumps(msg, ensure_ascii=False))


async def ws_reply_ok(conn: WsConnection, request_id: str, msg_type: str, payload: dict[str, Any]) -> None:
    await ws_send(conn.websocket, {"id": request_id, "type": msg_type, "payload": payload})


async def ws_reply_error(
    conn: WsConnection,
    request_id: str | None,
    message: str,
    *,
    code: str = "error",
) -> None:
    body: dict[str, Any] = {"type": "error", "payload": {"code": code, "message": message}}
    if request_id:
        body["id"] = request_id
    await ws_send(conn.websocket, body)
