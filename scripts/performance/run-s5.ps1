param([Parameter(Mandatory=$true)][ValidateSet('start','client','evidence')][string]$Action)
$ErrorActionPreference='Stop'
Set-Location -LiteralPath (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '../..')).Path
. (Join-Path $PSScriptRoot '../shared/network.ps1')
$pmPrevious=Enter-PmNetwork
$pmApp=$env:APP_URL;$pmTiming=$env:PM_SERVER_TIMING
try {
 $env:APP_URL='http://127.0.0.1:3115';$env:PM_SERVER_TIMING='1'
 if($Action -eq 'start'){ & node --env-file=.env.local node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port 3115 }
 elseif($Action -eq 'client') { & node --env-file=.env.local --import tsx scripts/performance/cache-client.mjs }
 else { & node --env-file=.env.local scripts/performance/cache-evidence.mjs }
 $pmExit=$LASTEXITCODE
}finally { Exit-PmNetwork $pmPrevious;$env:APP_URL=$pmApp;$env:PM_SERVER_TIMING=$pmTiming }
exit $pmExit
