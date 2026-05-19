#Requires -Version 5.1
# Download assets listed in external/resources/registry.json into external/resources/ (skip if file exists).
param(
  [switch] $Force
)
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot
$BackendRoot = $PSScriptRoot
$EmbedRoot = Join-Path $BackendRoot "python-embed"
$PythonExe = Join-Path $EmbedRoot "python.exe"
$env:PYTHONNOUSERSITE = "1"

if (-not (Test-Path -LiteralPath $PythonExe)) {
  Write-Error "python.exe not found: $PythonExe (expected backend\python-embed\python.exe)"
}

$script = Join-Path $BackendRoot "scripts\install_resources.py"
$pyArgs = @($script)
if ($Force) {
  $pyArgs += "--force"
}

& $PythonExe @pyArgs
exit $LASTEXITCODE
