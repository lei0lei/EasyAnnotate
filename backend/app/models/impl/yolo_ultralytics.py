"""Ultralytics YOLOv8 — multiple size checkpoints from model resources registry."""

from __future__ import annotations

from typing import Any

import torch

from app.model_resources import ensure_asset, iter_registry_weight_asset_ids
from app.models.base import InferenceModel
from app.models.registry import register_model
from app.models.torch_unload import dispose_torch_object, sync_gc_empty_cuda


def _build_yolo_variant_map() -> dict[str, str]:
    ids = iter_registry_weight_asset_ids("ultralytics/", extensions=(".pt",))
    return {k: k for k in ids}


YOLO_VARIANTS: dict[str, str] = _build_yolo_variant_map()

_yolo_models: dict[str, Any] = {}


def _get_yolo(model_id: str) -> Any:
    asset_id = YOLO_VARIANTS.get(model_id)
    if asset_id is None:
        raise ValueError(f"unknown YOLO model_id: {model_id}")
    cached = _yolo_models.get(model_id)
    if cached is not None:
        return cached
    try:
        from ultralytics import YOLO
    except ImportError as e:
        raise ImportError(
            "ultralytics is not installed. Run install-ml-gpu-deps.ps1 in backend.",
        ) from e
    ckpt = ensure_asset(asset_id)
    _yolo_models[model_id] = YOLO(str(ckpt))
    return _yolo_models[model_id]


def warmup_yolo(model_id: str, use_gpu: bool = True) -> None:
    m = _get_yolo(model_id)
    if use_gpu and torch.cuda.is_available():
        m.to(0)
    else:
        m.to("cpu")


def unload_yolo(model_id: str | None = None) -> None:
    global _yolo_models
    if not _yolo_models:
        sync_gc_empty_cuda()
        return
    if model_id is None:
        to_drop = list(_yolo_models.values())
        _yolo_models.clear()
    elif model_id in _yolo_models:
        to_drop = [_yolo_models.pop(model_id)]
    else:
        to_drop = []
    for v in to_drop:
        dispose_torch_object(v)
    del to_drop
    sync_gc_empty_cuda()


def _detection_dict(r: Any) -> dict[str, Any]:
    names = {int(k): str(v) for k, v in (r.names or {}).items()}
    if r.boxes is None or len(r.boxes) == 0:
        return {"names": names, "detections": []}
    xyxy = r.boxes.xyxy.cpu().numpy().tolist()
    conf = r.boxes.conf.cpu().numpy().tolist()
    cls_ids = r.boxes.cls.cpu().numpy().tolist()
    detections: list[dict[str, Any]] = []
    for i in range(len(xyxy)):
        cid = int(cls_ids[i])
        detections.append(
            {
                "xyxy": xyxy[i],
                "confidence": float(conf[i]),
                "class_id": cid,
                "class_name": names.get(cid),
            },
        )
    return {"names": names, "detections": detections}


def _make_yolo_class(mid: str):
    class _YoloModel(InferenceModel):
        @property
        def model_id(self) -> str:
            return mid

        def predict(self, payload: dict[str, Any]) -> dict[str, Any]:
            source = payload.get("source")
            if not source or not isinstance(source, str):
                raise ValueError("payload['source'] is required (local path, URL, or folder)")

            conf = float(payload.get("conf", 0.25))
            imgsz = payload.get("imgsz")
            raw_device = payload.get("device")
            if raw_device is None:
                device: str | int = 0 if torch.cuda.is_available() else "cpu"
            else:
                device = raw_device
            kwargs: dict[str, Any] = {"verbose": False, "conf": conf, "device": device}
            if imgsz is not None:
                kwargs["imgsz"] = int(imgsz)

            model = _get_yolo(mid)
            results = model.predict(source=source, **kwargs)
            if not results:
                return {"model_id": mid, "results": []}
            out_results = []
            for r in results:
                d = _detection_dict(r)
                d["shape"] = list(r.orig_shape) if r.orig_shape else None
                out_results.append(d)
            return {
                "model_id": mid,
                "source": source,
                "device": device,
                "results": out_results,
                "summary": {
                    "n_images": len(out_results),
                    "total_detections": sum(len(x["detections"]) for x in out_results),
                },
            }

    return _YoloModel


for _yid in YOLO_VARIANTS:
    register_model(_yid, lambda m=_yid: _make_yolo_class(m)())
