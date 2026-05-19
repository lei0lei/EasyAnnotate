from typing import Any

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import FileResponse

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


@router.get("/{asset_id:path}/decoder-onnx")
def get_decoder_onnx(asset_id: str) -> FileResponse:
    """Serve ``{checkpoint_stem}.decoder.onnx`` next to the registry weight file (CVAT/hashJoe path)."""
    rp = resolve_asset_paths(asset_id)
    if rp is None:
        raise HTTPException(status_code=404, detail=f"unknown asset_id: {asset_id}")
    if not rp.exists:
        raise HTTPException(status_code=404, detail=f"weight file missing for asset_id: {asset_id}")
    dec = rp.full_path.with_name(rp.full_path.stem + ".decoder.onnx")
    if not dec.is_file():
        raise HTTPException(
            status_code=404,
            detail="decoder onnx not found next to checkpoint; run scripts/export_sam21_cvat_decoder.py",
        )
    return FileResponse(
        path=str(dec),
        media_type="application/octet-stream",
        filename=dec.name,
        headers={
            "Cache-Control": "no-store, max-age=0",
            "Pragma": "no-cache",
        },
    )


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
