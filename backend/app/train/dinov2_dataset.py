"""DINOv2 分类训练数据集：ImageFolder 布局发现与 DataLoader。"""

from __future__ import annotations

import random
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from app.train.dinov2_workspace import IMAGE_EXTS, dataset_dir_path

_IMAGE_SUFFIXES = IMAGE_EXTS


@dataclass(frozen=True)
class Dinov2DatasetLayout:
    train_root: Path
    val_root: Path | None
    class_names: tuple[str, ...]
    val_from_split: bool


def _dir_has_class_images(root: Path) -> bool:
    if not root.is_dir():
        return False
    for child in root.iterdir():
        if not child.is_dir():
            continue
        for path in child.rglob("*"):
            if path.is_file() and path.suffix.lower() in _IMAGE_SUFFIXES:
                return True
    return False


def _list_class_names(root: Path) -> tuple[str, ...]:
    names = sorted(
        p.name
        for p in root.iterdir()
        if p.is_dir() and any(
            f.is_file() and f.suffix.lower() in _IMAGE_SUFFIXES for f in p.rglob("*")
        )
    )
    if not names:
        raise ValueError(f"目录下未找到按类别划分的图像：{root}")
    return tuple(names)


def discover_dataset_layout(job_slug: str) -> Dinov2DatasetLayout:
    """支持 ``train/<class>/`` [+ ``val/<class>/``] 或 ``<class>/`` 根布局。"""
    root = dataset_dir_path(job_slug)
    if not root.is_dir():
        raise FileNotFoundError("数据集目录不存在，请先上传并解压 ZIP")

    train_dir = root / "train"
    val_dir = root / "val"
    if train_dir.is_dir() and _dir_has_class_images(train_dir):
        class_names = _list_class_names(train_dir)
        if val_dir.is_dir() and _dir_has_class_images(val_dir):
            val_names = _list_class_names(val_dir)
            if set(val_names) != set(class_names):
                raise ValueError(
                    f"train 与 val 类别不一致：train={class_names} val={val_names}",
                )
            return Dinov2DatasetLayout(
                train_root=train_dir,
                val_root=val_dir,
                class_names=class_names,
                val_from_split=False,
            )
        return Dinov2DatasetLayout(
            train_root=train_dir,
            val_root=None,
            class_names=class_names,
            val_from_split=True,
        )

    if _dir_has_class_images(root):
        class_names = _list_class_names(root)
        return Dinov2DatasetLayout(
            train_root=root,
            val_root=None,
            class_names=class_names,
            val_from_split=True,
        )

    raise ValueError(
        "数据集需为 ImageFolder 布局：train/<类别名>/*.jpg，或根目录下直接按类别分子文件夹",
    )


def build_dataloaders(
    layout: Dinov2DatasetLayout,
    *,
    imgsz: int,
    batch: int,
    workers: int,
    val_ratio: float = 0.2,
    seed: int = 42,
) -> tuple[Any, Any, int, int]:
    """返回 (train_loader, val_loader, num_classes, train_samples)。"""
    import sys

    import torch
    from torch.utils.data import DataLoader, Subset
    from torchvision import transforms
    from torchvision.datasets import ImageFolder

    train_tf = transforms.Compose(
        [
            transforms.RandomResizedCrop(
                imgsz,
                scale=(0.6, 1.0),
                interpolation=transforms.InterpolationMode.BICUBIC,
            ),
            transforms.RandomHorizontalFlip(),
            transforms.ToTensor(),
            transforms.Normalize(mean=(0.485, 0.456, 0.406), std=(0.229, 0.224, 0.225)),
        ],
    )
    val_tf = transforms.Compose(
        [
            transforms.Resize(imgsz, interpolation=transforms.InterpolationMode.BICUBIC),
            transforms.CenterCrop(imgsz),
            transforms.ToTensor(),
            transforms.Normalize(mean=(0.485, 0.456, 0.406), std=(0.229, 0.224, 0.225)),
        ],
    )

    full_train = ImageFolder(layout.train_root, transform=train_tf)
    num_classes = len(full_train.classes)
    if num_classes < 2:
        raise ValueError(f"至少需要 2 个类别，当前为 {num_classes}")

    if layout.val_root is not None:
        val_ds = ImageFolder(layout.val_root, transform=val_tf)
        if len(val_ds.classes) != num_classes:
            raise ValueError("验证集类别数与训练集不一致")
        train_ds = full_train
    elif layout.val_from_split:
        n = len(full_train)
        if n < 2:
            raise ValueError("训练样本过少，无法划分验证集")
        val_count = max(1, int(n * val_ratio))
        train_count = n - val_count
        if train_count < 1:
            val_count = 1
            train_count = n - 1
        gen = torch.Generator().manual_seed(seed)
        perm = torch.randperm(n, generator=gen).tolist()
        val_idx = perm[:val_count]
        train_idx = perm[val_count:]
        train_ds = Subset(ImageFolder(layout.train_root, transform=train_tf), train_idx)
        val_ds = Subset(ImageFolder(layout.train_root, transform=val_tf), val_idx)
    else:
        raise ValueError("无法构建验证集")

    effective_workers = 0 if sys.platform == "win32" else workers
    train_loader = DataLoader(
        train_ds,
        batch_size=batch,
        shuffle=True,
        num_workers=effective_workers,
        pin_memory=torch.cuda.is_available(),
    )
    val_loader = DataLoader(
        val_ds,
        batch_size=batch,
        shuffle=False,
        num_workers=effective_workers,
        pin_memory=torch.cuda.is_available(),
    )
    train_samples = len(train_ds)
    return train_loader, val_loader, num_classes, train_samples
