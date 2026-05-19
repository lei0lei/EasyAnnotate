#!/usr/bin/env python3
"""
为 EfficientSAM 权重导出与 SAM2.1 / MobileSAM 一致的 ``*.decoder.onnx``（裁剪 mask + xtl/ytl/…）。

用法（在 backend/ 下）:
  ./python-embed/python.exe scripts/export_efficient_sam_cvat_decoder.py --asset-id efficient_sam/vitt
"""
from __future__ import annotations

import argparse
import json
import pathlib
import sys

import torch

_BACKEND_ROOT = pathlib.Path(__file__).resolve().parents[1]
if str(_BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(_BACKEND_ROOT))

from app.models.impl.efficient_sam_cvat_decoder import EfficientSamImageDecoder  # noqa: E402
from app.models.impl.efficient_sam_variants import (  # noqa: E402
    _build_efficient_sam_for_checkpoint,
    _efficient_encoder_spec,
)

EFFICIENT_SAM_ASSET_IDS: tuple[str, ...] = ("efficient_sam/vitt",)


def _resources_root() -> pathlib.Path:
    return _BACKEND_ROOT / "external" / "resources"


def _load_registry() -> dict:
    p = _resources_root() / "registry.json"
    with p.open(encoding="utf-8") as f:
        return json.load(f)


def _checkpoint_for_asset(registry: dict, asset_id: str) -> pathlib.Path:
    assets = registry.get("assets") or {}
    meta = assets.get(asset_id)
    if not isinstance(meta, dict):
        raise SystemExit(f"registry.json 中未找到 assets[{asset_id!r}]")
    rel = meta.get("relative_path")
    if not isinstance(rel, str) or not rel.strip():
        raise SystemExit(f"{asset_id} 缺少 relative_path")
    return (_resources_root() / rel.replace("\\", "/")).resolve()


def export_one(*, asset_id: str, checkpoint: pathlib.Path, opset: int) -> pathlib.Path:
    if not checkpoint.is_file():
        raise FileNotFoundError(checkpoint)

    out_decoder = checkpoint.with_name(checkpoint.stem + ".decoder.onnx")
    sam = _build_efficient_sam_for_checkpoint(asset_id, str(checkpoint), torch.device("cpu"))

    input_size = int(sam.image_encoder.img_size)
    embed_dim = sam.image_encoder.transformer_output_dim
    embed_size = input_size // 16
    mask_input_size = 4 * embed_size
    print("embed_dim", embed_dim, "embed_size", embed_size, "mask_input_size", mask_input_size)

    image_embed = torch.randn(1, embed_dim, embed_size, embed_size)
    point_coords = torch.randint(low=0, high=input_size, size=(1, 5, 2), dtype=torch.float32)
    point_labels = torch.tensor([[1.0, 1.0, -1.0, -1.0, -1.0]], dtype=torch.float32)
    mask_input = torch.randn(1, 1, mask_input_size, mask_input_size, dtype=torch.float32)
    has_mask_input = torch.tensor([0.0], dtype=torch.float32)
    orig_im_size = torch.tensor([480, 640], dtype=torch.int32)

    decoder = EfficientSamImageDecoder(sam, multimask_output=True).cpu()
    out_decoder.parent.mkdir(parents=True, exist_ok=True)

    torch.onnx.export(
        decoder,
        (image_embed, point_coords, point_labels, orig_im_size, mask_input, has_mask_input),
        str(out_decoder),
        input_names=[
            "image_embed",
            "point_coords",
            "point_labels",
            "orig_im_size",
            "mask_input",
            "has_mask_input",
        ],
        output_names=["masks", "iou_predictions", "low_res_masks", "xtl", "ytl", "xbr", "ybr"],
        dynamic_axes={
            "point_coords": {0: "num_labels", 1: "num_points"},
            "point_labels": {0: "num_labels", 1: "num_points"},
            "mask_input": {0: "num_labels"},
            "has_mask_input": {0: "num_labels"},
        },
        dynamo=False,
        external_data=False,
        export_params=True,
        opset_version=opset,
        do_constant_folding=True,
    )
    print("Saved decoder ONNX:", out_decoder)
    return out_decoder


def main() -> None:
    parser = argparse.ArgumentParser(description="Export EfficientSAM CVAT-style decoder ONNX.")
    parser.add_argument("--asset-id", type=str, default="efficient_sam/vitt")
    parser.add_argument("--checkpoint", type=str, help="直接指定 .pt 路径")
    parser.add_argument("--opset", type=int, default=17)
    args = parser.parse_args()

    try:
        from efficient_sam.efficient_sam import build_efficient_sam  # noqa: F401
    except ImportError:
        print("错误: 无法 import efficient_sam。请在 backend ML 环境中安装。", file=sys.stderr)
        raise SystemExit(1) from None

    asset_id = args.asset_id
    if args.checkpoint:
        ckpt = pathlib.Path(args.checkpoint).resolve()
    else:
        registry = _load_registry()
        if asset_id not in registry.get("assets", {}):
            # 允许未写入 registry 时按约定路径查找
            ckpt = _resources_root() / "efficientsam" / "efficient_sam_vitt.pt"
        else:
            ckpt = _checkpoint_for_asset(registry, asset_id)

    if not ckpt.is_file():
        print(f"跳过（无权重文件）: {ckpt}", file=sys.stderr)
        raise SystemExit(1)

    _ = _efficient_encoder_spec(asset_id)
    export_one(asset_id=asset_id, checkpoint=ckpt, opset=args.opset)


if __name__ == "__main__":
    main()
