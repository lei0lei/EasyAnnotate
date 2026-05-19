"""MobileSAM (TinyViT) — `model_id` 为 `registry.json` 的 `mobile_sam/...`；权重文件在 `external/resources/mobilesam/`。"""

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

def _iter_mobile_asset_ids() -> list[str]:
    return iter_registry_weight_asset_ids("mobile_sam/", extensions=(".pt",))


MOBILE_SAM_VARIANTS: dict[str, str] = {k: k for k in _iter_mobile_asset_ids()}

_mobile_predictors: dict[tuple[str, str], Any] = {}


def _load_image(source: str) -> np.ndarray:
    return np.array(_load_image_pil(source))


def _load_image_pil(source: str) -> Image.Image:
    s = source.strip()
    if s.startswith(("http://", "https://")):
        import urllib.request

        req = urllib.request.Request(s, headers={"User-Agent": "EasyAnnotate-mobilesam/1.0"})
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


def _get_predictor(model_id: str, device: torch.device) -> Any:
    if model_id not in MOBILE_SAM_VARIANTS:
        raise ValueError(f"unknown MobileSAM model_id: {model_id}")
    try:
        from mobile_sam.build_sam import build_sam_vit_t
        from mobile_sam.predictor import SamPredictor
    except ImportError as e:
        raise ImportError(
            "mobile_sam is not installed. Run install-ml-gpu-deps.ps1 in backend.",
        ) from e
    key = (model_id, _device_cache_key(device))
    existing = _mobile_predictors.get(key)
    if existing is not None:
        return existing
    ckpt = ensure_asset(MOBILE_SAM_VARIANTS[model_id])
    sam = build_sam_vit_t(checkpoint=str(ckpt))
    sam.to(device)
    sam.eval()
    pred = SamPredictor(sam)
    _mobile_predictors[key] = pred
    return pred


def warmup_mobile_sam(model_id: str, device: torch.device | None = None) -> None:
    d = device or _predictor_device(None)
    _ = _get_predictor(model_id, d)


def unload_mobile_sam(model_id: str | None = None) -> None:
    global _mobile_predictors
    if not _mobile_predictors:
        sync_gc_empty_cuda()
        return
    if model_id is None:
        to_drop = list(_mobile_predictors.values())
        _mobile_predictors.clear()
    else:
        to_drop = [v for k, v in _mobile_predictors.items() if k[0] == model_id]
        for key in list(_mobile_predictors):
            if key[0] == model_id:
                del _mobile_predictors[key]
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


def mobile_sam_encode_image_embeddings(model_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    """Run MobileSAM image encoder for browser ``*.decoder.onnx`` (CVAT-aligned crop outputs)."""
    if model_id not in MOBILE_SAM_VARIANTS:
        raise ValueError(f"unknown MobileSAM model_id: {model_id}")
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

    image_np = np.array(pil)
    predictor = _get_predictor(model_id, device)
    img_size = int(predictor.model.image_encoder.img_size)
    input_image = predictor.transform.apply_image(image_np)
    input_image_torch = torch.as_tensor(input_image, device=device).permute(2, 0, 1).contiguous()[None, :, :, :]
    input_image_torch = predictor.model.preprocess(input_image_torch)

    with torch.inference_mode():
        features = predictor.model.image_encoder(input_image_torch)

    embed_hw = img_size // 16
    mask_input_hw = 4 * embed_hw

    return {
        "model_id": model_id,
        "source": source,
        "device": str(device),
        "feature_layout": "mobile_sam_cvat_decoder_onnx_v1",
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


def _make_mobile_class(mid: str):
    class _MobileSamModel(InferenceModel):
        @property
        def model_id(self) -> str:
            return mid

        def predict(self, payload: dict[str, Any]) -> dict[str, Any]:
            source = payload.get("source")
            if not source or not isinstance(source, str):
                raise ValueError("payload['source'] is required (local path or image URL)")
            device = _predictor_device(payload.get("device"))
            multimask_output = bool(payload.get("multimask_output", False))
            image_np = _load_image(source)
            h, w = image_np.shape[:2]
            point_xy = payload.get("point_xy")
            point_labels = payload.get("point_labels")
            box = payload.get("box")
            predictor = _get_predictor(mid, device)
            predictor.set_image(image_np, image_format="RGB")
            box_arr: np.ndarray | None
            if box is not None:
                box_arr = np.asarray(box, dtype=np.float64).reshape(4)
                pc = None
                pl = None
            elif point_xy is not None:
                box_arr = None
                pc = np.asarray(point_xy, dtype=np.float64)
                if pc.ndim == 1:
                    pc = pc.reshape(1, 2)
                if point_labels is not None:
                    pl = np.asarray(point_labels, dtype=np.int64).reshape(-1)
                else:
                    pl = np.ones(len(pc), dtype=np.int64)
            else:
                box_arr = None
                pc = np.array([[w / 2.0, h / 2.0]], dtype=np.float64)
                pl = np.array([1], dtype=np.int64)

            with torch.inference_mode():
                if box_arr is not None:
                    masks, iou_predictions, _ = predictor.predict(
                        point_coords=None,
                        point_labels=None,
                        box=box_arr,
                        multimask_output=multimask_output,
                        return_logits=False,
                    )
                else:
                    masks, iou_predictions, _ = predictor.predict(
                        point_coords=pc,
                        point_labels=pl,
                        box=None,
                        multimask_output=multimask_output,
                        return_logits=False,
                    )

            c = int(masks.shape[0])
            best_idx = int(np.argmax(iou_predictions)) if len(iou_predictions) else 0
            m_best = masks[best_idx].astype(np.float32)
            fg = float(m_best.sum())
            area_ratio = fg / float(h * w) if h * w else 0.0

            return {
                "model_id": mid,
                "source": source,
                "device": str(device),
                "image_size": {"width": w, "height": h},
                "multimask_output": multimask_output,
                "num_masks": c,
                "iou_predictions": [float(x) for x in iou_predictions],
                "best_mask_index": best_idx,
                "best_mask_foreground_pixels": int(fg),
                "best_mask_area_ratio": area_ratio,
            }

    return _MobileSamModel


for _mid in list(MOBILE_SAM_VARIANTS.keys()):
    register_model(_mid, lambda m=_mid: _make_mobile_class(m)())
