"""YOLO 训练工作区：`backend/external/temp/<训练名>/` 每次训练独立目录。"""

from __future__ import annotations

import json
import re
import shutil
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from app.model_resources import ensure_asset, get_backend_root, iter_registry_weight_asset_ids

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
    return get_job_dir(job_slug) / BASE_MODEL_NAME


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
    base_pt = base_model_path(job_slug)
    meta = load_meta(job_slug)
    data_yaml = find_data_yaml(data_dir) if data_dir.is_dir() else None
    return {
        "job_slug": job_slug,
        "job_dir": str(job_dir),
        "display_name": meta.get("display_name", job_slug),
        "created_at": meta.get("created_at"),
        "dataset_zip": str(zip_path) if zip_path.is_file() else None,
        "dataset_dir": str(data_dir) if data_dir.is_dir() else None,
        "data_yaml": str(data_yaml) if data_yaml else None,
        "base_model": str(base_pt) if base_pt.is_file() else None,
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


def fix_data_yaml_path_after_unpack(data_yaml: Path, job_slug: str) -> Path:
    """
    解压后原地更新 data.yaml：仅将 path 设为数据集根的绝对路径，train/val/test 保持相对 path。
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
    append_train_log(job_slug, f"已修正 data.yaml 的 path={raw['path']}（train/val 仍为相对路径）")
    return resolved


def unpack_dataset_zip(job_slug: str) -> Path:
    zip_path = dataset_zip_path(job_slug)
    if not zip_path.is_file():
        raise FileNotFoundError("未找到 dataset.zip，请先上传或复制数据集压缩包")
    dest = dataset_dir_path(job_slug)
    if dest.exists():
        shutil.rmtree(dest)
    dest.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(zip_path, "r") as zf:
        zf.extractall(dest)
    data_yaml = find_data_yaml(dest)
    if data_yaml is None:
        raise ValueError("解压后的数据集中未找到 data.yaml（Ultralytics 训练所需）")
    append_train_log(job_slug, f"数据集已解压：{data_yaml}")
    return fix_data_yaml_path_after_unpack(data_yaml, job_slug)


def copy_dataset_zip_from(job_slug: str, source: Path) -> Path:
    if not source.is_file():
        raise FileNotFoundError(f"源文件不存在：{source}")
    if source.suffix.lower() != ".zip":
        raise ValueError("仅支持 .zip 数据集")
    dest = dataset_zip_path(job_slug)
    dest.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, dest)
    save_meta(job_slug, {"dataset_zip": str(dest)})
    append_train_log(job_slug, f"已复制数据集 zip：{dest.name}")
    return dest


def set_base_model_from_asset(job_slug: str, asset_id: str) -> Path:
    ckpt = ensure_asset(asset_id.strip())
    dest = base_model_path(job_slug)
    dest.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(ckpt, dest)
    save_meta(job_slug, {"base_model_asset_id": asset_id, "base_model_path": str(dest)})
    append_train_log(job_slug, f"已选用初始权重：{asset_id}")
    return dest


def save_uploaded_base_model(job_slug: str, source: Path) -> Path:
    if not source.is_file():
        raise FileNotFoundError("权重文件不存在")
    if source.suffix.lower() != ".pt":
        raise ValueError("仅支持 .pt 权重")
    dest = base_model_path(job_slug)
    dest.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, dest)
    save_meta(job_slug, {"base_model_asset_id": None, "base_model_path": str(dest)})
    append_train_log(job_slug, "已上传自定义 base_model.pt")
    return dest


def list_training_history() -> list[dict[str, Any]]:
    """扫描 ``external/temp`` 下子目录（每次进入页面重新解析）。"""
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
        items.append(
            {
                "job_slug": slug,
                "display_name": meta.get("display_name", slug),
                "created_at": created_at,
                "status": meta.get("status", "unknown"),
                "job_dir": str(child),
            },
        )
    items.sort(key=lambda x: str(x.get("created_at", "")), reverse=True)
    return items


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

YOLO_TASKS = ("detect", "segment", "pose", "obb")


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
    return False


def list_catalog_models(family: str, task: str) -> list[dict[str, str]]:
    ids = iter_registry_weight_asset_ids("ultralytics/", extensions=(".pt",))
    out: list[dict[str, str]] = []
    for asset_id in ids:
        if not asset_matches_family(asset_id, family):
            continue
        if not asset_matches_task(asset_id, task):
            continue
        label = _asset_basename(asset_id).removesuffix(".pt")
        out.append({"asset_id": asset_id, "label": label})
    return out
