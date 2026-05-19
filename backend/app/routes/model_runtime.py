"""Manage loaded backend models — start / stop / catalog (names from resources registry)."""

from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.model_runtime import get_runtime_catalog, model_start, model_stop, runtime_status

router = APIRouter()


class StartBody(BaseModel):
    model_id: str = Field(
        ...,
        description="与 catalog 中 variants[].model_id 一致（对应 registry.json 条目）",
    )
    use_gpu: bool = Field(
        True,
        description="为 true 且 CUDA 可用时预热到 GPU；否则 CPU。与 predict 默认 device 一致。",
    )


def _inference_block(model_id: str) -> dict[str, Any]:
    return {
        "method": "POST",
        "path": f"/api/v1/models/{model_id}/predict",
        "note": "请求体 JSON：{\"payload\": { ... }}，字段依具体模型而定（如 source、point_xy 等）",
    }


@router.get("/catalog")
def runtime_catalog() -> dict[str, Any]:
    data = get_runtime_catalog()
    for cat in data.get("categories", []):
        mid = cat.get("active_model_id")
        cat["inference"] = _inference_block(mid) if cat.get("running") and mid else None
    return data


@router.get("/status")
def status() -> dict[str, Any]:
    return runtime_status()


@router.post("/{category_id}/start")
def start(category_id: str, body: StartBody) -> dict[str, Any]:
    try:
        out = model_start(category_id, body.model_id.strip(), use_gpu=body.use_gpu)
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    mid = out["model_id"]
    return {
        **out,
        "inference": _inference_block(mid),
    }


@router.post("/{category_id}/stop")
def stop(category_id: str) -> dict[str, Any]:
    try:
        return model_stop(category_id)
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
