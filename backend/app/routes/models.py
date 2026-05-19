from typing import Any

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from app.models import get_model, list_model_ids
from app.model_runtime import merge_predict_payload_device, require_runtime_started
from app.models.impl.efficient_sam_variants import efficient_sam_encode_image_embeddings
from app.models.impl.mobile_sam_variants import mobile_sam_encode_image_embeddings
from app.models.impl.dinov2_patch_features import dinov2_extract_patch_features
from app.models.impl.sam2_hiera_variants import sam2_encode_image_embeddings

router = APIRouter()


class PredictRequest(BaseModel):
    payload: dict[str, Any] = Field(default_factory=dict)


@router.get("")
def list_models() -> dict[str, list[str]]:
    return {"model_ids": list_model_ids()}


@router.post("/{model_id:path}/predict")
def predict(
    model_id: str,
    body: PredictRequest,
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
    payload = merge_predict_payload_device(model_id, body.payload, runtime_slot=runtime_slot)
    return model.predict(payload)


@router.post("/{model_id:path}/encode-image")
def encode_image(
    model_id: str,
    body: PredictRequest,
    runtime_slot: str | None = Query(
        default=None,
        description="Optional catalog category (e.g. sam2_diffusion); default checks primary SAM slot only.",
    ),
) -> dict[str, Any]:
    """Image encoder features (float32) for browser ``*.decoder.onnx`` — SAM2.1 / MobileSAM / EfficientSAM."""
    try:
        require_runtime_started(model_id, runtime_slot=runtime_slot)
    except ValueError as e:
        raise HTTPException(status_code=503, detail=str(e)) from e
    payload = merge_predict_payload_device(model_id, body.payload, runtime_slot=runtime_slot)
    try:
        if model_id.startswith("sam2/"):
            return sam2_encode_image_embeddings(model_id, payload)
        if model_id.startswith("mobile_sam/"):
            return mobile_sam_encode_image_embeddings(model_id, payload)
        if model_id.startswith("efficient_sam/"):
            return efficient_sam_encode_image_embeddings(model_id, payload)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except ImportError as e:
        raise HTTPException(status_code=500, detail=str(e)) from e
    raise HTTPException(
        status_code=400,
        detail="encode-image is only supported for sam2/*, mobile_sam/* and efficient_sam/* model_id",
    )


@router.post("/{model_id:path}/patch-features")
def patch_features(
    model_id: str,
    body: PredictRequest,
) -> dict[str, Any]:
    """DINOv2 letterbox patch tokens (float32) for client-side similarity search."""
    if not model_id.startswith("dinov2/"):
        raise HTTPException(status_code=400, detail="patch-features is only supported for dinov2/* model_id")
    try:
        require_runtime_started(model_id)
    except ValueError as e:
        raise HTTPException(status_code=503, detail=str(e)) from e
    payload = merge_predict_payload_device(model_id, body.payload)
    try:
        return dinov2_extract_patch_features(model_id, payload)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except ImportError as e:
        raise HTTPException(status_code=500, detail=str(e)) from e
