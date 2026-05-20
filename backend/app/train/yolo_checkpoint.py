"""从 Ultralytics YOLO ``.pt`` 中读取任务/模型信息并校验与训练配置一致。"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any

from app.train.yolo_workspace import YOLO_FAMILIES, YOLO_TASKS, asset_matches_family, asset_matches_task


@dataclass(frozen=True)
class YoloWeightMeta:
    task: str | None
    family: str | None
    model_name: str | None
    source: str

    def as_dict(self) -> dict[str, Any]:
        return {
            "task": self.task,
            "family": self.family,
            "model_name": self.model_name,
            "source": self.source,
        }


@dataclass(frozen=True)
class YoloWeightValidationResult:
    meta: YoloWeightMeta
    warnings: tuple[str, ...]

    def as_dict(self) -> dict[str, Any]:
        return {
            "weight_meta": self.meta.as_dict(),
            "weight_warnings": list(self.warnings),
        }


def _train_args_dict(train_args: Any) -> dict[str, Any]:
    if train_args is None:
        return {}
    if isinstance(train_args, dict):
        return train_args
    try:
        return dict(train_args)
    except (TypeError, ValueError):
        pass
    out: dict[str, Any] = {}
    for key in ("task", "model", "data", "imgsz", "epochs"):
        if hasattr(train_args, key):
            out[key] = getattr(train_args, key)
    return out


def _hint_from_name(name: str) -> str:
    return Path(name).name.lower().removesuffix(".pt")


def family_from_hint(hint: str) -> str | None:
    h = _hint_from_name(hint)
    if not h:
        return None
    for fam in YOLO_FAMILIES:
        if asset_matches_family(f"ultralytics/{h}.pt", fam):
            return fam
    return None


def task_from_hint(hint: str) -> str | None:
    h = _hint_from_name(hint)
    if not h:
        return None
    for t in YOLO_TASKS:
        if asset_matches_task(f"ultralytics/{h}.pt", t):
            return t
    return None


def _merge_meta(*parts: YoloWeightMeta) -> YoloWeightMeta:
    task = next((p.task for p in parts if p.task), None)
    family = next((p.family for p in parts if p.family), None)
    model_name = next((p.model_name for p in parts if p.model_name), None)
    source = "+".join(dict.fromkeys(p.source for p in parts if p.source))
    return YoloWeightMeta(task=task, family=family, model_name=model_name, source=source or "unknown")


def _meta_from_train_args(ta: dict[str, Any], *, source: str) -> YoloWeightMeta:
    task = ta.get("task")
    if isinstance(task, str):
        task = task.strip().lower() or None
    else:
        task = None
    model_raw = ta.get("model")
    model_name = None
    if isinstance(model_raw, str) and model_raw.strip():
        model_name = Path(model_raw).name
    family = family_from_hint(model_name) if model_name else None
    if task is None and model_name:
        task = task_from_hint(model_name)
    return YoloWeightMeta(task=task, family=family, model_name=model_name, source=source)


def _meta_from_ckpt_dict(ckpt: dict[str, Any]) -> YoloWeightMeta:
    parts: list[YoloWeightMeta] = []
    ta = _train_args_dict(ckpt.get("train_args"))
    if ta:
        parts.append(_meta_from_train_args(ta, source="train_args"))

    for key in ("ema", "model"):
        mod = ckpt.get(key)
        if mod is None:
            continue
        yaml = getattr(mod, "yaml", None)
        if isinstance(yaml, dict):
            t = yaml.get("task")
            task_s = t.strip().lower() if isinstance(t, str) and t.strip() else None
            parts.append(
                YoloWeightMeta(
                    task=task_s,
                    family=None,
                    model_name=yaml.get("yaml_file") or yaml.get("model"),
                    source=f"ckpt.{key}.yaml",
                )
            )
        task_attr = getattr(mod, "task", None)
        if isinstance(task_attr, str) and task_attr.strip():
            parts.append(
                YoloWeightMeta(
                    task=task_attr.strip().lower(),
                    family=None,
                    model_name=None,
                    source=f"ckpt.{key}.task",
                )
            )
    return _merge_meta(*parts) if parts else YoloWeightMeta(None, None, None, "ckpt")


def _inspect_via_torch_load(path: Path) -> YoloWeightMeta:
    import torch

    ckpt = torch.load(path, map_location="cpu", weights_only=False)
    if isinstance(ckpt, dict):
        return _meta_from_ckpt_dict(ckpt)
    return YoloWeightMeta(None, None, None, "torch")


def _inspect_via_ultralytics(path: Path) -> YoloWeightMeta:
    from ultralytics import YOLO

    model = YOLO(str(path))
    parts: list[YoloWeightMeta] = []
    if isinstance(getattr(model, "task", None), str) and model.task.strip():
        parts.append(YoloWeightMeta(model.task.strip().lower(), None, None, "ultralytics.task"))
    ckpt = getattr(model, "ckpt", None)
    if isinstance(ckpt, dict):
        parts.append(_meta_from_ckpt_dict(ckpt))
    stem = path.stem
    parts.append(
        YoloWeightMeta(
            task=task_from_hint(stem),
            family=family_from_hint(stem),
            model_name=path.name,
            source="ultralytics.path",
        )
    )
    return _merge_meta(*parts)


def inspect_yolo_checkpoint(path: Path, *, filename: str | None = None) -> YoloWeightMeta:
    """读取 ``.pt`` 中的任务与模型系列（优先 ``train_args`` / 模型 yaml）。"""
    path = path.resolve()
    if not path.is_file():
        raise FileNotFoundError(f"权重文件不存在：{path}")

    meta = YoloWeightMeta(None, None, None, "none")
    try:
        meta = _inspect_via_ultralytics(path)
    except ImportError:
        pass
    except Exception:
        meta = YoloWeightMeta(None, None, None, "none")

    if meta.task is None and meta.family is None:
        try:
            meta = _merge_meta(meta, _inspect_via_torch_load(path))
        except ImportError as e:
            raise RuntimeError("未安装 PyTorch，无法解析 .pt 元数据") from e
        except Exception:
            pass

    hint = filename or path.name
    file_meta = YoloWeightMeta(
        task=task_from_hint(hint),
        family=family_from_hint(hint),
        model_name=Path(hint).name,
        source="filename",
    )
    return _merge_meta(meta, file_meta)


def validate_yolo_checkpoint(
    path: Path,
    *,
    family: str,
    task: str,
    filename: str | None = None,
) -> YoloWeightValidationResult:
    """校验权重与页面所选 ``family`` / ``task``。

    - 识别值与选择不一致 → ``ValueError``（不可用）
    - 无法识别 task/family（None）→ 警告，仍可使用
    """
    fam = (family or "").strip()
    tsk = (task or "").strip()
    if fam not in YOLO_FAMILIES:
        raise ValueError(f"未知模型系列：{fam}")
    if tsk not in YOLO_TASKS:
        raise ValueError(f"未知训练任务：{tsk}")

    meta = inspect_yolo_checkpoint(path, filename=filename)
    errors: list[str] = []
    warnings: list[str] = []

    if meta.task and meta.task != tsk:
        errors.append(f"权重任务为「{meta.task}」，当前训练任务为「{tsk}」")
    if meta.family and meta.family != fam:
        errors.append(f"权重模型系列为「{meta.family}」，当前选择为「{fam}」")

    if meta.task is None:
        warnings.append(f"未能从权重中识别训练任务，将按当前任务「{tsk}」使用")
    if meta.family is None:
        warnings.append(f"未能从权重中识别模型系列，将按当前系列「{fam}」使用")

    if errors:
        detail = meta.as_dict()
        extra = f"（识别到：{detail}）" if any(detail.values()) else ""
        raise ValueError("；".join(errors) + extra)

    return YoloWeightValidationResult(meta=meta, warnings=tuple(warnings))
