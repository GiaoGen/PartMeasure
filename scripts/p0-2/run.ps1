param([Parameter(Mandatory=$true)][ValidateSet('setup','api','browser','db','targeted','recovery','file-view')][string]$Action,[ValidateSet('Direct','DiagnosticProxy')][string]$NetworkMode='Direct',[string]$ProxyUrl)
$ErrorActionPreference='Stop'
Set-Location -LiteralPath (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
. (Join-Path $PSScriptRoot '../shared/network.ps1')
$pmNetwork=Enter-PmNetwork -Mode $NetworkMode -ProxyUrl $ProxyUrl
try{
 & node --env-file=.env.local "scripts/p0-2/$Action.mjs"
 $pmExit=$LASTEXITCODE
}finally{Exit-PmNetwork $pmNetwork}
exit $pmExit
