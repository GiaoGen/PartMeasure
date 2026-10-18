param([Parameter(Mandatory=$true)][ValidateSet('start','api','db','browser','browser-resume','browser-delivery','workflow','probe-header','transfer','retry-pending','diagnose-worker','seed','soak')][string]$Action)
$ErrorActionPreference='Stop'
Set-Location -LiteralPath (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$pmOldHttp=$env:HTTP_PROXY;$pmOldHttps=$env:HTTPS_PROXY;$pmOldNoProxy=$env:NO_PROXY
try{
 $pmUri=[Uri]'https://rvysclscetfqicpnzlra.supabase.co';$pmProxy=[System.Net.WebRequest]::DefaultWebProxy.GetProxy($pmUri)
 if($pmProxy.Host -ne $pmUri.Host){$env:HTTP_PROXY=$pmProxy.AbsoluteUri;$env:HTTPS_PROXY=$pmProxy.AbsoluteUri}
 $env:NO_PROXY='localhost,127.0.0.1,::1'
 if($Action -eq 'start'){
  $env:APP_URL='http://127.0.0.1:3001'
  & node --use-env-proxy node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port 3001
 }elseif($Action -eq 'browser-delivery'){
  & node --use-env-proxy --env-file=.env.local scripts/p0-4/browser.mjs --delivery-only
 }elseif($Action -eq 'browser-resume'){
  & node --use-env-proxy --env-file=.env.local scripts/p0-4/browser.mjs --resume
 }else{
  & node --use-env-proxy --env-file=.env.local "scripts/p0-4/$Action.mjs"
 }
 $pmExit=$LASTEXITCODE
}finally{$env:HTTP_PROXY=$pmOldHttp;$env:HTTPS_PROXY=$pmOldHttps;$env:NO_PROXY=$pmOldNoProxy}
exit $pmExit
