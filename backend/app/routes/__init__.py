"""聚合路由：挂载到 ``main.py`` 的 ``/api/v1`` 下。

| 前缀 | 模块 | 说明 |
|------|------|------|
| ``/models`` | ``models`` | 模型列表、``predict``、SAM2 ``encode-image`` |
| ``/model-assets`` | ``model_assets`` | 资源目录、权重/ONNX 文件、``ensure`` 下载 |
| ``/model-runtime`` | ``model_runtime`` | 运行目录 ``catalog``、按分类 ``start``/``stop``、``status`` |
"""

from fastapi import APIRouter

from . import model_assets, model_runtime, models

api_router = APIRouter()
api_router.include_router(models.router, prefix="/models", tags=["models"])
api_router.include_router(model_assets.router, prefix="/model-assets", tags=["model-assets"])
api_router.include_router(model_runtime.router, prefix="/model-runtime", tags=["model-runtime"])

__all__ = ["api_router"]
