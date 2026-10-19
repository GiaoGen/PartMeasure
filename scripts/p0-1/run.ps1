param([Parameter(Mandatory=$true)][ValidateSet('provision','dev','start','worker','auth-request','auth-verify','create-test-users','business-test','browser-test','tus-test','db-test')][string]$Action,[ValidateSet('Direct','DiagnosticProxy')][string]$NetworkMode='Direct',[string]$ProxyUrl)
$ErrorActionPreference='Stop'
Set-Location -LiteralPath (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
. (Join-Path $PSScriptRoot '../shared/network.ps1')
$pmNetwork=Enter-PmNetwork -Mode $NetworkMode -ProxyUrl $ProxyUrl
try {
  $taskArgs=@('--dns-result-order=ipv4first')
  if($Action -eq 'provision'){ & node @taskArgs scripts/p0-1/provision.mjs }
  elseif($Action -eq 'dev'){ & node @taskArgs node_modules/next/dist/bin/next dev --webpack --hostname 127.0.0.1 }
  elseif($Action -eq 'start'){ & node @taskArgs node_modules/next/dist/bin/next start --hostname 127.0.0.1 }
  elseif($Action -eq 'worker'){ & node @taskArgs --env-file=.env.local --conditions=react-server --import tsx scripts/p0-1/worker.ts }
  elseif($Action -eq 'auth-request'){ & node @taskArgs scripts/p0-1/auth-test.mjs request }
  elseif($Action -eq 'auth-verify'){ & node @taskArgs scripts/p0-1/auth-test.mjs verify }
  elseif($Action -eq 'create-test-users'){ & node @taskArgs scripts/p0-1/create-test-users.mjs }
  elseif($Action -eq 'browser-test'){ & node @taskArgs scripts/p0-1/browser-test.mjs }
  elseif($Action -eq 'tus-test'){ & node @taskArgs scripts/p0-1/tus-browser-test.mjs }
  elseif($Action -eq 'db-test'){ & node @taskArgs --env-file=.env.local scripts/p0-1/db-integrity.mjs }
  else { & node @taskArgs scripts/p0-1/business-test.mjs }
  $taskResult=$LASTEXITCODE
}finally{Exit-PmNetwork $pmNetwork}
exit $taskResult
