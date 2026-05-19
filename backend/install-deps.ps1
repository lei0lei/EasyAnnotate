#Requires -Version 5.1
# Install FastAPI base deps into backend\python-embed (same layout as old install-deps.bat).
param()
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot
$BackendRoot = $PSScriptRoot
$EmbedRoot = Join-Path $BackendRoot "python-embed"
$PythonExe = Join-Path $EmbedRoot "python.exe"
$env:PYTHONNOUSERSITE = "1"

if (-not (Test-Path -LiteralPath $PythonExe)) {
  Write-Error "python.exe not found: $PythonExe (expected backend\python-embed\python.exe)"
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

& $PythonExe -m pip install -r (Join-Path $BackendRoot "requirements.txt")
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
Write-Host ""
Write-Host "Done. Run .\start.ps1 to launch the API."
