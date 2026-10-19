# Process-local policy only. Never read or modify the Windows system proxy.
function Enter-PmNetwork {
 param([ValidateSet('Direct','DiagnosticProxy')][string]$Mode='Direct',[string]$ProxyUrl)
 if($Mode -eq 'DiagnosticProxy'){
  $pmParsed=$null
  if(-not [Uri]::TryCreate($ProxyUrl,[UriKind]::Absolute,[ref]$pmParsed) -or $pmParsed.Scheme -notin @('http','https') -or $pmParsed.UserInfo){throw 'DiagnosticProxy requires an explicit HTTP(S) ProxyUrl without credentials'}
 }elseif($ProxyUrl){throw 'ProxyUrl requires DiagnosticProxy mode'}
 $pmSnapshot=@{}
 foreach($pmName in @('HTTP_PROXY','HTTPS_PROXY','ALL_PROXY','NO_PROXY','NODE_USE_ENV_PROXY','NODE_OPTIONS','PM_NETWORK_MODE')){
  $pmSnapshot[$pmName]=[Environment]::GetEnvironmentVariable($pmName,'Process')
 }
 foreach($pmName in @('HTTP_PROXY','HTTPS_PROXY','ALL_PROXY')){[Environment]::SetEnvironmentVariable($pmName,$null,'Process')}
 $env:NODE_OPTIONS=($env:NODE_OPTIONS -replace '(?<!\S)--use-env-proxy(?=\s|$)','').Trim()
 $env:NO_PROXY='localhost,127.0.0.1,::1'
 $env:NODE_USE_ENV_PROXY='0'
 $env:PM_NETWORK_MODE='direct'
 if($Mode -eq 'DiagnosticProxy'){
  $env:HTTP_PROXY=$ProxyUrl;$env:HTTPS_PROXY=$ProxyUrl
  $env:NODE_USE_ENV_PROXY='1';$env:PM_NETWORK_MODE='diagnostic-proxy'
 }
 Write-Host ('Network mode: '+$env:PM_NETWORK_MODE+' (process-local; VPN/TUN not controlled)')
 return $pmSnapshot
}
function Exit-PmNetwork {
 param([hashtable]$Snapshot)
 foreach($pmName in $Snapshot.Keys){[Environment]::SetEnvironmentVariable($pmName,$Snapshot[$pmName],'Process')}
}
