"""Ultralytics YOLO 训练任务（后台线程 + 按 job_slug 隔离）。"""

from __future__ import annotations

import sys
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal

from app.train.yolo_workspace import (
    append_train_log,
    base_model_path,
    find_data_yaml,
    load_meta,
    runs_dir_path,
    save_meta,
)

JobStatus = Literal["idle", "running", "success", "failed"]


@dataclass
class YoloTrainJob:
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
_job = YoloTrainJob()


def get_job() -> dict[str, Any]:
    with _lock:
        return {
            "job_slug": _job.job_slug,
            "status": _job.status,
            "progress": _job.progress,
            "message": _job.message,
            "epoch": _job.epoch,
            "epochs": _job.epochs,
            "runs_dir": _job.runs_dir,
            "last_error": _job.last_error,
        }


def _set_job(**kwargs: Any) -> None:
    with _lock:
        for k, v in kwargs.items():
            setattr(_job, k, v)


def _resolve_train_device(device: str, job_slug: str) -> str:
    d = (device or "cpu").strip()
    if d.lower() == "cpu":
        return "cpu"
    try:
        import torch

        if not torch.cuda.is_available():
            append_train_log(job_slug, f"CUDA 不可用，device 由 {d!r} 改为 cpu")
            return "cpu"
        if d.isdigit() and int(d) >= torch.cuda.device_count():
            append_train_log(job_slug, f"GPU {d} 不存在，改用 cpu")
            return "cpu"
        return d
    except Exception:
        return "cpu"


def _newest_run_dir(runs_root: Path) -> Path:
    candidates = [p for p in runs_root.glob("train*") if p.is_dir()]
    if not candidates:
        return runs_root / "train"
    return max(candidates, key=lambda p: p.stat().st_mtime)


def _training_thread(
    job_slug: str,
    *,
    epochs: int,
    imgsz: int,
    batch: int,
    device: str,
    patience: int | None,
) -> None:
    try:
        from ultralytics import YOLO
    except ImportError as e:
        msg = "未安装 ultralytics，请在 backend 目录执行 install-ml-gpu-deps.ps1"
        append_train_log(job_slug, msg)
        _set_job(
            status="failed",
            progress=100,
            message=msg,
            last_error=str(e),
            finished_at=time.time(),
        )
        save_meta(job_slug, {"status": "failed", "last_error": str(e)})
        return

    weights = base_model_path(job_slug)
    if not weights.is_file():
        msg = "未设置基础模型（base_model.pt）"
        append_train_log(job_slug, msg)
        _set_job(status="failed", progress=100, message=msg, last_error="missing base_model.pt", finished_at=time.time())
        save_meta(job_slug, {"status": "failed", "last_error": msg})
        return

    meta = load_meta(job_slug)
    data_yaml_s = meta.get("data_yaml")
    if isinstance(data_yaml_s, str) and data_yaml_s.strip():
        data_yaml = Path(data_yaml_s)
    else:
        from app.train.yolo_workspace import dataset_dir_path

        data_yaml = find_data_yaml(dataset_dir_path(job_slug))

    if data_yaml is None or not data_yaml.is_file():
        msg = "未找到 data.yaml，请先上传并解压数据集"
        append_train_log(job_slug, msg)
        _set_job(status="failed", progress=100, message=msg, last_error="missing data.yaml", finished_at=time.time())
        save_meta(job_slug, {"status": "failed", "last_error": msg})
        return

    runs_root = runs_dir_path(job_slug)
    runs_root.mkdir(parents=True, exist_ok=True)
    device = _resolve_train_device(device, job_slug)

    def on_train_start(trainer: Any) -> None:
        append_train_log(job_slug, "Ultralytics 已进入训练流程（校验数据集 / 写入 runs）")
        _set_job(message="校验数据集并写入 runs…", progress=2)

    def on_train_epoch_end(trainer: Any) -> None:
        ep = int(getattr(trainer, "epoch", 0)) + 1
        total = int(getattr(trainer, "epochs", epochs) or epochs)
        pct = min(99, max(1, int(ep / max(1, total) * 100)))
        line = f"epoch {ep}/{total}"
        append_train_log(job_slug, line)
        _set_job(epoch=ep, epochs=total, progress=pct, message=f"训练中 {line}")

    try:
        data_yaml_abs = data_yaml.resolve()
        append_train_log(
            job_slug,
            f"开始训练 data={data_yaml_abs} weights={weights.resolve()} device={device} epochs={epochs}",
        )
        append_train_log(job_slug, f"runs 输出目录：{runs_root.resolve()}")
        model = YOLO(str(weights))
        train_kwargs: dict[str, Any] = {
            "data": str(data_yaml_abs),
            "epochs": epochs,
            "imgsz": imgsz,
            "batch": batch,
            "device": device,
            "project": str(runs_root.resolve()),
            "name": "train",
            "exist_ok": True,
            "verbose": True,
        }
        if patience is not None and patience > 0:
            train_kwargs["patience"] = patience
        if sys.platform == "win32":
            train_kwargs["workers"] = 0
            append_train_log(job_slug, "Windows：已设置 workers=0，避免 DataLoader 子进程卡死")

        model.add_callback("on_train_start", on_train_start)
        model.add_callback("on_train_epoch_end", on_train_epoch_end)
        _set_job(message="正在启动 Ultralytics（首轮前可能较慢）…", progress=1)
        append_train_log(job_slug, f"调用 model.train({train_kwargs})")
        model.train(**train_kwargs)
        run_dir = _newest_run_dir(runs_root)
        done_msg = f"训练完成：{run_dir}"
        append_train_log(job_slug, done_msg)
        _set_job(
            status="success",
            progress=100,
            message=done_msg,
            runs_dir=str(run_dir),
            finished_at=time.time(),
        )
        save_meta(job_slug, {"last_run": str(run_dir), "status": "success"})
    except Exception as e:
        err_msg = f"训练失败：{e}"
        append_train_log(job_slug, err_msg)
        _set_job(
            status="failed",
            progress=100,
            message=err_msg,
            last_error=str(e),
            finished_at=time.time(),
        )
        save_meta(job_slug, {"status": "failed", "last_error": str(e)})


def start_training(
    job_slug: str,
    *,
    epochs: int,
    imgsz: int,
    batch: int,
    device: str,
    patience: int | None = None,
) -> None:
    with _lock:
        if _job.status == "running":
            raise RuntimeError("已有训练任务正在运行")
        _job.job_slug = job_slug
        _job.status = "running"
        _job.progress = 0
        _job.message = "排队中…"
        _job.epoch = 0
        _job.epochs = epochs
        _job.started_at = time.time()
        _job.finished_at = None
        _job.last_error = None
        _job.runs_dir = None

    save_meta(
        job_slug,
        {
            "train_params": {
                "epochs": epochs,
                "imgsz": imgsz,
                "batch": batch,
                "device": device,
                "patience": patience,
            },
            "status": "running",
        },
    )
    append_train_log(job_slug, "训练任务已启动")

    def _run() -> None:
        try:
            _training_thread(
                job_slug,
                epochs=epochs,
                imgsz=imgsz,
                batch=batch,
                device=device,
                patience=patience,
            )
        except Exception as e:
            err_msg = f"训练线程异常：{e}"
            append_train_log(job_slug, err_msg)
            _set_job(
                status="failed",
                progress=100,
                message=err_msg,
                last_error=str(e),
                finished_at=time.time(),
            )
            save_meta(job_slug, {"status": "failed", "last_error": str(e)})

    thread = threading.Thread(
        target=_run,
        name=f"yolo-train-{job_slug}",
        daemon=True,
    )
    thread.start()


def list_devices() -> list[dict[str, str]]:
    devices: list[dict[str, str]] = [{"id": "cpu", "label": "CPU"}]
    try:
        import torch

        if torch.cuda.is_available():
            n = torch.cuda.device_count()
            for i in range(n):
                name = torch.cuda.get_device_name(i)
                devices.append({"id": str(i), "label": f"GPU {i}: {name}"})
    except Exception:
        pass
    return devices
