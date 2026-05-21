"""YOLO 批量标注：data.yaml / weights.pt 分片上传（5MB/片，支持续传）。"""

from __future__ import annotations

import json
import shutil
from pathlib import Path
from typing import Any, Literal
from uuid import uuid4

from app.train.yolo_batch_workspace import (
    DATA_YAML_NAME,
    WEIGHTS_NAME,
    assert_safe_model_slug,
    data_yaml_path,
    get_model_dir,
    save_data_yaml_upload,
    save_weights_upload,
    weights_path,
)

CHUNK_SIZE = 5 * 1024 * 1024
UploadKind = Literal["data_yaml", "weights"]


def _upload_session_dir(model_slug: str, upload_id: str) -> Path:
    slug = assert_safe_model_slug(model_slug)
    safe_id = upload_id.strip().replace("\\", "/").replace("..", "")
    if not safe_id or "/" in safe_id:
        raise ValueError("无效的 upload_id")
    return get_model_dir(slug) / ".chunk-uploads" / safe_id


def _upload_meta_path(session_dir: Path) -> Path:
    return session_dir / "meta.json"


def _load_upload_meta(session_dir: Path) -> dict[str, Any]:
    path = _upload_meta_path(session_dir)
    if not path.is_file():
        raise FileNotFoundError("上传会话不存在")
    with path.open(encoding="utf-8") as f:
        data = json.load(f)
    if not isinstance(data, dict):
        raise ValueError("上传会话元数据损坏")
    return data


def _save_upload_meta(session_dir: Path, meta: dict[str, Any]) -> None:
    session_dir.mkdir(parents=True, exist_ok=True)
    _upload_meta_path(session_dir).write_text(
        json.dumps(meta, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )


def _validate_filename(kind: UploadKind, filename: str) -> str:
    name = Path(filename or "").name.strip()
    if not name:
        raise ValueError("文件名为空")
    lower = name.lower()
    if kind == "data_yaml":
        if not (lower.endswith(".yaml") or lower.endswith(".yml")):
            raise ValueError("仅支持 .yaml / .yml")
    elif kind == "weights":
        if not lower.endswith(".pt"):
            raise ValueError("仅支持 .pt 权重")
    else:
        raise ValueError(f"未知上传类型：{kind}")
    return name


def init_upload(
    model_slug: str,
    kind: UploadKind,
    *,
    filename: str,
    total_size: int,
    upload_id: str | None = None,
) -> dict[str, Any]:
    slug = assert_safe_model_slug(model_slug)
    if not get_model_dir(slug).is_dir():
        raise FileNotFoundError(f"未找到模型工作区：{slug}")
    if total_size < 1:
        raise ValueError("文件大小无效")
    name = _validate_filename(kind, filename)
    total_chunks = (total_size + CHUNK_SIZE - 1) // CHUNK_SIZE
    session_id = (upload_id or "").strip() or uuid4().hex
    session_dir = _upload_session_dir(slug, session_id)
    meta_path = _upload_meta_path(session_dir)

    if meta_path.is_file():
        meta = _load_upload_meta(session_dir)
        if (
            meta.get("kind") != kind
            or int(meta.get("total_size") or 0) != total_size
            or str(meta.get("filename") or "") != name
        ):
            shutil.rmtree(session_dir, ignore_errors=True)
            meta = {}
    else:
        meta = {}

    if not meta:
        meta = {
            "kind": kind,
            "filename": name,
            "total_size": total_size,
            "total_chunks": total_chunks,
            "received_chunks": [],
        }
        _save_upload_meta(session_dir, meta)

    received = sorted(
        {
            int(x)
            for x in meta.get("received_chunks") or []
            if isinstance(x, int) or (isinstance(x, str) and str(x).isdigit())
        },
    )
    missing = [i for i in range(total_chunks) if i not in set(received)]
    return {
        "upload_id": session_id,
        "kind": kind,
        "chunk_size": CHUNK_SIZE,
        "total_size": total_size,
        "total_chunks": total_chunks,
        "uploaded_chunks": received,
        "missing_chunks": missing,
    }


def save_upload_chunk(
    model_slug: str,
    upload_id: str,
    chunk_index: int,
    data: bytes,
) -> dict[str, Any]:
    slug = assert_safe_model_slug(model_slug)
    if chunk_index < 0:
        raise ValueError("无效的分片序号")
    if not data:
        raise ValueError("分片数据为空")

    session_dir = _upload_session_dir(slug, upload_id)
    meta = _load_upload_meta(session_dir)
    total_chunks = int(meta.get("total_chunks") or 0)
    total_size = int(meta.get("total_size") or 0)
    if chunk_index >= total_chunks:
        raise ValueError("分片序号超出范围")

    expected = CHUNK_SIZE
    if chunk_index == total_chunks - 1:
        remainder = total_size % CHUNK_SIZE
        if remainder > 0:
            expected = remainder
    if len(data) != expected:
        raise ValueError(f"分片大小应为 {expected} 字节，实际 {len(data)} 字节")

    part_path = session_dir / f"part-{chunk_index:06d}"
    part_path.write_bytes(data)

    received_set: set[int] = set()
    for x in meta.get("received_chunks") or []:
        if isinstance(x, int):
            received_set.add(x)
        elif isinstance(x, str) and x.isdigit():
            received_set.add(int(x))
    received = sorted(received_set)
    if chunk_index not in received:
        received.append(chunk_index)
        received.sort()
    meta["received_chunks"] = received
    _save_upload_meta(session_dir, meta)

    missing = [i for i in range(total_chunks) if i not in set(received)]
    return {
        "upload_id": upload_id,
        "chunk_index": chunk_index,
        "uploaded_chunks": received,
        "missing_chunks": missing,
    }


def complete_upload(model_slug: str, upload_id: str) -> dict[str, Any]:
    slug = assert_safe_model_slug(model_slug)
    session_dir = _upload_session_dir(slug, upload_id)
    meta = _load_upload_meta(session_dir)
    kind = meta.get("kind")
    if kind not in ("data_yaml", "weights"):
        raise ValueError("上传类型无效")
    total_chunks = int(meta.get("total_chunks") or 0)
    received_set: set[int] = set()
    for x in meta.get("received_chunks") or []:
        if isinstance(x, int):
            received_set.add(x)
        elif isinstance(x, str) and x.isdigit():
            received_set.add(int(x))
    missing = [i for i in range(total_chunks) if i not in received_set]
    if missing:
        raise ValueError(f"仍有 {len(missing)} 个分片未上传")

    dest = data_yaml_path(slug) if kind == "data_yaml" else weights_path(slug)
    dest.parent.mkdir(parents=True, exist_ok=True)
    with dest.open("wb") as out:
        for i in range(total_chunks):
            part = session_dir / f"part-{i:06d}"
            if not part.is_file():
                raise FileNotFoundError(f"缺少分片 {i}")
            out.write(part.read_bytes())

    shutil.rmtree(session_dir, ignore_errors=True)
    raw = dest.read_bytes()
    if kind == "data_yaml":
        return save_data_yaml_upload(slug, raw)
    return save_weights_upload(slug, raw)
