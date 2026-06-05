"""Per-client SAM session with private encode bundle; encode/decode locks split."""

from __future__ import annotations

import logging
import threading
import time
import uuid
from dataclasses import dataclass, field
from typing import Any, Literal

_log = logging.getLogger(__name__)

SESSION_IDLE_TTL_SEC = 180
_TTL_SWEEP_INTERVAL_SEC = 30

from app.models.torch_unload import dispose_torch_object, sync_gc_empty_cuda
from app.sam_session.decode import SamDecodeResult, decode_session_prompt
from app.sam_session.encode_tensors import SamEncodeBundle, encode_image_tensors
from app.sam_session.prompt import SamBboxPrompt, SamPointPrompt

_encode_lock = threading.Lock()
_decode_lock = threading.Lock()


@dataclass
class SamEmbedSession:
    session_id: str
    client_id: str
    bundle: SamEncodeBundle
    last_activity_at: float = field(default_factory=time.monotonic)


_sessions_by_id: dict[str, SamEmbedSession] = {}
_client_to_session_id: dict[str, str] = {}


def _dispose_bundle(bundle: SamEncodeBundle) -> None:
    dispose_torch_object(bundle.image_embed)
    if bundle.high_res_feats_0 is not None:
        dispose_torch_object(bundle.high_res_feats_0)
    if bundle.high_res_feats_1 is not None:
        dispose_torch_object(bundle.high_res_feats_1)


def _release_session_unlocked(session_id: str, *, reason: str = "manual") -> None:
    session = _sessions_by_id.pop(session_id, None)
    if session is None:
        return
    if _client_to_session_id.get(session.client_id) == session_id:
        del _client_to_session_id[session.client_id]
    _dispose_bundle(session.bundle)
    sync_gc_empty_cuda()
    _log.debug(
        "sam session released (%s): client=%s session=%s model=%s",
        reason,
        session.client_id,
        session_id,
        session.bundle.model_id,
    )


def _touch_session(session: SamEmbedSession) -> None:
    session.last_activity_at = time.monotonic()


def _expire_idle_sessions_unlocked(now: float | None = None) -> None:
    """Drop sessions idle longer than ``SESSION_IDLE_TTL_SEC`` and dispose their embeddings."""
    now = now if now is not None else time.monotonic()
    stale_ids = [
        sid
        for sid, session in _sessions_by_id.items()
        if now - session.last_activity_at > SESSION_IDLE_TTL_SEC
    ]
    for sid in stale_ids:
        _release_session_unlocked(sid, reason="idle_timeout")


def _ensure_ttl_sweeper_started() -> None:
    if getattr(_ensure_ttl_sweeper_started, "_started", False):
        return
    _ensure_ttl_sweeper_started._started = True  # type: ignore[attr-defined]

    def _worker() -> None:
        while True:
            time.sleep(_TTL_SWEEP_INTERVAL_SEC)
            try:
                with _encode_lock:
                    _expire_idle_sessions_unlocked()
            except Exception:
                _log.exception("sam session idle TTL sweep failed")

    threading.Thread(target=_worker, daemon=True, name="sam-session-ttl").start()


def _replace_client_session_unlocked(client_id: str) -> None:
    old_id = _client_to_session_id.get(client_id)
    if old_id:
        _release_session_unlocked(old_id)


def prepare_session(
    client_id: str,
    model_id: str,
    payload: dict[str, Any],
) -> dict[str, Any]:
    """Encode image tensors and bind one private bundle per client session."""
    cid = client_id.strip()
    if not cid:
        raise ValueError("client_id is required")

    _ensure_ttl_sweeper_started()

    with _encode_lock:
        _expire_idle_sessions_unlocked()
        _replace_client_session_unlocked(cid)
        bundle = encode_image_tensors(model_id, payload)

        session_id = uuid.uuid4().hex
        session = SamEmbedSession(session_id=session_id, client_id=cid, bundle=bundle)
        _touch_session(session)
        _sessions_by_id[session_id] = session
        _client_to_session_id[cid] = session_id

        return {
            "session_id": session_id,
            "model_id": bundle.model_id,
            "feature_layout": bundle.feature_layout,
            "full_image_width": bundle.full_w,
            "full_image_height": bundle.full_h,
            "image_width": bundle.enc_w,
            "image_height": bundle.enc_h,
            "infer_scale": bundle.infer_scale,
        }


def decode_in_session(
    client_id: str,
    session_id: str,
    *,
    prompt_mode: Literal["point", "bbox"],
    points: list[dict[str, Any]],
    bbox: dict[str, Any] | None,
    min_pred_iou: float | None,
    polygon_vertex_bias: int,
    include_mask: bool = False,
    include_polygon: bool = True,
) -> SamDecodeResult:
    cid = client_id.strip()
    sid = session_id.strip()
    if not cid:
        raise ValueError("client_id is required")
    if not sid:
        raise ValueError("session_id is required")

    point_prompts: list[SamPointPrompt] = []
    for p in points:
        point_prompts.append(
            SamPointPrompt(
                x=int(p["x"]),
                y=int(p["y"]),
                label=0 if int(p.get("label", 1)) == 0 else 1,
            ),
        )

    bbox_prompt: SamBboxPrompt | None = None
    if bbox is not None:
        bbox_prompt = SamBboxPrompt(
            x1=int(bbox["x1"]),
            y1=int(bbox["y1"]),
            x2=int(bbox["x2"]),
            y2=int(bbox["y2"]),
        )

    with _decode_lock:
        session = _sessions_by_id.get(sid)
        if session is None:
            raise KeyError(f"unknown session_id: {sid}")
        if session.client_id != cid:
            raise PermissionError("session does not belong to this client")
        _touch_session(session)
        return decode_session_prompt(
            session.bundle,
            prompt_mode=prompt_mode,
            points=point_prompts,
            bbox=bbox_prompt,
            min_pred_iou=min_pred_iou,
            polygon_vertex_bias=polygon_vertex_bias,
            include_mask=include_mask,
            include_polygon=include_polygon,
        )


def release_client_session(client_id: str) -> None:
    cid = client_id.strip()
    if not cid:
        return
    with _encode_lock:
        _expire_idle_sessions_unlocked()
        sid = _client_to_session_id.get(cid)
        if sid:
            _release_session_unlocked(sid, reason="client_release")
