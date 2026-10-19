param([Parameter(Mandatory=$true)][ValidateSet('api','browser','browser-photo','db','seed','concurrency')][string]$Action,[ValidateSet('Direct','DiagnosticProxy')][string]$NetworkMode='Direct',[string]$ProxyUrl)
$ErrorActionPreference='Stop'
Set-Location -LiteralPath (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
. (Join-Path $PSScriptRoot '../shared/network.ps1')
$pmNetwork=Enter-PmNetwork -Mode $NetworkMode -ProxyUrl $ProxyUrl
try{
 if($Action -eq 'browser-photo'){ & node --env-file=.env.local scripts/p0-3/browser.mjs --photo-only }
 else { & node --env-file=.env.local "scripts/p0-3/$Action.mjs" }
 $pmExit=$LASTEXITCODE
}finally{Exit-PmNetwork $pmNetwork}
exit $pmExit
