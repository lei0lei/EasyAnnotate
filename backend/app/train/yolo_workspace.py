"""YOLO 训练工作区：`backend/external/temp/<训练名>/` 每次训练独立目录。"""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import sys
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from app.model_resources import (
    ensure_asset,
    get_backend_root,
    get_resources_root,
    iter_registry_weight_asset_ids,
    resolve_asset_paths,
)

TEMP_ROOT_NAME = "temp"
DATASET_ZIP_NAME = "dataset.zip"
DATASET_DIR_NAME = "dataset"
BASE_MODEL_NAME = "base_model.pt"
META_NAME = "workspace.json"
RUNS_DIR_NAME = "runs"
TRAIN_LOG_NAME = "train.log"


def get_temp_root() -> Path:
    root = get_backend_root() / "external" / TEMP_ROOT_NAME
    root.mkdir(parents=True, exist_ok=True)
    return root


def sanitize_training_slug(display_name: str) -> str:
    trimmed = display_name.strip()
    if not trimmed:
        raise ValueError("训练名称不能为空")
    slug = re.sub(r'[<>:"/\\|?*\u0000-\u001f]', "_", trimmed)
    slug = re.sub(r"\s+", "_", slug).strip("._")
    if not slug:
        raise ValueError("训练名称无效")
    return slug[:120]


def get_job_dir(job_slug: str) -> Path:
    return get_temp_root() / job_slug


def meta_path_for(job_slug: str) -> Path:
    return get_job_dir(job_slug) / META_NAME


def load_meta(job_slug: str) -> dict[str, Any]:
    path = meta_path_for(job_slug)
    if not path.is_file():
        return {}
    try:
        with path.open(encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except (OSError, json.JSONDecodeError):
        return {}


def save_meta(job_slug: str, patch: dict[str, Any]) -> dict[str, Any]:
    data = load_meta(job_slug)
    data.update(patch)
    job_dir = get_job_dir(job_slug)
    job_dir.mkdir(parents=True, exist_ok=True)
    meta_path_for(job_slug).write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
    return data


def prepare_job(display_name: str) -> dict[str, Any]:
    """为本次训练新建 ``temp/<slug>/``；同名目录已存在则报错。"""
    slug = sanitize_training_slug(display_name)
    job_dir = get_job_dir(slug)
    if job_dir.exists():
        raise ValueError(f"训练名称「{display_name}」已存在，请换一个名称")
    job_dir.mkdir(parents=True, exist_ok=False)
    now = datetime.now(timezone.utc).isoformat()
    save_meta(
        slug,
        {
            "display_name": display_name.strip(),
            "job_slug": slug,
            "created_at": now,
            "status": "prepared",
        },
    )
    return {"job_slug": slug, "job_dir": str(job_dir), "display_name": display_name.strip(), "created_at": now}


def dataset_zip_path(job_slug: str) -> Path:
    return get_job_dir(job_slug) / DATASET_ZIP_NAME


def dataset_dir_path(job_slug: str) -> Path:
    return get_job_dir(job_slug) / DATASET_DIR_NAME


def base_model_path(job_slug: str) -> Path:
    """兼容旧任务；新逻辑请用 ``resolve_base_model_path``。"""
    resolved = resolve_base_model_path(job_slug)
    if resolved is not None:
        return resolved
    return get_job_dir(job_slug) / BASE_MODEL_NAME


def sanitize_weight_filename(filename: str) -> str:
    """保留上传/registry 原始文件名（仅做安全字符处理）。"""
    raw = Path(filename).name.strip()
    if not raw:
        raise ValueError("权重文件名为空")
    if not raw.lower().endswith(".pt"):
        raw = f"{raw}.pt"
    stem = raw[: -len(".pt")]
    safe_stem = re.sub(r'[<>:"/\\|?*\u0000-\u001f]', "_", stem)
    safe_stem = re.sub(r"\s+", "_", safe_stem).strip("._")
    if not safe_stem:
        raise ValueError("权重文件名无效")
    return f"{safe_stem[:116]}.pt"


def _remove_job_root_weights(job_slug: str, *, except_path: Path | None = None) -> None:
    job_dir = get_job_dir(job_slug)
    if not job_dir.is_dir():
        return
    keep = except_path.resolve() if except_path is not None else None
    for pt in job_dir.glob("*.pt"):
        if not pt.is_file():
            continue
        if keep is not None and pt.resolve() == keep:
            continue
        pt.unlink(missing_ok=True)


def resolve_base_model_path(job_slug: str) -> Path | None:
    """当前任务用于训练的 .pt（meta 记录路径，兼容旧版 base_model.pt）。"""
    meta = load_meta(job_slug)
    path_s = meta.get("base_model_path")
    if isinstance(path_s, str) and path_s.strip():
        p = Path(path_s)
        if p.is_file():
            return p.resolve()
    legacy = get_job_dir(job_slug) / BASE_MODEL_NAME
    if legacy.is_file():
        return legacy.resolve()
    return None


def runs_dir_path(job_slug: str) -> Path:
    return get_job_dir(job_slug) / RUNS_DIR_NAME


def train_log_path(job_slug: str) -> Path:
    return get_job_dir(job_slug) / TRAIN_LOG_NAME


def append_train_log(job_slug: str, line: str) -> None:
    path = train_log_path(job_slug)
    path.parent.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
    with path.open("a", encoding="utf-8") as f:
        f.write(f"[{stamp}] {line}\n")


def workspace_snapshot(job_slug: str) -> dict[str, Any]:
    job_dir = get_job_dir(job_slug)
    if not job_dir.is_dir():
        raise FileNotFoundError(f"训练目录不存在：{job_slug}")
    zip_path = dataset_zip_path(job_slug)
    data_dir = dataset_dir_path(job_slug)
    meta = load_meta(job_slug)
    base_pt = resolve_base_model_path(job_slug)
    data_yaml = find_data_yaml(data_dir) if data_dir.is_dir() else None
    filename = meta.get("base_model_filename")
    if not isinstance(filename, str) or not filename.strip():
        filename = base_pt.name if base_pt is not None else None
    return {
        "job_slug": job_slug,
        "job_dir": str(job_dir),
        "display_name": meta.get("display_name", job_slug),
        "created_at": meta.get("created_at"),
        "dataset_zip": str(zip_path) if zip_path.is_file() else None,
        "dataset_zip_filename": meta.get("dataset_zip_filename"),
        "dataset_dir": str(data_dir) if data_dir.is_dir() else None,
        "data_yaml": str(data_yaml) if data_yaml else None,
        "base_model": str(base_pt) if base_pt is not None else None,
        "base_model_filename": filename,
        "base_model_asset_id": meta.get("base_model_asset_id"),
        "train_log": str(train_log_path(job_slug)) if train_log_path(job_slug).is_file() else None,
        "meta": meta,
    }


def find_data_yaml(root: Path) -> Path | None:
    if not root.is_dir():
        return None
    direct = root / "data.yaml"
    if direct.is_file():
        return direct
    for path in root.rglob("data.yaml"):
        if path.is_file():
            return path
    return None


def _path_for_yaml(value: Path) -> str:
    """写入 yaml 的绝对路径（统一为正斜杠，避免 Windows 下拼接异常）。"""
    return value.resolve().as_posix()


_DATASET_SPLIT_KEYS = ("train", "val", "test")


def _split_path_missing(dataset_root: Path, value: Any) -> bool:
    """train/val/test 未配置或指向的目录不存在时视为缺少。"""
    if value is None:
        return True
    if isinstance(value, (list, tuple)):
        if not value:
            return True
        value = value[0]
    if not isinstance(value, str) or not value.strip():
        return True
    rel = value.strip().replace("\\", "/")
    if rel in (".", "./"):
        return False
    candidate = Path(rel)
    resolved = candidate if candidate.is_absolute() else (dataset_root / candidate)
    try:
        resolved = resolved.resolve()
    except OSError:
        return True
    return not resolved.is_dir()


def _normalize_dataset_split_paths(raw: dict[str, Any], dataset_root: Path) -> list[str]:
    """缺少的 train/val/test 统一为 ``.``（相对 path 根目录的当前目录）。"""
    changed: list[str] = []
    for key in _DATASET_SPLIT_KEYS:
        if _split_path_missing(dataset_root, raw.get(key)):
            if raw.get(key) != ".":
                raw[key] = "."
                changed.append(key)
    return changed


def fix_data_yaml_path_after_unpack(data_yaml: Path, job_slug: str) -> Path:
    """
    解压后原地更新 data.yaml：path 设为数据集根绝对路径；
    缺少或无效的 train/val/test 设为 ``.``（相对 path 的当前目录）。
    """
    import yaml

    if not data_yaml.is_file():
        raise FileNotFoundError(f"data.yaml 不存在：{data_yaml}")

    with data_yaml.open(encoding="utf-8") as f:
        raw = yaml.safe_load(f)

    if raw is None:
        raw = {}
    if not isinstance(raw, dict):
        raise ValueError("data.yaml 根节点必须是映射（dict）")

    yaml_dir = data_yaml.parent.resolve()
    path_val = raw.get("path")
    if path_val is None or (isinstance(path_val, str) and not str(path_val).strip()):
        dataset_root = yaml_dir
    else:
        p = Path(str(path_val))
        dataset_root = p.resolve() if p.is_absolute() else (yaml_dir / p).resolve()

    if not dataset_root.is_dir():
        raise ValueError(f"数据集根目录不存在：{dataset_root}")

    raw["path"] = _path_for_yaml(dataset_root)
    split_fixed = _normalize_dataset_split_paths(raw, dataset_root)
    data_yaml.write_text(yaml.safe_dump(raw, allow_unicode=True, sort_keys=False), encoding="utf-8")
    resolved = data_yaml.resolve()
    save_meta(
        job_slug,
        {
            "data_yaml": str(resolved),
            "dataset_root": raw["path"],
            "dataset_ready": True,
        },
    )
    log = f"已修正 data.yaml 的 path={raw['path']}"
    if split_fixed:
        log += f"；train/val/test 缺省目录已设为 .：{', '.join(split_fixed)}"
    append_train_log(job_slug, log)
    return resolved


def _store_dataset_zip_display_name(job_slug: str, original_filename: str | None) -> str | None:
    if not original_filename or not str(original_filename).strip():
        return None
    name = Path(str(original_filename).strip()).name
    if not name:
        return None
    save_meta(job_slug, {"dataset_zip_filename": name})
    return name


def _extract_zip_to_dir(zip_path: Path, dest: Path, job_slug: str) -> str:
    """Windows 使用系统 tar.exe；Linux 使用 unzip；失败时回退 zipfile。"""
    dest.mkdir(parents=True, exist_ok=True)
    errors: list[str] = []

    if sys.platform == "win32":
        tar_exe = Path(os.environ.get("SystemRoot", r"C:\Windows")) / "System32" / "tar.exe"
        if tar_exe.is_file():
            try:
                subprocess.run(
                    [str(tar_exe), "-xf", str(zip_path.resolve()), "-C", str(dest.resolve())],
                    check=True,
                    capture_output=True,
                    text=True,
                )
                append_train_log(job_slug, f"使用 {tar_exe.name} 解压数据集")
                return "tar"
            except (OSError, subprocess.CalledProcessError) as e:
                err = e.stderr if isinstance(e, subprocess.CalledProcessError) and e.stderr else str(e)
                errors.append(f"tar: {err}")

    else:
        try:
            subprocess.run(
                ["unzip", "-o", str(zip_path.resolve()), "-d", str(dest.resolve())],
                check=True,
                capture_output=True,
                text=True,
            )
            append_train_log(job_slug, "使用 unzip 解压数据集")
            return "unzip"
        except (OSError, subprocess.CalledProcessError) as e:
            err = e.stderr if isinstance(e, subprocess.CalledProcessError) and e.stderr else str(e)
            errors.append(f"unzip: {err}")

    try:
        with zipfile.ZipFile(zip_path, "r") as zf:
            zf.extractall(dest)
        if errors:
            append_train_log(job_slug, f"系统解压失败，已回退 zipfile（{'；'.join(errors)}）")
        else:
            append_train_log(job_slug, "使用 zipfile 解压数据集")
        return "zipfile"
    except Exception as e:
        hint = "；".join(errors + [f"zipfile: {e}"])
        raise ValueError(f"解压数据集失败：{hint}") from e


def unpack_dataset_zip(job_slug: str, *, original_zip_filename: str | None = None) -> Path:
    zip_path = dataset_zip_path(job_slug)
    if not zip_path.is_file():
        raise FileNotFoundError("未找到 dataset.zip，请先上传或复制数据集压缩包")
    display = _store_dataset_zip_display_name(job_slug, original_zip_filename)
    dest = dataset_dir_path(job_slug)
    if dest.exists():
        shutil.rmtree(dest)
    dest.mkdir(parents=True, exist_ok=True)
    _extract_zip_to_dir(zip_path, dest, job_slug)
    data_yaml = find_data_yaml(dest)
    if data_yaml is None:
        raise ValueError("解压后的数据集中未找到 data.yaml（Ultralytics 训练所需）")
    log_name = display or zip_path.name
    append_train_log(job_slug, f"数据集已解压（{log_name}）：{data_yaml}")
    return fix_data_yaml_path_after_unpack(data_yaml, job_slug)


def copy_dataset_zip_from(job_slug: str, source: Path) -> Path:
    if not source.is_file():
        raise FileNotFoundError(f"源文件不存在：{source}")
    if source.suffix.lower() != ".zip":
        raise ValueError("仅支持 .zip 数据集")
    dest = dataset_zip_path(job_slug)
    dest.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, dest)
    _store_dataset_zip_display_name(job_slug, source.name)
    save_meta(job_slug, {"dataset_zip": str(dest)})
    append_train_log(job_slug, f"已复制数据集 zip：{source.name}")
    return dest


def resolve_ultralytics_weight_path(asset_id: str) -> Path:
    """registry 资源或 ``external/resources/ultralytics/**/*.pt`` 磁盘文件。"""
    aid = asset_id.strip()
    rp = resolve_asset_paths(aid)
    if rp is not None and rp.exists:
        return rp.full_path
    direct = (get_resources_root() / f"{aid}.pt").resolve()
    if direct.is_file():
        return direct
    raise FileNotFoundError(f"未找到权重文件：{aid}（请确认 external/resources 下存在对应 .pt）")


def set_base_model_from_asset(job_slug: str, asset_id: str, *, family: str, task: str) -> Path:
    aid = asset_id.strip()
    if not asset_matches_family(aid, family):
        raise ValueError(f"所选权重与模型系列「{family}」不匹配")
    if not asset_matches_task(aid, task):
        raise ValueError(f"所选权重与训练任务「{task}」不匹配")
    try:
        ckpt = ensure_asset(aid)
    except KeyError:
        ckpt = resolve_ultralytics_weight_path(aid)
    except ValueError:
        ckpt = resolve_ultralytics_weight_path(aid)
    from app.train.yolo_checkpoint import validate_yolo_checkpoint

    validation = validate_yolo_checkpoint(ckpt, family=family, task=task, filename=_asset_basename(asset_id))
    dest_name = sanitize_weight_filename(_asset_basename(asset_id))
    dest = get_job_dir(job_slug) / dest_name
    dest.parent.mkdir(parents=True, exist_ok=True)
    _remove_job_root_weights(job_slug)
    shutil.copy2(ckpt, dest)
    save_meta(
        job_slug,
        {
            "base_model_asset_id": asset_id,
            "base_model_path": str(dest.resolve()),
            "base_model_filename": dest_name,
            "base_model_family": family,
            "base_model_task": task,
            "base_model_weight_meta": validation.meta.as_dict(),
            "base_model_weight_warnings": list(validation.warnings),
        },
    )
    append_train_log(
        job_slug,
        f"已选用初始权重：{dest_name}（{asset_id}，task={validation.meta.task}）",
    )
    return dest.resolve()


def validate_job_base_model(job_slug: str, *, family: str, task: str) -> dict[str, Any]:
    path = resolve_base_model_path(job_slug)
    if path is None or not path.is_file():
        raise ValueError("未设置基础模型权重")
    meta = load_meta(job_slug)
    filename = meta.get("base_model_filename")
    from app.train.yolo_checkpoint import validate_yolo_checkpoint

    validation = validate_yolo_checkpoint(
        path,
        family=family,
        task=task,
        filename=str(filename) if filename else None,
    )
    save_meta(
        job_slug,
        {
            "base_model_family": family,
            "base_model_task": task,
            "base_model_weight_meta": validation.meta.as_dict(),
            "base_model_weight_warnings": list(validation.warnings),
        },
    )
    return validation.as_dict()


def save_uploaded_base_model(
    job_slug: str,
    source: Path,
    *,
    original_filename: str,
    family: str,
    task: str,
) -> Path:
    if not source.is_file():
        raise FileNotFoundError("权重文件不存在")
    if source.suffix.lower() != ".pt":
        raise ValueError("仅支持 .pt 权重")
    from app.train.yolo_checkpoint import validate_yolo_checkpoint

    validation = validate_yolo_checkpoint(source, family=family, task=task, filename=original_filename)
    dest_name = sanitize_weight_filename(original_filename)
    dest = get_job_dir(job_slug) / dest_name
    dest.parent.mkdir(parents=True, exist_ok=True)
    _remove_job_root_weights(job_slug)
    shutil.copy2(source, dest)
    resolved = dest.resolve()
    save_meta(
        job_slug,
        {
            "base_model_asset_id": None,
            "base_model_path": str(resolved),
            "base_model_filename": dest_name,
            "base_model_family": family,
            "base_model_task": task,
            "base_model_weight_meta": validation.meta.as_dict(),
            "base_model_weight_warnings": list(validation.warnings),
        },
    )
    append_train_log(
        job_slug,
        f"已上传权重：{dest_name}（校验 task={validation.meta.task} family={validation.meta.family}）",
    )
    return resolved


def _history_model_label(meta: dict[str, Any]) -> str | None:
    fn = meta.get("base_model_filename")
    if isinstance(fn, str) and fn.strip():
        return fn.strip()
    aid = meta.get("base_model_asset_id")
    if isinstance(aid, str) and aid.strip():
        return aid.strip()
    path_s = meta.get("base_model_path")
    if isinstance(path_s, str) and path_s.strip():
        return Path(path_s).name
    weight_meta = meta.get("base_model_weight_meta")
    if isinstance(weight_meta, dict):
        name = weight_meta.get("model_name")
        if isinstance(name, str) and name.strip():
            return name.strip()
    return None


def _history_train_imgsz(meta: dict[str, Any]) -> int | None:
    train_params = meta.get("train_params")
    if not isinstance(train_params, dict):
        return None
    try:
        value = int(train_params.get("imgsz") or 0)
    except (TypeError, ValueError):
        return None
    return value if value > 0 else None


def _history_progress_fields(meta: dict[str, Any], live: dict[str, Any] | None) -> dict[str, Any]:
    status = meta.get("status", "unknown")
    progress = int(meta.get("train_progress") or 0)
    epoch = int(meta.get("train_epoch") or 0)
    epochs = int(meta.get("train_epochs") or 0)
    train_params = meta.get("train_params")
    if epochs <= 0 and isinstance(train_params, dict):
        try:
            epochs = int(train_params.get("epochs") or 0)
        except (TypeError, ValueError):
            epochs = 0

    if live and live.get("job_slug") == meta.get("job_slug") and live.get("status") == "running":
        status = "running"
        progress = int(live.get("progress") or progress)
        epoch = int(live.get("epoch") or epoch)
        live_epochs = int(live.get("epochs") or 0)
        if live_epochs > 0:
            epochs = live_epochs

    return {
        "status": status if isinstance(status, str) else "unknown",
        "progress": max(0, min(100, progress)),
        "epoch": max(0, epoch),
        "epochs": max(0, epochs),
    }


def list_training_history() -> list[dict[str, Any]]:
    """扫描 ``external/temp`` 下子目录（每次进入页面重新解析）。"""
    from app.train import yolo_runner

    root = get_temp_root()
    items: list[dict[str, Any]] = []
    if not root.is_dir():
        return items
    for child in sorted(root.iterdir()):
        if not child.is_dir():
            continue
        slug = child.name
        meta = load_meta(slug)
        meta_with_slug = {**meta, "job_slug": slug}
        created_at = meta.get("created_at")
        if not isinstance(created_at, str) or not created_at.strip():
            try:
                created_at = datetime.fromtimestamp(child.stat().st_ctime, tz=timezone.utc).isoformat()
            except OSError:
                created_at = ""
        progress_fields = _history_progress_fields(meta_with_slug, yolo_runner.get_job(slug))
        family = meta.get("base_model_family")
        task = meta.get("base_model_task")
        items.append(
            {
                "job_slug": slug,
                "display_name": meta.get("display_name", slug),
                "created_at": created_at,
                "job_dir": str(child),
                "family": family if isinstance(family, str) else None,
                "task": task if isinstance(task, str) else None,
                "model_label": _history_model_label(meta),
                "imgsz": _history_train_imgsz(meta),
                **progress_fields,
            },
        )
    items.sort(key=lambda x: str(x.get("created_at", "")), reverse=True)
    return items


def assert_safe_job_slug(job_slug: str) -> str:
    slug = (job_slug or "").strip()
    if not slug or slug in (".", ".."):
        raise ValueError("无效的训练任务标识")
    if "/" in slug or "\\" in slug or "\x00" in slug:
        raise ValueError("无效的训练任务标识")
    return slug


def delete_training_job(job_slug: str) -> None:
    """删除 ``external/temp/<job_slug>/``；进行中的任务不可删除。"""
    from app.train import yolo_runner

    slug = assert_safe_job_slug(job_slug)
    job_dir = get_job_dir(slug)
    root = get_temp_root().resolve()
    try:
        resolved = job_dir.resolve()
    except OSError as e:
        raise FileNotFoundError(f"训练目录不存在：{slug}") from e
    if resolved != root and root not in resolved.parents:
        raise ValueError("无效的训练任务路径")

    if yolo_runner.is_job_running(slug):
        raise ValueError("训练任务进行中，无法删除")

    if not job_dir.is_dir():
        raise FileNotFoundError(f"训练目录不存在：{slug}")

    shutil.rmtree(job_dir)


_RESULT_IMAGE_SUFFIXES = frozenset({".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp"})
_RESULT_IMAGE_PRIORITY = (
    "results.png",
    "confusion_matrix_normalized.png",
    "confusion_matrix.png",
    "F1_curve.png",
    "PR_curve.png",
    "P_curve.png",
    "R_curve.png",
    "labels.jpg",
    "labels_correlogram.jpg",
)


def _result_image_sort_key(item: dict[str, Any]) -> tuple[int, str]:
    name = str(item.get("name") or "").lower()
    try:
        prio = _RESULT_IMAGE_PRIORITY.index(name)
    except ValueError:
        prio = len(_RESULT_IMAGE_PRIORITY)
    return (prio, str(item.get("path") or ""))


def _collect_result_search_roots(job_slug: str, meta: dict[str, Any]) -> list[Path]:
    runs = runs_dir_path(job_slug)
    if not runs.is_dir():
        return []
    roots: list[Path] = []
    last_run = meta.get("last_run")
    if isinstance(last_run, str) and last_run.strip():
        p = Path(last_run.strip())
        if p.is_dir():
            try:
                p.resolve().relative_to(runs.resolve())
                roots.append(p.resolve())
            except ValueError:
                pass
    if not roots:
        train_dirs = sorted(
            (p for p in runs.glob("train*") if p.is_dir()),
            key=lambda p: p.stat().st_mtime,
            reverse=True,
        )
        roots.extend(train_dirs)
    if not roots:
        roots.append(runs.resolve())
    return roots


def list_training_result_images(job_slug: str) -> dict[str, Any]:
    """扫描 ``runs/`` 下 Ultralytics 训练产物图片。"""
    slug = assert_safe_job_slug(job_slug)
    job_dir = get_job_dir(slug)
    if not job_dir.is_dir():
        raise FileNotFoundError(f"训练目录不存在：{slug}")
    runs = runs_dir_path(slug)
    meta = load_meta(slug)
    items: list[dict[str, Any]] = []
    seen: set[str] = set()
    for root in _collect_result_search_roots(slug, meta):
        for path in sorted(root.rglob("*")):
            if not path.is_file():
                continue
            if path.suffix.lower() not in _RESULT_IMAGE_SUFFIXES:
                continue
            try:
                rel = path.resolve().relative_to(runs.resolve()).as_posix()
            except ValueError:
                continue
            if rel in seen:
                continue
            seen.add(rel)
            stat = path.stat()
            items.append(
                {
                    "path": rel,
                    "name": path.name,
                    "mtime": int(stat.st_mtime),
                    "size": stat.st_size,
                }
            )
    items.sort(key=_result_image_sort_key)
    run_label = None
    last_run = meta.get("last_run")
    if isinstance(last_run, str) and last_run.strip():
        run_label = last_run.strip()
    return {
        "job_slug": slug,
        "runs_dir": str(runs),
        "run_dir": run_label,
        "items": items,
    }


def resolve_training_result_image(job_slug: str, rel_path: str) -> Path:
    slug = assert_safe_job_slug(job_slug)
    rel = (rel_path or "").strip().replace("\\", "/").lstrip("/")
    if not rel or ".." in rel.split("/"):
        raise ValueError("无效的图片路径")
    runs = runs_dir_path(slug).resolve()
    if not runs.is_dir():
        raise FileNotFoundError(f"训练目录不存在：{slug}")
    full = (runs / rel).resolve()
    try:
        full.relative_to(runs)
    except ValueError as e:
        raise ValueError("无效的图片路径") from e
    if not full.is_file() or full.suffix.lower() not in _RESULT_IMAGE_SUFFIXES:
        raise FileNotFoundError(f"图片不存在：{rel}")
    return full


_MODEL_FILE_SUFFIXES = frozenset({".pt", ".onnx"})
_MODEL_FILE_PRIORITY = ("best.pt", "last.pt", "best.onnx", "last.onnx")


def _model_file_sort_key(item: dict[str, Any]) -> tuple[int, str]:
    name = str(item.get("name") or "").lower()
    try:
        prio = _MODEL_FILE_PRIORITY.index(name)
    except ValueError:
        prio = len(_MODEL_FILE_PRIORITY)
    return (prio, str(item.get("path") or ""))


def list_training_model_files(job_slug: str) -> dict[str, Any]:
    """扫描训练任务目录下全部 ``.pt`` / ``.onnx`` 权重文件。"""
    slug = assert_safe_job_slug(job_slug)
    job_dir = get_job_dir(slug)
    if not job_dir.is_dir():
        raise FileNotFoundError(f"训练目录不存在：{slug}")
    job_root = job_dir.resolve()
    items: list[dict[str, Any]] = []
    seen: set[str] = set()
    for path in sorted(job_root.rglob("*")):
        if not path.is_file():
            continue
        if path.suffix.lower() not in _MODEL_FILE_SUFFIXES:
            continue
        try:
            rel = path.resolve().relative_to(job_root).as_posix()
        except ValueError:
            continue
        if rel in seen:
            continue
        seen.add(rel)
        stat = path.stat()
        items.append(
            {
                "path": rel,
                "name": path.name,
                "kind": path.suffix.lower().lstrip("."),
                "mtime": int(stat.st_mtime),
                "size": stat.st_size,
            }
        )
    items.sort(key=_model_file_sort_key)
    return {"job_slug": slug, "job_dir": str(job_root), "items": items}


def resolve_training_model_file(job_slug: str, rel_path: str) -> Path:
    slug = assert_safe_job_slug(job_slug)
    rel = (rel_path or "").strip().replace("\\", "/").lstrip("/")
    if not rel or ".." in rel.split("/"):
        raise ValueError("无效的模型路径")
    job_dir = get_job_dir(slug).resolve()
    if not job_dir.is_dir():
        raise FileNotFoundError(f"训练目录不存在：{slug}")
    full = (job_dir / rel).resolve()
    try:
        full.relative_to(job_dir)
    except ValueError as e:
        raise ValueError("无效的模型路径") from e
    if not full.is_file() or full.suffix.lower() not in _MODEL_FILE_SUFFIXES:
        raise FileNotFoundError(f"模型文件不存在：{rel}")
    return full


def read_training_logs(job_slug: str, *, tail_bytes: int = 512_000) -> str:
    job_dir = get_job_dir(job_slug)
    if not job_dir.is_dir():
        raise FileNotFoundError(f"训练目录不存在：{job_slug}")

    chunks: list[str] = []
    log_path = train_log_path(job_slug)
    if log_path.is_file():
        chunks.append(_read_tail(log_path, tail_bytes, header="=== train.log ==="))

    runs = runs_dir_path(job_slug)
    if runs.is_dir():
        for path in sorted(runs.rglob("results.csv")):
            rel = path.relative_to(job_dir)
            chunks.append(_read_tail(path, min(tail_bytes, 64_000), header=f"=== {rel.as_posix()} ==="))
        for name in ("args.yaml", "results.txt"):
            for path in sorted(runs.rglob(name))[:5]:
                rel = path.relative_to(job_dir)
                chunks.append(_read_tail(path, min(tail_bytes, 32_000), header=f"=== {rel.as_posix()} ==="))

    if not chunks:
        return "（暂无训练日志；训练开始后会写入 train.log 与 runs/ 下文件）"
    return "\n\n".join(chunks)


def _read_tail(path: Path, max_bytes: int, header: str) -> str:
    try:
        size = path.stat().st_size
        with path.open("rb") as f:
            if size > max_bytes:
                f.seek(-max_bytes, 2)
            raw = f.read()
        text = raw.decode("utf-8", errors="replace")
        prefix = f"...(仅显示末尾 {max_bytes} 字节)\n" if size > max_bytes else ""
        return f"{header}\n{prefix}{text}"
    except OSError as e:
        return f"{header}\n(无法读取: {e})"


YOLO_FAMILIES: dict[str, tuple[str, ...]] = {
    "yolov8": ("yolov8",),
    "yolo26": ("yolo11", "yolo26", "yolov26"),
}

YOLO_TASKS = ("detect", "segment", "pose", "obb", "classify")


def _asset_basename(asset_id: str) -> str:
    return asset_id.split("/")[-1].lower()


def asset_matches_family(asset_id: str, family: str) -> bool:
    patterns = YOLO_FAMILIES.get(family, ())
    base = _asset_basename(asset_id)
    return any(p in base for p in patterns)


def asset_matches_task(asset_id: str, task: str) -> bool:
    base = _asset_basename(asset_id)
    if task == "detect":
        return not any(s in base for s in ("-seg", "-pose", "-obb", "-cls"))
    if task == "segment":
        return "-seg" in base
    if task == "pose":
        return "-pose" in base
    if task == "obb":
        return "-obb" in base
    if task == "classify":
        return "-cls" in base
    return False


def _iter_ultralytics_pt_asset_ids() -> list[str]:
    """合并 registry 与 ``external/resources/ultralytics`` 目录下已存在的 .pt。"""
    seen: set[str] = set()
    ordered: list[str] = []

    def add(aid: str) -> None:
        if aid in seen or not aid.startswith("ultralytics/"):
            return
        seen.add(aid)
        ordered.append(aid)

    for aid in iter_registry_weight_asset_ids("ultralytics/", extensions=(".pt",)):
        add(aid)

    udir = get_resources_root() / "ultralytics"
    if udir.is_dir():
        resources = get_resources_root().resolve()
        for pt in sorted(udir.rglob("*.pt")):
            if not pt.is_file():
                continue
            rel = pt.resolve().relative_to(resources).as_posix()
            if not rel.lower().endswith(".pt"):
                continue
            add(rel[: -len(".pt")])

    return ordered


def list_catalog_models(family: str, task: str) -> list[dict[str, str]]:
    out: list[dict[str, str]] = []
    for asset_id in _iter_ultralytics_pt_asset_ids():
        if not asset_matches_family(asset_id, family):
            continue
        if not asset_matches_task(asset_id, task):
            continue
        try:
            resolve_ultralytics_weight_path(asset_id)
        except FileNotFoundError:
            continue
        label = _asset_basename(asset_id).removesuffix(".pt")
        out.append({"asset_id": asset_id, "label": label})
    return out
