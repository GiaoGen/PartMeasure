param([switch]$Web)
$ErrorActionPreference='Stop'
Set-Location -LiteralPath (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '../..')).Path
if(-not $Web){ Write-Output 'No Worker or scanner needed. Run npm run dev for the web app.'; exit 0 }
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/p0-4/run.ps1 -Action start
exit $LASTEXITCODE
