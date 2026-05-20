"""YOLO 模型训练 API（``external/temp/<训练名>/`` 每次训练独立目录）。"""

from __future__ import annotations

import tempfile
from pathlib import Path
from typing import Any

from fastapi import APIRouter, File, HTTPException, Query, UploadFile
from pydantic import BaseModel, Field

from app.train import yolo_runner, yolo_workspace

router = APIRouter()


class PrepareJobBody(BaseModel):
    training_name: str = Field(..., min_length=1, max_length=120, description="本次训练名称，用作 temp 子目录名")


class SelectBaseModelBody(BaseModel):
    job_slug: str
    asset_id: str = Field(..., description="registry 中的 ultralytics 权重 id")


class StartTrainBody(BaseModel):
    job_slug: str
    epochs: int = Field(100, ge=1, le=10_000)
    imgsz: int = Field(640, ge=32, le=4096)
    batch: int = Field(16, ge=1, le=512)
    device: str = Field("0", description="cpu 或 GPU 序号字符串")
    patience: int | None = Field(50, ge=0, le=1000)


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


@router.get("/history/{job_slug}/logs")
def history_logs(job_slug: str) -> dict[str, Any]:
    try:
        text = yolo_workspace.read_training_logs(job_slug)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    return {"job_slug": job_slug, "logs": text}


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
    return {"devices": yolo_runner.list_devices()}


@router.get("/status")
def status(job_slug: str = Query(...)) -> dict[str, Any]:
    slug = _require_slug(job_slug)
    job = yolo_runner.get_job()
    if job.get("job_slug") and job.get("job_slug") != slug and job.get("status") == "running":
        job = {**job, "message": "其他训练任务正在运行", "status": "idle", "progress": 0}
    try:
        ws = yolo_workspace.workspace_snapshot(slug)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    return {"job": job, "workspace": ws}


@router.post("/dataset/unpack")
def unpack_dataset(job_slug: str = Query(...)) -> dict[str, Any]:
    slug = _require_slug(job_slug)
    try:
        data_yaml = yolo_workspace.unpack_dataset_zip(slug)
    except (FileNotFoundError, ValueError) as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    return {"ok": True, "data_yaml": str(data_yaml)}


@router.post("/dataset/upload")
async def upload_dataset(job_slug: str = Query(...), file: UploadFile = File(...)) -> dict[str, Any]:
    slug = _require_slug(job_slug)
    if not file.filename or not file.filename.lower().endswith(".zip"):
        raise HTTPException(status_code=400, detail="仅支持 .zip 文件")
    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=400, detail="空文件")
    dest = yolo_workspace.dataset_zip_path(slug)
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(raw)
    try:
        data_yaml = yolo_workspace.unpack_dataset_zip(slug)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    return {"ok": True, "dataset_zip": str(dest), "data_yaml": str(data_yaml)}


@router.post("/base-model/select")
def select_base_model(body: SelectBaseModelBody) -> dict[str, Any]:
    slug = _require_slug(body.job_slug)
    try:
        path = yolo_workspace.set_base_model_from_asset(slug, body.asset_id)
    except (KeyError, FileNotFoundError, ValueError) as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    return {"ok": True, "base_model": str(path)}


@router.post("/base-model/upload")
async def upload_base_model(job_slug: str = Query(...), file: UploadFile = File(...)) -> dict[str, Any]:
    slug = _require_slug(job_slug)
    if not file.filename or not file.filename.lower().endswith(".pt"):
        raise HTTPException(status_code=400, detail="仅支持 .pt 权重")
    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=400, detail="空文件")
    tmp = ""
    try:
        with tempfile.NamedTemporaryFile(prefix="ea-yolo-", suffix=".pt", delete=False) as f:
            f.write(raw)
            tmp = f.name
        path = yolo_workspace.save_uploaded_base_model(slug, Path(tmp))
    finally:
        if tmp:
            Path(tmp).unlink(missing_ok=True)
    return {"ok": True, "base_model": str(path)}


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
    job = yolo_runner.get_job()
    if job.get("status") == "running":
        raise HTTPException(status_code=409, detail="训练任务进行中")
    device = body.device.strip() or "cpu"
    try:
        yolo_runner.start_training(
            slug,
            epochs=body.epochs,
            imgsz=body.imgsz,
            batch=body.batch,
            device=device,
            patience=body.patience,
        )
    except RuntimeError as e:
        raise HTTPException(status_code=409, detail=str(e)) from e
    return {"ok": True, "job": yolo_runner.get_job()}
