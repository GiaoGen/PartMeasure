param([Parameter(Mandatory=$true)][ValidateSet('start','api','db')][string]$Action,[ValidateSet('Direct','DiagnosticProxy')][string]$NetworkMode='Direct',[string]$ProxyUrl)
$ErrorActionPreference='Stop'
Set-Location -LiteralPath (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
. (Join-Path $PSScriptRoot '../shared/network.ps1')
$pmNetwork=Enter-PmNetwork -Mode $NetworkMode -ProxyUrl $ProxyUrl
$pmOldApp=$env:APP_URL
try{
 if($Action -eq 'start'){
  $env:APP_URL='http://127.0.0.1:3105'
  & node node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port 3105
 }else{
  & node --env-file=.env.local "scripts/backend-alignment/$Action.mjs"
 }
 $pmExit=$LASTEXITCODE
}finally{Exit-PmNetwork $pmNetwork;$env:APP_URL=$pmOldApp}
exit $pmExit
