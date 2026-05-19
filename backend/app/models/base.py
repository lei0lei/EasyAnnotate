from abc import ABC, abstractmethod
from typing import Any


class InferenceModel(ABC):
    """单个可调用推理模型的抽象；具体实现放在 `impl/` 下并注册到 `registry`。"""

    @property
    @abstractmethod
    def model_id(self) -> str: ...

    @abstractmethod
    def predict(self, payload: dict[str, Any]) -> dict[str, Any]:
        """输入/输出约定由各模型自行文档化，建议统一为可 JSON 序列化的 dict。"""
