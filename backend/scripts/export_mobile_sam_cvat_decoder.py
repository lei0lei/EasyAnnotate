#!/usr/bin/env python3
"""
为 MobileSAM 权重导出与 SAM2.1 CVAT 导出一致的 ``*.decoder.onnx``（裁剪 mask + xtl/ytl/…）。

用法（在 backend/ 下）:
  ./python-embed/python.exe scripts/export_mobile_sam_cvat_decoder.py --asset-id mobile_sam/vit_t
"""
from __future__ import annotations

import argparse
import json
import pathlib
import sys

import torch
from torch import nn

_BACKEND_ROOT = pathlib.Path(__file__).resolve().parents[1]
if str(_BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(_BACKEND_ROOT))

from app.models.impl.mobile_sam_cvat_decoder import MobileSamImageDecoder  # noqa: E402

MOBILE_SAM_ASSET_IDS: tuple[str, ...] = ("mobile_sam/vit_t",)


def _backend_root() -> pathlib.Path:
    return pathlib.Path(__file__).resolve().parents[1]


def _resources_root() -> pathlib.Path:
    return _backend_root() / "external" / "resources"


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


def export_one(*, checkpoint: pathlib.Path, opset: int, multimask_output: bool) -> pathlib.Path:
    from mobile_sam.build_sam import build_sam_vit_t

    if not checkpoint.is_file():
        raise FileNotFoundError(checkpoint)

    out_decoder = checkpoint.with_name(checkpoint.stem + ".decoder.onnx")
    sam = build_sam_vit_t(checkpoint=str(checkpoint))
    sam.eval()

    input_size = int(sam.image_encoder.img_size)
    embed_dim = sam.prompt_encoder.embed_dim
    embed_size = input_size // 16
    mask_input_size = 4 * embed_size
    print("embed_dim", embed_dim, "embed_size", embed_size, "mask_input_size", mask_input_size)

    image_embed = torch.randn(1, embed_dim, embed_size, embed_size)
    point_coords = torch.randint(low=0, high=input_size, size=(1, 5, 2), dtype=torch.float32)
    point_labels = torch.randint(low=0, high=2, size=(1, 5), dtype=torch.float32)
    mask_input = torch.randn(1, 1, mask_input_size, mask_input_size, dtype=torch.float32)
    has_mask_input = torch.tensor([0.0], dtype=torch.float32)
    orig_im_size = torch.tensor([input_size, input_size], dtype=torch.int32)

    decoder = MobileSamImageDecoder(sam, multimask_output=multimask_output).cpu()
    out_decoder.parent.mkdir(parents=True, exist_ok=True)

    _onnx_kw = dict(
        dynamo=False,
        external_data=False,
        export_params=True,
        opset_version=opset,
        do_constant_folding=True,
    )

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
        **_onnx_kw,
    )
    print("Saved decoder ONNX:", out_decoder)
    return out_decoder


def main() -> None:
    parser = argparse.ArgumentParser(description="Export MobileSAM CVAT-style decoder ONNX.")
    parser.add_argument("--asset-id", type=str, default="mobile_sam/vit_t")
    parser.add_argument("--checkpoint", type=str, help="直接指定 .pt 路径")
    parser.add_argument("--opset", type=int, default=17)
    parser.add_argument(
        "--single-mask",
        action="store_true",
        help="导出 single-mask 分支（默认 multimask_output=True）",
    )
    args = parser.parse_args()

    try:
        from mobile_sam.build_sam import build_sam_vit_t  # noqa: F401
    except ImportError:
        print("错误: 无法 import mobile_sam。请在 backend ML 环境中安装 mobile_sam。", file=sys.stderr)
        raise SystemExit(1) from None

    if args.checkpoint:
        ckpt = pathlib.Path(args.checkpoint).resolve()
    else:
        registry = _load_registry()
        ckpt = _checkpoint_for_asset(registry, args.asset_id)

    if not ckpt.is_file():
        print(f"跳过（无权重文件）: {ckpt}", file=sys.stderr)
        raise SystemExit(1)

    export_one(checkpoint=ckpt, opset=args.opset, multimask_output=not args.single_mask)


if __name__ == "__main__":
    main()
