"""WebSocket YOLO batch model uploads and predict."""

from __future__ import annotations

import asyncio
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal

from app.train import yolo_batch_chunk_transfer, yolo_batch_runner
from app.ws.connection import WsConnection
from app.ws.protocol_helpers import ws_reply_error as _reply_error
from app.ws.protocol_helpers import ws_reply_ok as _reply_ok

UploadKind = Literal["data_yaml", "weights"]


@dataclass
class _PendingYoloBatchChunk:
    request_id: str
    model_slug: str
    upload_id: str
    chunk_index: int
    byte_length: int
    upload_kind: UploadKind


@dataclass
class _PendingYoloBatchPredict:
    request_id: str
    model_slug: str
    byte_length: int
    suffix: str


def _binary_busy(conn: WsConnection) -> bool:
    return (
        conn.pending_yolo_chunk is not None
        or conn.pending_yolo_base_model is not None
        or conn.pending_yolo_batch_chunk is not None
        or conn.pending_yolo_batch_predict is not None
        or conn.pending_sam_prepare is not None
    )


def _ws_kind_prefix(upload_kind: UploadKind) -> str:
    return "data_yaml" if upload_kind == "data_yaml" else "weights"


async def _handle_upload_init(
    conn: WsConnection,
    upload_kind: UploadKind,
    request_id: str | None,
    payload: dict[str, Any],
) -> None:
    rid = request_id or uuid.uuid4().hex
    model_slug = str(payload.get("model_slug", "")).strip()
    filename = str(payload.get("filename", "")).strip()
    try:
        total_size = int(payload.get("total_size", 0))
    except (TypeError, ValueError):
        total_size = 0
    upload_id = str(payload.get("upload_id", "")).strip() or None
    prefix = _ws_kind_prefix(upload_kind)
    try:
        result = await asyncio.to_thread(
            yolo_batch_chunk_transfer.init_upload,
            model_slug,
            upload_kind,
            filename=filename,
            total_size=total_size,
            upload_id=upload_id,
        )
        await _reply_ok(conn, rid, f"yolo.batch.{prefix}.upload.init.ok", result)
    except (FileNotFoundError, ValueError) as e:
        await _reply_error(conn, rid, str(e), code="invalid_upload")


async def _handle_upload_chunk_begin(
    conn: WsConnection,
    upload_kind: UploadKind,
    request_id: str | None,
    payload: dict[str, Any],
) -> None:
    if _binary_busy(conn):
        await _reply_error(conn, request_id, "binary upload already in progress", code="upload_busy")
        return
    model_slug = str(payload.get("model_slug", "")).strip()
    upload_id = str(payload.get("upload_id", "")).strip()
    try:
        chunk_index = int(payload.get("chunk_index", -1))
        byte_length = int(payload.get("byte_length", 0))
    except (TypeError, ValueError):
        chunk_index = -1
        byte_length = 0
    if not model_slug or not upload_id or chunk_index < 0 or byte_length <= 0:
        await _reply_error(conn, request_id, "invalid chunk begin payload", code="invalid_upload")
        return
    rid = request_id or uuid.uuid4().hex
    prefix = _ws_kind_prefix(upload_kind)
    conn.pending_yolo_batch_chunk = _PendingYoloBatchChunk(
        request_id=rid,
        model_slug=model_slug,
        upload_id=upload_id,
        chunk_index=chunk_index,
        byte_length=byte_length,
        upload_kind=upload_kind,
    )
    await _reply_ok(conn, rid, f"yolo.batch.{prefix}.upload.chunk.ready", {"byte_length": byte_length})


async def _handle_upload_complete(
    conn: WsConnection,
    upload_kind: UploadKind,
    request_id: str | None,
    payload: dict[str, Any],
) -> None:
    rid = request_id or uuid.uuid4().hex
    model_slug = str(payload.get("model_slug", "")).strip()
    upload_id = str(payload.get("upload_id", "")).strip()
    prefix = _ws_kind_prefix(upload_kind)
    try:
        result = await asyncio.to_thread(yolo_batch_chunk_transfer.complete_upload, model_slug, upload_id)
        await _reply_ok(conn, rid, f"yolo.batch.{prefix}.upload.complete.ok", result)
    except (FileNotFoundError, ValueError) as e:
        await _reply_error(conn, rid, str(e), code="invalid_upload")


async def handle_yolo_batch_text(conn: WsConnection, msg_type: str, request_id: str | None, payload: dict[str, Any]) -> bool:
    """Handle YOLO batch message types. Returns True if handled."""
    if not msg_type.startswith("yolo.batch."):
        return False
    if not conn.client_id:
        await _reply_error(conn, request_id, "send hello first", code="not_authenticated")
        return True

    if msg_type == "yolo.batch.data_yaml.upload.init":
        await _handle_upload_init(conn, "data_yaml", request_id, payload)
        return True
    if msg_type == "yolo.batch.data_yaml.upload.chunk.begin":
        await _handle_upload_chunk_begin(conn, "data_yaml", request_id, payload)
        return True
    if msg_type == "yolo.batch.data_yaml.upload.complete":
        await _handle_upload_complete(conn, "data_yaml", request_id, payload)
        return True

    if msg_type == "yolo.batch.weights.upload.init":
        await _handle_upload_init(conn, "weights", request_id, payload)
        return True
    if msg_type == "yolo.batch.weights.upload.chunk.begin":
        await _handle_upload_chunk_begin(conn, "weights", request_id, payload)
        return True
    if msg_type == "yolo.batch.weights.upload.complete":
        await _handle_upload_complete(conn, "weights", request_id, payload)
        return True

    if msg_type == "yolo.batch.predict.begin":
        if _binary_busy(conn):
            await _reply_error(conn, request_id, "binary transfer already in progress", code="transfer_busy")
            return True
        model_slug = str(payload.get("model_slug", "")).strip()
        if not model_slug:
            await _reply_error(conn, request_id, "missing model_slug", code="invalid_predict")
            return True
        try:
            byte_length = int(payload.get("byte_length", 0))
        except (TypeError, ValueError):
            byte_length = 0
        if byte_length <= 0:
            await _reply_error(conn, request_id, "byte_length must be positive", code="invalid_predict")
            return True
        suffix = str(payload.get("suffix", ".jpg")).strip() or ".jpg"
        if not suffix.startswith("."):
            suffix = f".{suffix}"
        rid = request_id or uuid.uuid4().hex
        conn.pending_yolo_batch_predict = _PendingYoloBatchPredict(
            request_id=rid,
            model_slug=model_slug,
            byte_length=byte_length,
            suffix=suffix[:16],
        )
        await _reply_ok(conn, rid, "yolo.batch.predict.ready", {"byte_length": byte_length})
        return True

    return False


async def _run_predict_from_bytes(pending: _PendingYoloBatchPredict, data: bytes) -> dict[str, Any]:
    if len(data) != pending.byte_length:
        raise ValueError(f"byte length mismatch: expected {pending.byte_length}, got {len(data)}")
    return await asyncio.to_thread(yolo_batch_runner.predict_image_bytes, pending.model_slug, data)


async def handle_yolo_batch_binary(conn: WsConnection, data: bytes) -> bool:
    """Handle binary frame for YOLO batch upload/predict. Returns True if consumed."""
    pending_predict = conn.pending_yolo_batch_predict
    if pending_predict is not None:
        conn.pending_yolo_batch_predict = None
        rid = pending_predict.request_id
        try:
            result = await _run_predict_from_bytes(pending_predict, data)
            await _reply_ok(conn, rid, "yolo.batch.predict.ok", result)
        except (RuntimeError, FileNotFoundError, ValueError, ImportError) as e:
            await _reply_error(conn, rid, str(e), code="predict_failed")
        return True

    pending = conn.pending_yolo_batch_chunk
    if pending is None:
        return False
    conn.pending_yolo_batch_chunk = None
    rid = pending.request_id
    prefix = _ws_kind_prefix(pending.upload_kind)
    if len(data) != pending.byte_length:
        await _reply_error(
            conn,
            rid,
            f"chunk byte length mismatch: expected {pending.byte_length}, got {len(data)}",
            code="invalid_upload",
        )
        return True
    try:
        result = await asyncio.to_thread(
            yolo_batch_chunk_transfer.save_upload_chunk,
            pending.model_slug,
            pending.upload_id,
            pending.chunk_index,
            data,
        )
        await _reply_ok(conn, rid, f"yolo.batch.{prefix}.upload.chunk.ok", result)
    except (FileNotFoundError, ValueError) as e:
        await _reply_error(conn, rid, str(e), code="invalid_upload")
    return True
