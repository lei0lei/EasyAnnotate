"""DINOv2 训练工作区：`backend/external/temp/dinov2/<训练名>/`。"""

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

from app.model_resources import ensure_asset, get_backend_root, iter_registry_weight_asset_ids, resolve_asset_paths

TEMP_SEGMENT = "dinov2"
DATASET_ZIP_NAME = "dataset.zip"
DATASET_DIR_NAME = "dataset"
META_NAME = "workspace.json"
TRAIN_LOG_NAME = "train.log"
RUNS_DIR_NAME = "runs"
IMAGE_EXTS = frozenset({".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tif", ".tiff"})

DINOV2_OBJECTIVES: dict[str, str] = {
    "linear_probe": "线性探针",
    "fine_tune": "全量微调",
    "partial_tune": "部分解冻",
}


def get_temp_root() -> Path:
    root = get_backend_root() / "external" / "temp" / TEMP_SEGMENT
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
            "trainer": "dinov2",
        },
    )
    return {"job_slug": slug, "job_dir": str(job_dir), "display_name": display_name.strip(), "created_at": now}


def dataset_zip_path(job_slug: str) -> Path:
    return get_job_dir(job_slug) / DATASET_ZIP_NAME


def dataset_dir_path(job_slug: str) -> Path:
    return get_job_dir(job_slug) / DATASET_DIR_NAME


def train_log_path(job_slug: str) -> Path:
    return get_job_dir(job_slug) / TRAIN_LOG_NAME


def runs_dir_path(job_slug: str) -> Path:
    return get_job_dir(job_slug) / RUNS_DIR_NAME


def append_train_log(job_slug: str, line: str) -> None:
    path = train_log_path(job_slug)
    path.parent.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
    with path.open("a", encoding="utf-8") as f:
        f.write(f"[{stamp}] {line}\n")


def sanitize_weight_filename(filename: str) -> str:
    raw = Path(filename).name.strip()
    if not raw:
        raise ValueError("权重文件名为空")
    if not raw.lower().endswith(".pth"):
        raw = f"{raw}.pth"
    stem = raw[: -len(".pth")]
    safe_stem = re.sub(r'[<>:"/\\|?*\u0000-\u001f]', "_", stem)
    safe_stem = re.sub(r"\s+", "_", safe_stem).strip("._")
    if not safe_stem:
        raise ValueError("权重文件名无效")
    return f"{safe_stem[:116]}.pth"


def _remove_job_root_weights(job_slug: str, *, except_path: Path | None = None) -> None:
    job_dir = get_job_dir(job_slug)
    if not job_dir.is_dir():
        return
    keep = except_path.resolve() if except_path is not None else None
    for pth in job_dir.glob("*.pth"):
        if not pth.is_file():
            continue
        if keep is not None and pth.resolve() == keep:
            continue
        pth.unlink(missing_ok=True)


def resolve_base_model_path(job_slug: str) -> Path | None:
    meta = load_meta(job_slug)
    path_s = meta.get("base_model_path")
    if isinstance(path_s, str) and path_s.strip():
        p = Path(path_s)
        if p.is_file():
            return p.resolve()
    return None


def count_images_under(root: Path) -> int:
    if not root.is_dir():
        return 0
    n = 0
    for path in root.rglob("*"):
        if path.is_file() and path.suffix.lower() in IMAGE_EXTS:
            n += 1
    return n


def dataset_ready_for(job_slug: str) -> tuple[bool, int]:
    meta = load_meta(job_slug)
    if meta.get("dataset_ready") is True:
        count = meta.get("dataset_image_count")
        return True, int(count) if isinstance(count, int) else count_images_under(dataset_dir_path(job_slug))
    data_dir = dataset_dir_path(job_slug)
    count = count_images_under(data_dir)
    return count > 0, count


def workspace_snapshot(job_slug: str) -> dict[str, Any]:
    job_dir = get_job_dir(job_slug)
    if not job_dir.is_dir():
        raise FileNotFoundError(f"训练目录不存在：{job_slug}")
    zip_path = dataset_zip_path(job_slug)
    data_dir = dataset_dir_path(job_slug)
    meta = load_meta(job_slug)
    base_pth = resolve_base_model_path(job_slug)
    ready, image_count = dataset_ready_for(job_slug)
    filename = meta.get("base_model_filename")
    if not isinstance(filename, str) or not filename.strip():
        filename = base_pth.name if base_pth is not None else None
    return {
        "job_slug": job_slug,
        "job_dir": str(job_dir),
        "display_name": meta.get("display_name", job_slug),
        "created_at": meta.get("created_at"),
        "objective": meta.get("objective"),
        "dataset_zip": str(zip_path) if zip_path.is_file() else None,
        "dataset_zip_filename": meta.get("dataset_zip_filename"),
        "dataset_dir": str(data_dir) if data_dir.is_dir() else None,
        "dataset_ready": ready,
        "dataset_image_count": image_count,
        "base_model": str(base_pth) if base_pth is not None else None,
        "base_model_filename": filename,
        "base_model_asset_id": meta.get("base_model_asset_id"),
        "train_log": str(train_log_path(job_slug)) if train_log_path(job_slug).is_file() else None,
        "meta": meta,
    }


def _asset_basename(asset_id: str) -> str:
    return Path(asset_id.replace("/", "_")).name


def resolve_dinov2_weight_path(asset_id: str) -> Path:
    aid = asset_id.strip()
    if not aid.startswith("dinov2/"):
        raise ValueError(f"非 DINOv2 权重：{aid}")
    rp = resolve_asset_paths(aid)
    if rp is not None and rp.exists:
        return rp.full_path
    raise FileNotFoundError(f"未找到权重文件：{aid}")


def list_catalog_models() -> list[dict[str, str]]:
    out: list[dict[str, str]] = []
    for asset_id in iter_registry_weight_asset_ids("dinov2/", extensions=(".pth",)):
        try:
            resolve_dinov2_weight_path(asset_id)
        except (FileNotFoundError, ValueError):
            try:
                ensure_asset(asset_id)
            except (KeyError, ValueError, FileNotFoundError):
                continue
        label = _asset_basename(asset_id).removesuffix(".pth").replace("_", " ")
        out.append({"asset_id": asset_id, "label": label})
    out.sort(key=lambda x: x["asset_id"])
    return out


def set_base_model_from_asset(job_slug: str, asset_id: str, *, objective: str) -> Path:
    aid = asset_id.strip()
    if objective not in DINOV2_OBJECTIVES:
        raise ValueError(f"未知训练目标：{objective}")
    if not aid.startswith("dinov2/"):
        raise ValueError("请选择 registry 中的 DINOv2 预训练权重")
    try:
        ckpt = ensure_asset(aid)
    except (KeyError, ValueError):
        ckpt = resolve_dinov2_weight_path(aid)
    dest_name = sanitize_weight_filename(_asset_basename(aid))
    dest = get_job_dir(job_slug) / dest_name
    dest.parent.mkdir(parents=True, exist_ok=True)
    _remove_job_root_weights(job_slug)
    shutil.copy2(ckpt, dest)
    save_meta(
        job_slug,
        {
            "base_model_asset_id": asset_id,
            "base_model_arch_id": asset_id,
            "base_model_path": str(dest.resolve()),
            "base_model_filename": dest_name,
            "objective": objective,
        },
    )
    append_train_log(job_slug, f"已选用初始权重：{dest_name}（{asset_id}，objective={objective}）")
    return dest.resolve()


def set_base_model_from_upload(
    job_slug: str,
    raw: bytes,
    filename: str,
    *,
    objective: str,
    arch_asset_id: str | None = None,
) -> Path:
    if objective not in DINOV2_OBJECTIVES:
        raise ValueError(f"未知训练目标：{objective}")
    if not filename.lower().endswith(".pth"):
        raise ValueError("仅支持 .pth 权重")
    dest_name = sanitize_weight_filename(filename)
    dest = get_job_dir(job_slug) / dest_name
    dest.parent.mkdir(parents=True, exist_ok=True)
    _remove_job_root_weights(job_slug)
    dest.write_bytes(raw)
    meta = load_meta(job_slug)
    arch = (arch_asset_id or meta.get("base_model_arch_id") or "").strip()
    if not arch.startswith("dinov2/"):
        raise ValueError("上传自定义权重前请先在「预训练权重」下拉框中选择对应架构（registry 项）")
    patch: dict[str, Any] = {
        "base_model_asset_id": None,
        "base_model_arch_id": arch,
        "base_model_path": str(dest.resolve()),
        "base_model_filename": dest_name,
        "objective": objective,
    }
    save_meta(job_slug, patch)
    append_train_log(job_slug, f"已上传初始权重：{dest_name}（objective={objective}）")
    return dest.resolve()


def _store_dataset_zip_display_name(job_slug: str, original_filename: str | None) -> str | None:
    if not original_filename or not str(original_filename).strip():
        return None
    name = Path(str(original_filename).strip()).name
    if not name:
        return None
    save_meta(job_slug, {"dataset_zip_filename": name})
    return name


def _extract_zip_to_dir(zip_path: Path, dest: Path, job_slug: str) -> None:
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
                return
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
            return
        except (OSError, subprocess.CalledProcessError) as e:
            err = e.stderr if isinstance(e, subprocess.CalledProcessError) and e.stderr else str(e)
            errors.append(f"unzip: {err}")
    try:
        with zipfile.ZipFile(zip_path, "r") as zf:
            zf.extractall(dest)
        append_train_log(job_slug, "使用 zipfile 解压数据集")
    except Exception as e:
        hint = "；".join(errors + [f"zipfile: {e}"])
        raise ValueError(f"解压数据集失败：{hint}") from e


def unpack_dataset_zip(job_slug: str, *, original_zip_filename: str | None = None) -> dict[str, Any]:
    zip_path = dataset_zip_path(job_slug)
    if not zip_path.is_file():
        raise FileNotFoundError("未找到 dataset.zip，请先上传数据集压缩包")
    display = _store_dataset_zip_display_name(job_slug, original_zip_filename)
    dest = dataset_dir_path(job_slug)
    if dest.exists():
        shutil.rmtree(dest)
    dest.mkdir(parents=True, exist_ok=True)
    _extract_zip_to_dir(zip_path, dest, job_slug)
    count = count_images_under(dest)
    if count < 1:
        raise ValueError("解压后的数据集中未找到图像文件（支持 jpg/png/webp 等）")
    from app.train.dinov2_dataset import discover_dataset_layout

    discover_dataset_layout(job_slug)
    save_meta(
        job_slug,
        {
            "dataset_ready": True,
            "dataset_image_count": count,
        },
    )
    log_name = display or zip_path.name
    append_train_log(job_slug, f"数据集已解压（{log_name}）：{count} 张图像")
    return {"dataset_ready": True, "dataset_image_count": count}


def list_training_history() -> list[dict[str, Any]]:
    from app.train import dinov2_runner

    root = get_temp_root()
    items: list[dict[str, Any]] = []
    if not root.is_dir():
        return items
    for child in sorted(root.iterdir()):
        if not child.is_dir():
            continue
        slug = child.name
        meta = load_meta(slug)
        created_at = meta.get("created_at")
        if not isinstance(created_at, str) or not created_at.strip():
            try:
                created_at = datetime.fromtimestamp(child.stat().st_ctime, tz=timezone.utc).isoformat()
            except OSError:
                created_at = ""
        job = dinov2_runner.get_job(slug)
        items.append(
            {
                "job_slug": slug,
                "display_name": meta.get("display_name", slug),
                "created_at": created_at,
                "status": job.get("status", "idle"),
                "job_dir": str(child),
                "objective": meta.get("objective"),
                "model_label": meta.get("base_model_filename"),
                "progress": job.get("progress", 0),
            },
        )
    items.sort(key=lambda x: str(x.get("created_at", "")), reverse=True)
    return items
