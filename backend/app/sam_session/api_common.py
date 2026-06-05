"""Shared SAM session helpers for WebSocket routes."""

from __future__ import annotations

from typing import Any

from fastapi import HTTPException

from app.model_runtime import merge_predict_payload_device, require_runtime_started


def validate_client_id(raw: str | None) -> str:
    cid = (raw or "").strip()
    if not cid:
        raise ValueError("Missing client_id")
    if len(cid) > 128:
        raise ValueError("client_id too long")
    return cid


def build_prepare_payload(
    model_id: str,
    source: str,
    infer_scale: float | None,
    runtime_slot: str | None,
) -> dict[str, Any]:
    try:
        require_runtime_started(model_id, runtime_slot=runtime_slot)
    except ValueError as e:
        raise HTTPException(status_code=503, detail=str(e)) from e
    mid = model_id.strip()
    if not (mid.startswith("sam2/") or mid.startswith("mobile_sam/")):
        raise HTTPException(status_code=400, detail="session prepare supports sam2/* and mobile_sam/* only")
    payload: dict[str, Any] = {"source": source.strip()}
    if infer_scale is not None:
        payload["infer_scale"] = infer_scale
    return merge_predict_payload_device(mid, payload, runtime_slot=runtime_slot)
