#Requires -Version 5.1
# Upstream dinov2/requirements.txt pins torch==2.0.0 + cuml/xformers; breaks Windows embed + cu128.
param(
  [Parameter(Mandatory = $true)]
  [string] $Dinov2Root
)
$ErrorActionPreference = "Stop"
$path = Join-Path $Dinov2Root "requirements.txt"
$lines = @(
  "# Patched by EasyAnnotate: torch/torchvision from install-ml-gpu-deps.ps1; omit cuml/xformers.",
  "# Do not use UTF-8 BOM here: dinov2 setup.py opens this file with locale encoding on Windows.",
  "omegaconf",
  "torchmetrics>=0.10.3",
  "fvcore",
  "iopath",
  "submitit"
)
$utf8 = New-Object System.Text.UTF8Encoding $false
[System.IO.File]::WriteAllLines($path, $lines, $utf8)
Write-Host "Patched DINOv2 requirements: $path"
