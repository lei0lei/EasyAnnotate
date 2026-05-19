"""DINOv2 ViT — `model_id` 与 `registry.json` 中 `dinov2/*.pth` 条目一致，随 registry 增减。"""

from __future__ import annotations

from io import BytesIO
from typing import Any

import torch
from PIL import Image
from torchvision import transforms

from app.model_resources import ensure_asset, iter_registry_weight_asset_ids
from app.models.base import InferenceModel
from app.models.registry import register_model
from app.models.torch_unload import dispose_torch_object, sync_gc_empty_cuda


_DINO_ORDER: tuple[str, ...] = (
    "dinov2/dinov2_vits14_pretrain",
    "dinov2/dinov2_vits14_reg4_pretrain",
    "dinov2/dinov2_vitb14_pretrain",
    "dinov2/dinov2_vitb14_reg4_pretrain",
    "dinov2/dinov2_vitl14_pretrain",
    "dinov2/dinov2_vitl14_reg4_pretrain",
)


def _iter_dinov2_pth_asset_ids() -> list[str]:
    ids = iter_registry_weight_asset_ids("dinov2/", extensions=(".pth",))
    pref_rank = {k: i for i, k in enumerate(_DINO_ORDER)}
    ids.sort(key=lambda x: (pref_rank.get(x, 1_000), x))
    return ids


DINOV2_VARIANTS: dict[str, str] = {k: k for k in _iter_dinov2_pth_asset_ids()}

_dinov2_models: dict[str, torch.nn.Module] = {}


def _load_image(source: str) -> Image.Image:
    s = source.strip()
    if s.startswith(("http://", "https://")):
        import urllib.request

        req = urllib.request.Request(s, headers={"User-Agent": "EasyAnnotate-dinov2/1.0"})
        with urllib.request.urlopen(req, timeout=60) as resp:  # noqa: S310
            data = resp.read()
        return Image.open(BytesIO(data)).convert("RGB")
    return Image.open(s).convert("RGB")


def _new_empty_backbone(model_id: str) -> torch.nn.Module:
    try:
        from dinov2.hub.backbones import (
            dinov2_vitb14,
            dinov2_vitb14_reg,
            dinov2_vitg14,
            dinov2_vitg14_reg,
            dinov2_vitl14,
            dinov2_vitl14_reg,
            dinov2_vits14,
            dinov2_vits14_reg,
        )
    except ImportError as e:
        raise ImportError(
            "dinov2 is not installed. Run install-ml-gpu-deps.ps1 in backend.",
        ) from e
    is_reg = "reg4" in model_id
    if "vits14" in model_id:
        return dinov2_vits14_reg(pretrained=False) if is_reg else dinov2_vits14(pretrained=False)
    if "vitb14" in model_id:
        return dinov2_vitb14_reg(pretrained=False) if is_reg else dinov2_vitb14(pretrained=False)
    if "vitl14" in model_id:
        return dinov2_vitl14_reg(pretrained=False) if is_reg else dinov2_vitl14(pretrained=False)
    if "vitg14" in model_id:
        return dinov2_vitg14_reg(pretrained=False) if is_reg else dinov2_vitg14(pretrained=False)
    raise ValueError(f"unknown DINOv2 model_id: {model_id}")


def _get_dinov2(model_id: str) -> torch.nn.Module:
    asset_id = DINOV2_VARIANTS.get(model_id)
    if asset_id is None:
        raise ValueError(f"unknown DINOv2 model_id: {model_id}")
    cached = _dinov2_models.get(model_id)
    if cached is not None:
        return cached
    ckpt = ensure_asset(asset_id)
    model = _new_empty_backbone(model_id)
    try:
        state_dict = torch.load(str(ckpt), map_location="cpu", weights_only=True)
    except TypeError:
        state_dict = torch.load(str(ckpt), map_location="cpu")
    model.load_state_dict(state_dict, strict=True)
    _dinov2_models[model_id] = model
    return model


def warmup_dinov2(model_id: str, use_gpu: bool = True) -> None:
    m = _get_dinov2(model_id)
    if use_gpu and torch.cuda.is_available():
        m.to(0)
    else:
        m.to("cpu")


def unload_dinov2(model_id: str | None = None) -> None:
    global _dinov2_models
    if not _dinov2_models:
        sync_gc_empty_cuda()
        return
    if model_id is None:
        to_drop = list(_dinov2_models.values())
        _dinov2_models.clear()
    elif model_id in _dinov2_models:
        to_drop = [_dinov2_models.pop(model_id)]
    else:
        to_drop = []
    for v in to_drop:
        dispose_torch_object(v)
    del to_drop
    sync_gc_empty_cuda()


def _make_transform(img_size: int = 518):
    return transforms.Compose(
        [
            transforms.Resize(img_size, interpolation=transforms.InterpolationMode.BICUBIC),
            transforms.CenterCrop(img_size),
            transforms.ToTensor(),
            transforms.Normalize(mean=(0.485, 0.456, 0.406), std=(0.229, 0.224, 0.225)),
        ],
    )


def _make_dinov2_class(mid: str):
    class _Dinov2Model(InferenceModel):
        @property
        def model_id(self) -> str:
            return mid

        def predict(self, payload: dict[str, Any]) -> dict[str, Any]:
            source = payload.get("source")
            if not source or not isinstance(source, str):
                raise ValueError("payload['source'] is required (local path or image URL)")

            raw_device = payload.get("device")
            if raw_device is None:
                device: str | int | torch.device = 0 if torch.cuda.is_available() else "cpu"
            else:
                device = raw_device

            img_size = int(payload.get("img_size", 518))

            model = _get_dinov2(mid).to(device)
            model.eval()
            pil = _load_image(source)
            x = _make_transform(img_size)(pil).unsqueeze(0).to(device)

            with torch.inference_mode():
                feats = model.forward_features(x)

            clst = feats["x_norm_clstoken"][0].float().cpu()
            patches = feats["x_norm_patchtokens"][0].float().cpu()

            return {
                "model_id": mid,
                "source": source,
                "device": str(device),
                "img_size": img_size,
                "cls_embedding": {
                    "dim": int(clst.numel()),
                    "mean": float(clst.mean()),
                    "std": float(clst.std()),
                    "l2": float(torch.norm(clst)),
                    "head_dims": clst[:16].tolist(),
                },
                "patch_tokens": {
                    "count": int(patches.shape[0]),
                    "dim": int(patches.shape[-1]),
                    "mean": float(patches.mean()),
                    "std": float(patches.std()),
                },
            }

    return _Dinov2Model


for _did in DINOV2_VARIANTS:
    register_model(_did, lambda m=_did: _make_dinov2_class(m)())
