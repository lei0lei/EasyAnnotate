"""DINOv2 letterbox patch features for browser-side similarity search."""

from __future__ import annotations

import base64
import math
from dataclasses import asdict, dataclass
from typing import Any

import numpy as np
import torch
from PIL import Image

from app.models.impl.dinov2_variants import DINOV2_VARIANTS, _get_dinov2, _load_image, _make_transform


@dataclass(frozen=True)
class LetterboxMeta:
    orig_w: int
    orig_h: int
    scale: float
    pad_x: int
    pad_y: int
    letter_w: int
    letter_h: int
    img_size: int


def _letterbox_pil(pil: Image.Image, img_size: int) -> tuple[Image.Image, LetterboxMeta]:
    orig_w, orig_h = pil.size
    if orig_w <= 0 or orig_h <= 0:
        raise ValueError("invalid image size")
    scale = img_size / float(max(orig_w, orig_h))
    letter_w = max(1, int(round(orig_w * scale)))
    letter_h = max(1, int(round(orig_h * scale)))
    try:
        resample = Image.Resampling.BILINEAR  # type: ignore[attr-defined]
    except AttributeError:
        resample = Image.BILINEAR  # type: ignore[attr-defined]
    resized = pil.resize((letter_w, letter_h), resample)
    canvas = Image.new("RGB", (img_size, img_size), (0, 0, 0))
    pad_x = (img_size - letter_w) // 2
    pad_y = (img_size - letter_h) // 2
    canvas.paste(resized, (pad_x, pad_y))
    return canvas, LetterboxMeta(
        orig_w=orig_w,
        orig_h=orig_h,
        scale=scale,
        pad_x=pad_x,
        pad_y=pad_y,
        letter_w=letter_w,
        letter_h=letter_h,
        img_size=img_size,
    )


def _patch_grid_size(img_size: int, patch_size: int = 14) -> tuple[int, int]:
    gh = img_size // patch_size
    gw = img_size // patch_size
    return gh, gw


def _pack_f32_b64(arr: np.ndarray) -> dict[str, Any]:
    flat = np.ascontiguousarray(arr, dtype=np.float32)
    return {
        "dtype": "float32",
        "shape": [int(x) for x in flat.shape],
        "encoding": "le-raw",
        "data_base64": base64.standard_b64encode(flat.tobytes()).decode("ascii"),
    }


def dinov2_extract_patch_features(model_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    """Full-image DINOv2 patch tokens on letterboxed input (for client-side similarity)."""
    if model_id not in DINOV2_VARIANTS:
        raise ValueError(f"unknown DINOv2 model_id: {model_id}")

    source = payload.get("source")
    if not source or not isinstance(source, str):
        raise ValueError("payload['source'] is required")

    raw_device = payload.get("device")
    if raw_device is None:
        device: str | int | torch.device = 0 if torch.cuda.is_available() else "cpu"
    else:
        device = raw_device

    img_size = int(payload.get("img_size", 518))
    img_size = max(224, min(1024, img_size))

    pil = _load_image(source)
    letterboxed, meta = _letterbox_pil(pil, img_size)

    model = _get_dinov2(model_id).to(device)
    model.eval()
    x = _make_transform(img_size)(letterboxed).unsqueeze(0).to(device)
    with torch.inference_mode():
        feats = model.forward_features(x)
    patches = feats["x_norm_patchtokens"][0].float().cpu().numpy()

    gh, gw = _patch_grid_size(img_size, 14)
    expected = gh * gw
    if patches.shape[0] != expected:
        gh = int(round(math.sqrt(patches.shape[0])))
        gw = max(1, patches.shape[0] // gh)

    dim = int(patches.shape[-1])
    grid = patches.reshape(gh, gw, dim).astype(np.float32)

    return {
        "model_id": model_id,
        "source": source,
        "device": str(device),
        "img_size": img_size,
        "grid_h": gh,
        "grid_w": gw,
        "dim": dim,
        "letterbox": asdict(meta),
        "patch_features": _pack_f32_b64(grid),
    }
