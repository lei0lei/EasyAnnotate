#Requires -Version 5.1
param(
  [Parameter(Mandatory = $true)]
  [string]$EmbedRoot
)

$ErrorActionPreference = "Stop"
$pthFiles = Get-ChildItem -LiteralPath $EmbedRoot -Filter "python*._pth" -File -ErrorAction SilentlyContinue
if (-not $pthFiles -or $pthFiles.Count -eq 0) {
  Write-Warning "No python*._pth under $EmbedRoot — skip (non-embed layout?)"
  exit 0
}

foreach ($pth in $pthFiles) {
  $raw = [System.IO.File]::ReadAllText($pth.FullName)
  if ($raw -match '(?m)^\s*import site\s*$') {
    Write-Host "Already enabled: $($pth.Name)"
    continue
  }
  $next = $raw -replace '(?m)^\s*#import site\s*$', 'import site'
  if ($next -eq $raw) {
    $next = $raw.TrimEnd("`r", "`n") + "`r`nimport site`r`n"
  }
  [System.IO.File]::WriteAllText($pth.FullName, $next)
  Write-Host "Enabled site-packages: $($pth.Name)"
}
