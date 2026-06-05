"""WebSocket SAM session messages (prepare with binary upload, decode, release)."""

from __future__ import annotations

import asyncio
import json
import os
import tempfile
import uuid
from dataclasses import dataclass
from typing import Any

from fastapi import HTTPException

from app.sam_session.api_common import build_prepare_payload, validate_client_id
from app.sam_session.service import decode_in_session, prepare_session, release_client_session
from app.ws.connection import WsConnection
from app.ws.protocol_helpers import ws_reply_error as _reply_error
from app.ws.protocol_helpers import ws_reply_ok as _reply_ok


@dataclass
class _PendingPrepare:
    request_id: str
    model_id: str
    infer_scale: float | None
    runtime_slot: str | None
    byte_length: int
    suffix: str = ".jpg"


def _clamp_infer_scale(value: Any) -> float | None:
    if value is None:
        return None
    try:
        f = float(value)
    except (TypeError, ValueError):
        return None
    return min(1.0, max(0.3, f))


def _decode_ws_to_service(client_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    result = decode_in_session(
        client_id,
        str(payload.get("session_id", "")).strip(),
        prompt_mode=payload.get("prompt_mode", "point"),
        points=payload.get("points") or [],
        bbox=payload.get("bbox"),
        min_pred_iou=payload.get("min_pred_iou"),
        polygon_vertex_bias=int(payload.get("polygon_vertex_bias", 50)),
        include_mask=bool(payload.get("include_mask", False)),
        include_polygon=bool(payload.get("include_polygon", True)),
    )
    return {
        "ok": result.ok,
        "pred_iou": result.pred_iou,
        "polygon": result.polygon,
        "bbox": result.bbox,
        "message": result.message,
        "mask_base64": result.mask_base64,
        "mask_width": result.mask_width,
        "mask_height": result.mask_height,
    }


async def _run_prepare_from_bytes(conn: WsConnection, pending: _PendingPrepare, raw: bytes) -> dict[str, Any]:
    if len(raw) != pending.byte_length:
        raise ValueError(f"image byte length mismatch: expected {pending.byte_length}, got {len(raw)}")
    if not conn.client_id:
        raise ValueError("hello required before prepare")

    tmp_path = ""
    try:
        with tempfile.NamedTemporaryFile(prefix="ea-sam-ws-", suffix=pending.suffix, delete=False) as f:
            f.write(raw)
            tmp_path = f.name
        payload = build_prepare_payload(
            pending.model_id,
            tmp_path,
            pending.infer_scale,
            pending.runtime_slot,
        )
        return await asyncio.to_thread(prepare_session, conn.client_id, pending.model_id.strip(), payload)
    except HTTPException as e:
        detail = e.detail if isinstance(e.detail, str) else str(e.detail)
        raise ValueError(detail) from e
    finally:
        if tmp_path:
            try:
                os.unlink(tmp_path)
            except OSError:
                pass


async def handle_sam_text(conn: WsConnection, msg_type: str, request_id: str | None, payload: dict[str, Any]) -> bool:
    """Handle SAM message types. Returns True if handled."""
    if msg_type == "sam.prepare.begin":
        if not conn.client_id:
            await _reply_error(conn, request_id, "send hello first", code="not_authenticated")
            return True
        if conn.pending_yolo_chunk is not None or conn.pending_yolo_base_model is not None:
            await _reply_error(conn, request_id, "binary upload already in progress", code="upload_busy")
            return True
        if conn.pending_sam_prepare is not None:
            await _reply_error(conn, request_id, "prepare already in progress", code="prepare_busy")
            return True
        model_id = str(payload.get("model_id", "")).strip()
        if not model_id:
            await _reply_error(conn, request_id, "model_id is required", code="invalid_prepare")
            return True
        try:
            byte_length = int(payload.get("byte_length", 0))
        except (TypeError, ValueError):
            byte_length = 0
        if byte_length <= 0:
            await _reply_error(conn, request_id, "byte_length must be positive", code="invalid_prepare")
            return True
        suffix = str(payload.get("suffix", ".jpg")).strip() or ".jpg"
        if not suffix.startswith("."):
            suffix = f".{suffix}"
        rid = request_id or uuid.uuid4().hex
        conn.pending_sam_prepare = _PendingPrepare(
            request_id=rid,
            model_id=model_id,
            infer_scale=_clamp_infer_scale(payload.get("infer_scale")),
            runtime_slot=(str(payload.get("runtime_slot")).strip() if payload.get("runtime_slot") else None),
            byte_length=byte_length,
            suffix=suffix[:16],
        )
        await _reply_ok(conn, rid, "sam.prepare.ready", {"byte_length": byte_length})
        return True

    if msg_type == "sam.decode":
        rid = request_id or uuid.uuid4().hex
        if not conn.client_id:
            await _reply_error(conn, rid, "send hello first", code="not_authenticated")
            return True
        try:
            result = await asyncio.to_thread(_decode_ws_to_service, conn.client_id, payload)
            await _reply_ok(conn, rid, "sam.decode.ok", result)
        except KeyError as e:
            await _reply_error(conn, rid, str(e), code="session_not_found")
        except PermissionError as e:
            await _reply_error(conn, rid, str(e), code="forbidden")
        except ValueError as e:
            await _reply_error(conn, rid, str(e), code="invalid_decode")
        except ImportError as e:
            await _reply_error(conn, rid, str(e), code="server_error")
        return True

    if msg_type == "sam.release":
        rid = request_id or uuid.uuid4().hex
        if conn.client_id:
            await asyncio.to_thread(release_client_session, conn.client_id)
        await _reply_ok(conn, rid, "sam.release.ok", {"status": "released"})
        return True

    return False


async def handle_sam_binary(conn: WsConnection, data: bytes) -> bool:
    pending = conn.pending_sam_prepare
    if pending is None:
        return False
    conn.pending_sam_prepare = None
    rid = pending.request_id
    try:
        result = await _run_prepare_from_bytes(conn, pending, data)
        await _reply_ok(conn, rid, "sam.prepare.ok", result)
    except Exception as e:
        detail = str(e)
        code = "server_error"
        if "503" in detail or "runtime" in detail.lower():
            code = "runtime_unavailable"
        await _reply_error(conn, rid, detail, code=code)
    return True


async def on_sam_disconnect(conn: WsConnection) -> None:
    cid = conn.client_id
    if cid:
        await asyncio.to_thread(release_client_session, cid)
