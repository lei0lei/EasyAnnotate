"""Mask geometry helpers for SAM session decode (contour, bbox, upscale)."""

from __future__ import annotations

from typing import Any

import cv2
import numpy as np


def clamp_infer_scale(raw: Any) -> float:
    try:
        scale = float(raw)
    except (TypeError, ValueError):
        scale = 1.0
    return max(0.3, min(1.0, scale))


def polygon_contour_options(vertex_bias_0_100: int) -> tuple[float, int]:
    t = max(0, min(100, round(vertex_bias_0_100))) / 100.0
    rdp_epsilon = 8.5 - (8.5 - 0.22) * t
    max_points = max(24, int(36 + t * 620))
    return rdp_epsilon, max_points


def upscale_binary_nearest(src: np.ndarray, sw: int, sh: int, fw: int, fh: int) -> np.ndarray:
    if sw <= 0 or sh <= 0 or fw <= 0 or fh <= 0:
        return np.zeros((max(0, fh), max(0, fw)), dtype=np.uint8)
    flat = src.reshape(sh, sw).astype(np.uint8, copy=False)
    if sw == fw and sh == fh:
        return flat
    return cv2.resize(flat, (fw, fh), interpolation=cv2.INTER_NEAREST)


def normalize_annotation_polygon(ring: list[list[int]] | None) -> list[list[int]] | None:
    """Open ring in image pixel coords, >=3 vertices, ready for polygon shape commit."""
    if not ring or len(ring) < 3:
        return None
    out: list[list[int]] = []
    for p in ring:
        if len(p) < 2:
            continue
        out.append([int(p[0]), int(p[1])])
    if len(out) < 3:
        return None
    if len(out) >= 2 and out[0] == out[-1]:
        out = out[:-1]
    if len(out) < 3:
        return None
    return out


def mask_has_foreground(data: np.ndarray) -> bool:
    return bool(data.size > 0 and np.any(data))


def foreground_bbox_inclusive(data: np.ndarray, w: int, h: int) -> dict[str, int] | None:
    ys, xs = np.nonzero(data.reshape(h, w))
    if xs.size == 0:
        return None
    return {
        "x1": int(xs.min()),
        "y1": int(ys.min()),
        "x2": int(xs.max()),
        "y2": int(ys.max()),
    }


def mask_to_polygon(data: np.ndarray, w: int, h: int, rdp_epsilon: float, max_points: int) -> list[list[int]] | None:
    flat = data.reshape(h, w).astype(np.uint8)
    if not mask_has_foreground(flat):
        return None
    contours, _ = cv2.findContours(flat, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    if not contours:
        return None
    cnt = max(contours, key=cv2.contourArea)
    if cnt.shape[0] < 3:
        return None
    approx = cv2.approxPolyDP(cnt, float(rdp_epsilon), True)
    if approx.shape[0] < 3:
        approx = cnt
    ring: list[list[int]] = [[int(p[0][0]), int(p[0][1])] for p in approx]
    if len(ring) > max_points:
        step = max(1, len(ring) // max_points)
        ring = ring[::step]
        if len(ring) < 3:
            return None
    if len(ring) >= 2 and ring[0] == ring[-1]:
        ring = ring[:-1]
    if len(ring) < 3:
        return None
    return ring
