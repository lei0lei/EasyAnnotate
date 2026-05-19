#Requires -Version 5.1
# Start FastAPI on 0.0.0.0:8000 using backend\python-embed\python.exe
param()
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot
$BackendRoot = $PSScriptRoot
$EmbedRoot = Join-Path $BackendRoot "python-embed"
$PythonExe = Join-Path $EmbedRoot "python.exe"
$env:PYTHONNOUSERSITE = "1"

if (-not (Test-Path -LiteralPath $PythonExe)) {
  Write-Error "python.exe not found: $PythonExe"
}

& $PythonExe -m uvicorn app.main:app --host "0.0.0.0" --port 8000
