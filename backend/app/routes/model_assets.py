from typing import Any

from fastapi import APIRouter, HTTPException, Query

from app.model_resources import asset_status, ensure_asset, get_resources_root, iter_registry, resolve_asset_paths

router = APIRouter()


@router.get("")
def list_model_assets() -> dict[str, Any]:
    assets = [asset_status(aid) for aid, _ in iter_registry()]
    return {"assets": assets, "resources_root": str(get_resources_root())}


@router.get("/{asset_id:path}/status")
def model_asset_status(asset_id: str) -> dict[str, Any]:
    st = asset_status(asset_id)
    if not st.get("known"):
        raise HTTPException(status_code=404, detail=f"unknown asset_id: {asset_id}")
    return st


@router.post("/{asset_id:path}/ensure")
def model_asset_ensure(
    asset_id: str,
    force: bool = Query(False, description="Re-download even if file exists"),
) -> dict[str, Any]:
    try:
        path = ensure_asset(asset_id, force=force)
    except KeyError:
        raise HTTPException(status_code=404, detail=f"unknown asset_id: {asset_id}") from None
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except RuntimeError as e:
        raise HTTPException(status_code=502, detail=str(e)) from e
    return {"asset_id": asset_id, "path": str(path), "downloaded": True}
