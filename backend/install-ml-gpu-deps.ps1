#Requires -Version 5.1
# PyTorch (CUDA) + Ultralytics YOLO + DINOv2 + SAM2 + MobileSAM + EfficientSAM into python-embed (path-portable pip install).
param(
  [string] $TorchCuda = "cu128"
)
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot
$BackendRoot = $PSScriptRoot
$EmbedRoot = Join-Path $BackendRoot "python-embed"
$PythonExe = Join-Path $EmbedRoot "python.exe"
$env:PYTHONNOUSERSITE = "1"

if (-not (Test-Path -LiteralPath $PythonExe)) {
  Write-Error "python.exe not found: $PythonExe"
}

& $PythonExe -c "import sys; raise SystemExit(0 if sys.version_info >= (3, 10) else 1)"
if ($LASTEXITCODE -ne 0) {
  Write-Error "SAM2/DINOv2 need Python 3.10+. Replace python-embed with 3.10+ from python.org"
}

$enable = Join-Path $BackendRoot "scripts\enable_embed_site.ps1"
& $enable -EmbedRoot $EmbedRoot

$null = & $PythonExe -m pip --version 2>&1
if ($LASTEXITCODE -ne 0) {
  Write-Host "Installing pip into embeddable Python..."
  $getPip = Join-Path $env:TEMP "get-pip-easyannotate.py"
  Invoke-WebRequest -Uri "https://bootstrap.pypa.io/get-pip.py" -OutFile $getPip
  & $PythonExe $getPip
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  Write-Error "git.exe must be on PATH to clone external/github (dinov2, sam2, ultralytics, mobilesam, efficientsam)"
}

$gh = Join-Path $BackendRoot "external\github"
if (-not (Test-Path -LiteralPath $gh)) {
  New-Item -ItemType Directory -Path $gh | Out-Null
}

$dinov2 = Join-Path $gh "dinov2"
if (-not (Test-Path -LiteralPath (Join-Path $dinov2 ".git"))) {
  Write-Host "Cloning DINOv2 into external\github\dinov2 ..."
  & git clone "https://github.com/facebookresearch/dinov2.git" $dinov2
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
} else {
  Write-Host "Updating DINOv2 ..."
  & git -C $dinov2 pull --ff-only
}

$patchDinov2 = Join-Path $BackendRoot "scripts\patch-dinov2-embed-requirements.ps1"
& $patchDinov2 -Dinov2Root $dinov2

$sam2 = Join-Path $gh "sam2"
if (-not (Test-Path -LiteralPath (Join-Path $sam2 ".git"))) {
  Write-Host "Cloning SAM 2 into external\github\sam2 ..."
  & git clone "https://github.com/facebookresearch/sam2.git" $sam2
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
} else {
  Write-Host "Updating SAM 2 ..."
  & git -C $sam2 pull --ff-only
}

$ultralytics = Join-Path $gh "ultralytics"
if (-not (Test-Path -LiteralPath (Join-Path $ultralytics ".git"))) {
  Write-Host "Cloning Ultralytics YOLO into external\github\ultralytics ..."
  & git clone "https://github.com/ultralytics/ultralytics.git" $ultralytics
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
} else {
  Write-Host "Updating Ultralytics YOLO ..."
  & git -C $ultralytics pull --ff-only
}

$mobilesam = Join-Path $gh "mobilesam"
if (-not (Test-Path -LiteralPath (Join-Path $mobilesam ".git"))) {
  Write-Host "Cloning MobileSAM into external\github\mobilesam ..."
  & git clone "https://github.com/ChaoningZhang/MobileSAM.git" $mobilesam
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
} else {
  Write-Host "Updating MobileSAM ..."
  & git -C $mobilesam pull --ff-only
}

$efficientsam = Join-Path $gh "efficientsam"
if (-not (Test-Path -LiteralPath (Join-Path $efficientsam ".git"))) {
  Write-Host "Cloning EfficientSAM into external\github\efficientsam ..."
  & git clone "https://github.com/yformer/EfficientSAM.git" $efficientsam
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
} else {
  Write-Host "Updating EfficientSAM ..."
  & git -C $efficientsam pull --ff-only
}

Write-Host ""
Write-Host "=== Base API deps (requirements.txt) ==="
& $PythonExe -m pip install -r (Join-Path $BackendRoot "requirements.txt")
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host ""
Write-Host "=== PyTorch + torchvision ($TorchCuda) into embed ==="
$indexUrl = "https://download.pytorch.org/whl/$TorchCuda"
& $PythonExe -m pip install "torch>=2.5.1,<3" "torchvision>=0.20.1" --index-url $indexUrl
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host ""
Write-Host "=== Vision deps (requirements-ml-gpu.txt) ==="
& $PythonExe -m pip install -r (Join-Path $BackendRoot "requirements-ml-gpu.txt")
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

if (-not $env:SAM2_BUILD_CUDA) {
  $env:SAM2_BUILD_CUDA = "0"
}
Write-Host ""
Write-Host "SAM2_BUILD_CUDA=$($env:SAM2_BUILD_CUDA) (set `$env:SAM2_BUILD_CUDA='1' before script to build SAM2 CUDA ext)"

Write-Host ""
Write-Host "=== Ultralytics YOLO (pip install into site-packages) ==="
& $PythonExe -m pip install $ultralytics
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host ""
Write-Host "=== DINOv2 (pip install into site-packages) ==="
& $PythonExe -m pip install $dinov2
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host ""
Write-Host "=== SAM 2 (pip install into site-packages) ==="
& $PythonExe -m pip install $sam2
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host ""
Write-Host "=== MobileSAM (pip install into site-packages) ==="
& $PythonExe -m pip install $mobilesam
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host ""
Write-Host "=== EfficientSAM (pip install into site-packages) ==="
& $PythonExe -m pip install $efficientsam
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host ""
Write-Host "Done. Run .\start.ps1 to launch the API."
