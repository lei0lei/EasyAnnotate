"""WebSocket YOLO training uploads (dataset zip chunks, base .pt) and monitor/download."""

from __future__ import annotations

import asyncio
import json
import logging
import mimetypes
import tempfile
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from fastapi import WebSocket

from app.train import yolo_chunk_transfer
from app.train import yolo_runner
from app.train import yolo_workspace
from app.ws.connection import WsConnection
from app.ws.protocol_helpers import ws_reply_error as _reply_error
from app.ws.protocol_helpers import ws_reply_ok as _reply_ok

_log = logging.getLogger(__name__)


@dataclass
class _PendingYoloChunk:
    request_id: str
    job_slug: str
    upload_id: str
    chunk_index: int
    byte_length: int


@dataclass
class _PendingYoloBaseModel:
    request_id: str
    job_slug: str
    family: str
    task: str
    filename: str
    byte_length: int


@dataclass
class _PendingYoloBaseModelChunk:
    request_id: str
    job_slug: str
    upload_id: str
    chunk_index: int
    byte_length: int


async def handle_yolo_training_text(conn: WsConnection, msg_type: str, request_id: str | None, payload: dict[str, Any]) -> bool:
    """Handle YOLO training message types. Returns True if handled."""
    if not msg_type.startswith("training.yolo."):
        return False
    if not conn.client_id:
        await _reply_error(conn, request_id, "send hello first", code="not_authenticated")
        return True

    if msg_type == "training.yolo.dataset.upload.init":
        rid = request_id or uuid.uuid4().hex
        job_slug = str(payload.get("job_slug", "")).strip()
        filename = str(payload.get("filename", "")).strip()
        try:
            total_size = int(payload.get("total_size", 0))
        except (TypeError, ValueError):
            total_size = 0
        upload_id = str(payload.get("upload_id", "")).strip() or None
        try:
            result = await asyncio.to_thread(
                yolo_chunk_transfer.init_dataset_upload,
                job_slug,
                filename=filename,
                total_size=total_size,
                upload_id=upload_id,
            )
            await _reply_ok(conn, rid, "training.yolo.dataset.upload.init.ok", result)
        except (FileNotFoundError, ValueError) as e:
            await _reply_error(conn, rid, str(e), code="invalid_upload")
        return True

    if msg_type == "training.yolo.dataset.upload.chunk.begin":
        if conn.pending_yolo_chunk is not None or conn.pending_yolo_base_model is not None or conn.pending_yolo_batch_chunk is not None or conn.pending_yolo_batch_predict is not None or conn.pending_sam_prepare is not None:
            await _reply_error(conn, request_id, "binary upload already in progress", code="upload_busy")
            return True
        job_slug = str(payload.get("job_slug", "")).strip()
        upload_id = str(payload.get("upload_id", "")).strip()
        try:
            chunk_index = int(payload.get("chunk_index", -1))
            byte_length = int(payload.get("byte_length", 0))
        except (TypeError, ValueError):
            chunk_index = -1
            byte_length = 0
        if not job_slug or not upload_id or chunk_index < 0 or byte_length <= 0:
            await _reply_error(conn, request_id, "invalid chunk begin payload", code="invalid_upload")
            return True
        rid = request_id or uuid.uuid4().hex
        conn.pending_yolo_chunk = _PendingYoloChunk(
            request_id=rid,
            job_slug=job_slug,
            upload_id=upload_id,
            chunk_index=chunk_index,
            byte_length=byte_length,
        )
        await _reply_ok(conn, rid, "training.yolo.dataset.upload.chunk.ready", {"byte_length": byte_length})
        return True

    if msg_type == "training.yolo.dataset.upload.complete":
        rid = request_id or uuid.uuid4().hex
        job_slug = str(payload.get("job_slug", "")).strip()
        upload_id = str(payload.get("upload_id", "")).strip()
        try:
            result = await asyncio.to_thread(yolo_chunk_transfer.complete_dataset_upload, job_slug, upload_id)
            await _reply_ok(conn, rid, "training.yolo.dataset.upload.complete.ok", result)
        except (FileNotFoundError, ValueError) as e:
            await _reply_error(conn, rid, str(e), code="invalid_upload")
        return True

    if msg_type == "training.yolo.base_model.upload.init":
        rid = request_id or uuid.uuid4().hex
        job_slug = str(payload.get("job_slug", "")).strip()
        family = str(payload.get("family", "")).strip()
        task = str(payload.get("task", "")).strip()
        filename = str(payload.get("filename", "upload.pt")).strip() or "upload.pt"
        try:
            total_size = int(payload.get("total_size", 0))
        except (TypeError, ValueError):
            total_size = 0
        try:
            result = await asyncio.to_thread(
                yolo_chunk_transfer.init_base_model_upload,
                job_slug,
                filename=filename,
                total_size=total_size,
                family=family,
                task=task,
            )
            await _reply_ok(conn, rid, "training.yolo.base_model.upload.init.ok", result)
        except (FileNotFoundError, ValueError) as e:
            await _reply_error(conn, rid, str(e), code="invalid_upload")
        return True

    if msg_type == "training.yolo.base_model.upload.chunk.begin":
        if conn.pending_yolo_chunk is not None or conn.pending_yolo_base_model is not None or conn.pending_yolo_batch_chunk is not None or conn.pending_yolo_batch_predict is not None or conn.pending_sam_prepare is not None:
            await _reply_error(conn, request_id, "binary upload already in progress", code="upload_busy")
            return True
        job_slug = str(payload.get("job_slug", "")).strip()
        upload_id = str(payload.get("upload_id", "")).strip()
        try:
            chunk_index = int(payload.get("chunk_index", -1))
            byte_length = int(payload.get("byte_length", 0))
        except (TypeError, ValueError):
            chunk_index = -1
            byte_length = 0
        if not job_slug or not upload_id or chunk_index < 0 or byte_length <= 0:
            await _reply_error(conn, request_id, "invalid base model chunk payload", code="invalid_upload")
            return True
        rid = request_id or uuid.uuid4().hex
        conn.pending_yolo_base_model = _PendingYoloBaseModelChunk(
            request_id=rid,
            job_slug=job_slug,
            upload_id=upload_id,
            chunk_index=chunk_index,
            byte_length=byte_length,
        )
        await _reply_ok(conn, rid, "training.yolo.base_model.upload.chunk.ready", {"byte_length": byte_length})
        return True

    if msg_type == "training.yolo.base_model.upload.complete":
        rid = request_id or uuid.uuid4().hex
        job_slug = str(payload.get("job_slug", "")).strip()
        upload_id = str(payload.get("upload_id", "")).strip()
        try:
            result = await asyncio.to_thread(yolo_chunk_transfer.complete_base_model_upload, job_slug, upload_id)
            await _reply_ok(conn, rid, "training.yolo.base_model.upload.complete.ok", result)
        except (FileNotFoundError, ValueError, RuntimeError, OSError) as e:
            await _reply_error(conn, rid, str(e), code="invalid_upload")
        except Exception as e:
            _log.exception("YOLO base model upload completion failed")
            await _reply_error(conn, rid, str(e).strip() or type(e).__name__, code="server_error")
        return True

    if msg_type == "training.yolo.base_model.upload.begin":
        if conn.pending_yolo_chunk is not None or conn.pending_yolo_base_model is not None or conn.pending_yolo_batch_chunk is not None or conn.pending_yolo_batch_predict is not None or conn.pending_sam_prepare is not None:
            await _reply_error(conn, request_id, "binary upload already in progress", code="upload_busy")
            return True
        job_slug = str(payload.get("job_slug", "")).strip()
        family = str(payload.get("family", "")).strip()
        task = str(payload.get("task", "")).strip()
        filename = str(payload.get("filename", "upload.pt")).strip() or "upload.pt"
        try:
            byte_length = int(payload.get("byte_length", 0))
        except (TypeError, ValueError):
            byte_length = 0
        if not job_slug or not family or not task or byte_length <= 0:
            await _reply_error(conn, request_id, "invalid base model upload payload", code="invalid_upload")
            return True
        if not filename.lower().endswith(".pt"):
            await _reply_error(conn, request_id, "仅支持 .pt 权重", code="invalid_upload")
            return True
        rid = request_id or uuid.uuid4().hex
        conn.pending_yolo_base_model = _PendingYoloBaseModel(
            request_id=rid,
            job_slug=job_slug,
            family=family,
            task=task,
            filename=Path(filename).name,
            byte_length=byte_length,
        )
        await _reply_ok(conn, rid, "training.yolo.base_model.upload.ready", {"byte_length": byte_length})
        return True

    if msg_type == "training.yolo.status.get":
        rid = request_id or uuid.uuid4().hex
        job_slug = str(payload.get("job_slug", "")).strip()
        if not job_slug:
            await _reply_error(conn, rid, "missing job_slug", code="invalid_request")
            return True
        try:
            job = await asyncio.to_thread(yolo_runner.get_job, job_slug)
            ws_snap = await asyncio.to_thread(yolo_workspace.workspace_snapshot, job_slug)
            await _reply_ok(conn, rid, "training.yolo.status.ok", {"job": job, "workspace": ws_snap})
        except FileNotFoundError as e:
            await _reply_error(conn, rid, str(e), code="not_found")
        return True

    if msg_type == "training.yolo.logs.get":
        rid = request_id or uuid.uuid4().hex
        job_slug = str(payload.get("job_slug", "")).strip()
        if not job_slug:
            await _reply_error(conn, rid, "missing job_slug", code="invalid_request")
            return True
        try:
            text = await asyncio.to_thread(yolo_workspace.read_training_logs, job_slug)
            await _reply_ok(conn, rid, "training.yolo.logs.ok", {"job_slug": job_slug, "logs": text})
        except FileNotFoundError as e:
            await _reply_error(conn, rid, str(e), code="not_found")
        return True

    if msg_type == "training.yolo.results.list":
        rid = request_id or uuid.uuid4().hex
        job_slug = str(payload.get("job_slug", "")).strip()
        if not job_slug:
            await _reply_error(conn, rid, "missing job_slug", code="invalid_request")
            return True
        try:
            result = await asyncio.to_thread(yolo_workspace.list_training_result_images, job_slug)
            await _reply_ok(conn, rid, "training.yolo.results.ok", result)
        except FileNotFoundError as e:
            await _reply_error(conn, rid, str(e), code="not_found")
        return True

    if msg_type == "training.yolo.results.image.begin":
        if conn.pending_yolo_chunk is not None or conn.pending_yolo_base_model is not None or conn.pending_yolo_batch_chunk is not None or conn.pending_yolo_batch_predict is not None or conn.pending_sam_prepare is not None:
            await _reply_error(conn, request_id, "binary transfer already in progress", code="transfer_busy")
            return True
        job_slug = str(payload.get("job_slug", "")).strip()
        rel_path = str(payload.get("path", "")).strip()
        if not job_slug or not rel_path:
            await _reply_error(conn, request_id, "missing job_slug or path", code="invalid_request")
            return True
        rid = request_id or uuid.uuid4().hex
        try:
            file_path = await asyncio.to_thread(yolo_workspace.resolve_training_result_image, job_slug, rel_path)
            data = await asyncio.to_thread(file_path.read_bytes)
            media_type, _ = mimetypes.guess_type(str(file_path))
            await _reply_ok(
                conn,
                rid,
                "training.yolo.results.image.ready",
                {
                    "byte_length": len(data),
                    "content_type": media_type or "application/octet-stream",
                },
            )
            await conn.websocket.send_bytes(data)
            await _reply_ok(conn, rid, "training.yolo.results.image.ok", {"byte_length": len(data)})
        except ValueError as e:
            await _reply_error(conn, rid, str(e), code="invalid_request")
        except FileNotFoundError as e:
            await _reply_error(conn, rid, str(e), code="not_found")
        return True

    if msg_type == "training.yolo.models.list":
        rid = request_id or uuid.uuid4().hex
        job_slug = str(payload.get("job_slug", "")).strip()
        if not job_slug:
            await _reply_error(conn, rid, "missing job_slug", code="invalid_request")
            return True
        try:
            result = await asyncio.to_thread(yolo_workspace.list_training_model_files, job_slug)
            await _reply_ok(conn, rid, "training.yolo.models.ok", result)
        except FileNotFoundError as e:
            await _reply_error(conn, rid, str(e), code="not_found")
        return True

    if msg_type == "training.yolo.model.download.info":
        rid = request_id or uuid.uuid4().hex
        job_slug = str(payload.get("job_slug", "")).strip()
        rel_path = str(payload.get("path", "")).strip()
        if not job_slug or not rel_path:
            await _reply_error(conn, rid, "missing job_slug or path", code="invalid_request")
            return True
        try:
            info = await asyncio.to_thread(yolo_chunk_transfer.model_download_info, job_slug, rel_path)
            await _reply_ok(conn, rid, "training.yolo.model.download.info.ok", info)
        except ValueError as e:
            await _reply_error(conn, rid, str(e), code="invalid_request")
        except FileNotFoundError as e:
            await _reply_error(conn, rid, str(e), code="not_found")
        return True

    if msg_type == "training.yolo.model.download.chunk.begin":
        if conn.pending_yolo_chunk is not None or conn.pending_yolo_base_model is not None or conn.pending_yolo_batch_chunk is not None or conn.pending_yolo_batch_predict is not None or conn.pending_sam_prepare is not None:
            await _reply_error(conn, request_id, "binary transfer already in progress", code="transfer_busy")
            return True
        job_slug = str(payload.get("job_slug", "")).strip()
        rel_path = str(payload.get("path", "")).strip()
        try:
            chunk_index = int(payload.get("chunk_index", -1))
            byte_length = int(payload.get("byte_length", 0))
        except (TypeError, ValueError):
            chunk_index = -1
            byte_length = 0
        if not job_slug or not rel_path or chunk_index < 0 or byte_length <= 0:
            await _reply_error(conn, request_id, "invalid model download chunk payload", code="invalid_request")
            return True
        rid = request_id or uuid.uuid4().hex
        try:
            info = await asyncio.to_thread(yolo_chunk_transfer.model_download_info, job_slug, rel_path)
            chunk_size = int(info.get("chunk_size") or yolo_chunk_transfer.CHUNK_SIZE)
            total_size = int(info.get("total_size") or 0)
            start = chunk_index * chunk_size
            if start >= total_size:
                await _reply_error(conn, rid, "chunk index out of range", code="invalid_request")
                return True
            end = min(start + byte_length - 1, total_size - 1)
            expected_len = end - start + 1
            if expected_len != byte_length:
                await _reply_error(conn, rid, "byte_length mismatch for chunk", code="invalid_request")
                return True
            data, _ = await asyncio.to_thread(
                yolo_chunk_transfer.read_model_byte_range,
                job_slug,
                rel_path,
                start,
                end,
            )
            if len(data) != byte_length:
                await _reply_error(conn, rid, "chunk read size mismatch", code="internal_error")
                return True
            await _reply_ok(
                conn,
                rid,
                "training.yolo.model.download.chunk.ready",
                {"byte_length": len(data), "chunk_index": chunk_index},
            )
            await conn.websocket.send_bytes(data)
            await _reply_ok(
                conn,
                rid,
                "training.yolo.model.download.chunk.ok",
                {"chunk_index": chunk_index, "byte_length": len(data)},
            )
        except ValueError as e:
            await _reply_error(conn, rid, str(e), code="invalid_request")
        except FileNotFoundError as e:
            await _reply_error(conn, rid, str(e), code="not_found")
        return True

    return False


async def handle_yolo_training_binary(conn: WsConnection, data: bytes) -> bool:
    """Handle binary frame for YOLO training. Returns True if consumed."""
    pending_chunk = conn.pending_yolo_chunk
    if pending_chunk is not None:
        conn.pending_yolo_chunk = None
        rid = pending_chunk.request_id
        if len(data) != pending_chunk.byte_length:
            await _reply_error(
                conn,
                rid,
                f"chunk byte length mismatch: expected {pending_chunk.byte_length}, got {len(data)}",
                code="invalid_upload",
            )
            return True
        try:
            result = await asyncio.to_thread(
                yolo_chunk_transfer.save_dataset_upload_chunk,
                pending_chunk.job_slug,
                pending_chunk.upload_id,
                pending_chunk.chunk_index,
                data,
            )
            await _reply_ok(conn, rid, "training.yolo.dataset.upload.chunk.ok", result)
        except (FileNotFoundError, ValueError) as e:
            await _reply_error(conn, rid, str(e), code="invalid_upload")
        return True

    pending_pt = conn.pending_yolo_base_model
    if pending_pt is not None:
        conn.pending_yolo_base_model = None
        rid = pending_pt.request_id
        if len(data) != pending_pt.byte_length:
            await _reply_error(
                conn,
                rid,
                f"byte length mismatch: expected {pending_pt.byte_length}, got {len(data)}",
                code="invalid_upload",
            )
            return True
        if isinstance(pending_pt, _PendingYoloBaseModelChunk):
            try:
                result = await asyncio.to_thread(
                    yolo_chunk_transfer.save_base_model_upload_chunk,
                    pending_pt.job_slug,
                    pending_pt.upload_id,
                    pending_pt.chunk_index,
                    data,
                )
                await _reply_ok(conn, rid, "training.yolo.base_model.upload.chunk.ok", result)
            except (FileNotFoundError, ValueError, OSError) as e:
                await _reply_error(conn, rid, str(e), code="invalid_upload")
            except Exception as e:
                _log.exception("YOLO base model chunk upload failed")
                await _reply_error(conn, rid, str(e).strip() or type(e).__name__, code="server_error")
            return True
        tmp = ""
        try:
            with tempfile.NamedTemporaryFile(prefix="ea-yolo-ws-", suffix=".pt", delete=False) as f:
                f.write(data)
                tmp = f.name
            path = await asyncio.to_thread(
                yolo_workspace.save_uploaded_base_model,
                pending_pt.job_slug,
                Path(tmp),
                original_filename=pending_pt.filename,
                family=pending_pt.family,
                task=pending_pt.task,
            )
            job_meta = await asyncio.to_thread(yolo_workspace.load_meta, pending_pt.job_slug)
            await _reply_ok(
                conn,
                rid,
                "training.yolo.base_model.upload.ok",
                {
                    "ok": True,
                    "base_model": str(path),
                    "weight_meta": job_meta.get("base_model_weight_meta"),
                    "weight_warnings": job_meta.get("base_model_weight_warnings") or [],
                },
            )
        except (ValueError, RuntimeError, FileNotFoundError) as e:
            await _reply_error(conn, rid, str(e), code="invalid_upload")
        except Exception as e:
            _log.exception("Legacy YOLO base model upload failed")
            await _reply_error(conn, rid, str(e).strip() or type(e).__name__, code="server_error")
        finally:
            if tmp:
                Path(tmp).unlink(missing_ok=True)
        return True

    return False
