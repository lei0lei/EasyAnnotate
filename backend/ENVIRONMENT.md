# 后端环境（便携 / 整目录复制）

目标：**推理与运行所需文件都在 `python-embed` 里**，把整个 `backend` 拷到别机、别路径也能用（需 **同架构 x64**、**匹配 NVIDIA 驱动**（若用 CUDA 轮子）、`cu128` 等与轮子一致；当前文档以 **Windows embeddable** 与 **Linux embeddable** 两种布局为参考）。

在 **PowerShell** 中请在 `backend` 目录执行脚本（或从仓库根目录用路径调用，例如 `.\backend\install-deps.ps1`）。若提示禁止运行脚本，可先执行：`Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`，或用 `powershell -ExecutionPolicy Bypass -File .\backend\install-deps.ps1`。

## Linux（bash）

在 **`backend`** 目录执行与 `*.ps1` 同逻辑的 **`*.sh`**（首次可 `chmod +x *.sh scripts/*.sh`）。脚本假定 **Linux 版 embeddable** 在 `python-embed/`，解释器为 **`python-embed/bin/python3`**（或 `python3.12` 等，由 `scripts/embed_python.sh` 探测）。安装 pip 使用 **`curl`** 下载 `get-pip.py`；`scripts/enable_embed_site.sh` 使用 **GNU `sed -i`**。

| PowerShell | Bash |
|------------|------|
| `scripts/enable_embed_site.ps1` | `scripts/enable_embed_site.sh` |
| `scripts/patch-dinov2-embed-requirements.ps1` | `scripts/patch-dinov2-embed-requirements.sh` |
| `install-deps.ps1` | `install-deps.sh` |
| `install-ml-gpu-deps.ps1` | `install-ml-gpu-deps.sh`（可选首参：`./install-ml-gpu-deps.sh cu124`） |
| `install-resources.ps1` | `install-resources.sh`（支持 `--force`） |
| `start.ps1` | `start.sh` |

辅助（仅 bash）：**`scripts/embed_python.sh`** 打印 `python-embed` 下的解释器路径。

编 SAM2 CUDA 扩展：`SAM2_BUILD_CUDA=1 ./install-ml-gpu-deps.sh`。

## 「移动版」要注意什么

| 做法 | 复制目录后 |
|------|------------|
| **`pip install -e`（可编辑）** | 会在 `site-packages` 里记下**原来的绝对路径**，换路径后易坏。 |
| **`pip install 本地目录`（当前脚本）** | 把包装进 **`Lib\site-packages`**，**不依赖** `external/github` 的磁盘路径，整份 `python-embed` 可搬。 |

当前 **`install-ml-gpu-deps.ps1`** 使用后者。`external/github` 仍保留，便于你 `git pull` 后在同一台机器上**重新执行脚本**升级已安装包。

## 1. 基底 API（FastAPI / uvicorn）

```powershell
Set-Location path\to\backend   # 或从根目录: .\backend\install-deps.ps1
.\install-deps.ps1
```

## 2. GPU：PyTorch(CUDA) + Ultralytics YOLO + DINOv2 + SAM 2 + MobileSAM + EfficientSAM

**依赖**：`git.exe` 在 PATH 上（克隆到 `external/github`）。

```powershell
.\install-ml-gpu-deps.ps1
```

默认 **CUDA 12.8（`cu128`）**；其他系列示例：

```powershell
.\install-ml-gpu-deps.ps1 -TorchCuda cu124
```

**源码克隆位置**：

- `external/github/ultralytics` ← [ultralytics/ultralytics](https://github.com/ultralytics/ultralytics)（YOLO；**AGPL-3.0**，商用需自行评估许可）
- `external/github/dinov2` ← [facebookresearch/dinov2](https://github.com/facebookresearch/dinov2)
- `external/github/sam2` ← [facebookresearch/sam2](https://github.com/facebookresearch/sam2)
- `external/github/mobilesam` ← [ChaoningZhang/MobileSAM](https://github.com/ChaoningZhang/MobileSAM)（轻量 SAM：TinyViT 编码器 + 原版 SAM 解码器；**依赖 `timm`**，已写入 `requirements-ml-gpu.txt`）
- `external/github/efficientsam` ← [yformer/EfficientSAM](https://github.com/yformer/EfficientSAM)（EfficientSAM；仅 PyTorch，上游 `setup.py` 无额外硬依赖）

说明：

- **Ultralytics**：依赖里使用 **`opencv-python`**（非 headless）；安装时可能会与先前的 `opencv-python-headless` 并存或由 pip 协商替换，一般不影响仅后端推理。

- **DINOv2**：上游 `requirements.txt` 固定 `torch==2.0.0` 且含 `cuml`/`xformers` 等，在 Windows 便携 + 新版 PyTorch 下常无法解析；安装脚本会在 clone 后**改写** `external/github/dinov2/requirements.txt`（仅保留与已安装 torch 共存的依赖）。
- 默认 **`SAM2_BUILD_CUDA=0`**（便携/免 NVCC）。若要编扩展：`$env:SAM2_BUILD_CUDA='1'; .\install-ml-gpu-deps.ps1`。见 [SAM2 INSTALL.md](https://github.com/facebookresearch/sam2/blob/main/INSTALL.md)。

## 3. 启动

```powershell
.\start.ps1
```

## 4. 体积与迁移

- **`python-embed`**（含 `Lib\site-packages`）最大，**这是移动版核心**；拷整个 `backend` 时请带上。
- **`app`、`start.ps1` / `start.sh`、`install-*.{ps1,sh}`、`scripts\`** 也要带。
- **`external/github`**：分发时可**不拷**以减小体积（运行已不依赖其路径）；若要离线升级再拷或到新机器上重新 clone + 再跑一遍安装脚本。

目标机仍需：支持所选 **CUDA 系列** 的驱动；若缺 **VC++ 运行库**，按微软说明安装。

## 5. 验证

```powershell
.\python-embed\python.exe -c "import torch; print('cuda', torch.cuda.is_available())"
.\python-embed\python.exe -m uvicorn app.main:app --host 0.0.0.0 --port 8000
```

浏览器：`http://127.0.0.1:8000/health`。

### 仅下载模型资源（不进 git 的大文件）

在 `backend` 目录执行（已存在则跳过，除非加 `-Force`）：

```powershell
.\install-resources.ps1
.\install-resources.ps1 -Force
```

内部调用 `scripts/install_resources.py`，按 **`registry.json`** 写入 `external/resources/` 下对应路径。

## 6. 模型权重与配置（`external/resources`）

- 清单：**`external/resources/registry.json`**（资源 ID → 相对路径 + 下载 URL）。
- 预置示例：`ultralytics/yolov8s`、`sam2/sam2.1_hiera_large`、`sam2/cfg/sam2.1_hiera_l`、`dinov2/dinov2_vitb14_pretrain`、`mobile_sam/vit_t`（`mobile_sam.pt`）、`efficient_sam/vitt`（`efficient_sam_vitt.pt`）等（见 `registry.json`）。
- 预留子目录 **`efficientnet/`**、**`mobilenet/`**，用于存放对应骨干预训练权重；在 `registry.json` 登记资源后即可用 `install-resources` / `ensure_asset` 与现有流程一致。
- **API**：`GET /api/v1/model-assets` 列出资源与是否已下载；`POST /api/v1/model-assets/<asset_id>/ensure` 按需下载（含斜杠的 ID 可直接写在路径里，如 `.../ultralytics/yolov8s/ensure`）。
- 大 `.pt` 文件已写入 **`backend/.gitignore`**，通常只提交 `registry.json` 与小 yaml。

详见 **`external/resources/README.md`**。
