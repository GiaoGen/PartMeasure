param(
  [Parameter(Mandatory=$true)][ValidateSet('request','verify','services')][string]$Action,
  [ValidateSet('A','B')][string]$Actor,
  [switch]$ResendConfirmed
)
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$taskOldHttp = $env:HTTP_PROXY
$taskOldHttps = $env:HTTPS_PROXY
try {
  # Node does not automatically use the user's Windows system proxy. Respect it for this child only.
  $taskUri = [Uri]'https://rvysclscetfqicpnzlra.supabase.co'
  $taskProxy = [System.Net.WebRequest]::DefaultWebProxy.GetProxy($taskUri)
  if ($taskProxy.Host -ne $taskUri.Host) {
    $env:HTTPS_PROXY = $taskProxy.AbsoluteUri
    $env:HTTP_PROXY = $taskProxy.AbsoluteUri
  }
  if ($Action -eq 'services') { & node --use-env-proxy --dns-result-order=ipv4first scripts/labs/services.mjs }
  else {
    if($ResendConfirmed -and $Action -ne 'request'){throw 'ResendConfirmed only applies to email request'}
    $taskArguments=@('--use-env-proxy','--dns-result-order=ipv4first','scripts/labs/auth.mjs',$Action,$Actor)
    if($ResendConfirmed){$taskArguments+='--resend-confirmed'}
    & node @taskArguments
  }
  $taskResult = $LASTEXITCODE
} finally {
  $env:HTTP_PROXY = $taskOldHttp
  $env:HTTPS_PROXY = $taskOldHttps
}
exit $taskResult
