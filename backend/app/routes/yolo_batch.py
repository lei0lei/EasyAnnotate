"""YOLO 批量标注工具 API（``external/model_temp/<模型名>/``）。"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, File, HTTPException, Query, Request, UploadFile
from pydantic import BaseModel, Field

from app.train import yolo_batch_chunk_transfer, yolo_batch_runner, yolo_batch_workspace

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


class ChunkUploadInitBody(BaseModel):
    filename: str = Field(..., min_length=1)
    total_size: int = Field(..., ge=1)
    upload_id: str | None = Field(None, description="续传时传入已有 upload_id")


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


@router.post("/models/{model_slug}/data-yaml/upload/init")
def data_yaml_upload_init(model_slug: str, body: ChunkUploadInitBody) -> dict[str, Any]:
    slug = _require_slug(model_slug)
    try:
        return yolo_batch_chunk_transfer.init_upload(
            slug,
            "data_yaml",
            filename=body.filename,
            total_size=body.total_size,
            upload_id=body.upload_id,
        )
    except (FileNotFoundError, ValueError) as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@router.put("/models/{model_slug}/data-yaml/upload/chunk")
async def data_yaml_upload_chunk(
    request: Request,
    model_slug: str,
    upload_id: str = Query(...),
    chunk_index: int = Query(..., ge=0),
) -> dict[str, Any]:
    slug = _require_slug(model_slug)
    data = await request.body()
    try:
        return yolo_batch_chunk_transfer.save_upload_chunk(slug, upload_id, chunk_index, data)
    except (FileNotFoundError, ValueError) as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@router.post("/models/{model_slug}/data-yaml/upload/complete")
def data_yaml_upload_complete(model_slug: str, upload_id: str = Query(...)) -> dict[str, Any]:
    slug = _require_slug(model_slug)
    try:
        return yolo_batch_chunk_transfer.complete_upload(slug, upload_id)
    except (FileNotFoundError, ValueError) as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@router.post("/models/{model_slug}/weights/upload/init")
def weights_upload_init(model_slug: str, body: ChunkUploadInitBody) -> dict[str, Any]:
    slug = _require_slug(model_slug)
    try:
        return yolo_batch_chunk_transfer.init_upload(
            slug,
            "weights",
            filename=body.filename,
            total_size=body.total_size,
            upload_id=body.upload_id,
        )
    except (FileNotFoundError, ValueError) as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@router.put("/models/{model_slug}/weights/upload/chunk")
async def weights_upload_chunk(
    request: Request,
    model_slug: str,
    upload_id: str = Query(...),
    chunk_index: int = Query(..., ge=0),
) -> dict[str, Any]:
    slug = _require_slug(model_slug)
    data = await request.body()
    try:
        return yolo_batch_chunk_transfer.save_upload_chunk(slug, upload_id, chunk_index, data)
    except (FileNotFoundError, ValueError) as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@router.post("/models/{model_slug}/weights/upload/complete")
def weights_upload_complete(model_slug: str, upload_id: str = Query(...)) -> dict[str, Any]:
    slug = _require_slug(model_slug)
    try:
        return yolo_batch_chunk_transfer.complete_upload(slug, upload_id)
    except (FileNotFoundError, ValueError) as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@router.post("/models/{model_slug}/data-yaml/confirm")
def confirm_data_yaml(model_slug: str) -> dict[str, Any]:
    slug = _require_slug(model_slug)
    try:
        return yolo_batch_workspace.confirm_data_yaml_on_disk(slug)
    except (FileNotFoundError, ValueError) as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@router.post("/models/{model_slug}/weights/confirm")
def confirm_weights(model_slug: str) -> dict[str, Any]:
    slug = _require_slug(model_slug)
    try:
        return yolo_batch_workspace.confirm_weights_on_disk(slug)
    except (FileNotFoundError, ValueError) as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@router.post("/models/{model_slug}/data-yaml/upload")
async def upload_data_yaml(model_slug: str, file: UploadFile = File(...)) -> dict[str, Any]:
    """小文件直传（本地或远程）；大文件请用分片上传。"""
    slug = _require_slug(model_slug)
    if not file.filename or not (
        file.filename.lower().endswith(".yaml") or file.filename.lower().endswith(".yml")
    ):
        raise HTTPException(status_code=400, detail="仅支持 .yaml / .yml")
    raw = await file.read()
    try:
        return yolo_batch_workspace.save_data_yaml_upload(slug, raw)
    except (FileNotFoundError, ValueError) as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@router.post("/models/{model_slug}/weights/upload")
async def upload_weights(model_slug: str, file: UploadFile = File(...)) -> dict[str, Any]:
    """小文件直传；大文件请用分片上传。"""
    slug = _require_slug(model_slug)
    if not file.filename or not file.filename.lower().endswith(".pt"):
        raise HTTPException(status_code=400, detail="仅支持 .pt 权重")
    raw = await file.read()
    try:
        return yolo_batch_workspace.save_weights_upload(slug, raw)
    except (FileNotFoundError, ValueError) as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


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


@router.post("/models/{model_slug}/predict")
def predict_one(
    model_slug: str,
    image_path: str = Query(..., description="本地图片绝对路径"),
) -> dict[str, Any]:
    slug = _require_slug(model_slug)
    try:
        return yolo_batch_runner.predict_image(slug, image_path.strip())
    except (RuntimeError, FileNotFoundError, ValueError) as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
