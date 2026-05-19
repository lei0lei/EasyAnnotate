"""Help free GPU / RAM after removing models from in-process caches."""

from __future__ import annotations

import gc
import sys
from typing import Any

import torch


def _trim_glibc_heap_best_effort() -> None:
    """On glibc Linux, return free heap pages to the OS (no-op on Windows / macOS)."""
    if sys.platform != "linux":
        return
    try:
        import ctypes

        libc = ctypes.CDLL("libc.so.6")
        libc.malloc_trim(0)
    except Exception:
        pass


def _move_module_tree_cpu(m: torch.nn.Module) -> None:
    try:
        m.to("cpu")
    except Exception:
        pass
    try:
        m.eval()
    except Exception:
        pass


def dispose_torch_object(obj: Any) -> None:
    """Best-effort: clear predictor caches, move nn.Modules to CPU, drop wrapper refs."""
    if obj is None:
        return

    reset = getattr(obj, "reset_predictor", None)
    if callable(reset):
        try:
            reset()
        except Exception:
            pass
    reset_img = getattr(obj, "reset_image", None)
    if callable(reset_img):
        try:
            reset_img()
        except Exception:
            pass

    for cache_attr in ("_features", "features", "_orig_hw", "original_size", "input_size"):
        if hasattr(obj, cache_attr):
            try:
                setattr(obj, cache_attr, None)
            except Exception:
                pass
    for bool_attr in ("_is_image_set", "_is_batch", "is_image_set"):
        if hasattr(obj, bool_attr):
            try:
                setattr(obj, bool_attr, False)
            except Exception:
                pass

    if isinstance(obj, torch.nn.Module):
        _move_module_tree_cpu(obj)
        return

    for attr in ("model", "sam"):
        child = getattr(obj, attr, None)
        if isinstance(child, torch.nn.Module):
            _move_module_tree_cpu(child)

    if not isinstance(obj, torch.nn.Module):
        for attr in ("model", "sam", "predictor"):
            if hasattr(obj, attr):
                try:
                    setattr(obj, attr, None)
                except Exception:
                    pass


def sync_gc_empty_cuda() -> None:
    for _ in range(2):
        gc.collect(2)

    if torch.cuda.is_available():
        try:
            torch.cuda.synchronize()
        except Exception:
            pass
        for d in range(torch.cuda.device_count()):
            try:
                with torch.cuda.device(d):
                    torch.cuda.empty_cache()
            except Exception:
                pass
        try:
            fn = getattr(torch._C, "_cuda_clearCublasWorkspaces", None)
            if callable(fn):
                fn()
        except Exception:
            pass

    for _ in range(2):
        gc.collect(2)

    _trim_glibc_heap_best_effort()
