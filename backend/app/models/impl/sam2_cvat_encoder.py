"""SAM2.1 features aligned with hashJoe/samexporter CVAT ONNX (encoder + decoder export)."""

from __future__ import annotations

from typing import Any

import torch
from torch import nn


class SAM2ImageEncoder(nn.Module):
    """Same forward as hashJoe `export_sam21_cvat.py` / `export_sam21_cvat_decoder.py`."""

    def __init__(self, sam_model: Any) -> None:
        super().__init__()
        self.model = sam_model
        self.image_encoder = sam_model.image_encoder
        self.no_mem_embed = sam_model.no_mem_embed

    def forward(self, x: torch.Tensor) -> tuple[torch.Tensor, torch.Tensor, torch.Tensor]:
        backbone_out = self.image_encoder(x)
        backbone_out["backbone_fpn"][0] = self.model.sam_mask_decoder.conv_s0(backbone_out["backbone_fpn"][0])
        backbone_out["backbone_fpn"][1] = self.model.sam_mask_decoder.conv_s1(backbone_out["backbone_fpn"][1])

        feature_maps = backbone_out["backbone_fpn"][-self.model.num_feature_levels :]
        vision_pos_embeds = backbone_out["vision_pos_enc"][-self.model.num_feature_levels :]

        feat_sizes = [(t.shape[-2], t.shape[-1]) for t in vision_pos_embeds]

        vision_feats = [t.flatten(2).permute(2, 0, 1) for t in feature_maps]
        vision_feats[-1] = vision_feats[-1] + self.no_mem_embed

        feats = [
            feat.permute(1, 2, 0).reshape(1, -1, *feat_size)
            for feat, feat_size in zip(vision_feats[::-1], feat_sizes[::-1])
        ][::-1]

        return feats[0], feats[1], feats[2]
