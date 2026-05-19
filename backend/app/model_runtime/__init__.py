"""Backend model runtime: catalog, start/stop (load/unload weights), status."""

from .catalog import MODEL_CATEGORIES, category_spec, model_id_in_category
from .service import (
    get_runtime_catalog,
    merge_predict_payload_device,
    model_start,
    model_stop,
    require_runtime_started,
    runtime_status,
)

__all__ = [
    "MODEL_CATEGORIES",
    "category_spec",
    "model_id_in_category",
    "get_runtime_catalog",
    "merge_predict_payload_device",
    "model_start",
    "model_stop",
    "require_runtime_started",
    "runtime_status",
]
