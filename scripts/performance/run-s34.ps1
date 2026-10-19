param([Parameter(Mandatory=$true)][ValidateSet('probe','start','live','worker','backfill','cleanup','images')][string]$Action)
$ErrorActionPreference='Stop'
Set-Location -LiteralPath (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '../..')).Path
. (Join-Path $PSScriptRoot '../shared/network.ps1')
$pmNetwork=Enter-PmNetwork
$pmOldApp=$env:APP_URL
try{
 $env:APP_URL='http://127.0.0.1:3111'
 if($Action -eq 'probe'){& node --env-file=.env.local scripts/performance/probe-s34.mjs}
 elseif($Action -eq 'start'){& node --env-file=.env.local --env-file=tmp/performance-s34/events.env node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port 3111}
 elseif($Action -eq 'live'){& node --env-file=.env.local --env-file=tmp/performance-s34/events.env --import tsx scripts/performance/live-s34.mjs}
 elseif($Action -eq 'images'){& node --import tsx scripts/performance/images-s34.mjs}
 else{
  $pmWorkerArgs=@('--env-file=.env.local','--env-file=tmp/performance-s34/events.env','--import','tsx','scripts/worker/supervise.ts')
  if($Action -eq 'cleanup'){$pmWorkerArgs+='--cleanup-only'}
  elseif($Action -eq 'backfill'){$pmWorkerArgs+=@('--backfill-only','--once')}
  & node @pmWorkerArgs
 }
 $pmExit=$LASTEXITCODE
}finally{Exit-PmNetwork $pmNetwork;$env:APP_URL=$pmOldApp}
exit $pmExit
