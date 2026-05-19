"""EfficientSAM — `model_id` 为 `registry.json` 的 `efficient_sam/...`；权重文件在 `external/resources/efficientsam/`。"""

from __future__ import annotations

import base64
from io import BytesIO
from typing import Any

import numpy as np
import torch
from PIL import Image

from app.model_resources import ensure_asset, iter_registry_weight_asset_ids
from app.models.base import InferenceModel
from app.models.registry import register_model
from app.models.torch_unload import dispose_torch_object, sync_gc_empty_cuda


def _efficient_encoder_spec(model_id: str) -> tuple[int, int]:
    s = model_id.lower()
    if "vitt" in s:
        return 192, 3
    if "vits" in s:
        return 384, 6
    raise ValueError(
        f"EfficientSAM: cannot infer encoder from {model_id!r} (expected vitt / vits in id or filename).",
    )


def _iter_efficient_asset_ids() -> list[str]:
    return iter_registry_weight_asset_ids("efficient_sam/", extensions=(".pt",))


EFFICIENT_SAM_VARIANTS: dict[str, str] = {k: k for k in _iter_efficient_asset_ids()}

_efficient_models: dict[tuple[str, str], torch.nn.Module] = {}


def _load_image_pil(source: str) -> Image.Image:
    s = source.strip()
    if s.startswith(("http://", "https://")):
        import urllib.request

        req = urllib.request.Request(s, headers={"User-Agent": "EasyAnnotate-efficient_sam/1.0"})
        with urllib.request.urlopen(req, timeout=60) as resp:  # noqa: S310
            data = resp.read()
        return Image.open(BytesIO(data)).convert("RGB")
    return Image.open(s).convert("RGB")


def _predictor_device(raw: Any) -> torch.device:
    if raw is None:
        return torch.device("cuda:0" if torch.cuda.is_available() else "cpu")
    if raw == 0 or raw == "0":
        return torch.device("cuda:0")
    return torch.device(str(raw))


def _device_cache_key(d: torch.device) -> str:
    if d.type == "cuda":
        idx = d.index if d.index is not None else 0
        return f"cuda:{idx}"
    return str(d)


def _build_efficient_sam_for_checkpoint(model_id: str, ckpt_path: str, device: torch.device) -> torch.nn.Module:
    try:
        from efficient_sam.efficient_sam import build_efficient_sam
    except ImportError as e:
        raise ImportError(
            "efficient_sam is not installed. Run install-ml-gpu-deps.ps1 in backend.",
        ) from e
    pdim, heads = _efficient_encoder_spec(model_id)
    sam = build_efficient_sam(
        encoder_patch_embed_dim=pdim,
        encoder_num_heads=heads,
        checkpoint=None,
    )
    try:
        raw = torch.load(str(ckpt_path), map_location="cpu", weights_only=True)
    except TypeError:
        raw = torch.load(str(ckpt_path), map_location="cpu")
    if isinstance(raw, dict) and "model" in raw:
        sam.load_state_dict(raw["model"], strict=True)
    else:
        sam.load_state_dict(raw, strict=True)
    sam.to(device)
    sam.eval()
    return sam


def _get_efficient(model_id: str, device: torch.device) -> torch.nn.Module:
    if model_id not in EFFICIENT_SAM_VARIANTS:
        raise ValueError(f"unknown EfficientSAM model_id: {model_id}")
    key = (model_id, _device_cache_key(device))
    existing = _efficient_models.get(key)
    if existing is not None:
        return existing
    ckpt = ensure_asset(EFFICIENT_SAM_VARIANTS[model_id])
    sam = _build_efficient_sam_for_checkpoint(model_id, str(ckpt), device)
    _efficient_models[key] = sam
    return sam


def warmup_efficient_sam(model_id: str, device: torch.device | None = None) -> None:
    d = device or _predictor_device(None)
    _ = _get_efficient(model_id, d)


def unload_efficient_sam(model_id: str | None = None) -> None:
    global _efficient_models
    if not _efficient_models:
        sync_gc_empty_cuda()
        return
    if model_id is None:
        to_drop = list(_efficient_models.values())
        _efficient_models.clear()
    else:
        to_drop = [v for k, v in _efficient_models.items() if k[0] == model_id]
        for key in list(_efficient_models):
            if key[0] == model_id:
                del _efficient_models[key]
    for v in to_drop:
        dispose_torch_object(v)
    del to_drop
    sync_gc_empty_cuda()


def _pack_tensor_f32_b64(t: torch.Tensor) -> dict[str, Any]:
    arr = t.detach().cpu().float().numpy().astype(np.float32)
    return {
        "dtype": "float32",
        "shape": [int(x) for x in arr.shape],
        "encoding": "le-raw",
        "data_base64": base64.standard_b64encode(arr.tobytes()).decode("ascii"),
    }


def efficient_sam_encode_image_embeddings(model_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    """Run EfficientSAM image encoder for browser ``*.decoder.onnx`` (CVAT-aligned crop outputs)."""
    if model_id not in EFFICIENT_SAM_VARIANTS:
        raise ValueError(f"unknown EfficientSAM model_id: {model_id}")
    source = payload.get("source")
    if not source or not isinstance(source, str):
        raise ValueError("payload['source'] is required (local path or image URL)")

    device = _predictor_device(payload.get("device"))
    pil = _load_image_pil(source)
    full_w, full_h = pil.size
    raw_scale = payload.get("infer_scale", 1.0)
    try:
        scale = float(raw_scale)
    except (TypeError, ValueError):
        scale = 1.0
    scale = max(0.3, min(1.0, scale))
    w_s = max(1, int(round(full_w * scale)))
    h_s = max(1, int(round(full_h * scale)))
    if (w_s, h_s) != (full_w, full_h):
        pil = pil.resize((w_s, h_s), Image.Resampling.LANCZOS)

    import torchvision.transforms as T

    x = T.ToTensor()(pil).unsqueeze(0).to(device) * 255.0
    model = _get_efficient(model_id, device)
    img_size = int(model.image_encoder.img_size)
    embed_hw = img_size // 16
    mask_input_hw = 4 * embed_hw

    with torch.inference_mode():
        features = model.get_image_embeddings(x)

    return {
        "model_id": model_id,
        "source": source,
        "device": str(device),
        "feature_layout": "efficient_sam_cvat_decoder_onnx_v1",
        "orig_hw": [[int(full_h), int(full_w)]],
        "image_width": int(w_s),
        "image_height": int(h_s),
        "full_image_width": int(full_w),
        "full_image_height": int(full_h),
        "model_input_size": img_size,
        "multimask_decoder": True,
        "mask_input_height": int(mask_input_hw),
        "mask_input_width": int(mask_input_hw),
        "image_embed": _pack_tensor_f32_b64(features),
    }


def _make_efficient_class(mid: str):
    class _EfficientSamModel(InferenceModel):
        @property
        def model_id(self) -> str:
            return mid

        def predict(self, payload: dict[str, Any]) -> dict[str, Any]:
            source = payload.get("source")
            if not source or not isinstance(source, str):
                raise ValueError("payload['source'] is required (local path or image URL)")
            device = _predictor_device(payload.get("device"))
            pil = _load_image_pil(source)
            w, h = pil.size
            point_xy = payload.get("point_xy")
            point_labels = payload.get("point_labels")
            if payload.get("box") is not None:
                raise ValueError("EfficientSAM path currently supports point prompts only (not box).")

            if point_xy is not None:
                pc = torch.as_tensor(point_xy, dtype=torch.float32, device=device)
                if pc.ndim == 1:
                    pc = pc.reshape(1, 2)
                if point_labels is not None:
                    pl = torch.as_tensor(point_labels, dtype=torch.int64, device=device).reshape(-1)
                else:
                    pl = torch.ones(len(pc), dtype=torch.int64, device=device)
                pts = pc.unsqueeze(0).unsqueeze(0)
                pls = pl.unsqueeze(0).unsqueeze(0)
            else:
                pts = torch.tensor([[[[w / 2.0, h / 2.0]]]], dtype=torch.float32, device=device)
                pls = torch.tensor([[[1]]], dtype=torch.int64, device=device)

            import torchvision.transforms as T

            x = T.ToTensor()(pil).unsqueeze(0).to(device) * 255.0

            model = _get_efficient(mid, device)
            with torch.inference_mode():
                masks, ious = model(x, pts, pls, scale_to_original_image_size=True)
            m_sel = masks[0, 0]
            iou_vec = ious[0, 0]
            n_pred = int(m_sel.shape[0])
            best_idx = int(torch.argmax(iou_vec)) if n_pred else 0
            m_best = m_sel[best_idx].float()
            fg = float((m_best > 0).float().sum())
            area_ratio_fg = fg / float(h * w) if h * w else 0.0

            return {
                "model_id": mid,
                "source": source,
                "device": str(device),
                "image_size": {"width": w, "height": h},
                "num_masks": n_pred,
                "iou_predictions": [float(x) for x in iou_vec.cpu().tolist()],
                "best_mask_index": best_idx,
                "best_mask_foreground_pixels": int(fg),
                "best_mask_area_ratio": area_ratio_fg,
            }

    return _EfficientSamModel


for _eid in list(EFFICIENT_SAM_VARIANTS.keys()):
    register_model(_eid, lambda m=_eid: _make_efficient_class(m)())
