"""CLI: download missing files from external/resources/registry.json (skip if already present)."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path


def _backend_root() -> Path:
    return Path(__file__).resolve().parents[1]


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Install model assets under external/resources/")
    parser.add_argument(
        "--force",
        action="store_true",
        help="Re-download every asset even if the file already exists",
    )
    args = parser.parse_args(argv)

    backend = _backend_root()
    sys.path.insert(0, str(backend))

    from app.model_resources import asset_status, ensure_asset, iter_registry

    n_skip = n_ok = n_err = 0
    for asset_id, _meta in iter_registry():
        st = asset_status(asset_id)
        if not st.get("known"):
            print(f"[warn] skip unknown entry shape: {asset_id!r}")
            continue
        if st.get("exists") and not args.force:
            print(f"[skip] {asset_id} -> {st.get('path')}")
            n_skip += 1
            continue
        try:
            path = ensure_asset(asset_id, force=args.force)
            print(f"[ok]   {asset_id} -> {path}")
            n_ok += 1
        except Exception as e:  # noqa: BLE001
            print(f"[fail] {asset_id}: {e}", file=sys.stderr)
            n_err += 1

    print(f"Done. ok={n_ok} skip={n_skip} fail={n_err}")
    return 1 if n_err else 0


if __name__ == "__main__":
    raise SystemExit(main())
