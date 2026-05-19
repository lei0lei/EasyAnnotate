"""MobileSAM (SAM v1) decoder wrapper for CVAT-style ONNX export — aligned with ``export_sam21_cvat_decoder`` outputs."""

from __future__ import annotations

from typing import Any

import torch
from torch import nn


class MobileSamImageDecoder(nn.Module):
    """Decoder + prompt embed + crop mask outputs (no high-res FPN feats)."""

    def __init__(self, sam_model: Any, multimask_output: bool) -> None:
        super().__init__()
        self.mask_decoder = sam_model.mask_decoder
        self.prompt_encoder = sam_model.prompt_encoder
        self.model = sam_model
        self.img_size = sam_model.image_encoder.img_size
        self.multimask_output = multimask_output

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
        sparse_embedding = self._embed_points(point_coords, point_labels)
        dense_embedding = self._embed_masks(mask_input, has_mask_input)

        masks, iou_predictions = self.mask_decoder.predict_masks(
            image_embeddings=image_embed,
            image_pe=self.prompt_encoder.get_dense_pe(),
            sparse_prompt_embeddings=sparse_embedding,
            dense_prompt_embeddings=dense_embedding,
        )

        if self.multimask_output:
            masks = masks[:, 1:, :, :]
            iou_predictions = iou_predictions[:, 1:]
        else:
            masks = masks[:, 0:1, :, :]
            iou_predictions = iou_predictions[:, 0:1]

        masks = torch.clamp(masks, -32.0, 32.0)
        masks = masks.squeeze(0)
        iou_predictions = iou_predictions.squeeze(0)

        best_index = torch.argmax(iou_predictions)
        best_mask = masks[best_index]

        best_mask_resized = self._postprocess_mask(best_mask.unsqueeze(0).unsqueeze(0), orig_im_size)
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

        point_coords[:, :, 0] = point_coords[:, :, 0] / self.img_size
        point_coords[:, :, 1] = point_coords[:, :, 1] / self.img_size

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

    def _postprocess_mask(self, masks: torch.Tensor, orig_im_size: torch.Tensor) -> torch.Tensor:
        """与 ``Sam.postprocess_masks`` 一致；张量运算以便 ONNX 随 ``orig_im_size`` 动态变化。"""
        img_size = int(self.img_size)
        masks = torch.nn.functional.interpolate(
            masks,
            size=(img_size, img_size),
            mode="bilinear",
            align_corners=False,
        )
        oh = orig_im_size[0].to(torch.float32)
        ow = orig_im_size[1].to(torch.float32)
        max_side = torch.maximum(oh, ow).clamp(min=1.0)
        scale = float(img_size) / max_side
        new_h = torch.round(oh * scale).to(torch.int64)
        new_w = torch.round(ow * scale).to(torch.int64)
        masks = masks[..., :new_h, :new_w]
        masks = torch.nn.functional.interpolate(
            masks,
            size=(orig_im_size[0], orig_im_size[1]),
            mode="bilinear",
            align_corners=False,
        )
        return masks.squeeze(0).squeeze(0)

    @staticmethod
    def _resize_longest_side_shape(old_h: int, old_w: int, long_side: int) -> tuple[int, int]:
        """与 MobileSAM ``ResizeLongestSide.get_preprocess_shape`` 一致（Python 路径用）。"""
        scale = float(long_side) / float(max(old_h, old_w, 1))
        new_h = int(old_h * scale + 0.5)
        new_w = int(old_w * scale + 0.5)
        return new_h, new_w
