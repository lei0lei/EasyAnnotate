"""Ultralytics YOLO 训练任务（后台线程 + 按 job_slug 隔离，支持多任务并行）。"""

from __future__ import annotations

import sys
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal

from app.train.yolo_workspace import (
    append_train_log,
    resolve_base_model_path,
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
_jobs: dict[str, YoloTrainJob] = {}


def _job_to_dict(job: YoloTrainJob) -> dict[str, Any]:
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
        if job is None:
            return _job_to_dict(YoloTrainJob(job_slug=slug))
        return _job_to_dict(job)


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
            job = YoloTrainJob(job_slug=slug)
            _jobs[slug] = job
        for k, v in kwargs.items():
            setattr(job, k, v)


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


def _apply_custom_train_kwargs(
    train_kwargs: dict[str, Any],
    *,
    use_custom_augment: bool,
    augment: dict[str, Any] | None,
    use_custom_optimizer: bool,
    optimizer: dict[str, Any] | None,
) -> None:
    if use_custom_augment and augment:
        for k, v in augment.items():
            if v is not None:
                train_kwargs[k] = v
    if use_custom_optimizer and optimizer:
        opt = dict(optimizer)
        patience = opt.pop("patience", None)
        _BOOL_KEYS = frozenset({"cos_lr", "overlap_mask"})
        for k in list(opt.keys()):
            if k in _BOOL_KEYS and opt[k] is not None:
                opt[k] = bool(opt[k])
        train_kwargs.update(opt)
        if patience is not None:
            try:
                p = int(patience)
                if p > 0:
                    train_kwargs["patience"] = p
            except (TypeError, ValueError):
                pass


def _export_trained_onnx(
    job_slug: str,
    model: Any,
    *,
    imgsz: int,
) -> str | None:
    append_train_log(job_slug, f"开始导出 ONNX（imgsz={imgsz}，与训练一致）…")
    _set_job(job_slug, message=f"正在导出 ONNX（imgsz={imgsz}）…", progress=99)
    try:
        export_path = model.export(format="onnx", imgsz=int(imgsz))
        path_str = str(export_path)
        append_train_log(job_slug, f"ONNX 导出完成：{path_str}")
        save_meta(job_slug, {"onnx_export_path": path_str, "onnx_export_error": None})
        return path_str
    except Exception as e:
        err = f"ONNX 导出失败：{e}"
        append_train_log(job_slug, err)
        save_meta(job_slug, {"onnx_export_error": str(e)})
        return None


def _training_thread(
    job_slug: str,
    *,
    epochs: int,
    imgsz: int,
    batch: int,
    workers: int,
    device: str,
    time_hours: float | None,
    use_custom_augment: bool,
    augment: dict[str, Any] | None,
    use_custom_optimizer: bool,
    optimizer: dict[str, Any] | None,
    export_onnx: bool = False,
) -> None:
    try:
        from ultralytics import YOLO
    except ImportError as e:
        msg = "未安装 ultralytics，请在 backend 目录执行 install-ml-gpu-deps.ps1"
        append_train_log(job_slug, msg)
        _set_job(
            job_slug,
            status="failed",
            progress=100,
            message=msg,
            last_error=str(e),
            finished_at=time.time(),
        )
        save_meta(job_slug, {"status": "failed", "last_error": str(e)})
        return

    weights = resolve_base_model_path(job_slug)
    if weights is None or not weights.is_file():
        msg = "未设置基础模型权重（请从下拉框选择或上传 .pt）"
        append_train_log(job_slug, msg)
        _set_job(
            job_slug,
            status="failed",
            progress=100,
            message=msg,
            last_error="missing base model weights",
            finished_at=time.time(),
        )
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
        _set_job(
            job_slug,
            status="failed",
            progress=100,
            message=msg,
            last_error="missing data.yaml",
            finished_at=time.time(),
        )
        save_meta(job_slug, {"status": "failed", "last_error": msg})
        return

    runs_root = runs_dir_path(job_slug)
    runs_root.mkdir(parents=True, exist_ok=True)
    device = _resolve_train_device(device, job_slug)

    def on_train_start(trainer: Any) -> None:
        append_train_log(job_slug, "Ultralytics 已进入训练流程（校验数据集 / 写入 runs）")
        _set_job(job_slug, message="校验数据集并写入 runs…", progress=2)

    def on_train_epoch_end(trainer: Any) -> None:
        ep = int(getattr(trainer, "epoch", 0)) + 1
        total = int(getattr(trainer, "epochs", epochs) or epochs)
        pct = min(99, max(1, int(ep / max(1, total) * 100)))
        line = f"epoch {ep}/{total}"
        append_train_log(job_slug, line)
        _set_job(job_slug, epoch=ep, epochs=total, progress=pct, message=f"训练中 {line}")
        save_meta(
            job_slug,
            {"train_progress": pct, "train_epoch": ep, "train_epochs": total},
        )

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
        if time_hours is not None and time_hours > 0:
            train_kwargs["time"] = float(time_hours)
        _apply_custom_train_kwargs(
            train_kwargs,
            use_custom_augment=use_custom_augment,
            augment=augment,
            use_custom_optimizer=use_custom_optimizer,
            optimizer=optimizer,
        )
        if sys.platform == "win32":
            if workers != 0:
                append_train_log(job_slug, f"Windows：workers 由 {workers} 调整为 0，避免 DataLoader 子进程卡死")
            train_kwargs["workers"] = 0
        else:
            train_kwargs["workers"] = workers

        model.add_callback("on_train_start", on_train_start)
        model.add_callback("on_train_epoch_end", on_train_epoch_end)
        _set_job(job_slug, message="正在启动 Ultralytics（首轮前可能较慢）…", progress=1)
        append_train_log(job_slug, f"调用 model.train({train_kwargs})")
        model.train(**train_kwargs)
        run_dir = _newest_run_dir(runs_root)
        done_msg = f"训练完成：{run_dir}"
        append_train_log(job_slug, done_msg)
        if export_onnx:
            onnx_path = _export_trained_onnx(job_slug, model, imgsz=imgsz)
            if onnx_path:
                done_msg = f"{done_msg}；ONNX：{onnx_path}"
            else:
                done_msg = f"{done_msg}；ONNX 导出失败（见 train.log）"
        _set_job(
            job_slug,
            status="success",
            progress=100,
            message=done_msg,
            runs_dir=str(run_dir),
            finished_at=time.time(),
        )
        save_meta(
            job_slug,
            {"last_run": str(run_dir), "status": "success", "train_progress": 100},
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


def start_training(
    job_slug: str,
    *,
    epochs: int,
    imgsz: int,
    batch: int,
    workers: int = 2,
    device: str,
    time_hours: float | None = None,
    use_custom_augment: bool = False,
    augment: dict[str, Any] | None = None,
    use_custom_optimizer: bool = False,
    optimizer: dict[str, Any] | None = None,
    export_onnx: bool = False,
) -> None:
    slug = (job_slug or "").strip()
    with _lock:
        existing = _jobs.get(slug)
        if existing is not None and existing.status == "running":
            raise RuntimeError("该训练任务已在运行")
        _jobs[slug] = YoloTrainJob(
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
        job_slug,
        {
            "train_params": {
                "epochs": epochs,
                "imgsz": imgsz,
                "batch": batch,
                "workers": workers,
                "device": device,
                "time_hours": time_hours,
                "use_custom_augment": use_custom_augment,
                "augment": augment,
                "use_custom_optimizer": use_custom_optimizer,
                "optimizer": optimizer,
                "export_onnx": export_onnx,
            },
            "status": "running",
            "train_progress": 0,
            "train_epoch": 0,
            "train_epochs": epochs,
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
                workers=workers,
                device=device,
                time_hours=time_hours,
                use_custom_augment=use_custom_augment,
                augment=augment,
                use_custom_optimizer=use_custom_optimizer,
                optimizer=optimizer,
                export_onnx=export_onnx,
            )
        except Exception as e:
            err_msg = f"训练线程异常：{e}"
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

    thread = threading.Thread(
        target=_run,
        name=f"yolo-train-{job_slug}",
        daemon=True,
    )
    thread.start()


def _bytes_to_gib(value: int) -> float:
    return max(0, value) / (1024**3)


def _gpu_memory_bytes(device_index: int) -> tuple[int | None, int | None]:
    """返回 (total_bytes, used_bytes)；不可用时为 (None, None)。"""
    try:
        import torch

        free_b, total_b = torch.cuda.mem_get_info(device_index)
        total_i = int(total_b)
        used_i = max(0, total_i - int(free_b))
        return total_i, used_i
    except Exception:
        try:
            import torch

            props = torch.cuda.get_device_properties(device_index)
            return int(props.total_memory), None
        except Exception:
            return None, None


def list_devices() -> list[dict[str, Any]]:
    devices: list[dict[str, Any]] = [{"id": "cpu", "label": "CPU"}]
    try:
        import torch

        if not torch.cuda.is_available():
            return devices
        n = torch.cuda.device_count()
        for i in range(n):
            try:
                name = torch.cuda.get_device_name(i)
                total_b, used_b = _gpu_memory_bytes(i)
                if total_b is not None and used_b is not None:
                    label = (
                        f"GPU {i}: {name} "
                        f"({_bytes_to_gib(used_b):.1f}/{_bytes_to_gib(total_b):.1f} GB)"
                    )
                elif total_b is not None:
                    label = f"GPU {i}: {name} (共 {_bytes_to_gib(total_b):.1f} GB)"
                else:
                    label = f"GPU {i}: {name}"
                entry: dict[str, Any] = {"id": str(i), "label": label}
                if total_b is not None:
                    entry["memory_total_bytes"] = total_b
                if used_b is not None:
                    entry["memory_used_bytes"] = used_b
                devices.append(entry)
            except Exception:
                devices.append({"id": str(i), "label": f"GPU {i}: （不可用）"})
    except Exception:
        pass
    return devices


def _nvidia_smi_gpu_count() -> int | None:
    try:
        import subprocess

        result = subprocess.run(
            ["nvidia-smi", "-L"],
            capture_output=True,
            text=True,
            timeout=10,
            check=False,
        )
        if result.returncode != 0:
            return None
        lines = [ln for ln in (result.stdout or "").splitlines() if ln.strip().startswith("GPU ")]
        return len(lines) if lines else None
    except Exception:
        return None


def cuda_device_environment() -> dict[str, Any]:
    """供 /devices 诊断：PyTorch 可见卡数 vs nvidia-smi / CUDA_VISIBLE_DEVICES。"""
    import os

    out: dict[str, Any] = {
        "torch_cuda_device_count": 0,
        "cuda_visible_devices": os.environ.get("CUDA_VISIBLE_DEVICES", ""),
        "nvidia_smi_gpu_count": _nvidia_smi_gpu_count(),
    }
    try:
        import torch

        if torch.cuda.is_available():
            out["torch_cuda_device_count"] = int(torch.cuda.device_count())
    except Exception:
        pass
    return out
