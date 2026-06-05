"""Prompt coordinate mapping for CVAT-aligned SAM decoders."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

import torch


def _clamp_int(n: float, lo: int, hi: int) -> int:
    return int(min(hi, max(lo, round(n))))


def _to_model_space(x: float, y: float, iw: int, ih: int, res: int) -> tuple[float, float]:
    return (x / iw) * res, (y / ih) * res


def _to_mobile_sam_model_space(x: float, y: float, iw: int, ih: int, res: int) -> tuple[float, float]:
    scale = res / max(ih, iw, 1)
    new_w = round(iw * scale)
    new_h = round(ih * scale)
    return (x / iw) * new_w, (y / ih) * new_h


def prompt_to_model_space(
    x: float,
    y: float,
    iw: int,
    ih: int,
    res: int,
    feature_layout: str,
) -> tuple[float, float]:
    if feature_layout == "mobile_sam_cvat_decoder_onnx_v1":
        return _to_mobile_sam_model_space(x, y, iw, ih, res)
    return _to_model_space(x, y, iw, ih, res)


@dataclass(frozen=True)
class SamPointPrompt:
    x: int
    y: int
    label: Literal[0, 1]


@dataclass(frozen=True)
class SamBboxPrompt:
    x1: int
    y1: int
    x2: int
    y2: int


def map_full_image_prompt_to_encode(
    *,
    feature_layout: str,
    enc_w: int,
    enc_h: int,
    full_w: int,
    full_h: int,
    model_input_size: int,
    prompt_mode: Literal["point", "bbox"],
    points: list[SamPointPrompt],
    bbox: SamBboxPrompt | None,
) -> tuple[torch.Tensor, torch.Tensor]:
    """Map full-image prompts to model-space point_coords / point_labels tensors."""
    iw = enc_w
    ih = enc_h
    iwm = max(0, iw - 1)
    ihm = max(0, ih - 1)
    res = model_input_size

    def to_enc_px(x_full: float, y_full: float) -> tuple[int, int]:
        x_enc = _clamp_int((x_full * iw) / max(1, full_w), 0, iwm)
        y_enc = _clamp_int((y_full * ih) / max(1, full_h), 0, ihm)
        return x_enc, y_enc

    coords_flat: list[float] = []
    labels_flat: list[float] = []

    if prompt_mode == "bbox":
        if bbox is None:
            raise ValueError("bbox prompt required")
        x1, y1 = to_enc_px(bbox.x1, bbox.y1)
        x2, y2 = to_enc_px(bbox.x2, bbox.y2)
        if x2 < x1:
            x1, x2 = x2, x1
        if y2 < y1:
            y1, y2 = y2, y1
        a = prompt_to_model_space(float(x1), float(y1), iw, ih, res, feature_layout)
        b = prompt_to_model_space(float(x2), float(y2), iw, ih, res, feature_layout)
        coords_flat.extend([a[0], a[1], b[0], b[1], 0.0, 0.0])
        labels_flat.extend([2.0, 3.0, -1.0])
    else:
        if not points:
            raise ValueError("point prompt required")
        for p in points:
            x_enc, y_enc = to_enc_px(float(p.x), float(p.y))
            m = prompt_to_model_space(float(x_enc), float(y_enc), iw, ih, res, feature_layout)
            coords_flat.extend([m[0], m[1]])
            labels_flat.append(float(p.label))
        coords_flat.extend([0.0, 0.0])
        labels_flat.append(-1.0)

    n = len(labels_flat)
    point_coords = torch.tensor(coords_flat, dtype=torch.float32).reshape(1, n, 2)
    point_labels = torch.tensor(labels_flat, dtype=torch.float32).reshape(1, n)
    return point_coords, point_labels
