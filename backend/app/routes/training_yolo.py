"""YOLO 模型训练 API（``external/temp/<训练名>/`` 每次训练独立目录）。"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from app.train import yolo_runner, yolo_workspace

router = APIRouter()


class PrepareJobBody(BaseModel):
    training_name: str = Field(..., min_length=1, max_length=120, description="本次训练名称，用作 temp 子目录名")


class SelectBaseModelBody(BaseModel):
    job_slug: str
    asset_id: str = Field(..., description="registry 中的 ultralytics 权重 id")
    family: str = Field(..., description="yolov8 | yolo26")
    task: str = Field(..., description="detect | segment | pose | obb | classify")


class StartTrainBody(BaseModel):
    job_slug: str
    epochs: int = Field(100, ge=1, le=10_000)
    imgsz: int = Field(640, ge=32, le=4096)
    batch: int = Field(2, ge=1, le=512)
    workers: int = Field(2, ge=0, le=64)
    device: str = Field("0", description="cpu 或 GPU 序号字符串")
    time_hours: float | None = Field(None, ge=0, le=10_000, description="最长训练时间（小时），0 或未传表示不限制")
    use_custom_augment: bool = Field(False, description="启用自定义图像增强参数")
    augment: dict[str, Any] | None = None
    use_custom_optimizer: bool = Field(False, description="启用自定义优化器参数")
    optimizer: dict[str, Any] | None = None
    export_onnx: bool = Field(False, description="训练成功后导出 ONNX（imgsz 与训练一致）")


def _require_slug(job_slug: str) -> str:
    slug = (job_slug or "").strip()
    if not slug:
        raise HTTPException(status_code=400, detail="缺少 job_slug")
    return slug


@router.get("/catalog")
def catalog() -> dict[str, Any]:
    families = [{"id": k, "label": k} for k in yolo_workspace.YOLO_FAMILIES]
    tasks = [{"id": t, "label": t} for t in yolo_workspace.YOLO_TASKS]
    return {"families": families, "tasks": tasks}


@router.get("/models")
def list_models(family: str, task: str) -> dict[str, Any]:
    if family not in yolo_workspace.YOLO_FAMILIES:
        raise HTTPException(status_code=400, detail=f"unknown family: {family}")
    if task not in yolo_workspace.YOLO_TASKS:
        raise HTTPException(status_code=400, detail=f"unknown task: {task}")
    return {"models": yolo_workspace.list_catalog_models(family, task)}


@router.get("/history")
def history() -> dict[str, Any]:
    """每次请求重新扫描 ``external/temp``。"""
    return {"items": yolo_workspace.list_training_history()}


@router.delete("/history/{job_slug}")
def delete_history_job(job_slug: str) -> dict[str, Any]:
    try:
        yolo_workspace.delete_training_job(job_slug)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    return {"ok": True, "job_slug": job_slug.strip()}


@router.post("/jobs/prepare")
def prepare_job(body: PrepareJobBody) -> dict[str, Any]:
    try:
        return yolo_workspace.prepare_job(body.training_name)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@router.get("/workspace")
def workspace(job_slug: str = Query(..., description="训练目录 slug")) -> dict[str, Any]:
    slug = _require_slug(job_slug)
    try:
        return yolo_workspace.workspace_snapshot(slug)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e


@router.get("/devices")
def devices() -> dict[str, Any]:
    return {
        "devices": yolo_runner.list_devices(),
        "environment": yolo_runner.cuda_device_environment(),
    }


@router.post("/dataset/unpack")
def unpack_dataset(
    job_slug: str = Query(...),
    original_filename: str | None = Query(None, description="用户选择的 ZIP 原始文件名"),
) -> dict[str, Any]:
    slug = _require_slug(job_slug)
    try:
        data_yaml = yolo_workspace.unpack_dataset_zip(slug, original_zip_filename=original_filename)
    except (FileNotFoundError, ValueError) as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    meta = yolo_workspace.load_meta(slug)
    return {
        "ok": True,
        "data_yaml": str(data_yaml),
        "dataset_zip_filename": meta.get("dataset_zip_filename"),
    }


@router.post("/base-model/select")
def select_base_model(body: SelectBaseModelBody) -> dict[str, Any]:
    slug = _require_slug(body.job_slug)
    try:
        path = yolo_workspace.set_base_model_from_asset(
            slug,
            body.asset_id,
            family=body.family.strip(),
            task=body.task.strip(),
        )
    except (KeyError, FileNotFoundError, ValueError) as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    job_meta = yolo_workspace.load_meta(slug)
    return {
        "ok": True,
        "base_model": str(path),
        "weight_meta": job_meta.get("base_model_weight_meta"),
        "weight_warnings": job_meta.get("base_model_weight_warnings") or [],
    }


@router.post("/base-model/validate")
def validate_base_model(
    job_slug: str = Query(...),
    family: str = Query(...),
    task: str = Query(...),
) -> dict[str, Any]:
    slug = _require_slug(job_slug)
    try:
        result = yolo_workspace.validate_job_base_model(slug, family=family.strip(), task=task.strip())
    except (FileNotFoundError, ValueError) as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    return {"ok": True, **result}


@router.post("/start")
def start_train(body: StartTrainBody) -> dict[str, Any]:
    slug = _require_slug(body.job_slug)
    try:
        snap = yolo_workspace.workspace_snapshot(slug)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    if not snap.get("data_yaml") and not snap.get("dataset_dir"):
        raise HTTPException(status_code=400, detail="请先上传并解压训练数据集")
    if not snap.get("base_model"):
        raise HTTPException(status_code=400, detail="请先选择或上传基础模型")
    job = yolo_runner.get_job(slug)
    if job.get("status") == "running":
        raise HTTPException(status_code=409, detail="该训练任务正在进行中")
    device = body.device.strip() or "cpu"
    try:
        yolo_runner.start_training(
            slug,
            epochs=body.epochs,
            imgsz=body.imgsz,
            batch=body.batch,
            workers=body.workers,
            device=device,
            time_hours=body.time_hours,
            use_custom_augment=body.use_custom_augment,
            augment=body.augment,
            use_custom_optimizer=body.use_custom_optimizer,
            optimizer=body.optimizer,
            export_onnx=body.export_onnx,
        )
    except RuntimeError as e:
        raise HTTPException(status_code=409, detail=str(e)) from e
    return {"ok": True, "job": yolo_runner.get_job(slug)}
