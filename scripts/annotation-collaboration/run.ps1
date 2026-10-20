param([Parameter(Mandatory=$true)][ValidateSet('apply','reconcile','start','live','manual')][string]$Action)
$ErrorActionPreference='Stop'
Set-Location -LiteralPath (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '../..')).Path
. (Join-Path $PSScriptRoot '../shared/network.ps1')
$pmNetwork=Enter-PmNetwork
$pmPreviousApp=$env:APP_URL
try {
 $env:APP_URL='http://127.0.0.1:3122'
 if($Action -eq 'apply') { & node --env-file=.env.local scripts/annotation-collaboration/apply-isolated.mjs }
 elseif($Action -eq 'reconcile') { & node --env-file=.env.local --conditions=react-server --import tsx scripts/annotation-collaboration/reconcile.ts }
 elseif($Action -eq 'start') { & node --env-file=.env.local --env-file=tmp/performance-s34/events.env node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port 3122 }
 elseif($Action -eq 'manual') { & node --env-file=.env.local scripts/annotation-collaboration/prepare-manual.mjs }
 else { & node --env-file=.env.local scripts/annotation-collaboration/live.mjs }
 $pmExit=$LASTEXITCODE
} finally { Exit-PmNetwork $pmNetwork; $env:APP_URL=$pmPreviousApp }
exit $pmExit
