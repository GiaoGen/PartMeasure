$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot '../shared/network.ps1')
$pmInitial=@{}
foreach($pmKey in @('HTTP_PROXY','HTTPS_PROXY','ALL_PROXY','NO_PROXY','NODE_USE_ENV_PROXY','NODE_OPTIONS','PM_NETWORK_MODE')){$pmInitial[$pmKey]=[Environment]::GetEnvironmentVariable($pmKey,'Process')}
try{
 $env:HTTP_PROXY='http://127.0.0.1:9';$env:HTTPS_PROXY='http://127.0.0.1:9';$env:ALL_PROXY='http://127.0.0.1:9'
 $env:NODE_USE_ENV_PROXY='1';$env:NODE_OPTIONS='--use-env-proxy --use-system-ca'
 $pmState=Enter-PmNetwork
 try{
  if($env:HTTP_PROXY -or $env:HTTPS_PROXY -or $env:ALL_PROXY -or $env:NODE_USE_ENV_PROXY -ne '0' -or $env:NODE_OPTIONS -match '--use-env-proxy' -or $env:NODE_OPTIONS -notmatch '--use-system-ca'){throw 'DIRECT_POLICY_FAILED'}
 }finally{Exit-PmNetwork $pmState}
 if($env:HTTP_PROXY -ne 'http://127.0.0.1:9' -or $env:NODE_USE_ENV_PROXY -ne '1'){throw 'RESTORE_FAILED'}
 $pmRejected=$false
 try{Enter-PmNetwork -Mode DiagnosticProxy | Out-Null}catch{$pmRejected=$true}
 if(-not $pmRejected){throw 'IMPLICIT_PROXY_ACCEPTED'}
 $pmState=Enter-PmNetwork -Mode DiagnosticProxy -ProxyUrl 'http://127.0.0.1:9'
 try{if($env:NODE_USE_ENV_PROXY -ne '1' -or $env:PM_NETWORK_MODE -ne 'diagnostic-proxy'){throw 'EXPLICIT_POLICY_FAILED'}}finally{Exit-PmNetwork $pmState}
 Write-Output 'PASS: direct default, inherited proxy cleared, TLS option retained, explicit proxy only, environment restored; no network requests'
}finally{Exit-PmNetwork $pmInitial}
