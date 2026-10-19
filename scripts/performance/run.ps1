param(
 [Parameter(Mandatory=$true)][ValidateSet('start','transport','api','regression','client')][string]$Action,
 [ValidateSet('before','after')][string]$Sample='after'
)
$ErrorActionPreference='Stop'
Set-Location -LiteralPath (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '../..')).Path
. (Join-Path $PSScriptRoot '../shared/network.ps1')
$pmNetwork=Enter-PmNetwork
$pmOldApp=$env:APP_URL;$pmOldTiming=$env:PM_SERVER_TIMING
try{
 if($Action -eq 'start'){
  $env:APP_URL='http://127.0.0.1:3110';$env:PM_SERVER_TIMING='1'
  & node node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port 3110
 }elseif($Action -eq 'transport'){
  & node --env-file=.env.local scripts/performance/transport.mjs $Sample
 }elseif($Action -eq 'api'){
  & node --env-file=.env.local scripts/performance/api-baseline.mjs $Sample
 }elseif($Action -eq 'client'){
  & node --env-file=.env.local --import tsx scripts/performance/client.mjs
 }else{
  & node --env-file=.env.local --import tsx scripts/performance/regression.mjs
 }
 $pmExit=$LASTEXITCODE
}finally{Exit-PmNetwork $pmNetwork;$env:APP_URL=$pmOldApp;$env:PM_SERVER_TIMING=$pmOldTiming}
exit $pmExit
