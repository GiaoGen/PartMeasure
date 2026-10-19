param([Parameter(Mandatory=$true)][ValidateSet('start','api','db')][string]$Action)
$ErrorActionPreference='Stop'
Set-Location -LiteralPath (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$pmOldHttp=$env:HTTP_PROXY;$pmOldHttps=$env:HTTPS_PROXY;$pmOldNoProxy=$env:NO_PROXY;$pmOldApp=$env:APP_URL
try{
 $pmUri=[Uri]'https://rvysclscetfqicpnzlra.supabase.co';$pmProxy=[System.Net.WebRequest]::DefaultWebProxy.GetProxy($pmUri)
 if($pmProxy.Host -ne $pmUri.Host){$env:HTTP_PROXY=$pmProxy.AbsoluteUri;$env:HTTPS_PROXY=$pmProxy.AbsoluteUri}
 $env:NO_PROXY='localhost,127.0.0.1,::1'
 if($Action -eq 'start'){
  $env:APP_URL='http://127.0.0.1:3105'
  & node --use-env-proxy node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port 3105
 }else{
  & node --use-env-proxy --env-file=.env.local "scripts/backend-alignment/$Action.mjs"
 }
 $pmExit=$LASTEXITCODE
}finally{$env:HTTP_PROXY=$pmOldHttp;$env:HTTPS_PROXY=$pmOldHttps;$env:NO_PROXY=$pmOldNoProxy;$env:APP_URL=$pmOldApp}
exit $pmExit
