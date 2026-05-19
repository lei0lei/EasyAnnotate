"""Upload-based inference endpoints (require ``python-multipart``).

Registered conditionally by ``models.py`` — if the dependency is missing,
the original JSON-body endpoints still work; only the ``*-upload`` routes
are unavailable.
"""

import json
import os
import tempfile
from pathlib import Path
from typing import Any, Callable

from fastapi import APIRouter, File, Form, HTTPException, Query, UploadFile

from app.model_runtime import merge_predict_payload_device, require_runtime_started
from app.models import get_model
from app.models.impl.dinov2_patch_features import dinov2_extract_patch_features
from app.models.impl.efficient_sam_variants import efficient_sam_encode_image_embeddings
from app.models.impl.mobile_sam_variants import mobile_sam_encode_image_embeddings
from app.models.impl.sam2_hiera_variants import sam2_encode_image_embeddings

router = APIRouter()


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


async def _run_with_uploaded_source(
    image: UploadFile,
    payload: dict[str, Any],
    runner: Callable[[dict[str, Any]], dict[str, Any]],
) -> dict[str, Any]:
    raw = await image.read()
    if not raw:
        raise HTTPException(status_code=400, detail="image file is empty")
    suffix = Path(image.filename or "image.bin").suffix
    tmp_path = ""
    try:
        with tempfile.NamedTemporaryFile(prefix="ea-upload-", suffix=suffix, delete=False) as f:
            f.write(raw)
            tmp_path = f.name
        merged = {**payload, "source": tmp_path}
        return runner(merged)
    finally:
        if tmp_path:
            try:
                os.unlink(tmp_path)
            except OSError:
                pass


@router.post("/{model_id:path}/predict-upload")
async def predict_upload(
    model_id: str,
    image: UploadFile = File(...),
    payload_json: str | None = Form(
        default=None,
        description="Optional JSON object for predict payload fields except source.",
    ),
    runtime_slot: str | None = Query(
        default=None,
        description="Optional catalog category (e.g. sam2_diffusion); default checks primary SAM slot only.",
    ),
) -> dict[str, Any]:
    model = get_model(model_id)
    if model is None:
        raise HTTPException(status_code=404, detail=f"unknown model: {model_id}")
    try:
        require_runtime_started(model_id, runtime_slot=runtime_slot)
    except ValueError as e:
        raise HTTPException(status_code=503, detail=str(e)) from e
    payload = merge_predict_payload_device(model_id, _parse_payload_json(payload_json), runtime_slot=runtime_slot)
    return await _run_with_uploaded_source(image, payload, model.predict)


@router.post("/{model_id:path}/encode-image-upload")
async def encode_image_upload(
    model_id: str,
    image: UploadFile = File(...),
    payload_json: str | None = Form(
        default=None,
        description="Optional JSON object for encode-image payload fields except source (e.g. infer_scale).",
    ),
    runtime_slot: str | None = Query(
        default=None,
        description="Optional catalog category (e.g. sam2_diffusion); default checks primary SAM slot only.",
    ),
) -> dict[str, Any]:
    try:
        require_runtime_started(model_id, runtime_slot=runtime_slot)
    except ValueError as e:
        raise HTTPException(status_code=503, detail=str(e)) from e
    payload = merge_predict_payload_device(model_id, _parse_payload_json(payload_json), runtime_slot=runtime_slot)
    try:
        if model_id.startswith("sam2/"):
            return await _run_with_uploaded_source(image, payload, lambda p: sam2_encode_image_embeddings(model_id, p))
        if model_id.startswith("mobile_sam/"):
            return await _run_with_uploaded_source(image, payload, lambda p: mobile_sam_encode_image_embeddings(model_id, p))
        if model_id.startswith("efficient_sam/"):
            return await _run_with_uploaded_source(
                image,
                payload,
                lambda p: efficient_sam_encode_image_embeddings(model_id, p),
            )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except ImportError as e:
        raise HTTPException(status_code=500, detail=str(e)) from e
    raise HTTPException(
        status_code=400,
        detail="encode-image is only supported for sam2/*, mobile_sam/* and efficient_sam/* model_id",
    )


@router.post("/{model_id:path}/patch-features-upload")
async def patch_features_upload(
    model_id: str,
    image: UploadFile = File(...),
    payload_json: str | None = Form(
        default=None,
        description="Optional JSON object for patch-features payload fields except source (e.g. img_size).",
    ),
) -> dict[str, Any]:
    if not model_id.startswith("dinov2/"):
        raise HTTPException(status_code=400, detail="patch-features is only supported for dinov2/* model_id")
    try:
        require_runtime_started(model_id)
    except ValueError as e:
        raise HTTPException(status_code=503, detail=str(e)) from e
    payload = merge_predict_payload_device(model_id, _parse_payload_json(payload_json))
    try:
        return await _run_with_uploaded_source(image, payload, lambda p: dinov2_extract_patch_features(model_id, p))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except ImportError as e:
        raise HTTPException(status_code=500, detail=str(e)) from e
