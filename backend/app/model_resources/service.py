"""Local model assets under backend/external/resources; download by registry.json."""

from __future__ import annotations

import json
import os
import shutil
import tempfile
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterator

_REGISTRY_NAME = "registry.json"


def get_backend_root() -> Path:
    """backend/ directory (contains app/, external/)."""
    return Path(__file__).resolve().parents[2]


def get_resources_root() -> Path:
    return get_backend_root() / "external" / "resources"


def _registry_path() -> Path:
    return get_resources_root() / _REGISTRY_NAME


def load_registry() -> dict[str, Any]:
    path = _registry_path()
    if not path.is_file():
        return {"version": 1, "assets": {}}
    with path.open(encoding="utf-8") as f:
        return json.load(f)


def registry_asset_description(asset_id: str) -> str | None:
    """`registry.json` 里对应 `asset_id` 的 `description`（说明文字）。"""
    data = load_registry()
    assets = data.get("assets")
    if not isinstance(assets, dict):
        return None
    meta = assets.get(asset_id)
    if not isinstance(meta, dict):
        return None
    d = meta.get("description")
    if isinstance(d, str) and d.strip():
        return d.strip()
    return None


def registry_asset_file_basename(asset_id: str) -> str | None:
    """`registry.json` 里该资源 `relative_path` 的文件名（如 `sam2.1_hiera_tiny.pt`）。"""
    data = load_registry()
    assets = data.get("assets")
    if not isinstance(assets, dict):
        return None
    meta = assets.get(asset_id)
    if not isinstance(meta, dict):
        return None
    rel = meta.get("relative_path")
    if not isinstance(rel, str) or not rel.strip():
        return None
    return Path(rel.strip().replace("\\", "/")).name


def iter_registry_weight_asset_ids(
    prefix: str,
    *,
    extensions: tuple[str, ...] = (".pt", ".pth"),
    exclude_id_substrings: tuple[str, ...] = (),
) -> list[str]:
    """`prefix` 下 `relative_path` 以 `extensions` 结尾的资源 id，字母序。"""
    data = load_registry()
    assets = data.get("assets") or {}
    ext_l = tuple(e.lower() for e in extensions)
    out: list[str] = []
    for aid_raw, meta in assets.items():
        aid = str(aid_raw)
        if not aid.startswith(prefix):
            continue
        if any(s in aid for s in exclude_id_substrings):
            continue
        if not isinstance(meta, dict):
            continue
        rel = meta.get("relative_path")
        if not isinstance(rel, str) or not rel.strip():
            continue
        r = rel.strip().replace("\\", "/").lower()
        if any(r.endswith(ext) for ext in ext_l):
            out.append(aid)
    out.sort()
    return out


def iter_registry() -> Iterator[tuple[str, dict[str, Any]]]:
    data = load_registry()
    assets = data.get("assets") or {}
    if not isinstance(assets, dict):
        return
    for aid, meta in assets.items():
        if isinstance(meta, dict):
            yield str(aid), meta


@dataclass(frozen=True)
class AssetPaths:
    asset_id: str
    full_path: Path
    exists: bool


def resolve_asset_paths(asset_id: str) -> AssetPaths | None:
    for aid, meta in iter_registry():
        if aid != asset_id:
            continue
        rel = meta.get("relative_path")
        if not isinstance(rel, str) or not rel.strip():
            return None
        rel = rel.strip().replace("\\", "/")
        if ".." in rel or rel.startswith("/"):
            return None
        full = (get_resources_root() / rel).resolve()
        try:
            full.relative_to(get_resources_root().resolve())
        except ValueError:
            return None
        return AssetPaths(asset_id=aid, full_path=full, exists=full.is_file())
    return None


def asset_status(asset_id: str) -> dict[str, Any]:
    rp = resolve_asset_paths(asset_id)
    if rp is None:
        return {"asset_id": asset_id, "known": False}
    meta = dict(load_registry().get("assets", {}).get(asset_id, {}))
    dec_path = rp.full_path.with_name(rp.full_path.stem + ".decoder.onnx")
    return {
        "asset_id": asset_id,
        "known": True,
        "relative_path": meta.get("relative_path"),
        "path": str(rp.full_path),
        "exists": rp.exists,
        "decoder_onnx_path": str(dec_path),
        "decoder_onnx_exists": dec_path.is_file(),
        "description": meta.get("description"),
        "urls": meta.get("urls") if isinstance(meta.get("urls"), list) else [],
    }


def _download_url(url: str, dest: Path, *, retries: int = 3) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    req = urllib.request.Request(
        url,
        headers={"User-Agent": "EasyAnnotate-model-resources/1.0"},
    )
    delay = 2.0
    last_err: BaseException | None = None
    for attempt in range(max(1, retries)):
        fd, tmp_name = tempfile.mkstemp(dir=dest.parent, suffix=".part")
        tmp_path = Path(tmp_name)
        try:
            os.close(fd)
            with urllib.request.urlopen(req, timeout=900) as resp:  # noqa: S310
                cl = resp.headers.get("Content-Length")
                expected: int | None = int(cl) if cl and str(cl).isdigit() else None
                with tmp_path.open("wb") as out:
                    shutil.copyfileobj(resp, out)
                got = tmp_path.stat().st_size
                if expected is not None and got != expected:
                    raise OSError(
                        f"download incomplete: wrote {got} bytes, Content-Length={expected}",
                    )
            if dest.exists():
                dest.unlink()
            tmp_path.replace(dest)
            return
        except BaseException as e:
            tmp_path.unlink(missing_ok=True)
            last_err = e
            if attempt + 1 >= retries:
                break
            time.sleep(delay * (attempt + 1))
    raise last_err if last_err else RuntimeError("download failed")


def ensure_asset(asset_id: str, *, force: bool = False) -> Path:
    """Download asset if missing (unless force). Returns resolved file path."""
    rp = resolve_asset_paths(asset_id)
    if rp is None:
        raise KeyError(f"unknown asset_id: {asset_id}")
    if rp.exists and not force:
        return rp.full_path

    data = load_registry()
    meta = (data.get("assets") or {}).get(asset_id) or {}
    urls = meta.get("urls")
    if not isinstance(urls, list) or not urls:
        raise ValueError(f"asset {asset_id!r} has no urls in registry")

    last_err: Exception | None = None
    for u in urls:
        if not isinstance(u, str) or not u.strip():
            continue
        try:
            _download_url(u.strip(), rp.full_path)
            if rp.full_path.is_file():
                return rp.full_path
        except (urllib.error.URLError, OSError, ValueError) as e:
            last_err = e
            continue
    raise RuntimeError(f"failed to download {asset_id!r}: {last_err}")
