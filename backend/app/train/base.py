from abc import ABC, abstractmethod
from typing import Any


class Trainer(ABC):
    """单套训练流程的抽象；具体实现放在 `pipelines/` 下并注册到 `registry`。"""

    @property
    @abstractmethod
    def trainer_id(self) -> str: ...

    @abstractmethod
    def run(self, config: dict[str, Any]) -> dict[str, Any]:
        """config / 返回值由各训练任务约定，建议可 JSON 友好。"""
