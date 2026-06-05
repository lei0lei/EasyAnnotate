"""WebSocket entry: /api/v1/ws"""

from __future__ import annotations

import json
import logging
import uuid

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.sam_session.api_common import validate_client_id
from app.ws.connection import WsConnection
from app.ws.protocol_helpers import ws_reply_error, ws_reply_ok
from app.ws.sam_handler import handle_sam_binary, handle_sam_text, on_sam_disconnect
from app.ws.yolo_training_handler import handle_yolo_training_binary, handle_yolo_training_text

_log = logging.getLogger(__name__)

router = APIRouter()


async def _handle_text_message(conn: WsConnection, raw: str) -> None:
    try:
        msg = json.loads(raw)
    except json.JSONDecodeError:
        await ws_reply_error(conn, None, "invalid JSON")
        return
    if not isinstance(msg, dict):
        await ws_reply_error(conn, None, "message must be a JSON object")
        return

    msg_type = str(msg.get("type", "")).strip()
    request_id = str(msg.get("id", "")).strip() or None
    payload = msg.get("payload")
    if payload is None:
        payload = {}
    if not isinstance(payload, dict):
        await ws_reply_error(conn, request_id, "payload must be an object")
        return

    if msg_type == "hello":
        try:
            conn.client_id = validate_client_id(str(payload.get("client_id", "")))
        except ValueError as e:
            await ws_reply_error(conn, request_id, str(e), code="hello_failed")
            return
        rid = request_id or uuid.uuid4().hex
        await ws_reply_ok(conn, rid, "hello.ok", {"client_id": conn.client_id})
        return

    if msg_type == "ping":
        rid = request_id or uuid.uuid4().hex
        await ws_reply_ok(conn, rid, "pong", {})
        return

    if await handle_sam_text(conn, msg_type, request_id, payload):
        return
    if await handle_yolo_training_text(conn, msg_type, request_id, payload):
        return

    await ws_reply_error(conn, request_id, f"unknown type: {msg_type}", code="unknown_type")


async def _handle_binary_message(conn: WsConnection, data: bytes) -> None:
    if await handle_yolo_training_binary(conn, data):
        return
    if await handle_sam_binary(conn, data):
        return
    await ws_reply_error(conn, None, "unexpected binary frame", code="invalid_upload")


@router.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket) -> None:
    await websocket.accept()
    conn = WsConnection(websocket=websocket)
    try:
        while True:
            message = await websocket.receive()
            if message.get("type") == "websocket.disconnect":
                break
            if "text" in message and message["text"] is not None:
                await _handle_text_message(conn, message["text"])
            elif "bytes" in message and message["bytes"] is not None:
                await _handle_binary_message(conn, message["bytes"])
    except WebSocketDisconnect:
        pass
    except Exception:
        _log.exception("websocket session error")
    finally:
        await on_sam_disconnect(conn)
