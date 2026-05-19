"""Runtime catalog: weight lists come from `registry.json` scans (`.pt` / `.pth`)."""

from __future__ import annotations

from dataclasses import dataclass

from app.model_resources import asset_status, iter_registry_weight_asset_ids
from app.models.impl.sam2_hiera_variants import SAM2_VARIANTS


@dataclass(frozen=True)
class CatalogVariant:
    """One selectable checkpoint; `asset_ids[0]` is the primary `registry.json` key."""

    model_id: str
    asset_ids: tuple[str, ...]


@dataclass(frozen=True)
class CategorySpec:
    id: str
    label_zh: str
    label_en: str
    variants: tuple[CatalogVariant, ...]


_SAM2_PREF: tuple[str, ...] = (
    "sam2/sam2.1_hiera_tiny",
    "sam2/sam2.1_hiera_small",
    "sam2/sam2.1_hiera_base_plus",
    "sam2/sam2.1_hiera_large",
)

_YOLO_PREF: tuple[str, ...] = (
    "ultralytics/yolov8n",
    "ultralytics/yolov8s",
    "ultralytics/yolov8m",
)

_DINO_PREF: tuple[str, ...] = (
    "dinov2/dinov2_vits14_pretrain",
    "dinov2/dinov2_vits14_reg4_pretrain",
    "dinov2/dinov2_vitb14_pretrain",
    "dinov2/dinov2_vitb14_reg4_pretrain",
    "dinov2/dinov2_vitl14_pretrain",
    "dinov2/dinov2_vitl14_reg4_pretrain",
)


def _rank_sort(ids: list[str], pref: tuple[str, ...]) -> list[str]:
    r = {k: i for i, k in enumerate(pref)}
    return sorted(ids, key=lambda x: (r.get(x, 1_000), x))


def _primary_asset_file_installed(asset_id: str) -> bool:
    """仅当 registry 中该权重的本地文件已存在时，才纳入 runtime 目录（避免未下载的条目仍出现在下拉框）。"""
    st = asset_status(asset_id)
    return bool(st.get("known") and st.get("exists"))


def _sam2_variants_from_registry() -> tuple[CatalogVariant, ...]:
    ids = iter_registry_weight_asset_ids(
        "sam2/",
        extensions=(".pt",),
        exclude_id_substrings=("/cfg/",),
    )
    ids = [i for i in ids if i in SAM2_VARIANTS]
    ids = [i for i in ids if _primary_asset_file_installed(SAM2_VARIANTS[i][1])]
    ids = _rank_sort(ids, _SAM2_PREF)
    return tuple(CatalogVariant(i, (SAM2_VARIANTS[i][1],)) for i in ids)


def _yolo_variants_from_registry() -> tuple[CatalogVariant, ...]:
    ids = iter_registry_weight_asset_ids("ultralytics/", extensions=(".pt",))
    ids = [i for i in ids if _primary_asset_file_installed(i)]
    ids = _rank_sort(ids, _YOLO_PREF)
    return tuple(CatalogVariant(i, (i,)) for i in ids)


def _dinov2_variants_from_registry() -> tuple[CatalogVariant, ...]:
    ids = iter_registry_weight_asset_ids("dinov2/", extensions=(".pth",))
    ids = [i for i in ids if _primary_asset_file_installed(i)]
    ids = _rank_sort(ids, _DINO_PREF)
    return tuple(CatalogVariant(i, (i,)) for i in ids)


def _mobile_sam_variants_from_registry() -> tuple[CatalogVariant, ...]:
    ids = iter_registry_weight_asset_ids("mobile_sam/", extensions=(".pt",))
    ids = [i for i in ids if _primary_asset_file_installed(i)]
    return tuple(CatalogVariant(i, (i,)) for i in ids)


def _efficient_sam_variants_from_registry() -> tuple[CatalogVariant, ...]:
    ids = iter_registry_weight_asset_ids("efficient_sam/", extensions=(".pt",))
    ids = [i for i in ids if _primary_asset_file_installed(i)]
    return tuple(CatalogVariant(i, (i,)) for i in ids)


MODEL_CATEGORIES: tuple[CategorySpec, ...] = (
    CategorySpec(
        id="sam2",
        label_zh="SAM 2.1 Hiera",
        label_en="SAM 2.1 Hiera",
        variants=_sam2_variants_from_registry(),
    ),
    CategorySpec(
        id="yolo",
        label_zh="Ultralytics YOLOv8",
        label_en="Ultralytics YOLOv8",
        variants=_yolo_variants_from_registry(),
    ),
    CategorySpec(
        id="dinov2",
        label_zh="DINOv2 ViT",
        label_en="DINOv2 ViT",
        variants=_dinov2_variants_from_registry(),
    ),
    CategorySpec(
        id="mobile_sam",
        label_zh="MobileSAM",
        label_en="MobileSAM",
        variants=_mobile_sam_variants_from_registry(),
    ),
    CategorySpec(
        id="efficient_sam",
        label_zh="EfficientSAM",
        label_en="EfficientSAM",
        variants=_efficient_sam_variants_from_registry(),
    ),
)


def category_spec(category_id: str) -> CategorySpec | None:
    for c in MODEL_CATEGORIES:
        if c.id == category_id:
            return c
    return None


def model_id_in_category(category_id: str, model_id: str) -> bool:
    cat = category_spec(category_id)
    if cat is None:
        return False
    return any(v.model_id == model_id for v in cat.variants)
