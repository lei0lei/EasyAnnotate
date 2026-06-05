"""SAM2.1 decoder wrapper for CVAT-style decode — aligned with ``export_sam21_cvat_decoder.py``."""

from __future__ import annotations

from typing import Any

import torch
from torch import nn


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
        pred_iou = iou_predictions[best_index]

        best_mask_resized = torch.nn.functional.interpolate(
            best_mask.unsqueeze(0).unsqueeze(0),
            size=(orig_im_size[0], orig_im_size[1]),
            mode="bilinear",
            align_corners=False,
        )
        best_mask_resized = best_mask_resized.squeeze(0).squeeze(0)
        full_binary = (best_mask_resized > 0).to(torch.uint8)

        return full_binary, pred_iou

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
