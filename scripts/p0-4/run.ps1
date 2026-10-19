param([Parameter(Mandatory=$true)][ValidateSet('start','api','db','browser','browser-resume','browser-delivery','workflow','probe-header','transfer','retry-pending','diagnose-worker','seed','soak')][string]$Action,[ValidateSet('Direct','DiagnosticProxy')][string]$NetworkMode='Direct',[string]$ProxyUrl)
$ErrorActionPreference='Stop'
Set-Location -LiteralPath (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
. (Join-Path $PSScriptRoot '../shared/network.ps1')
$pmNetwork=Enter-PmNetwork -Mode $NetworkMode -ProxyUrl $ProxyUrl
$pmOldApp=$env:APP_URL
try{
 if($Action -eq 'start'){
  $env:APP_URL='http://127.0.0.1:3001'
  & node node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port 3001
 }elseif($Action -eq 'browser-delivery'){
  & node --env-file=.env.local scripts/p0-4/browser.mjs --delivery-only
 }elseif($Action -eq 'browser-resume'){
  & node --env-file=.env.local scripts/p0-4/browser.mjs --resume
 }else{
  & node --env-file=.env.local "scripts/p0-4/$Action.mjs"
 }
 $pmExit=$LASTEXITCODE
}finally{Exit-PmNetwork $pmNetwork;$env:APP_URL=$pmOldApp}
exit $pmExit
