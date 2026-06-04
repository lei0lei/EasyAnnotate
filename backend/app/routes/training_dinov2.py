"""DINOv2 模型训练 API（``external/temp/dinov2/<训练名>/``）。"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, File, HTTPException, Query, UploadFile
from pydantic import BaseModel, Field

from app.train import dinov2_runner, dinov2_workspace

router = APIRouter()


class PrepareJobBody(BaseModel):
    training_name: str = Field(..., min_length=1, max_length=120)


class SelectBaseModelBody(BaseModel):
    job_slug: str
    asset_id: str = Field(..., description="registry 中的 dinov2/*.pth id")
    objective: str = Field(..., description="linear_probe | fine_tune | partial_tune")


class StartTrainBody(BaseModel):
    job_slug: str
    epochs: int = Field(50, ge=1, le=10_000)
    batch: int = Field(8, ge=1, le=512)
    lr: float = Field(1e-4, gt=0, le=1.0)
    imgsz: int = Field(518, ge=32, le=4096)
    workers: int = Field(2, ge=0, le=64)
    device: str = Field("0")
    freeze_backbone: bool = Field(True)
    weight_decay: float = Field(0.01, ge=0, le=1.0)


def _require_slug(job_slug: str) -> str:
    slug = (job_slug or "").strip()
    if not slug:
        raise HTTPException(status_code=400, detail="缺少 job_slug")
    return slug


@router.get("/catalog")
def catalog() -> dict[str, Any]:
    objectives = [{"id": k, "label": v} for k, v in dinov2_workspace.DINOV2_OBJECTIVES.items()]
    return {"objectives": objectives}


@router.get("/models")
def list_models() -> dict[str, Any]:
    return {"models": dinov2_workspace.list_catalog_models()}


@router.get("/history")
def history() -> dict[str, Any]:
    return {"items": dinov2_workspace.list_training_history()}


@router.post("/jobs/prepare")
def prepare_job(body: PrepareJobBody) -> dict[str, Any]:
    try:
        return dinov2_workspace.prepare_job(body.training_name)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@router.get("/workspace")
def workspace(job_slug: str = Query(...)) -> dict[str, Any]:
    slug = _require_slug(job_slug)
    try:
        return dinov2_workspace.workspace_snapshot(slug)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e


@router.get("/devices")
def devices() -> dict[str, Any]:
    from app.train import yolo_runner

    return {
        "devices": dinov2_runner.list_devices(),
        "environment": yolo_runner.cuda_device_environment(),
    }


@router.get("/status")
def status(job_slug: str = Query(...)) -> dict[str, Any]:
    slug = _require_slug(job_slug)
    job = dinov2_runner.get_job(slug)
    try:
        ws = dinov2_workspace.workspace_snapshot(slug)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    return {"job": job, "workspace": ws}


@router.post("/dataset/unpack")
def unpack_dataset(
    job_slug: str = Query(...),
    original_filename: str | None = Query(None),
) -> dict[str, Any]:
    slug = _require_slug(job_slug)
    try:
        result = dinov2_workspace.unpack_dataset_zip(slug, original_zip_filename=original_filename)
    except (FileNotFoundError, ValueError) as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    meta = dinov2_workspace.load_meta(slug)
    return {
        "ok": True,
        **result,
        "dataset_zip_filename": meta.get("dataset_zip_filename"),
    }


@router.post("/dataset/upload")
async def upload_dataset(job_slug: str = Query(...), file: UploadFile = File(...)) -> dict[str, Any]:
    slug = _require_slug(job_slug)
    if not file.filename or not file.filename.lower().endswith(".zip"):
        raise HTTPException(status_code=400, detail="仅支持 .zip 文件")
    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=400, detail="空文件")
    dest = dinov2_workspace.dataset_zip_path(slug)
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(raw)
    try:
        result = dinov2_workspace.unpack_dataset_zip(slug, original_zip_filename=file.filename)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    meta = dinov2_workspace.load_meta(slug)
    return {
        "ok": True,
        "dataset_zip": str(dest),
        **result,
        "dataset_zip_filename": meta.get("dataset_zip_filename"),
    }


@router.post("/base-model/select")
def select_base_model(body: SelectBaseModelBody) -> dict[str, Any]:
    slug = _require_slug(body.job_slug)
    try:
        path = dinov2_workspace.set_base_model_from_asset(
            slug,
            body.asset_id,
            objective=body.objective.strip(),
        )
    except (KeyError, FileNotFoundError, ValueError) as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    return {"ok": True, "base_model": str(path)}


@router.post("/base-model/upload")
async def upload_base_model(
    job_slug: str = Query(...),
    objective: str = Query(...),
    arch_asset_id: str | None = Query(None, description="registry 架构 id，上传自定义权重时必填"),
    file: UploadFile = File(...),
) -> dict[str, Any]:
    slug = _require_slug(job_slug)
    if not file.filename or not file.filename.lower().endswith(".pth"):
        raise HTTPException(status_code=400, detail="仅支持 .pth 权重")
    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=400, detail="空文件")
    try:
        path = dinov2_workspace.set_base_model_from_upload(
            slug,
            raw,
            file.filename,
            objective=objective.strip(),
            arch_asset_id=arch_asset_id,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    return {"ok": True, "base_model": str(path)}


@router.post("/start")
def start_train(body: StartTrainBody) -> dict[str, Any]:
    slug = _require_slug(body.job_slug)
    try:
        ws = dinov2_workspace.workspace_snapshot(slug)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    if not ws.get("base_model"):
        raise HTTPException(status_code=400, detail="请先选择或上传 DINOv2 预训练权重")
    if not ws.get("dataset_ready"):
        raise HTTPException(status_code=400, detail="请先上传并解压图像数据集 ZIP")
    job = dinov2_runner.get_job(slug)
    if job.get("status") == "running":
        raise HTTPException(status_code=409, detail="该训练任务正在进行中")
    meta = dinov2_workspace.load_meta(slug)
    objective = str(meta.get("objective") or "linear_probe")
    device = body.device.strip() or "cpu"
    try:
        dinov2_runner.start_training(
            slug,
            epochs=body.epochs,
            imgsz=body.imgsz,
            batch=body.batch,
            workers=body.workers,
            device=device,
            lr=body.lr,
            weight_decay=body.weight_decay,
            objective=objective,
            freeze_backbone=body.freeze_backbone,
        )
    except RuntimeError as e:
        raise HTTPException(status_code=409, detail=str(e)) from e
    return {"ok": True, "job": dinov2_runner.get_job(slug)}
