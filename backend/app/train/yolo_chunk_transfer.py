"""YOLO 训练数据集分片上传与模型文件分片下载（5MB/片，支持续传）。"""

from __future__ import annotations

import json
import shutil
from pathlib import Path
from typing import Any
from uuid import uuid4

from app.train.yolo_workspace import (
    assert_safe_job_slug,
    dataset_zip_path,
    get_job_dir,
    load_meta,
    resolve_training_model_file,
    save_uploaded_base_model,
    save_meta,
    unpack_dataset_zip,
)

CHUNK_SIZE = 5 * 1024 * 1024


def _upload_session_dir(job_slug: str, upload_id: str) -> Path:
    slug = assert_safe_job_slug(job_slug)
    safe_id = upload_id.strip().replace("\\", "/").replace("..", "")
    if not safe_id or "/" in safe_id:
        raise ValueError("无效的 upload_id")
    return get_job_dir(slug) / ".chunk-uploads" / safe_id


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


def init_dataset_upload(
    job_slug: str,
    *,
    filename: str,
    total_size: int,
    upload_id: str | None = None,
) -> dict[str, Any]:
    slug = assert_safe_job_slug(job_slug)
    if total_size < 1:
        raise ValueError("文件大小无效")
    name = Path(filename or "").name.strip()
    if not name.lower().endswith(".zip"):
        raise ValueError("仅支持 .zip 文件")

    total_chunks = (total_size + CHUNK_SIZE - 1) // CHUNK_SIZE
    session_id = (upload_id or "").strip() or uuid4().hex
    session_dir = _upload_session_dir(slug, session_id)
    meta_path = _upload_meta_path(session_dir)

    if meta_path.is_file():
        meta = _load_upload_meta(session_dir)
        if int(meta.get("total_size") or 0) != total_size or str(meta.get("filename") or "") != name:
            shutil.rmtree(session_dir, ignore_errors=True)
            meta = {}
    else:
        meta = {}

    if not meta:
        meta = {
            "filename": name,
            "total_size": total_size,
            "total_chunks": total_chunks,
            "received_chunks": [],
        }
        _save_upload_meta(session_dir, meta)

    received = sorted({int(x) for x in meta.get("received_chunks") or [] if isinstance(x, int) or str(x).isdigit()})
    missing = [i for i in range(total_chunks) if i not in set(received)]
    return {
        "upload_id": session_id,
        "chunk_size": CHUNK_SIZE,
        "total_size": total_size,
        "total_chunks": total_chunks,
        "uploaded_chunks": received,
        "missing_chunks": missing,
    }


def save_dataset_upload_chunk(
    job_slug: str,
    upload_id: str,
    chunk_index: int,
    data: bytes,
) -> dict[str, Any]:
    slug = assert_safe_job_slug(job_slug)
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


def complete_dataset_upload(job_slug: str, upload_id: str) -> dict[str, Any]:
    slug = assert_safe_job_slug(job_slug)
    session_dir = _upload_session_dir(slug, upload_id)
    meta = _load_upload_meta(session_dir)
    total_chunks = int(meta.get("total_chunks") or 0)
    received_set: set[int] = set()
    for x in meta.get("received_chunks") or []:
        if isinstance(x, int):
            received_set.add(x)
        elif isinstance(x, str) and x.isdigit():
            received_set.add(int(x))
    received = received_set
    missing = [i for i in range(total_chunks) if i not in received]
    if missing:
        raise ValueError(f"仍有 {len(missing)} 个分片未上传")

    dest = dataset_zip_path(slug)
    dest.parent.mkdir(parents=True, exist_ok=True)
    with dest.open("wb") as out:
        for i in range(total_chunks):
            part = session_dir / f"part-{i:06d}"
            if not part.is_file():
                raise FileNotFoundError(f"缺少分片 {i}")
            out.write(part.read_bytes())

    shutil.rmtree(session_dir, ignore_errors=True)
    filename = str(meta.get("filename") or "dataset.zip")
    data_yaml = unpack_dataset_zip(slug, original_zip_filename=filename)
    job_meta = load_meta(slug)
    return {
        "ok": True,
        "dataset_zip": str(dest),
        "data_yaml": str(data_yaml),
        "dataset_zip_filename": job_meta.get("dataset_zip_filename"),
    }


def init_base_model_upload(
    job_slug: str,
    *,
    filename: str,
    total_size: int,
    family: str,
    task: str,
    upload_id: str | None = None,
) -> dict[str, Any]:
    slug = assert_safe_job_slug(job_slug)
    if total_size < 1:
        raise ValueError("文件大小无效")
    name = Path(filename or "").name.strip()
    if not name.lower().endswith(".pt"):
        raise ValueError("仅支持 .pt 权重")
    family_value = family.strip()
    task_value = task.strip()
    if not family_value or not task_value:
        raise ValueError("family 和 task 不能为空")

    total_chunks = (total_size + CHUNK_SIZE - 1) // CHUNK_SIZE
    session_id = (upload_id or "").strip() or uuid4().hex
    session_dir = _upload_session_dir(slug, session_id)
    meta_path = _upload_meta_path(session_dir)

    if meta_path.is_file():
        meta = _load_upload_meta(session_dir)
        if (
            meta.get("kind") != "base_model"
            or int(meta.get("total_size") or 0) != total_size
            or str(meta.get("filename") or "") != name
            or str(meta.get("family") or "") != family_value
            or str(meta.get("task") or "") != task_value
        ):
            shutil.rmtree(session_dir, ignore_errors=True)
            meta = {}
    else:
        meta = {}

    if not meta:
        meta = {
            "kind": "base_model",
            "filename": name,
            "family": family_value,
            "task": task_value,
            "total_size": total_size,
            "total_chunks": total_chunks,
            "received_chunks": [],
        }
        _save_upload_meta(session_dir, meta)

    received = sorted(
        {
            int(x)
            for x in meta.get("received_chunks") or []
            if isinstance(x, int) or (isinstance(x, str) and x.isdigit())
        },
    )
    missing = [i for i in range(total_chunks) if i not in set(received)]
    return {
        "upload_id": session_id,
        "chunk_size": CHUNK_SIZE,
        "total_size": total_size,
        "total_chunks": total_chunks,
        "uploaded_chunks": received,
        "missing_chunks": missing,
    }


def save_base_model_upload_chunk(
    job_slug: str,
    upload_id: str,
    chunk_index: int,
    data: bytes,
) -> dict[str, Any]:
    slug = assert_safe_job_slug(job_slug)
    if chunk_index < 0:
        raise ValueError("无效的分片序号")
    if not data:
        raise ValueError("分片数据为空")

    session_dir = _upload_session_dir(slug, upload_id)
    meta = _load_upload_meta(session_dir)
    if meta.get("kind") != "base_model":
        raise ValueError("上传会话类型不匹配")
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

    (session_dir / f"part-{chunk_index:06d}").write_bytes(data)
    received = {
        int(x)
        for x in meta.get("received_chunks") or []
        if isinstance(x, int) or (isinstance(x, str) and x.isdigit())
    }
    received.add(chunk_index)
    uploaded = sorted(received)
    meta["received_chunks"] = uploaded
    _save_upload_meta(session_dir, meta)
    return {
        "upload_id": upload_id,
        "chunk_index": chunk_index,
        "uploaded_chunks": uploaded,
        "missing_chunks": [i for i in range(total_chunks) if i not in received],
    }


def complete_base_model_upload(job_slug: str, upload_id: str) -> dict[str, Any]:
    slug = assert_safe_job_slug(job_slug)
    session_dir = _upload_session_dir(slug, upload_id)
    meta = _load_upload_meta(session_dir)
    if meta.get("kind") != "base_model":
        raise ValueError("上传会话类型不匹配")

    total_chunks = int(meta.get("total_chunks") or 0)
    received = {
        int(x)
        for x in meta.get("received_chunks") or []
        if isinstance(x, int) or (isinstance(x, str) and x.isdigit())
    }
    missing = [i for i in range(total_chunks) if i not in received]
    if missing:
        raise ValueError(f"仍有 {len(missing)} 个分片未上传")

    assembled = session_dir / "assembled.pt"
    with assembled.open("wb") as out:
        for i in range(total_chunks):
            part = session_dir / f"part-{i:06d}"
            if not part.is_file():
                raise FileNotFoundError(f"缺少分片 {i}")
            with part.open("rb") as src:
                shutil.copyfileobj(src, out)

    path = save_uploaded_base_model(
        slug,
        assembled,
        original_filename=str(meta.get("filename") or "upload.pt"),
        family=str(meta.get("family") or ""),
        task=str(meta.get("task") or ""),
    )
    job_meta = load_meta(slug)
    shutil.rmtree(session_dir, ignore_errors=True)
    return {
        "ok": True,
        "base_model": str(path),
        "weight_meta": job_meta.get("base_model_weight_meta"),
        "weight_warnings": job_meta.get("base_model_weight_warnings") or [],
    }


def model_download_info(job_slug: str, rel_path: str) -> dict[str, Any]:
    file_path = resolve_training_model_file(job_slug, rel_path)
    stat = file_path.stat()
    total_chunks = (stat.st_size + CHUNK_SIZE - 1) // CHUNK_SIZE if stat.st_size > 0 else 0
    return {
        "path": rel_path.strip().replace("\\", "/").lstrip("/"),
        "filename": file_path.name,
        "total_size": stat.st_size,
        "chunk_size": CHUNK_SIZE,
        "total_chunks": total_chunks,
        "accept_ranges": True,
    }


def read_model_byte_range(job_slug: str, rel_path: str, start: int, end: int) -> tuple[bytes, int]:
    """读取 [start, end] 闭区间字节；返回 (data, file_size)。"""
    file_path = resolve_training_model_file(job_slug, rel_path)
    size = file_path.stat().st_size
    if size == 0:
        return b"", 0
    if start < 0 or start >= size:
        raise ValueError("无效的 Range 起始位置")
    end = min(end, size - 1)
    if end < start:
        raise ValueError("无效的 Range")
    length = end - start + 1
    with file_path.open("rb") as f:
        f.seek(start)
        data = f.read(length)
    if len(data) != length:
        raise OSError("读取模型文件失败")
    return data, size


def parse_range_header(range_header: str, file_size: int) -> tuple[int, int] | None:
    if file_size <= 0:
        return None
    raw = (range_header or "").strip().lower()
    if not raw.startswith("bytes="):
        return None
    spec = raw[6:].split(",")[0].strip()
    if "-" not in spec:
        return None
    start_s, end_s = spec.split("-", 1)
    try:
        if start_s == "":
            # suffix bytes=-500
            suffix = int(end_s)
            if suffix <= 0:
                return None
            start = max(0, file_size - suffix)
            end = file_size - 1
        else:
            start = int(start_s)
            end = int(end_s) if end_s else file_size - 1
    except ValueError:
        return None
    end = min(end, file_size - 1)
    if start < 0 or start > end:
        return None
    return start, end
