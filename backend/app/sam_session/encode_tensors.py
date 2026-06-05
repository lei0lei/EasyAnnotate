"""In-memory SAM image encoder outputs for server-side decode sessions."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import torch

from app.models.impl.mobile_sam_variants import MOBILE_SAM_VARIANTS, _get_predictor as _get_mobile_predictor
from app.models.impl.mobile_sam_variants import _load_image_pil as _load_mobile_image_pil
from app.models.impl.mobile_sam_variants import _predictor_device as _mobile_predictor_device
from app.models.impl.sam2_cvat_encoder import SAM2ImageEncoder
from app.models.impl.sam2_hiera_variants import SAM2_VARIANTS, _get_sam2_predictor, _load_image, _predictor_device
from app.sam_session.mask_geometry import clamp_infer_scale


@dataclass
class SamEncodeBundle:
    model_id: str
    feature_layout: str
    device: torch.device
    source: str
    infer_scale: float
    full_w: int
    full_h: int
    enc_w: int
    enc_h: int
    model_input_size: int
    mask_input_h: int
    mask_input_w: int
    image_embed: torch.Tensor
    high_res_feats_0: torch.Tensor | None
    high_res_feats_1: torch.Tensor | None


def _resize_pil(pil: Any, w_s: int, h_s: int) -> Any:
    from PIL import Image

    if (w_s, h_s) == pil.size:
        return pil
    try:
        resample = Image.Resampling.BILINEAR  # type: ignore[attr-defined]
    except AttributeError:
        resample = Image.BILINEAR  # type: ignore[attr-defined]
    return pil.resize((w_s, h_s), resample)


def encode_sam2_tensors(model_id: str, payload: dict[str, Any]) -> SamEncodeBundle:
    if model_id not in SAM2_VARIANTS:
        raise ValueError(f"unknown SAM2 model_id: {model_id}")
    source = payload.get("source")
    if not source or not isinstance(source, str):
        raise ValueError("payload['source'] is required (local path or image URL)")

    device = _predictor_device(payload.get("device"))
    pil = _load_image(source)
    full_w, full_h = pil.size
    scale = clamp_infer_scale(payload.get("infer_scale", 1.0))
    w_s = max(1, int(round(full_w * scale)))
    h_s = max(1, int(round(full_h * scale)))
    pil = _resize_pil(pil, w_s, h_s)

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

    predictor.reset_predictor()

    return SamEncodeBundle(
        model_id=model_id,
        feature_layout="sam2.1_cvat_decoder_onnx_v1",
        device=device,
        source=source,
        infer_scale=scale,
        full_w=int(full_w),
        full_h=int(full_h),
        enc_w=int(w_s),
        enc_h=int(h_s),
        model_input_size=int(sam.image_size),
        mask_input_h=int(mask_input_hw),
        mask_input_w=int(mask_input_hw),
        image_embed=image_embed.detach(),
        high_res_feats_0=high_res_feats_0.detach(),
        high_res_feats_1=high_res_feats_1.detach(),
    )


def encode_mobile_sam_tensors(model_id: str, payload: dict[str, Any]) -> SamEncodeBundle:
    if model_id not in MOBILE_SAM_VARIANTS:
        raise ValueError(f"unknown MobileSAM model_id: {model_id}")
    source = payload.get("source")
    if not source or not isinstance(source, str):
        raise ValueError("payload['source'] is required (local path or image URL)")

    import numpy as np

    device = _mobile_predictor_device(payload.get("device"))
    pil = _load_mobile_image_pil(source)
    full_w, full_h = pil.size
    scale = clamp_infer_scale(payload.get("infer_scale", 1.0))
    w_s = max(1, int(round(full_w * scale)))
    h_s = max(1, int(round(full_h * scale)))
    pil = _resize_pil(pil, w_s, h_s)

    image_np = np.array(pil)
    predictor = _get_mobile_predictor(model_id, device)
    img_size = int(predictor.model.image_encoder.img_size)
    input_image = predictor.transform.apply_image(image_np)
    input_image_torch = torch.as_tensor(input_image, device=device).permute(2, 0, 1).contiguous()[None, :, :, :]
    input_image_torch = predictor.model.preprocess(input_image_torch)

    with torch.inference_mode():
        features = predictor.model.image_encoder(input_image_torch)

    embed_hw = img_size // 16
    mask_input_hw = 4 * embed_hw

    return SamEncodeBundle(
        model_id=model_id,
        feature_layout="mobile_sam_cvat_decoder_onnx_v1",
        device=device,
        source=source,
        infer_scale=scale,
        full_w=int(full_w),
        full_h=int(full_h),
        enc_w=int(w_s),
        enc_h=int(h_s),
        model_input_size=img_size,
        mask_input_h=int(mask_input_hw),
        mask_input_w=int(mask_input_hw),
        image_embed=features.detach(),
        high_res_feats_0=None,
        high_res_feats_1=None,
    )


def encode_image_tensors(model_id: str, payload: dict[str, Any]) -> SamEncodeBundle:
    if model_id.startswith("sam2/"):
        return encode_sam2_tensors(model_id, payload)
    if model_id.startswith("mobile_sam/"):
        return encode_mobile_sam_tensors(model_id, payload)
    raise ValueError("encode session is only supported for sam2/* and mobile_sam/* model_id")
