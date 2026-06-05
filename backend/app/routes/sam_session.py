"""SAM server-side decode sessions: per-client encode cache + queued inference."""

from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path
from typing import Any, Literal

from fastapi import APIRouter, File, Form, Header, HTTPException, Query, UploadFile
from pydantic import BaseModel, Field

from app.model_runtime import merge_predict_payload_device, require_runtime_started
from app.sam_session.service import decode_in_session, prepare_session, release_client_session

router = APIRouter()

CLIENT_ID_HEADER = "X-Sam-Client-Id"


class SamPrepareRequest(BaseModel):
    model_id: str
    source: str
    infer_scale: float | None = Field(default=None, ge=0.3, le=1.0)


class SamPointPayload(BaseModel):
    x: int
    y: int
    label: Literal[0, 1] = 1


class SamBboxPayload(BaseModel):
    x1: int
    y1: int
    x2: int
    y2: int


class SamDecodeRequest(BaseModel):
    session_id: str
    prompt_mode: Literal["point", "bbox"]
    points: list[SamPointPayload] = Field(default_factory=list)
    bbox: SamBboxPayload | None = None
    min_pred_iou: float | None = Field(default=None, ge=0.0, le=1.0)
    polygon_vertex_bias: int = Field(default=50, ge=0, le=100)
    include_mask: bool = False
    include_polygon: bool = True


def _require_client_id(raw: str | None) -> str:
    cid = (raw or "").strip()
    if not cid:
        raise HTTPException(status_code=400, detail=f"Missing header {CLIENT_ID_HEADER}")
    if len(cid) > 128:
        raise HTTPException(status_code=400, detail=f"{CLIENT_ID_HEADER} too long")
    return cid


def _prepare_payload(model_id: str, body: SamPrepareRequest, runtime_slot: str | None) -> dict[str, Any]:
    try:
        require_runtime_started(model_id, runtime_slot=runtime_slot)
    except ValueError as e:
        raise HTTPException(status_code=503, detail=str(e)) from e
    if not (model_id.startswith("sam2/") or model_id.startswith("mobile_sam/")):
        raise HTTPException(status_code=400, detail="session prepare supports sam2/* and mobile_sam/* only")
    payload: dict[str, Any] = {"source": body.source.strip()}
    if body.infer_scale is not None:
        payload["infer_scale"] = body.infer_scale
    return merge_predict_payload_device(model_id, payload, runtime_slot=runtime_slot)


@router.post("/session/prepare")
def sam_session_prepare(
    body: SamPrepareRequest,
    client_id: str | None = Header(default=None, alias=CLIENT_ID_HEADER),
    runtime_slot: str | None = Query(default=None),
) -> dict[str, Any]:
    """Encode image and attach a private embedding bundle for this client (replaces any prior session)."""
    cid = _require_client_id(client_id)
    payload = _prepare_payload(body.model_id, body, runtime_slot)
    try:
        return prepare_session(cid, body.model_id.strip(), payload)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except ImportError as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.post("/session/decode")
def sam_session_decode(
    body: SamDecodeRequest,
    client_id: str | None = Header(default=None, alias=CLIENT_ID_HEADER),
) -> dict[str, Any]:
    """Decode prompt against a prepared session (queued globally across clients)."""
    cid = _require_client_id(client_id)
    try:
        result = decode_in_session(
            cid,
            body.session_id.strip(),
            prompt_mode=body.prompt_mode,
            points=[p.model_dump() for p in body.points],
            bbox=body.bbox.model_dump() if body.bbox is not None else None,
            min_pred_iou=body.min_pred_iou,
            polygon_vertex_bias=body.polygon_vertex_bias,
            include_mask=body.include_mask,
            include_polygon=body.include_polygon,
        )
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e)) from e
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except ImportError as e:
        raise HTTPException(status_code=500, detail=str(e)) from e

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


@router.delete("/session")
def sam_session_release(client_id: str | None = Header(default=None, alias=CLIENT_ID_HEADER)) -> dict[str, str]:
    cid = _require_client_id(client_id)
    release_client_session(cid)
    return {"status": "released"}


def _parse_payload_json(payload_json: str | None) -> dict[str, Any]:
    if payload_json is None or not payload_json.strip():
        return {}
    try:
        parsed = json.loads(payload_json)
    except json.JSONDecodeError as e:
        raise HTTPException(status_code=400, detail=f"invalid payload_json: {e.msg}") from e
    if not isinstance(parsed, dict):
        raise HTTPException(status_code=400, detail="payload_json must be a JSON object")
    return parsed


@router.post("/session/prepare-upload")
async def sam_session_prepare_upload(
    image: UploadFile = File(...),
    model_id: str | None = Form(default=None),
    payload_json: str | None = Form(default=None),
    client_id: str | None = Header(default=None, alias=CLIENT_ID_HEADER),
    runtime_slot: str | None = Query(default=None),
) -> dict[str, Any]:
    """Multipart prepare when ``source`` is not readable by the backend (remote client)."""
    extra = _parse_payload_json(payload_json)
    cid_raw = client_id or extra.get("sam_client_id")
    cid = _require_client_id(str(cid_raw).strip() if cid_raw else None)
    mid = (model_id or extra.get("model_id") or "").strip()
    if not mid:
        raise HTTPException(status_code=400, detail="model_id is required")
    infer_scale = extra.get("infer_scale")
    body = SamPrepareRequest(
        model_id=mid,
        source="__upload__",
        infer_scale=float(infer_scale) if infer_scale is not None else None,
    )
    payload = _prepare_payload(mid, body, runtime_slot)

    raw = await image.read()
    if not raw:
        raise HTTPException(status_code=400, detail="image file is empty")
    suffix = Path(image.filename or "image.bin").suffix
    tmp_path = ""
    try:
        with tempfile.NamedTemporaryFile(prefix="ea-sam-session-", suffix=suffix, delete=False) as f:
            f.write(raw)
            tmp_path = f.name
        payload["source"] = tmp_path
        return prepare_session(cid, mid, payload)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except ImportError as e:
        raise HTTPException(status_code=500, detail=str(e)) from e
    finally:
        if tmp_path:
            try:
                os.unlink(tmp_path)
            except OSError:
                pass
