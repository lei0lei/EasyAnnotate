"""YOLO 批量标注工具 API（``external/model_temp/<模型名>/``）。"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.train import yolo_batch_runner, yolo_batch_workspace

router = APIRouter()


class PrepareModelBody(BaseModel):
    display_name: str = Field(..., min_length=1, max_length=120)
    task: str = Field(..., description="detect | segment | pose | obb")
    conf: float = Field(0.25, ge=0.0, le=1.0)
    iou: float = Field(0.7, ge=0.0, le=1.0)
    imgsz: int = Field(640, ge=32, le=4096)
    max_det: int = Field(300, ge=1, le=10_000)
    use_gpu: bool = True


class UpdateModelBody(BaseModel):
    display_name: str | None = Field(None, min_length=1, max_length=120)
    conf: float | None = Field(None, ge=0.0, le=1.0)
    iou: float | None = Field(None, ge=0.0, le=1.0)
    imgsz: int | None = Field(None, ge=32, le=4096)
    max_det: int | None = Field(None, ge=1, le=10_000)
    use_gpu: bool | None = None


def _require_slug(model_slug: str) -> str:
    slug = (model_slug or "").strip()
    if not slug:
        raise HTTPException(status_code=400, detail="缺少 model_slug")
    return slug


def _enrich_running(snapshot: dict[str, Any]) -> dict[str, Any]:
    slug = snapshot.get("model_slug") or ""
    snapshot["running"] = yolo_batch_runner.is_model_running(str(slug))
    return snapshot


@router.get("/catalog")
def catalog() -> dict[str, Any]:
    tasks = [{"id": t, "label": t} for t in yolo_batch_workspace.YOLO_BATCH_TASKS]
    return {"tasks": tasks, "model_temp_dir": str(yolo_batch_workspace.get_model_temp_root())}


@router.get("/models")
def list_models() -> dict[str, Any]:
    items = [_enrich_running(s) for s in yolo_batch_workspace.list_models()]
    return {"items": items}


@router.get("/status")
def status() -> dict[str, Any]:
    return yolo_batch_runner.runtime_status()


@router.get("/models/{model_slug}")
def get_model(model_slug: str) -> dict[str, Any]:
    slug = _require_slug(model_slug)
    try:
        snap = yolo_batch_workspace.model_snapshot(slug)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    return _enrich_running(snap)


@router.post("/models/prepare")
def prepare_model(body: PrepareModelBody) -> dict[str, Any]:
    try:
        snap = yolo_batch_workspace.prepare_model(
            body.display_name,
            body.task,
            conf=body.conf,
            iou=body.iou,
            imgsz=body.imgsz,
            max_det=body.max_det,
            use_gpu=body.use_gpu,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    return _enrich_running(snap)


@router.patch("/models/{model_slug}")
def update_model(model_slug: str, body: UpdateModelBody) -> dict[str, Any]:
    slug = _require_slug(model_slug)
    if yolo_batch_runner.is_model_running(slug):
        raise HTTPException(status_code=400, detail="请先停止模型再修改参数")
    try:
        snap = yolo_batch_workspace.update_model_settings(
            slug,
            display_name=body.display_name,
            conf=body.conf,
            iou=body.iou,
            imgsz=body.imgsz,
            max_det=body.max_det,
            use_gpu=body.use_gpu,
        )
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    return _enrich_running(snap)


@router.post("/models/{model_slug}/finalize")
def finalize_model(model_slug: str) -> dict[str, Any]:
    slug = _require_slug(model_slug)
    try:
        snap = yolo_batch_workspace.finalize_model(slug)
    except (FileNotFoundError, ValueError) as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    return _enrich_running(snap)


@router.post("/models/{model_slug}/start")
def start_model(model_slug: str) -> dict[str, Any]:
    slug = _require_slug(model_slug)
    try:
        out = yolo_batch_runner.start_model(slug)
    except (FileNotFoundError, ValueError, ImportError) as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    snap = yolo_batch_workspace.model_snapshot(slug)
    return {**out, "model": _enrich_running(snap)}


@router.post("/models/{model_slug}/stop")
def stop_model(model_slug: str) -> dict[str, Any]:
    slug = _require_slug(model_slug)
    out = yolo_batch_runner.stop_model(slug)
    try:
        snap = yolo_batch_workspace.model_snapshot(slug)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    return {**out, "model": _enrich_running(snap)}


@router.delete("/models/{model_slug}")
def delete_model(model_slug: str) -> dict[str, Any]:
    slug = _require_slug(model_slug)
    if yolo_batch_runner.is_model_running(slug):
        raise HTTPException(status_code=400, detail="请先停止模型再删除")
    try:
        yolo_batch_workspace.delete_model(slug)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    return {"ok": True, "model_slug": slug}
