"""聚合路由：挂载到 ``main.py`` 的 ``/api/v1`` 下。

| 前缀 | 模块 | 说明 |
|------|------|------|
| ``/models`` | ``models`` | 模型列表、``predict``、SAM2 ``encode-image`` |
| ``/models`` | ``models_upload`` | 图片上传推理（需 ``python-multipart``；缺失时跳过） |
| ``/model-assets`` | ``model_assets`` | 资源目录、权重/ONNX 文件、``ensure`` 下载 |
| ``/model-runtime`` | ``model_runtime`` | 运行目录 ``catalog``、按分类 ``start``/``stop``、``status`` |
| ``/training/yolo`` | ``training_yolo`` | YOLO 训练工作区、数据集、启动训练 |
| ``/training/dinov2`` | ``training_dinov2`` | DINOv2 训练工作区、数据集、启动训练 |
| ``/yolo-batch`` | ``yolo_batch`` | YOLO 批量标注模型（``external/model_temp``） |
"""

from fastapi import APIRouter

from . import model_assets, model_runtime, models, training_dinov2, training_yolo, yolo_batch

api_router = APIRouter()
api_router.include_router(models.router, prefix="/models", tags=["models"])

try:
    from . import models_upload
    api_router.include_router(models_upload.router, prefix="/models", tags=["models-upload"])
except Exception:
    pass

api_router.include_router(model_assets.router, prefix="/model-assets", tags=["model-assets"])
api_router.include_router(model_runtime.router, prefix="/model-runtime", tags=["model-runtime"])
api_router.include_router(training_yolo.router, prefix="/training/yolo", tags=["training-yolo"])
api_router.include_router(training_dinov2.router, prefix="/training/dinov2", tags=["training-dinov2"])
api_router.include_router(yolo_batch.router, prefix="/yolo-batch", tags=["yolo-batch"])

__all__ = ["api_router"]
