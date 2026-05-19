"""推理实现模块：import 时完成 register_model。"""

from . import dinov2_variants  # noqa: F401
from . import efficient_sam_variants  # noqa: F401
from . import mobile_sam_variants  # noqa: F401
from . import sam2_hiera_variants  # noqa: F401
from . import yolo_ultralytics  # noqa: F401

__all__ = [
    "dinov2_variants",
    "efficient_sam_variants",
    "mobile_sam_variants",
    "sam2_hiera_variants",
    "yolo_ultralytics",
]
