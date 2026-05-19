"""Start/stop: preload or release weights per model family; track active variant per category."""

from __future__ import annotations

import threading
from dataclasses import dataclass
from typing import Any

import torch

from app.model_resources import asset_status, registry_asset_file_basename
from app.models.impl.dinov2_variants import warmup_dinov2 as _warm_dino
from app.models.impl.dinov2_variants import unload_dinov2 as _unload_dino
from app.models.impl.efficient_sam_variants import warmup_efficient_sam as _warm_eff
from app.models.impl.efficient_sam_variants import unload_efficient_sam as _unload_eff
from app.models.impl.mobile_sam_variants import warmup_mobile_sam as _warm_mobile
from app.models.impl.mobile_sam_variants import unload_mobile_sam as _unload_mobile
from app.models.impl.sam2_hiera_variants import warmup_sam2 as _warm_sam2
from app.models.impl.sam2_hiera_variants import unload_sam2 as _unload_sam2
from app.models.impl.yolo_ultralytics import warmup_yolo as _warm_yolo
from app.models.impl.yolo_ultralytics import unload_yolo as _unload_yolo

from .catalog import MODEL_CATEGORIES, category_spec, model_id_in_category

_lock = threading.Lock()


@dataclass(frozen=True)
class ActiveEntry:
    model_id: str
    use_gpu: bool


_active: dict[str, ActiveEntry] = {}


def runtime_slots_for_model_id(model_id: str) -> tuple[str, ...] | None:
    """Catalog categories that gate this model_id（主槽在前）。"""
    if model_id.startswith("sam2/"):
        return ("sam2",)
    if model_id.startswith("mobile_sam/"):
        return ("mobile_sam",)
    if model_id.startswith("ultralytics/"):
        return ("yolo",)
    if model_id.startswith("dinov2/"):
        return ("dinov2",)
    if model_id.startswith("efficient_sam/"):
        return ("efficient_sam",)
    return None


def category_id_for_model_id(model_id: str) -> str | None:
    """Primary runtime category（未传 runtime_slot 时仅检查该槽）。"""
    slots = runtime_slots_for_model_id(model_id)
    return slots[0] if slots else None


def require_runtime_started(model_id: str, *, runtime_slot: str | None = None) -> None:
    """Raise ValueError if this model_id is not started in the required runtime slot.

    When ``runtime_slot`` is None, only the primary global slot is checked (``sam2``, ``mobile_sam``, ``dinov2``, …).
    """
    slots = runtime_slots_for_model_id(model_id)
    if slots is None:
        return
    if not any(model_id_in_category(s, model_id) for s in slots):
        raise ValueError(f"model_id {model_id!r} is not listed in any runtime category for this family")

    with _lock:
        if runtime_slot is not None:
            if runtime_slot not in slots:
                raise ValueError(
                    f"runtime_slot {runtime_slot!r} is not valid for model_id {model_id!r}; "
                    f"expected one of {slots!r}",
                )
            entry = _active.get(runtime_slot)
            if entry is None or entry.model_id != model_id:
                active_mid = entry.model_id if entry else None
                raise ValueError(
                    f"model runtime not started for {model_id!r} in slot {runtime_slot!r} "
                    f"(active={active_mid!r}); call POST /api/v1/model-runtime/{runtime_slot}/start first.",
                )
            return

        primary = slots[0]
        entry = _active.get(primary)
        if entry is None or entry.model_id != model_id:
            active_mid = entry.model_id if entry else None
            raise ValueError(
                f"model runtime not started for {model_id!r} "
                f"(category {primary!r}: active={active_mid!r}); "
                f"call POST /api/v1/model-runtime/{primary}/start first.",
            )


def _unload_weights(model_id: str) -> None:
    if model_id.startswith("sam2/"):
        _unload_sam2(model_id)
    elif model_id.startswith("ultralytics/"):
        _unload_yolo(model_id)
    elif model_id.startswith("dinov2/"):
        _unload_dino(model_id)
    elif model_id.startswith("mobile_sam/"):
        _unload_mobile(model_id)
    elif model_id.startswith("efficient_sam/"):
        _unload_eff(model_id)


def _warm_device(use_gpu: bool) -> torch.device:
    if use_gpu and torch.cuda.is_available():
        return torch.device("cuda:0")
    return torch.device("cpu")


def _warm(category_id: str, model_id: str, use_gpu: bool) -> None:
    dev = _warm_device(use_gpu)
    if category_id == "sam2":
        _warm_sam2(model_id, dev)
    elif category_id == "yolo":
        _warm_yolo(model_id, use_gpu)
    elif category_id == "dinov2":
        _warm_dino(model_id, use_gpu)
    elif category_id == "mobile_sam":
        _warm_mobile(model_id, dev)
    elif category_id == "efficient_sam":
        _warm_eff(model_id, dev)


def _variant_assets_ready(asset_ids: tuple[str, ...]) -> bool:
    for aid in asset_ids:
        st = asset_status(aid)
        if not st.get("known") or not st.get("exists"):
            return False
    return True


def _variant_label(asset_ids: tuple[str, ...]) -> str:
    """下拉展示：使用 registry 里权重文件的原始文件名（relative_path 的 basename）。"""
    primary = asset_ids[0] if asset_ids else ""
    if not primary:
        return ""
    base = registry_asset_file_basename(primary)
    if base:
        return base
    return primary


def get_runtime_catalog() -> dict[str, Any]:
    with _lock:
        active_snapshot = dict(_active)
    categories_out: list[dict[str, Any]] = []
    for cat in MODEL_CATEGORIES:
        entry = active_snapshot.get(cat.id)
        active_model_id: str | None = entry.model_id if entry else None
        active_use_gpu: bool | None = entry.use_gpu if entry else None
        variants_out: list[dict[str, Any]] = []
        for v in cat.variants:
            variants_out.append(
                {
                    "model_id": v.model_id,
                    "label": _variant_label(v.asset_ids),
                    "assets_installed": _variant_assets_ready(v.asset_ids),
                    "asset_ids": list(v.asset_ids),
                },
            )
        categories_out.append(
            {
                "id": cat.id,
                "label_zh": cat.label_zh,
                "label_en": cat.label_en,
                "running": entry is not None,
                "active_model_id": active_model_id,
                "active_use_gpu": active_use_gpu,
                "variants": variants_out,
            },
        )
    return {"categories": categories_out}


def merge_predict_payload_device(
    model_id: str,
    payload: dict[str, Any],
    *,
    runtime_slot: str | None = None,
) -> dict[str, Any]:
    """If payload has no ``device``, set from runtime entry (use_gpu + CUDA availability)."""
    if "device" in payload:
        return payload
    slots = runtime_slots_for_model_id(model_id)
    if not slots:
        return payload
    with _lock:
        entry = None
        if runtime_slot is not None:
            e = _active.get(runtime_slot)
            if e is not None and e.model_id == model_id:
                entry = e
        if entry is None:
            for s in slots:
                e = _active.get(s)
                if e is not None and e.model_id == model_id:
                    entry = e
                    break
    if entry is None:
        return payload
    dev: Any = 0 if entry.use_gpu and torch.cuda.is_available() else "cpu"
    out = dict(payload)
    out["device"] = dev
    return out


def model_start(category_id: str, model_id: str, *, use_gpu: bool = True) -> dict[str, Any]:
    cat = category_spec(category_id)
    if cat is None:
        raise KeyError(f"unknown category: {category_id}")
    if not model_id_in_category(category_id, model_id):
        raise KeyError(f"model_id {model_id!r} is not in category {category_id!r}")

    v_meta = next((v for v in cat.variants if v.model_id == model_id), None)
    if v_meta is None:
        raise KeyError(f"model_id {model_id!r} not found")
    if not _variant_assets_ready(v_meta.asset_ids):
        raise ValueError(
            f"model files missing for {model_id!r}; "
            f"use POST /api/v1/model-assets/{{id}}/ensure for: {v_meta.asset_ids}",
        )

    with _lock:
        prev = _active.get(category_id)
    if prev is not None and prev.model_id == model_id and prev.use_gpu == use_gpu:
        return {
            "category": category_id,
            "model_id": model_id,
            "use_gpu": use_gpu,
            "started": True,
            "already_running": True,
        }

    if prev is not None and prev.model_id != model_id:
        _unload_weights(prev.model_id)
    elif prev is not None and prev.model_id == model_id and prev.use_gpu != use_gpu:
        _unload_weights(model_id)

    _warm(category_id, model_id, use_gpu)

    with _lock:
        _active[category_id] = ActiveEntry(model_id=model_id, use_gpu=use_gpu)

    return {
        "category": category_id,
        "model_id": model_id,
        "use_gpu": use_gpu,
        "started": True,
        "already_running": False,
    }


def model_stop(category_id: str) -> dict[str, Any]:
    cat = category_spec(category_id)
    if cat is None:
        raise KeyError(f"unknown category: {category_id}")
    with _lock:
        entry = _active.pop(category_id, None)
    if entry is None:
        return {"category": category_id, "stopped": True, "was_running": False}
    _unload_weights(entry.model_id)
    return {
        "category": category_id,
        "stopped": True,
        "was_running": True,
        "previous_model_id": entry.model_id,
        "previous_use_gpu": entry.use_gpu,
    }


def runtime_status() -> dict[str, Any]:
    with _lock:
        return {
            "active": {
                k: {"model_id": v.model_id, "use_gpu": v.use_gpu} for k, v in _active.items()
            },
        }
