"""YOLO 批量标注：按 model_slug 加载/卸载推理模型（内存缓存）。"""

from __future__ import annotations

import threading
from pathlib import Path
from typing import Any

import torch

from app.models.torch_unload import dispose_torch_object, sync_gc_empty_cuda
from app.train.yolo_batch_workspace import (
    data_yaml_path,
    load_meta,
    parse_data_yaml_names,
    weights_path,
)

_lock = threading.Lock()
_loaded: dict[str, Any] = {}


def is_model_running(model_slug: str) -> bool:
    slug = (model_slug or "").strip()
    with _lock:
        return slug in _loaded


def list_running_slugs() -> list[str]:
    with _lock:
        return sorted(_loaded.keys())


def _apply_class_names(model: Any, yaml_path: Path) -> None:
    names = parse_data_yaml_names(yaml_path)
    try:
        model.names = names
    except Exception:
        pass
    try:
        if hasattr(model, "model") and hasattr(model.model, "names"):
            model.model.names = names
    except Exception:
        pass


def _resolve_device(use_gpu: bool) -> str | int:
    if use_gpu and torch.cuda.is_available():
        return 0
    return "cpu"


def start_model(model_slug: str) -> dict[str, Any]:
    slug = (model_slug or "").strip()
    if not slug:
        raise ValueError("缺少 model_slug")
    meta = load_meta(slug)
    if not meta.get("ready"):
        raise ValueError("模型尚未完成配置（缺少 yaml 或权重）")
    pt = weights_path(slug)
    yaml_p = data_yaml_path(slug)
    if not pt.is_file():
        raise FileNotFoundError("未找到权重文件")
    if not yaml_p.is_file():
        raise FileNotFoundError("未找到 data.yaml")

    with _lock:
        if slug in _loaded:
            return {"model_slug": slug, "running": True, "already_running": True}

    try:
        from ultralytics import YOLO
    except ImportError as e:
        raise ImportError(
            "ultralytics 未安装，请在 backend 目录运行 install-ml-gpu-deps.ps1",
        ) from e

    use_gpu = bool(meta.get("use_gpu", True))
    device = _resolve_device(use_gpu)
    model = YOLO(str(pt))
    _apply_class_names(model, yaml_p)
    if device != "cpu":
        model.to(device)
    else:
        model.to("cpu")

    with _lock:
        _loaded[slug] = model

    return {
        "model_slug": slug,
        "running": True,
        "device": str(device),
        "task": meta.get("task"),
    }


def stop_model(model_slug: str) -> dict[str, Any]:
    slug = (model_slug or "").strip()
    with _lock:
        model = _loaded.pop(slug, None)
    if model is not None:
        dispose_torch_object(model)
    sync_gc_empty_cuda()
    return {"model_slug": slug, "running": False}


def stop_all() -> dict[str, Any]:
    with _lock:
        slugs = list(_loaded.keys())
        models = [_loaded.pop(s) for s in slugs]
    for m in models:
        dispose_torch_object(m)
    sync_gc_empty_cuda()
    return {"stopped": slugs}


def get_infer_kwargs(model_slug: str) -> dict[str, Any]:
    meta = load_meta(model_slug)
    return {
        "conf": float(meta.get("conf", 0.25)),
        "iou": float(meta.get("iou", 0.7)),
        "imgsz": int(meta.get("imgsz", 640)),
        "max_det": int(meta.get("max_det", 300)),
        "verbose": False,
    }


def _predict_loaded_model(
    model: Any,
    slug: str,
    source: Any,
    *,
    device: str | int | None = None,
) -> dict[str, Any]:
    meta = load_meta(slug)
    kwargs = get_infer_kwargs(slug)
    if device is not None:
        kwargs["device"] = device
    else:
        kwargs["device"] = _resolve_device(bool(meta.get("use_gpu", True)))

    task = (meta.get("task") or "detect").strip().lower()
    results = model.predict(source=source, **kwargs)
    if not results:
        return {"model_slug": slug, "task": task, "results": []}

    from app.train.yolo_batch_predict_export import export_ultralytics_result

    out: list[dict[str, Any]] = []
    for r in results:
        out.append(export_ultralytics_result(r, task))
    return {"model_slug": slug, "task": task, "results": out}


def predict_image(model_slug: str, image_path: str, *, device: str | int | None = None) -> dict[str, Any]:
    """对单张图片推理（供后续批量标注任务调用）。"""
    slug = (model_slug or "").strip()
    with _lock:
        model = _loaded.get(slug)
    if model is None:
        raise RuntimeError(f"模型未启动：{slug}")
    return _predict_loaded_model(model, slug, image_path, device=device)


def predict_image_bytes(model_slug: str, data: bytes, *, device: str | int | None = None) -> dict[str, Any]:
    """对内存中的图片字节推理（WebSocket 上传场景，避免写临时文件）。"""
    slug = (model_slug or "").strip()
    if not data:
        raise ValueError("image bytes empty")
    with _lock:
        model = _loaded.get(slug)
    if model is None:
        raise RuntimeError(f"模型未启动：{slug}")

    import io

    from PIL import Image

    try:
        image = Image.open(io.BytesIO(data))
        image.load()
    except Exception as e:
        raise ValueError(f"invalid image bytes: {e}") from e
    return _predict_loaded_model(model, slug, image, device=device)


def runtime_status() -> dict[str, Any]:
    slugs = list_running_slugs()
    return {"running_models": slugs, "count": len(slugs)}
