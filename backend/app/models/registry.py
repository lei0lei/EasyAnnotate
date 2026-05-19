from collections.abc import Callable
from typing import Any

from .base import InferenceModel

_factory_by_id: dict[str, Callable[[], InferenceModel]] = {}


def register_model(model_id: str, factory: Callable[[], InferenceModel]) -> None:
    _factory_by_id[model_id] = factory


def get_model(model_id: str) -> InferenceModel | None:
    factory = _factory_by_id.get(model_id)
    return None if factory is None else factory()


def list_model_ids() -> list[str]:
    return sorted(_factory_by_id.keys())
