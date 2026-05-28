"""将 Ultralytics 推理结果序列化为前端可消费的 JSON（detect / obb / segment / pose）。"""

from __future__ import annotations

from typing import Any

# 分割 mask 轮廓顶点过多时，经 IPC/HTTP 传 JSON 易触发桌面端原生层闪退（0xc0000409）。
_MAX_POLYGON_VERTS = 256


def _names_map(r: Any) -> dict[int, str]:
    return {int(k): str(v) for k, v in (getattr(r, "names", None) or {}).items()}


def _detection_entry(
    *,
    class_id: int,
    class_name: str | None,
    confidence: float,
    shape_type: str,
    points: list[list[float]],
    extra: dict[str, Any] | None = None,
) -> dict[str, Any]:
    row: dict[str, Any] = {
        "class_id": class_id,
        "class_name": class_name,
        "confidence": confidence,
        "shape_type": shape_type,
        "points": points,
    }
    if extra:
        row.update(extra)
    return row


def _xyxy_to_rect_points(xyxy: list[float]) -> list[list[float]]:
    x1, y1, x2, y2 = [float(v) for v in xyxy[:4]]
    return [
        [x1, y1],
        [x2, y1],
        [x2, y2],
        [x1, y2],
    ]


def _downsample_polygon(pts: list[list[float]], max_verts: int) -> list[list[float]]:
    if len(pts) <= max_verts:
        return pts
    step = max(1, len(pts) // max_verts)
    return pts[::step][:max_verts]


def export_ultralytics_result(r: Any, task: str) -> dict[str, Any]:
    """单张图 ``Results`` → dict。"""
    names = _names_map(r)
    task_id = (task or "detect").strip().lower()
    shape = list(r.orig_shape) if getattr(r, "orig_shape", None) else None
    detections: list[dict[str, Any]] = []

    if task_id == "obb" and getattr(r, "obb", None) is not None and len(r.obb) > 0:
        obb = r.obb
        confs = obb.conf.cpu().numpy().tolist()
        cls_ids = obb.cls.cpu().numpy().tolist()
        polys = obb.xyxyxyxy.cpu().numpy().tolist()
        for i in range(len(polys)):
            cid = int(cls_ids[i])
            corners = polys[i]
            pts = [[float(p[0]), float(p[1])] for p in corners]
            if len(pts) < 4:
                continue
            detections.append(
                _detection_entry(
                    class_id=cid,
                    class_name=names.get(cid),
                    confidence=float(confs[i]),
                    shape_type="rotation",
                    points=pts,
                ),
            )
    elif task_id == "segment" and getattr(r, "masks", None) is not None:
        boxes = r.boxes
        if boxes is not None and len(boxes) > 0:
            confs = boxes.conf.cpu().numpy().tolist()
            cls_ids = boxes.cls.cpu().numpy().tolist()
        else:
            confs = []
            cls_ids = []
        xy_list = r.masks.xy if hasattr(r.masks, "xy") else []
        for i, poly in enumerate(xy_list):
            pts = [[float(p[0]), float(p[1])] for p in poly]
            if len(pts) < 3:
                continue
            cid = int(cls_ids[i]) if i < len(cls_ids) else 0
            conf = float(confs[i]) if i < len(confs) else 0.0
            shape_type = "polygon"
            if len(pts) > _MAX_POLYGON_VERTS:
                # 保持分割语义：仅做顶点下采样，不降级为 rectangle。
                pts = _downsample_polygon(pts, _MAX_POLYGON_VERTS)
            detections.append(
                _detection_entry(
                    class_id=cid,
                    class_name=names.get(cid),
                    confidence=conf,
                    shape_type=shape_type,
                    points=pts,
                ),
            )
        if not detections and boxes is not None and len(boxes) > 0:
            xyxy = boxes.xyxy.cpu().numpy().tolist()
            confs = boxes.conf.cpu().numpy().tolist()
            cls_ids = boxes.cls.cpu().numpy().tolist()
            for i in range(len(xyxy)):
                cid = int(cls_ids[i])
                detections.append(
                    _detection_entry(
                        class_id=cid,
                        class_name=names.get(cid),
                        confidence=float(confs[i]),
                        shape_type="rectangle",
                        points=_xyxy_to_rect_points(xyxy[i]),
                    ),
                )
    elif task_id == "pose" and getattr(r, "keypoints", None) is not None:
        kpt = r.keypoints
        if kpt is not None and len(kpt) > 0:
            boxes = r.boxes
            box_confs = boxes.conf.cpu().numpy().tolist() if boxes is not None and len(boxes) > 0 else []
            box_cls = boxes.cls.cpu().numpy().tolist() if boxes is not None and len(boxes) > 0 else []
            xy = kpt.xy.cpu().numpy()
            data = kpt.data.cpu().numpy() if hasattr(kpt, "data") and kpt.data is not None else None
            for i in range(len(xy)):
                cid = int(box_cls[i]) if i < len(box_cls) else 0
                base_conf = float(box_confs[i]) if i < len(box_confs) else 0.0
                instance_points: list[list[float]] = []
                nk = xy.shape[1] if xy.ndim > 1 else 0
                for j in range(nk):
                    x = float(xy[i, j, 0])
                    y = float(xy[i, j, 1])
                    kconf = 1.0
                    if data is not None and data.ndim >= 3 and data.shape[2] >= 3:
                        kconf = float(data[i, j, 2])
                    if kconf < 0.25:
                        continue
                    instance_points.append([x, y])
                    detections.append(
                        _detection_entry(
                            class_id=cid,
                            class_name=names.get(cid),
                            confidence=float(kconf if kconf > 0 else base_conf),
                            shape_type="point",
                            points=[[x, y]],
                            extra={"group_id": i, "keypoint_index": j},
                        ),
                    )
    else:
        boxes = r.boxes
        if boxes is not None and len(boxes) > 0:
            xyxy = boxes.xyxy.cpu().numpy().tolist()
            confs = boxes.conf.cpu().numpy().tolist()
            cls_ids = boxes.cls.cpu().numpy().tolist()
            for i in range(len(xyxy)):
                cid = int(cls_ids[i])
                detections.append(
                    _detection_entry(
                        class_id=cid,
                        class_name=names.get(cid),
                        confidence=float(confs[i]),
                        shape_type="rectangle",
                        points=_xyxy_to_rect_points(xyxy[i]),
                    ),
                )

    return {"names": names, "shape": shape, "detections": detections}
