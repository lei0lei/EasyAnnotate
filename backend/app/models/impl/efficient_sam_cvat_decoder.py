"""EfficientSAM decoder wrapper for CVAT-style ONNX export (crop mask + xtl/ytl/…)."""

from __future__ import annotations

from typing import Any

import torch
import torch.nn.functional as F
from torch import nn


class EfficientSamImageDecoder(nn.Module):
    """Decoder export target: same ONNX I/O contract as MobileSAM CVAT decoder."""

    def __init__(self, sam_model: Any, multimask_output: bool = True) -> None:
        super().__init__()
        self.sam = sam_model
        self.img_size = int(sam_model.image_encoder.img_size)
        self.multimask_output = multimask_output
        self.max_pts = int(sam_model.decoder_max_num_input_points)

    @torch.no_grad()
    def forward(
        self,
        image_embed: torch.Tensor,
        point_coords: torch.Tensor,
        point_labels: torch.Tensor,
        orig_im_size: torch.Tensor,
        mask_input: torch.Tensor,
        has_mask_input: torch.Tensor,
    ):
        del mask_input, has_mask_input

        batched_points, batched_labels = self._cvat_prompts_to_efficient(
            point_coords, point_labels, orig_im_size
        )

        # 不在 graph 内走 EfficientSAM 自带的 bicubic 上采样（onnxruntime-web WASM 常不支持）。
        low_masks, iou_predictions = self.sam.predict_masks(
            image_embed,
            batched_points,
            batched_labels,
            multimask_output=self.multimask_output,
            input_h=orig_im_size[0],
            input_w=orig_im_size[1],
            output_h=-1,
            output_w=-1,
        )

        low = low_masks[0, 0]
        ious = iou_predictions[0, 0]
        best_index = torch.argmax(ious)
        best_low = low[best_index].unsqueeze(0).unsqueeze(0)
        best_up = F.interpolate(
            best_low,
            size=(orig_im_size[0], orig_im_size[1]),
            mode="bilinear",
            align_corners=False,
        )
        best_mask = (best_up.squeeze(0).squeeze(0) > 0).to(torch.uint8)

        xtl, ytl, xbr, ybr = self._mask_bbox(best_mask)
        cropped_mask = best_mask[ytl : ybr + 1, xtl : xbr + 1]

        return (
            cropped_mask.unsqueeze(0).unsqueeze(0),
            ious[best_index].unsqueeze(0).unsqueeze(0),
            best_mask.unsqueeze(0).unsqueeze(0).to(torch.float32),
            xtl,
            ytl,
            xbr,
            ybr,
        )

    def _mask_bbox(self, mask: torch.Tensor) -> tuple[torch.Tensor, torch.Tensor, torch.Tensor, torch.Tensor]:
        """BBox of foreground pixels; ONNX-safe when mask is empty."""
        h, w = mask.shape
        device = mask.device
        default = torch.zeros((), dtype=torch.int64, device=device)
        fg = mask > 0
        has_fg = fg.any()

        h_idx = torch.arange(h, device=device, dtype=torch.int64).view(h, 1).expand(h, w)
        w_idx = torch.arange(w, device=device, dtype=torch.int64).view(1, w).expand(h, w)

        ytl = torch.where(has_fg, h_idx.masked_fill(~fg, h - 1).amin(), default)
        ybr = torch.where(has_fg, h_idx.masked_fill(~fg, 0).amax(), default)
        xtl = torch.where(has_fg, w_idx.masked_fill(~fg, w - 1).amin(), default)
        xbr = torch.where(has_fg, w_idx.masked_fill(~fg, 0).amax(), default)
        return xtl, ytl, xbr, ybr

    def _cvat_prompts_to_efficient(
        self,
        point_coords: torch.Tensor,
        point_labels: torch.Tensor,
        orig_im_size: torch.Tensor,
    ) -> tuple[torch.Tensor, torch.Tensor]:
        """CVAT model-space coords -> EfficientSAM encode-space pixels, padded to 6 points."""
        img_size = float(self.img_size)
        oh = orig_im_size[0].to(dtype=point_coords.dtype)
        ow = orig_im_size[1].to(dtype=point_coords.dtype)
        pts = point_coords.clone()
        pts[..., 0] = pts[..., 0] * ow / img_size
        pts[..., 1] = pts[..., 1] * oh / img_size

        max_pts = self.max_pts
        coords_out = torch.zeros((1, 1, max_pts, 2), device=pts.device, dtype=pts.dtype)
        labels_out = torch.full((1, 1, max_pts), -1.0, device=point_labels.device, dtype=point_labels.dtype)
        copy_n = min(int(pts.shape[1]), max_pts)
        if copy_n > 0:
            coords_out[0, 0, :copy_n] = pts[0, :copy_n]
            labels_out[0, 0, :copy_n] = point_labels[0, :copy_n]
        return coords_out, labels_out
