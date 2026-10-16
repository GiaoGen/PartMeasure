param([Parameter(Mandatory=$true)][ValidateSet('setup','api','browser','db','targeted','recovery','file-view')][string]$Action)
$ErrorActionPreference='Stop'
Set-Location -LiteralPath (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$pmOldHttp=$env:HTTP_PROXY;$pmOldHttps=$env:HTTPS_PROXY;$pmOldNoProxy=$env:NO_PROXY
try{
 $pmUri=[Uri]'https://rvysclscetfqicpnzlra.supabase.co';$pmProxy=[System.Net.WebRequest]::DefaultWebProxy.GetProxy($pmUri)
 if($pmProxy.Host -ne $pmUri.Host){$env:HTTP_PROXY=$pmProxy.AbsoluteUri;$env:HTTPS_PROXY=$pmProxy.AbsoluteUri}
 $env:NO_PROXY='localhost,127.0.0.1,::1'
 & node --use-env-proxy --env-file=.env.local "scripts/p0-2/$Action.mjs"
 $pmExit=$LASTEXITCODE
}finally{$env:HTTP_PROXY=$pmOldHttp;$env:HTTPS_PROXY=$pmOldHttps;$env:NO_PROXY=$pmOldNoProxy}
exit $pmExit
