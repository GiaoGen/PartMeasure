param([switch]$TunOff)
$ErrorActionPreference='Stop'
Set-Location -LiteralPath (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '../..')).Path
. (Join-Path $PSScriptRoot '../shared/network.ps1')
$pmDiagNetwork=Enter-PmNetwork
$pmDiagOldTun=$env:PM_DIAG_TUN_OFF
try {
 if($TunOff){$env:PM_DIAG_TUN_OFF='1'}else{$env:PM_DIAG_TUN_OFF='0'}
 & node --env-file=.env.local scripts/performance/auth-direct-probe.mjs
 $pmDiagExit=$LASTEXITCODE
}finally {
 Exit-PmNetwork $pmDiagNetwork
 $env:PM_DIAG_TUN_OFF=$pmDiagOldTun
}
exit $pmDiagExit
