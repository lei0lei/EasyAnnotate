#!/usr/bin/env python3
"""
为每个 SAM2.1 Hiera 权重导出与 hashJoe/samexporter（cvat 分支）一致的 ONNX 解码器，
输出文件与 .pt 同目录：例如 sam2/sam2.1_hiera_tiny.decoder.onnx

依赖：使用 backend/python-embed/python.exe 所在环境；需已安装 torch、onnx、onnxscript
（见 requirements-ml-gpu.txt，由 install-ml-gpu-deps.ps1 安装）、以及可 import 的 sam2（与运行 encode-image 相同环境）。

重要：encode-image 与 ``export_sam21_cvat_decoder.py`` 使用同一 ``SAM2ImageEncoder``，可与同目录导出的 ``*.decoder.onnx`` 配套使用。

用法（在 backend/ 下，务必使用与 start.ps1 相同的 python-embed，不要用系统 python）:
  ./python-embed/python.exe scripts/export_sam21_cvat_decoder.py --asset-id sam2/sam2.1_hiera_tiny
  ./python-embed/python.exe scripts/export_sam21_cvat_decoder.py --all-sam21

--all-sam21 / --asset-id：若 registry 指向的 .pt 不在磁盘上则打印「跳过」并继续（不抛 FileNotFoundError）。
显式 --checkpoint 仍要求该路径存在。

可选同时导出 encoder ONNX（一般仅调试用）:
  ./python-embed/python.exe scripts/export_sam21_cvat_decoder.py --all-sam21 --export-encoder

实现来源说明：SAM2ImageEncoder / SAM2ImageDecoder 结构与
https://github.com/hashJoe/samexporter/blob/cvat/samexporter/export_sam21_cvat.py
一致；Hydra 配置改为与本仓库 registry / sam2_hiera_variants 使用的 SAM2.1 路径对齐。
"""
from __future__ import annotations

import argparse
import json
import pathlib
import sys
from typing import Any

import torch
from torch import nn

_BACKEND_ROOT = pathlib.Path(__file__).resolve().parents[1]
if str(_BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(_BACKEND_ROOT))

from app.models.impl.sam2_cvat_encoder import SAM2ImageEncoder  # noqa: E402


# ---------------------------------------------------------------------------
# Decoder 与 hashJoe samexporter/export_sam21_cvat.py 对齐（ONNX 导出用）
# ---------------------------------------------------------------------------


class SAM2ImageDecoder(nn.Module):
    def __init__(self, sam_model: Any, multimask_output: bool) -> None:
        super().__init__()
        self.mask_decoder = sam_model.sam_mask_decoder
        self.prompt_encoder = sam_model.sam_prompt_encoder
        self.model = sam_model
        self.img_size = sam_model.image_size
        self.multimask_output = multimask_output

    @torch.no_grad()
    def forward(
        self,
        image_embed: torch.Tensor,
        high_res_feats_0: torch.Tensor,
        high_res_feats_1: torch.Tensor,
        point_coords: torch.Tensor,
        point_labels: torch.Tensor,
        orig_im_size: torch.Tensor,
        mask_input: torch.Tensor,
        has_mask_input: torch.Tensor,
    ):
        sparse_embedding = self._embed_points(point_coords, point_labels)
        self.sparse_embedding = sparse_embedding
        dense_embedding = self._embed_masks(mask_input, has_mask_input)

        high_res_feats = [high_res_feats_0, high_res_feats_1]

        masks, iou_predictions, _, _ = self.mask_decoder.predict_masks(
            image_embeddings=image_embed,
            image_pe=self.prompt_encoder.get_dense_pe(),
            sparse_prompt_embeddings=sparse_embedding,
            dense_prompt_embeddings=dense_embedding,
            repeat_image=False,
            high_res_features=high_res_feats,
        )

        if self.multimask_output:
            masks = masks[:, 1:, :, :]
            iou_predictions = iou_predictions[:, 1:]
        else:
            masks, iou_predictions = self.mask_decoder._dynamic_multimask_via_stability(masks, iou_predictions)

        masks = torch.clamp(masks, -32.0, 32.0)

        masks = masks.squeeze(0)
        iou_predictions = iou_predictions.squeeze(0)

        best_index = torch.argmax(iou_predictions)
        best_mask = masks[best_index]

        best_mask_resized = torch.nn.functional.interpolate(
            best_mask.unsqueeze(0).unsqueeze(0),
            size=(orig_im_size[0], orig_im_size[1]),
            mode="bilinear",
            align_corners=False,
        )

        best_mask_resized = best_mask_resized.squeeze(0).squeeze(0)
        best_mask_resized = (best_mask_resized > 0).to(torch.uint8)

        nonzero = best_mask_resized.nonzero(as_tuple=True)
        has_nonzero = (nonzero[0].numel() > 0) & (nonzero[1].numel() > 0)
        default_val = torch.zeros((), dtype=torch.int64)
        ytl = torch.where(has_nonzero, torch.min(nonzero[0]), default_val)
        ybr = torch.where(has_nonzero, torch.max(nonzero[0]), default_val)
        xtl = torch.where(has_nonzero, torch.min(nonzero[1]), default_val)
        xbr = torch.where(has_nonzero, torch.max(nonzero[1]), default_val)

        cropped_mask = best_mask_resized[ytl : ybr + 1, xtl : xbr + 1]

        return (
            cropped_mask.unsqueeze(0).unsqueeze(0),
            iou_predictions[best_index].unsqueeze(0).unsqueeze(0),
            best_mask.unsqueeze(0).unsqueeze(0),
            xtl,
            ytl,
            xbr,
            ybr,
        )

    def _embed_points(self, point_coords: torch.Tensor, point_labels: torch.Tensor) -> torch.Tensor:
        point_coords = point_coords + 0.5

        padding_point = torch.zeros((point_coords.shape[0], 1, 2), device=point_coords.device)
        padding_label = -torch.ones((point_labels.shape[0], 1), device=point_labels.device)
        point_coords = torch.cat([point_coords, padding_point], dim=1)
        point_labels = torch.cat([point_labels, padding_label], dim=1)

        point_coords[:, :, 0] = point_coords[:, :, 0] / self.model.image_size
        point_coords[:, :, 1] = point_coords[:, :, 1] / self.model.image_size

        point_embedding = self.prompt_encoder.pe_layer._pe_encoding(point_coords)
        point_labels = point_labels.unsqueeze(-1).expand_as(point_embedding)

        point_embedding = point_embedding * (point_labels != -1)
        point_embedding = point_embedding + self.prompt_encoder.not_a_point_embed.weight * (point_labels == -1)

        for i in range(self.prompt_encoder.num_point_embeddings):
            point_embedding = (
                point_embedding + self.prompt_encoder.point_embeddings[i].weight * (point_labels == i)
            )

        return point_embedding

    def _embed_masks(self, input_mask: torch.Tensor, has_mask_input: torch.Tensor) -> torch.Tensor:
        mask_embedding = has_mask_input * self.prompt_encoder.mask_downscaling(input_mask)
        mask_embedding = mask_embedding + (1 - has_mask_input) * self.prompt_encoder.no_mask_embed.weight.reshape(
            1, -1, 1, 1
        )
        return mask_embedding


# 与 app/models/impl/sam2_hiera_variants.SAM2_VARIANTS 中 SAM2.1 四条一致
SAM21_ASSET_IDS: tuple[str, ...] = (
    "sam2/sam2.1_hiera_tiny",
    "sam2/sam2.1_hiera_small",
    "sam2/sam2.1_hiera_base_plus",
    "sam2/sam2.1_hiera_large",
)

HYDRA_CFG_BY_ASSET_ID: dict[str, str] = {
    "sam2/sam2.1_hiera_tiny": "configs/sam2.1/sam2.1_hiera_t.yaml",
    "sam2/sam2.1_hiera_small": "configs/sam2.1/sam2.1_hiera_s.yaml",
    "sam2/sam2.1_hiera_base_plus": "configs/sam2.1/sam2.1_hiera_b+.yaml",
    "sam2/sam2.1_hiera_large": "configs/sam2.1/sam2.1_hiera_l.yaml",
}


def _backend_root() -> pathlib.Path:
    return pathlib.Path(__file__).resolve().parents[1]


def _resources_root() -> pathlib.Path:
    return _backend_root() / "external" / "resources"


def _load_registry() -> dict[str, Any]:
    p = _resources_root() / "registry.json"
    with p.open(encoding="utf-8") as f:
        return json.load(f)


def _checkpoint_for_asset(registry: dict[str, Any], asset_id: str) -> pathlib.Path:
    assets = registry.get("assets") or {}
    meta = assets.get(asset_id)
    if not isinstance(meta, dict):
        raise SystemExit(f"registry.json 中未找到 assets[{asset_id!r}]")
    rel = meta.get("relative_path")
    if not isinstance(rel, str) or not rel.strip():
        raise SystemExit(f"{asset_id} 缺少 relative_path")
    return (_resources_root() / rel.replace("\\", "/")).resolve()


def export_one(
    *,
    checkpoint: pathlib.Path,
    hydra_cfg: str,
    opset: int,
    multimask_output: bool,
    export_encoder: bool,
) -> tuple[pathlib.Path, pathlib.Path | None]:
    from sam2.build_sam import build_sam2

    if not checkpoint.is_file():
        raise FileNotFoundError(checkpoint)

    out_decoder = checkpoint.with_name(checkpoint.stem + ".decoder.onnx")
    out_encoder = checkpoint.with_name(checkpoint.stem + ".encoder.onnx") if export_encoder else None

    sam2_model = build_sam2(hydra_cfg, str(checkpoint), device="cpu")
    input_size = (1024, 1024)
    img = torch.randn(1, 3, input_size[0], input_size[1]).cpu()

    sam2_encoder = SAM2ImageEncoder(sam2_model).cpu()
    high_res_feats_0, high_res_feats_1, image_embed = sam2_encoder(img)

    out_decoder.parent.mkdir(parents=True, exist_ok=True)

    # PyTorch 2.4+ defaults dynamo=True (torch.export); SAM2 图常无法被 dynamo 捕获，须用 TorchScript 旧路径。
    _onnx_kw = dict(
        dynamo=False,
        external_data=False,
        export_params=True,
        opset_version=opset,
        do_constant_folding=True,
    )

    if export_encoder and out_encoder is not None:
        torch.onnx.export(
            sam2_encoder,
            img,
            str(out_encoder),
            input_names=["image"],
            output_names=["high_res_feats_0", "high_res_feats_1", "image_embed"],
            **_onnx_kw,
        )
        print("Saved encoder ONNX:", out_encoder)

    sam2_decoder = SAM2ImageDecoder(sam2_model, multimask_output=multimask_output).cpu()

    embed_dim = sam2_model.sam_prompt_encoder.embed_dim
    embed_size = (sam2_model.image_size // sam2_model.backbone_stride, sam2_model.image_size // sam2_model.backbone_stride)
    mask_input_size = [4 * x for x in embed_size]
    print("embed_dim", embed_dim, "embed_size", embed_size, "mask_input_size", mask_input_size)

    point_coords = torch.randint(low=0, high=input_size[1], size=(1, 5, 2), dtype=torch.float32)
    point_labels = torch.randint(low=0, high=2, size=(1, 5), dtype=torch.float32)
    mask_input = torch.randn(1, 1, *mask_input_size, dtype=torch.float32)
    has_mask_input = torch.tensor([1.0], dtype=torch.float32)
    orig_im_size = torch.tensor([input_size[0], input_size[1]], dtype=torch.int32)

    torch.onnx.export(
        sam2_decoder,
        (
            image_embed,
            high_res_feats_0,
            high_res_feats_1,
            point_coords,
            point_labels,
            orig_im_size,
            mask_input,
            has_mask_input,
        ),
        str(out_decoder),
        input_names=[
            "image_embed",
            "high_res_feats_0",
            "high_res_feats_1",
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
    return out_decoder, out_encoder


def main() -> None:
    parser = argparse.ArgumentParser(description="Export SAM2.1 CVAT-style decoder ONNX next to each .pt checkpoint.")
    parser.add_argument("--asset-id", type=str, help="registry.json 中的资源 id，如 sam2/sam2.1_hiera_tiny")
    parser.add_argument("--all-sam21", action="store_true", help="导出 registry 中列出的 SAM2.1 Hiera；本地无 .pt 的条目自动跳过")
    parser.add_argument("--checkpoint", type=str, help="直接指定 .pt 路径（则须同时传 --hydra-cfg）")
    parser.add_argument("--hydra-cfg", type=str, help="与 build_sam2 第一个参数一致，如 configs/sam2.1/sam2.1_hiera_t.yaml")
    parser.add_argument("--opset", type=int, default=17)
    parser.add_argument(
        "--single-mask",
        action="store_true",
        help="与 ONNX 内 single-mask 分支一致（默认 multimask_output=True，与 hashJoe CVAT 导出一致）",
    )
    parser.add_argument("--export-encoder", action="store_true", help="同时导出 .encoder.onnx（默认可不传）")
    args = parser.parse_args()

    if not args.asset_id and not args.all_sam21 and not args.checkpoint:
        parser.error("请指定 --asset-id、--all-sam21 或 --checkpoint + --hydra-cfg")

    try:
        from sam2.build_sam import build_sam2  # noqa: F401
    except ImportError:
        print("错误: 无法 import sam2。请在 backend 的 ML 环境中安装 sam2（与 encode-image 相同）。", file=sys.stderr)
        raise SystemExit(1) from None

    registry = _load_registry()
    jobs: list[tuple[pathlib.Path, str]] = []

    if args.checkpoint:
        if not args.hydra_cfg:
            parser.error("使用 --checkpoint 时必须提供 --hydra-cfg")
        jobs.append((pathlib.Path(args.checkpoint).resolve(), args.hydra_cfg))
    else:
        ids = list(SAM21_ASSET_IDS) if args.all_sam21 else [args.asset_id]
        for aid in ids:
            if aid not in HYDRA_CFG_BY_ASSET_ID:
                raise SystemExit(f"未知 asset_id: {aid!r}（请使用 SAM21_ASSET_IDS 之一或改用 --checkpoint）")
            ckpt = _checkpoint_for_asset(registry, aid)
            if not ckpt.is_file():
                print(f"跳过（无权重文件）: {ckpt}", file=sys.stderr)
                continue
            jobs.append((ckpt, HYDRA_CFG_BY_ASSET_ID[aid]))

    if not jobs:
        print("没有可导出的任务（registry 中的 .pt 均不存在或未匹配）", file=sys.stderr)
        raise SystemExit(0)

    for ckpt, hydra_cfg in jobs:
        print("---", ckpt.name, hydra_cfg)
        export_one(
            checkpoint=ckpt,
            hydra_cfg=hydra_cfg,
            opset=args.opset,
            multimask_output=not args.single_mask,
            export_encoder=args.export_encoder,
        )


if __name__ == "__main__":
    main()
