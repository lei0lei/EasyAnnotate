from collections.abc import Callable

from .base import Trainer

_factory_by_id: dict[str, Callable[[], Trainer]] = {}


def register_trainer(trainer_id: str, factory: Callable[[], Trainer]) -> None:
    _factory_by_id[trainer_id] = factory


def get_trainer(trainer_id: str) -> Trainer | None:
    factory = _factory_by_id.get(trainer_id)
    return None if factory is None else factory()


def list_trainer_ids() -> list[str]:
    return sorted(_factory_by_id.keys())
