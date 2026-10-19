param(
  [Parameter(Mandatory=$true)][ValidateSet('request','verify','services')][string]$Action,
  [ValidateSet('A','B')][string]$Actor,
  [switch]$ResendConfirmed,
  [ValidateSet('Direct','DiagnosticProxy')][string]$NetworkMode='Direct',
  [string]$ProxyUrl
)
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
. (Join-Path $PSScriptRoot '../shared/network.ps1')
$pmNetwork=Enter-PmNetwork -Mode $NetworkMode -ProxyUrl $ProxyUrl
try {
  if ($Action -eq 'services') { & node --dns-result-order=ipv4first scripts/labs/services.mjs }
  else {
    if($ResendConfirmed -and $Action -ne 'request'){throw 'ResendConfirmed only applies to email request'}
    $taskArguments=@('--dns-result-order=ipv4first','scripts/labs/auth.mjs',$Action,$Actor)
    if($ResendConfirmed){$taskArguments+='--resend-confirmed'}
    & node @taskArguments
  }
  $taskResult = $LASTEXITCODE
} finally {
  Exit-PmNetwork $pmNetwork
}
exit $taskResult
