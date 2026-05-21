"""YOLO 批量标注模型工作区：`backend/external/model_temp/<模型名>/`。"""

from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from app.model_resources import get_backend_root

MODEL_TEMP_DIR_NAME = "model_temp"
META_NAME = "model.json"
DATA_YAML_NAME = "data.yaml"
WEIGHTS_NAME = "weights.pt"

YOLO_BATCH_TASKS = ("detect", "segment", "pose", "obb")


def get_model_temp_root() -> Path:
    root = get_backend_root() / "external" / MODEL_TEMP_DIR_NAME
    root.mkdir(parents=True, exist_ok=True)
    return root


def sanitize_model_slug(display_name: str) -> str:
    trimmed = display_name.strip()
    if not trimmed:
        raise ValueError("模型名称不能为空")
    slug = re.sub(r'[<>:"/\\|?*\u0000-\u001f]', "_", trimmed)
    slug = re.sub(r"\s+", "_", slug).strip("._")
    if not slug:
        raise ValueError("模型名称无效")
    return slug[:120]


def assert_safe_model_slug(model_slug: str) -> str:
    slug = (model_slug or "").strip()
    if not slug or slug in (".", ".."):
        raise ValueError("无效的模型标识")
    if "/" in slug or "\\" in slug or "\x00" in slug:
        raise ValueError("无效的模型标识")
    return slug


def get_model_dir(model_slug: str) -> Path:
    slug = assert_safe_model_slug(model_slug)
    return get_model_temp_root() / slug


def meta_path_for(model_slug: str) -> Path:
    return get_model_dir(model_slug) / META_NAME


def data_yaml_path(model_slug: str) -> Path:
    return get_model_dir(model_slug) / DATA_YAML_NAME


def weights_path(model_slug: str) -> Path:
    return get_model_dir(model_slug) / WEIGHTS_NAME


def load_meta(model_slug: str) -> dict[str, Any]:
    path = meta_path_for(model_slug)
    if not path.is_file():
        return {}
    try:
        with path.open(encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except (OSError, json.JSONDecodeError):
        return {}


def save_meta(model_slug: str, patch: dict[str, Any]) -> dict[str, Any]:
    data = load_meta(model_slug)
    data.update(patch)
    model_dir = get_model_dir(model_slug)
    model_dir.mkdir(parents=True, exist_ok=True)
    meta_path_for(model_slug).write_text(
        json.dumps(data, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )
    return data


def parse_data_yaml_names(yaml_path: Path) -> dict[int, str]:
    import yaml

    with yaml_path.open(encoding="utf-8") as f:
        raw = yaml.safe_load(f)
    if not isinstance(raw, dict):
        raise ValueError("data.yaml 格式无效")
    names_raw = raw.get("names")
    if names_raw is None:
        raise ValueError("data.yaml 缺少 names 字段")
    names: dict[int, str] = {}
    if isinstance(names_raw, dict):
        for k, v in names_raw.items():
            names[int(k)] = str(v)
    elif isinstance(names_raw, list):
        for i, v in enumerate(names_raw):
            names[i] = str(v)
    else:
        raise ValueError("data.yaml 中 names 须为列表或字典")
    if not names:
        raise ValueError("data.yaml 中 names 为空")
    return names


def prepare_model(
    display_name: str,
    task: str,
    *,
    conf: float = 0.25,
    iou: float = 0.7,
    imgsz: int = 640,
    max_det: int = 300,
    use_gpu: bool = True,
) -> dict[str, Any]:
    task_id = task.strip().lower()
    if task_id not in YOLO_BATCH_TASKS:
        raise ValueError(f"未知任务类型：{task}")
    slug = sanitize_model_slug(display_name)
    model_dir = get_model_dir(slug)
    if model_dir.exists():
        raise ValueError(f"模型名称「{display_name}」已存在，请换一个名称")
    model_dir.mkdir(parents=True, exist_ok=False)
    now = datetime.now(timezone.utc).isoformat()
    save_meta(
        slug,
        {
            "display_name": display_name.strip(),
            "model_slug": slug,
            "task": task_id,
            "created_at": now,
            "conf": float(conf),
            "iou": float(iou),
            "imgsz": int(imgsz),
            "max_det": int(max_det),
            "use_gpu": bool(use_gpu),
            "ready": False,
        },
    )
    return model_snapshot(slug)


def confirm_data_yaml_on_disk(model_slug: str) -> dict[str, Any]:
    slug = assert_safe_model_slug(model_slug)
    dest = data_yaml_path(slug)
    if not dest.is_file():
        raise ValueError("请先放置 data.yaml")
    names = parse_data_yaml_names(dest)
    save_meta(slug, {"data_yaml": str(dest), "class_names": names})
    return {"ok": True, "data_yaml": str(dest), "class_count": len(names)}


def confirm_weights_on_disk(model_slug: str) -> dict[str, Any]:
    slug = assert_safe_model_slug(model_slug)
    dest = weights_path(slug)
    if not dest.is_file():
        raise ValueError("请先放置 weights.pt")
    save_meta(slug, {"weights_pt": str(dest)})
    return {"ok": True, "weights_pt": str(dest)}


def save_data_yaml_upload(model_slug: str, raw: bytes) -> dict[str, Any]:
    if not raw:
        raise ValueError("空文件")
    dest = data_yaml_path(model_slug)
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(raw)
    try:
        names = parse_data_yaml_names(dest)
    except ValueError as e:
        dest.unlink(missing_ok=True)
        raise e
    save_meta(model_slug, {"data_yaml": str(dest), "class_names": names})
    return {"ok": True, "data_yaml": str(dest), "class_count": len(names)}


def save_weights_upload(model_slug: str, raw: bytes) -> dict[str, Any]:
    if not raw:
        raise ValueError("空文件")
    dest = weights_path(model_slug)
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(raw)
    save_meta(model_slug, {"weights_pt": str(dest)})
    return {"ok": True, "weights_pt": str(dest)}


def finalize_model(model_slug: str) -> dict[str, Any]:
    yaml_p = data_yaml_path(model_slug)
    pt_p = weights_path(model_slug)
    if not yaml_p.is_file():
        raise ValueError("请先上传 data.yaml")
    if not pt_p.is_file():
        raise ValueError("请先上传 .pt 权重")
    try:
        names = parse_data_yaml_names(yaml_p)
    except ValueError as e:
        raise ValueError(str(e)) from e
    save_meta(
        model_slug,
        {
            "ready": True,
            "data_yaml": str(yaml_p),
            "weights_pt": str(pt_p),
            "class_names": names,
            "finalized_at": datetime.now(timezone.utc).isoformat(),
        },
    )
    return model_snapshot(model_slug)


def update_model_settings(
    model_slug: str,
    *,
    display_name: str | None = None,
    conf: float | None = None,
    iou: float | None = None,
    imgsz: int | None = None,
    max_det: int | None = None,
    use_gpu: bool | None = None,
) -> dict[str, Any]:
    if not get_model_dir(model_slug).is_dir():
        raise FileNotFoundError(f"未找到模型：{model_slug}")
    patch: dict[str, Any] = {}
    if display_name is not None and display_name.strip():
        patch["display_name"] = display_name.strip()
    if conf is not None:
        patch["conf"] = float(conf)
    if iou is not None:
        patch["iou"] = float(iou)
    if imgsz is not None:
        patch["imgsz"] = int(imgsz)
    if max_det is not None:
        patch["max_det"] = int(max_det)
    if use_gpu is not None:
        patch["use_gpu"] = bool(use_gpu)
    if patch:
        save_meta(model_slug, patch)
    return model_snapshot(model_slug)


def model_snapshot(model_slug: str) -> dict[str, Any]:
    if not get_model_dir(model_slug).is_dir():
        raise FileNotFoundError(f"未找到模型：{model_slug}")
    meta = load_meta(model_slug)
    yaml_p = data_yaml_path(model_slug)
    pt_p = weights_path(model_slug)
    return {
        "model_slug": model_slug,
        "model_dir": str(get_model_dir(model_slug)),
        "display_name": meta.get("display_name") or model_slug,
        "task": meta.get("task"),
        "created_at": meta.get("created_at"),
        "finalized_at": meta.get("finalized_at"),
        "ready": bool(meta.get("ready")),
        "data_yaml": str(yaml_p) if yaml_p.is_file() else None,
        "weights_pt": str(pt_p) if pt_p.is_file() else None,
        "conf": meta.get("conf", 0.25),
        "iou": meta.get("iou", 0.7),
        "imgsz": meta.get("imgsz", 640),
        "max_det": meta.get("max_det", 300),
        "use_gpu": meta.get("use_gpu", True),
        "class_count": len(meta.get("class_names") or {}),
    }


def list_models() -> list[dict[str, Any]]:
    root = get_model_temp_root()
    items: list[dict[str, Any]] = []
    if not root.is_dir():
        return items
    for child in sorted(root.iterdir(), key=lambda p: p.name.lower()):
        if not child.is_dir():
            continue
        slug = child.name
        if not meta_path_for(slug).is_file():
            continue
        try:
            items.append(model_snapshot(slug))
        except FileNotFoundError:
            continue
    items.sort(key=lambda x: (x.get("created_at") or ""), reverse=True)
    return items


def delete_model(model_slug: str) -> None:
    import shutil

    model_dir = get_model_dir(model_slug)
    if not model_dir.is_dir():
        raise FileNotFoundError(f"未找到模型：{model_slug}")
    shutil.rmtree(model_dir)
