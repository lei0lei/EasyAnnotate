"""Server-side SAM CVAT decoder inference from cached encode tensors."""

from __future__ import annotations

import base64
from dataclasses import dataclass
from typing import Literal

import numpy as np
import torch

from app.models.impl.mobile_sam_cvat_decoder import MobileSamImageDecoder
from app.models.impl.mobile_sam_variants import _device_cache_key, _get_predictor as _get_mobile_predictor
from app.models.impl.sam2_cvat_decoder import SAM2ImageDecoder
from app.models.impl.sam2_hiera_variants import _device_cache_key as _sam2_device_cache_key
from app.models.impl.sam2_hiera_variants import _get_sam2_predictor
from app.sam_session.encode_tensors import SamEncodeBundle
from app.sam_session.mask_geometry import (
    foreground_bbox_inclusive,
    mask_has_foreground,
    mask_to_polygon,
    normalize_annotation_polygon,
    polygon_contour_options,
    upscale_binary_nearest,
)
from app.sam_session.prompt import SamBboxPrompt, SamPointPrompt, map_full_image_prompt_to_encode

_sam2_decoders: dict[tuple[str, str], SAM2ImageDecoder] = {}
_mobile_decoders: dict[tuple[str, str], MobileSamImageDecoder] = {}


def _get_sam2_decoder(model_id: str, device: torch.device) -> SAM2ImageDecoder:
    key = (model_id, _sam2_device_cache_key(device))
    hit = _sam2_decoders.get(key)
    if hit is not None:
        return hit
    predictor = _get_sam2_predictor(model_id, device)
    dec = SAM2ImageDecoder(predictor.model, multimask_output=True).to(device).eval()
    _sam2_decoders[key] = dec
    return dec


def _get_mobile_decoder(model_id: str, device: torch.device) -> MobileSamImageDecoder:
    key = (model_id, _device_cache_key(device))
    hit = _mobile_decoders.get(key)
    if hit is not None:
        return hit
    predictor = _get_mobile_predictor(model_id, device)
    dec = MobileSamImageDecoder(predictor.model, multimask_output=True).to(device).eval()
    _mobile_decoders[key] = dec
    return dec


@dataclass(frozen=True)
class SamDecodeResult:
    ok: bool
    pred_iou: float | None
    polygon: list[list[int]] | None
    bbox: dict[str, int] | None
    message: str | None = None
    mask_base64: str | None = None
    mask_width: int | None = None
    mask_height: int | None = None


def _mask_input_tensors(bundle: SamEncodeBundle, device: torch.device) -> tuple[torch.Tensor, torch.Tensor]:
    mh = bundle.mask_input_h
    mw = bundle.mask_input_w
    mask_input = torch.zeros((1, 1, mh, mw), dtype=torch.float32, device=device)
    has_mask_input = torch.zeros((1,), dtype=torch.float32, device=device)
    return mask_input, has_mask_input


def _run_sam2_decode(
    bundle: SamEncodeBundle,
    point_coords: torch.Tensor,
    point_labels: torch.Tensor,
) -> tuple[np.ndarray, float | None]:
    device = bundle.device
    dec = _get_sam2_decoder(bundle.model_id, device)
    orig_im = torch.tensor([bundle.enc_h, bundle.enc_w], dtype=torch.int32, device=device)
    mask_input, has_mask_input = _mask_input_tensors(bundle, device)

    with torch.inference_mode():
        if device.type == "cuda":
            with torch.autocast(device.type, dtype=torch.bfloat16):
                full_binary, pred_iou = dec(
                    bundle.image_embed.to(device),
                    bundle.high_res_feats_0.to(device),  # type: ignore[union-attr]
                    bundle.high_res_feats_1.to(device),  # type: ignore[union-attr]
                    point_coords.to(device),
                    point_labels.to(device),
                    orig_im,
                    mask_input,
                    has_mask_input,
                )
        else:
            full_binary, pred_iou = dec(
                bundle.image_embed.to(device),
                bundle.high_res_feats_0.to(device),  # type: ignore[union-attr]
                bundle.high_res_feats_1.to(device),  # type: ignore[union-attr]
                point_coords.to(device),
                point_labels.to(device),
                orig_im,
                mask_input,
                has_mask_input,
            )

    mask_np = full_binary.detach().cpu().numpy().astype(np.uint8)
    iou = float(pred_iou.detach().cpu().item()) if pred_iou is not None else None
    return mask_np, iou


def _run_mobile_decode(
    bundle: SamEncodeBundle,
    point_coords: torch.Tensor,
    point_labels: torch.Tensor,
) -> tuple[np.ndarray, float | None]:
    device = bundle.device
    dec = _get_mobile_decoder(bundle.model_id, device)
    orig_im = torch.tensor([bundle.enc_h, bundle.enc_w], dtype=torch.int32, device=device)
    mask_input, has_mask_input = _mask_input_tensors(bundle, device)

    with torch.inference_mode():
        out = dec(
            bundle.image_embed.to(device),
            point_coords.to(device),
            point_labels.to(device),
            orig_im,
            mask_input,
            has_mask_input,
        )
    _cropped, iou_t, _best_low, xtl, ytl, xbr, ybr = out
    iou = float(iou_t.detach().cpu().reshape(-1)[0].item())

    crop = (_cropped.squeeze() > 0).detach().cpu().numpy().astype(np.uint8)
    ch, cw = crop.shape
    full = np.zeros((bundle.enc_h, bundle.enc_w), dtype=np.uint8)
    y0 = int(ytl.item())
    x0 = int(xtl.item())
    y1 = min(bundle.enc_h, y0 + ch)
    x1 = min(bundle.enc_w, x0 + cw)
    if y1 > y0 and x1 > x0:
        full[y0:y1, x0:x1] = crop[: y1 - y0, : x1 - x0]
    return full, iou


def decode_session_prompt(
    bundle: SamEncodeBundle,
    *,
    prompt_mode: Literal["point", "bbox"],
    points: list[SamPointPrompt],
    bbox: SamBboxPrompt | None,
    min_pred_iou: float | None,
    polygon_vertex_bias: int,
    include_mask: bool = False,
    include_polygon: bool = True,
) -> SamDecodeResult:
    if prompt_mode == "point" and not points:
        return SamDecodeResult(ok=False, pred_iou=None, polygon=None, bbox=None, message="empty point prompt")

    point_coords, point_labels = map_full_image_prompt_to_encode(
        feature_layout=bundle.feature_layout,
        enc_w=bundle.enc_w,
        enc_h=bundle.enc_h,
        full_w=bundle.full_w,
        full_h=bundle.full_h,
        model_input_size=bundle.model_input_size,
        prompt_mode=prompt_mode,
        points=points,
        bbox=bbox,
    )

    if bundle.feature_layout == "sam2.1_cvat_decoder_onnx_v1":
        enc_mask, pred_iou = _run_sam2_decode(bundle, point_coords, point_labels)
    elif bundle.feature_layout == "mobile_sam_cvat_decoder_onnx_v1":
        enc_mask, pred_iou = _run_mobile_decode(bundle, point_coords, point_labels)
    else:
        raise ValueError(f"unsupported feature_layout: {bundle.feature_layout}")

    if pred_iou is not None and min_pred_iou is not None and min_pred_iou > 0 and pred_iou < min_pred_iou:
        return SamDecodeResult(
            ok=False,
            pred_iou=pred_iou,
            polygon=None,
            bbox=None,
            message="prediction IoU below threshold",
        )

    if not mask_has_foreground(enc_mask):
        return SamDecodeResult(
            ok=False,
            pred_iou=pred_iou,
            polygon=None,
            bbox=None,
            message="no foreground in mask",
        )

    full_mask = upscale_binary_nearest(enc_mask, bundle.enc_w, bundle.enc_h, bundle.full_w, bundle.full_h)
    if not mask_has_foreground(full_mask):
        return SamDecodeResult(
            ok=False,
            pred_iou=pred_iou,
            polygon=None,
            bbox=None,
            message="no foreground after upscale",
        )

    bbox_out = foreground_bbox_inclusive(full_mask, bundle.full_w, bundle.full_h)
    polygon: list[list[int]] | None = None
    if include_polygon:
        rdp_eps, max_pts = polygon_contour_options(polygon_vertex_bias)
        raw_poly = mask_to_polygon(full_mask, bundle.full_w, bundle.full_h, rdp_eps, max_pts)
        polygon = normalize_annotation_polygon(raw_poly)

    mask_b64: str | None = None
    if include_mask:
        mask_b64 = base64.standard_b64encode(full_mask.tobytes()).decode("ascii")

    if include_polygon:
        if polygon is None:
            return SamDecodeResult(
                ok=False,
                pred_iou=pred_iou,
                polygon=None,
                bbox=bbox_out,
                message="could not derive annotation polygon",
            )
    elif bbox_out is None and not include_mask:
        return SamDecodeResult(
            ok=False,
            pred_iou=pred_iou,
            polygon=None,
            bbox=None,
            message="could not derive bbox",
        )

    return SamDecodeResult(
        ok=True,
        pred_iou=pred_iou,
        polygon=polygon,
        bbox=bbox_out,
        message=None,
        mask_base64=mask_b64,
        mask_width=bundle.full_w if include_mask else None,
        mask_height=bundle.full_h if include_mask else None,
    )
