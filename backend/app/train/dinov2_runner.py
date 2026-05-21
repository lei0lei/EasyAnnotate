"""DINOv2 图像分类微调（后台线程 + 按 job_slug 隔离）。"""

from __future__ import annotations

import json
import sys
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal

import torch
import torch.nn as nn

from app.train.dinov2_dataset import build_dataloaders, discover_dataset_layout
from app.train.dinov2_workspace import (
    append_train_log,
    load_meta,
    resolve_base_model_path,
    runs_dir_path,
    save_meta,
)

JobStatus = Literal["idle", "running", "success", "failed"]

_PARTIAL_UNFREEZE_BLOCKS = 4


@dataclass
class Dinov2TrainJob:
    job_slug: str = ""
    status: JobStatus = "idle"
    progress: int = 0
    message: str = ""
    epoch: int = 0
    epochs: int = 0
    started_at: float | None = None
    finished_at: float | None = None
    last_error: str | None = None
    runs_dir: str | None = None


_lock = threading.Lock()
_jobs: dict[str, Dinov2TrainJob] = {}


def _job_to_dict(job: Dinov2TrainJob) -> dict[str, Any]:
    return {
        "job_slug": job.job_slug,
        "status": job.status,
        "progress": job.progress,
        "message": job.message,
        "epoch": job.epoch,
        "epochs": job.epochs,
        "runs_dir": job.runs_dir,
        "last_error": job.last_error,
    }


def get_job(job_slug: str) -> dict[str, Any]:
    slug = (job_slug or "").strip()
    with _lock:
        job = _jobs.get(slug)
        if job is not None:
            return _job_to_dict(job)
    meta = load_meta(slug)
    status = meta.get("status") if isinstance(meta.get("status"), str) else "idle"
    if status not in ("idle", "running", "success", "failed"):
        status = "idle"
    return {
        "job_slug": slug,
        "status": status,
        "progress": int(meta.get("train_progress") or 0),
        "message": str(meta.get("train_message") or ""),
        "epoch": int(meta.get("train_epoch") or 0),
        "epochs": int(meta.get("train_epochs") or 0),
        "last_error": meta.get("last_error") or meta.get("train_last_error"),
        "runs_dir": meta.get("last_run"),
    }


def is_job_running(job_slug: str) -> bool:
    slug = (job_slug or "").strip()
    with _lock:
        job = _jobs.get(slug)
        return job is not None and job.status == "running"


def _set_job(job_slug: str, **kwargs: Any) -> None:
    slug = (job_slug or "").strip()
    with _lock:
        job = _jobs.get(slug)
        if job is None:
            job = Dinov2TrainJob(job_slug=slug)
            _jobs[slug] = job
        for k, v in kwargs.items():
            setattr(job, k, v)
    patch: dict[str, Any] = {}
    if "status" in kwargs:
        patch["status"] = kwargs["status"]
    if "progress" in kwargs:
        patch["train_progress"] = kwargs["progress"]
    if "message" in kwargs:
        patch["train_message"] = kwargs["message"]
    if "epoch" in kwargs:
        patch["train_epoch"] = kwargs["epoch"]
    if "epochs" in kwargs:
        patch["train_epochs"] = kwargs["epochs"]
    if "last_error" in kwargs:
        patch["last_error"] = kwargs["last_error"]
    if patch:
        save_meta(slug, patch)


def _resolve_train_device(device: str, job_slug: str) -> torch.device:
    d = (device or "cpu").strip()
    if d.lower() == "cpu":
        return torch.device("cpu")
    if not torch.cuda.is_available():
        append_train_log(job_slug, f"CUDA 不可用，device 由 {d!r} 改为 cpu")
        return torch.device("cpu")
    if d.isdigit():
        idx = int(d)
        if idx >= torch.cuda.device_count():
            append_train_log(job_slug, f"GPU {d} 不存在，改用 cpu")
            return torch.device("cpu")
        return torch.device(f"cuda:{idx}")
    return torch.device(d)


def _infer_arch_id(meta: dict[str, Any], weights: Path) -> str:
    arch = meta.get("base_model_arch_id")
    if isinstance(arch, str) and arch.strip().startswith("dinov2/"):
        return arch.strip()
    asset = meta.get("base_model_asset_id")
    if isinstance(asset, str) and asset.strip().startswith("dinov2/"):
        return asset.strip()
    name = weights.name.lower()
    for token in ("vitg14", "vitl14", "vitb14", "vits14"):
        if token in name:
            reg = "_reg4" if "reg4" in name else ""
            return f"dinov2/dinov2_{token}{reg}_pretrain"
    raise ValueError(
        "无法确定 DINOv2 架构：请从下拉框选择 registry 权重后再训练（不要仅上传自定义 .pth）",
    )


def _load_backbone(arch_id: str, weights: Path) -> nn.Module:
    from app.models.impl.dinov2_variants import _new_empty_backbone

    model = _new_empty_backbone(arch_id)
    try:
        state_dict = torch.load(str(weights), map_location="cpu", weights_only=True)
    except TypeError:
        state_dict = torch.load(str(weights), map_location="cpu")
    model.load_state_dict(state_dict, strict=True)
    return model


class _Dinov2Classifier(nn.Module):
    def __init__(self, backbone: nn.Module, num_classes: int) -> None:
        super().__init__()
        self.backbone = backbone
        embed_dim = getattr(backbone, "embed_dim", None)
        if embed_dim is None:
            raise ValueError("backbone 缺少 embed_dim 属性")
        self.head = nn.Linear(int(embed_dim), num_classes)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        feats = self.backbone.forward_features(x)
        cls_token = feats["x_norm_clstoken"]
        return self.head(cls_token)


def _apply_train_mode(
    model: _Dinov2Classifier,
    *,
    objective: str,
    freeze_backbone: bool,
) -> None:
    obj = (objective or "linear_probe").strip()
    for p in model.backbone.parameters():
        p.requires_grad = False
    for p in model.head.parameters():
        p.requires_grad = True

    if obj == "linear_probe" or (obj == "fine_tune" and freeze_backbone):
        return

    if obj == "fine_tune":
        for p in model.backbone.parameters():
            p.requires_grad = True
        return

    if obj == "partial_tune":
        blocks = getattr(model.backbone, "blocks", None)
        if blocks is None:
            raise ValueError("backbone 无 blocks，无法部分解冻")
        n = min(_PARTIAL_UNFREEZE_BLOCKS, len(blocks))
        for block in blocks[-n:]:
            for p in block.parameters():
                p.requires_grad = True
        return

    raise ValueError(f"未知训练目标：{objective}")


def _run_epoch(
    model: _Dinov2Classifier,
    loader: Any,
    *,
    device: torch.device,
    criterion: nn.Module,
    optimizer: torch.optim.Optimizer | None,
    train: bool,
) -> tuple[float, float, int]:
    if train:
        model.train()
    else:
        model.eval()
    total_loss = 0.0
    correct = 0
    total = 0
    ctx = torch.enable_grad() if train else torch.inference_mode()
    with ctx:
        for images, targets in loader:
            images = images.to(device, non_blocking=True)
            targets = targets.to(device, non_blocking=True)
            if train and optimizer is not None:
                optimizer.zero_grad(set_to_none=True)
            logits = model(images)
            loss = criterion(logits, targets)
            if train and optimizer is not None:
                loss.backward()
                optimizer.step()
            total_loss += float(loss.item()) * images.size(0)
            pred = logits.argmax(dim=1)
            correct += int((pred == targets).sum().item())
            total += images.size(0)
    avg_loss = total_loss / max(total, 1)
    acc = correct / max(total, 1)
    return avg_loss, acc, total


def _training_thread(
    job_slug: str,
    *,
    epochs: int,
    imgsz: int,
    batch: int,
    workers: int,
    device_s: str,
    lr: float,
    weight_decay: float,
    objective: str,
    freeze_backbone: bool,
) -> None:
    weights = resolve_base_model_path(job_slug)
    if weights is None or not weights.is_file():
        msg = "未设置预训练权重"
        append_train_log(job_slug, msg)
        _set_job(job_slug, status="failed", progress=100, message=msg, last_error=msg)
        save_meta(job_slug, {"status": "failed", "last_error": msg})
        return

    meta = load_meta(job_slug)
    try:
        arch_id = _infer_arch_id(meta, weights)
    except ValueError as e:
        msg = str(e)
        append_train_log(job_slug, msg)
        _set_job(job_slug, status="failed", progress=100, message=msg, last_error=msg)
        save_meta(job_slug, {"status": "failed", "last_error": msg})
        return

    runs_root = runs_dir_path(job_slug)
    runs_root.mkdir(parents=True, exist_ok=True)
    train_run = runs_root / "train"
    train_run.mkdir(parents=True, exist_ok=True)

    device = _resolve_train_device(device_s, job_slug)
    append_train_log(
        job_slug,
        f"开始训练 arch={arch_id} weights={weights.name} device={device} "
        f"objective={objective} epochs={epochs} batch={batch} imgsz={imgsz}",
    )

    try:
        layout = discover_dataset_layout(job_slug)
        append_train_log(
            job_slug,
            f"数据集：train={layout.train_root} classes={list(layout.class_names)} "
            f"val_split={layout.val_from_split}",
        )
        train_loader, val_loader, num_classes, train_samples = build_dataloaders(
            layout,
            imgsz=imgsz,
            batch=batch,
            workers=workers,
        )
        append_train_log(job_slug, f"样本：训练 {train_samples}，类别数 {num_classes}")

        backbone = _load_backbone(arch_id, weights)
        model = _Dinov2Classifier(backbone, num_classes)
        _apply_train_mode(model, objective=objective, freeze_backbone=freeze_backbone)
        model.to(device)

        trainable = sum(p.numel() for p in model.parameters() if p.requires_grad)
        append_train_log(job_slug, f"可训练参数：{trainable:,}")

        criterion = nn.CrossEntropyLoss()
        params = [p for p in model.parameters() if p.requires_grad]
        optimizer = torch.optim.AdamW(params, lr=lr, weight_decay=weight_decay)

        classes_path = train_run / "classes.json"
        classes_path.write_text(
            json.dumps(list(layout.class_names), ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

        best_val_acc = -1.0
        history: list[dict[str, Any]] = []

        for epoch in range(1, epochs + 1):
            train_loss, train_acc, _ = _run_epoch(
                model,
                train_loader,
                device=device,
                criterion=criterion,
                optimizer=optimizer,
                train=True,
            )
            val_loss, val_acc, _ = _run_epoch(
                model,
                val_loader,
                device=device,
                criterion=criterion,
                optimizer=None,
                train=False,
            )
            progress = int(min(99, epoch / max(epochs, 1) * 100))
            line = (
                f"epoch {epoch}/{epochs} train_loss={train_loss:.4f} train_acc={train_acc:.3f} "
                f"val_loss={val_loss:.4f} val_acc={val_acc:.3f}"
            )
            append_train_log(job_slug, line)
            history.append(
                {
                    "epoch": epoch,
                    "train_loss": train_loss,
                    "train_acc": train_acc,
                    "val_loss": val_loss,
                    "val_acc": val_acc,
                },
            )
            (train_run / "metrics.json").write_text(
                json.dumps(history, indent=2, ensure_ascii=False),
                encoding="utf-8",
            )

            _set_job(
                job_slug,
                epoch=epoch,
                epochs=epochs,
                progress=progress,
                message=f"第 {epoch}/{epochs} 轮 · val_acc={val_acc:.3f}",
            )
            save_meta(job_slug, {"train_epoch": epoch, "train_progress": progress, "train_message": line})

            if val_acc >= best_val_acc:
                best_val_acc = val_acc
                torch.save(
                    {
                        "arch_id": arch_id,
                        "num_classes": num_classes,
                        "class_names": list(layout.class_names),
                        "objective": objective,
                        "imgsz": imgsz,
                        "epoch": epoch,
                        "val_acc": val_acc,
                        "model": model.state_dict(),
                    },
                    train_run / "checkpoint_best.pth",
                )

        torch.save(
            {
                "arch_id": arch_id,
                "num_classes": num_classes,
                "class_names": list(layout.class_names),
                "model": model.state_dict(),
            },
            train_run / "checkpoint_last.pth",
        )

        done_msg = f"训练完成：best_val_acc={best_val_acc:.3f} 输出 {train_run}"
        append_train_log(job_slug, done_msg)
        _set_job(
            job_slug,
            status="success",
            progress=100,
            message=done_msg,
            runs_dir=str(train_run),
            finished_at=time.time(),
        )
        save_meta(
            job_slug,
            {
                "status": "success",
                "last_run": str(train_run),
                "train_progress": 100,
                "best_val_acc": best_val_acc,
            },
        )
    except Exception as e:
        err_msg = f"训练失败：{e}"
        append_train_log(job_slug, err_msg)
        _set_job(
            job_slug,
            status="failed",
            progress=100,
            message=err_msg,
            last_error=str(e),
            finished_at=time.time(),
        )
        save_meta(job_slug, {"status": "failed", "last_error": str(e)})
    finally:
        if device.type == "cuda":
            torch.cuda.empty_cache()


def start_training(
    job_slug: str,
    *,
    epochs: int,
    imgsz: int,
    batch: int,
    workers: int,
    device: str,
    lr: float,
    weight_decay: float,
    objective: str,
    freeze_backbone: bool,
) -> None:
    slug = (job_slug or "").strip()
    with _lock:
        existing = _jobs.get(slug)
        if existing is not None and existing.status == "running":
            raise RuntimeError("该训练任务已在运行")
        _jobs[slug] = Dinov2TrainJob(
            job_slug=slug,
            status="running",
            progress=0,
            message="排队中…",
            epoch=0,
            epochs=epochs,
            started_at=time.time(),
            finished_at=None,
            last_error=None,
            runs_dir=None,
        )

    save_meta(
        slug,
        {
            "train_params": {
                "epochs": epochs,
                "imgsz": imgsz,
                "batch": batch,
                "workers": workers,
                "device": device,
                "lr": lr,
                "weight_decay": weight_decay,
                "objective": objective,
                "freeze_backbone": freeze_backbone,
            },
            "status": "running",
            "train_progress": 0,
            "train_epoch": 0,
            "train_epochs": epochs,
            "last_error": None,
        },
    )
    append_train_log(slug, "训练任务已启动")

    def _run() -> None:
        try:
            _training_thread(
                slug,
                epochs=epochs,
                imgsz=imgsz,
                batch=batch,
                workers=workers,
                device_s=device,
                lr=lr,
                weight_decay=weight_decay,
                objective=objective,
                freeze_backbone=freeze_backbone,
            )
        except Exception as e:
            err_msg = f"训练线程异常：{e}"
            append_train_log(slug, err_msg)
            _set_job(
                slug,
                status="failed",
                progress=100,
                message=err_msg,
                last_error=str(e),
                finished_at=time.time(),
            )
            save_meta(slug, {"status": "failed", "last_error": str(e)})

    thread = threading.Thread(target=_run, name=f"dinov2-train-{slug}", daemon=True)
    thread.start()


def list_devices() -> list[dict[str, Any]]:
    from app.train.yolo_runner import list_devices as _yolo_devices

    return _yolo_devices()
