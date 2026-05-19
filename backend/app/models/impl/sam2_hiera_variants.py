"""SAM 2.1 Hiera — small / medium / large variants (image segmentation)."""

from __future__ import annotations

import base64
from io import BytesIO
from typing import Any

import numpy as np
import torch
from PIL import Image

from app.model_resources import ensure_asset
from app.models.base import InferenceModel
from app.models.impl.sam2_cvat_encoder import SAM2ImageEncoder
from app.models.registry import register_model
from app.models.torch_unload import dispose_torch_object, sync_gc_empty_cuda

SAM2_VARIANTS: dict[str, tuple[str, str]] = {
    "sam2/sam2.1_hiera_tiny": (
        "configs/sam2.1/sam2.1_hiera_t.yaml",
        "sam2/sam2.1_hiera_tiny",
    ),
    "sam2/sam2.1_hiera_small": (
        "configs/sam2.1/sam2.1_hiera_s.yaml",
        "sam2/sam2.1_hiera_small",
    ),
    "sam2/sam2.1_hiera_base_plus": (
        "configs/sam2.1/sam2.1_hiera_b+.yaml",
        "sam2/sam2.1_hiera_base_plus",
    ),
    "sam2/sam2.1_hiera_large": (
        "configs/sam2.1/sam2.1_hiera_l.yaml",
        "sam2/sam2.1_hiera_large",
    ),
}

_sam2_predictors: dict[tuple[str, str], Any] = {}


def _patch_sam2_transforms_skip_jit() -> None:
    import torch.nn as nn
    from torchvision.transforms import Normalize, Resize, ToTensor

    from sam2.utils import transforms as sam2_ut

    if getattr(sam2_ut, "_easyannotate_skip_jit_patch", False):
        return

    def __init__(
        self,
        resolution: int,
        mask_threshold: float,
        max_hole_area: float = 0.0,
        max_sprinkle_area: float = 0.0,
    ) -> None:
        nn.Module.__init__(self)
        self.resolution = resolution
        self.mask_threshold = mask_threshold
        self.max_hole_area = max_hole_area
        self.max_sprinkle_area = max_sprinkle_area
        self.mean = [0.485, 0.456, 0.406]
        self.std = [0.229, 0.224, 0.225]
        self.to_tensor = ToTensor()
        self.transforms = nn.Sequential(
            Resize((self.resolution, self.resolution)),
            Normalize(self.mean, self.std),
        )

    sam2_ut.SAM2Transforms.__init__ = __init__  # type: ignore[method-assign]
    sam2_ut._easyannotate_skip_jit_patch = True


def _load_image(source: str) -> Image.Image:
    s = source.strip()
    if s.startswith(("http://", "https://")):
        import urllib.request

        req = urllib.request.Request(s, headers={"User-Agent": "EasyAnnotate-sam2/1.0"})
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


def _get_sam2_predictor(model_id: str, device: torch.device) -> Any:
    if model_id not in SAM2_VARIANTS:
        raise ValueError(f"unknown SAM2 model_id: {model_id}")
    try:
        _patch_sam2_transforms_skip_jit()
        from sam2.build_sam import build_sam2
        from sam2.sam2_image_predictor import SAM2ImagePredictor
    except ImportError as e:
        raise ImportError(
            "sam2 is not installed. Run install-ml-gpu-deps.ps1 in backend.",
        ) from e

    key = (model_id, _device_cache_key(device))
    existing = _sam2_predictors.get(key)
    if existing is not None:
        return existing

    hydra_cfg, asset_id = SAM2_VARIANTS[model_id]
    ckpt = ensure_asset(asset_id)
    sam_model = build_sam2(
        hydra_cfg,
        ckpt_path=str(ckpt),
        device=str(device),
        mode="eval",
    )
    pred = SAM2ImagePredictor(sam_model)
    _sam2_predictors[key] = pred
    return pred


def warmup_sam2(model_id: str, device: torch.device | None = None) -> None:
    d = device or _predictor_device(None)
    _ = _get_sam2_predictor(model_id, d)


def unload_sam2(model_id: str | None = None) -> None:
    global _sam2_predictors
    if not _sam2_predictors:
        return
    if model_id is None:
        to_drop = list(_sam2_predictors.values())
        _sam2_predictors.clear()
    else:
        to_drop = [v for k, v in _sam2_predictors.items() if k[0] == model_id]
        for key in list(_sam2_predictors):
            if key[0] == model_id:
                del _sam2_predictors[key]
    for v in to_drop:
        dispose_torch_object(v)
    del to_drop
    sync_gc_empty_cuda()


def _pack_tensor_f32_b64(t: torch.Tensor) -> dict[str, Any]:
    """Serialize float32 tensor for browser ORT (hashJoe / CVAT decoder path)."""
    arr = t.detach().cpu().float().numpy().astype(np.float32)
    return {
        "dtype": "float32",
        "shape": [int(x) for x in arr.shape],
        "encoding": "le-raw",
        "data_base64": base64.standard_b64encode(arr.tobytes()).decode("ascii"),
    }


def sam2_encode_image_embeddings(model_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    """Run SAM2.1 CVAT-aligned image encoder for browser ONNX decoder (hashJoe path).

    Uses the same ``SAM2ImageEncoder`` forward as ``export_sam21_cvat_decoder.py``.
    Clears the shared predictor state after packing.
    """
    if model_id not in SAM2_VARIANTS:
        raise ValueError(f"unknown SAM2 model_id: {model_id}")
    source = payload.get("source")
    if not source or not isinstance(source, str):
        raise ValueError("payload['source'] is required (local path or image URL)")

    device = _predictor_device(payload.get("device"))
    pil = _load_image(source)
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
        try:
            resample = Image.Resampling.BILINEAR  # type: ignore[attr-defined]
        except AttributeError:
            resample = Image.BILINEAR  # type: ignore[attr-defined]
        pil = pil.resize((w_s, h_s), resample)

    predictor = _get_sam2_predictor(model_id, device)
    sam = predictor.model
    input_image = predictor._transforms(pil)
    input_image = input_image[None, ...].to(device)

    enc = SAM2ImageEncoder(sam).to(device)
    with torch.inference_mode():
        if device.type == "cuda":
            with torch.autocast(device.type, dtype=torch.bfloat16):
                high_res_feats_0, high_res_feats_1, image_embed = enc(input_image)
        else:
            high_res_feats_0, high_res_feats_1, image_embed = enc(input_image)

    stride = int(getattr(sam, "backbone_stride", 16))
    embed_hw = int(sam.image_size) // stride
    mask_input_hw = 4 * embed_hw

    out: dict[str, Any] = {
        "model_id": model_id,
        "source": source,
        "device": str(device),
        "feature_layout": "sam2.1_cvat_decoder_onnx_v1",
        "orig_hw": [[int(full_h), int(full_w)]],
        "image_width": int(w_s),
        "image_height": int(h_s),
        "full_image_width": int(full_w),
        "full_image_height": int(full_h),
        "model_input_size": int(sam.image_size),
        "multimask_decoder": True,
        "mask_input_height": int(mask_input_hw),
        "mask_input_width": int(mask_input_hw),
        "image_embed": _pack_tensor_f32_b64(image_embed),
        "high_res_feats": [
            _pack_tensor_f32_b64(high_res_feats_0),
            _pack_tensor_f32_b64(high_res_feats_1),
        ],
    }
    predictor.reset_predictor()
    return out


def _make_sam2_model_class(mid: str):
    class _Sam2HieraVariant(InferenceModel):
        @property
        def model_id(self) -> str:
            return mid

        def predict(self, payload: dict[str, Any]) -> dict[str, Any]:
            source = payload.get("source")
            if not source or not isinstance(source, str):
                raise ValueError("payload['source'] is required (local path or image URL)")

            device = _predictor_device(payload.get("device"))
            multimask_output = bool(payload.get("multimask_output", False))
            normalize_coords = bool(payload.get("normalize_coords", True))

            pil = _load_image(source)
            w, h = pil.size

            point_xy = payload.get("point_xy")
            point_labels = payload.get("point_labels")
            box = payload.get("box")

            box_arr: np.ndarray | None
            if box is not None:
                box_arr = np.asarray(box, dtype=np.float64).reshape(4)
                point_coords = None
                plabs = None
            elif point_xy is not None:
                box_arr = None
                pc = np.asarray(point_xy, dtype=np.float64)
                if pc.ndim == 1:
                    pc = pc.reshape(1, 2)
                point_coords = pc
                if point_labels is not None:
                    plabs = np.asarray(point_labels, dtype=np.int64).reshape(-1)
                else:
                    plabs = np.ones(len(point_coords), dtype=np.int64)
            else:
                box_arr = None
                point_coords = np.array([[w / 2.0, h / 2.0]], dtype=np.float64)
                plabs = np.array([1], dtype=np.int64)

            predictor = _get_sam2_predictor(mid, device)

            def _run():
                predictor.set_image(pil)
                if box is not None:
                    return predictor.predict(
                        point_coords=None,
                        point_labels=None,
                        box=box_arr,
                        multimask_output=multimask_output,
                        return_logits=False,
                        normalize_coords=normalize_coords,
                    )
                return predictor.predict(
                    point_coords=point_coords,
                    point_labels=plabs,
                    box=None,
                    multimask_output=multimask_output,
                    return_logits=False,
                    normalize_coords=normalize_coords,
                )

            with torch.inference_mode():
                if device.type == "cuda":
                    with torch.autocast(device.type, dtype=torch.bfloat16):
                        masks, iou_predictions, _low = _run()
                else:
                    masks, iou_predictions, _low = _run()

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
                "prompt": {
                    "point_xy": None if box_arr is not None else point_coords.tolist(),
                    "point_labels": None if box_arr is not None else plabs.tolist(),
                    "box": box_arr.tolist() if box_arr is not None else None,
                },
                "multimask_output": multimask_output,
                "num_masks": c,
                "iou_predictions": [float(x) for x in iou_predictions],
                "best_mask_index": best_idx,
                "best_mask_foreground_pixels": int(fg),
                "best_mask_area_ratio": area_ratio,
            }

    return _Sam2HieraVariant


for _reg_id in SAM2_VARIANTS:
    register_model(_reg_id, lambda m=_reg_id: _make_sam2_model_class(m)())
