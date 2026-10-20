param([string]$PostgresBin='C:\Program Files\PostgreSQL\18\bin')
$ErrorActionPreference='Stop'
$pmRoot=(Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
Set-Location -LiteralPath $pmRoot
$pmRun=Join-Path $pmRoot ('tmp\performance-s34\pg-'+[guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $pmRun -Force | Out-Null
$pmData=Join-Path $pmRun 'data'
$pmPort=55448
if(Get-NetTCPConnection -State Listen -LocalPort $pmPort -ErrorAction SilentlyContinue){throw 'LOCAL_TEST_PORT_OCCUPIED'}
$pmOpenSsl='C:\Program Files\Git\usr\bin\openssl.exe'
$pmCertProcess=Start-Process -FilePath $pmOpenSsl -WindowStyle Hidden -Wait -PassThru -ArgumentList @('req','-x509','-newkey','rsa:2048','-nodes','-days','1','-subj','/CN=127.0.0.1','-addext','subjectAltName=IP:127.0.0.1','-keyout',(Join-Path $pmRun 'server.key'),'-out',(Join-Path $pmRun 'server.crt')) -RedirectStandardOutput (Join-Path $pmRun 'cert.stdout.log') -RedirectStandardError (Join-Path $pmRun 'cert.log')
if($pmCertProcess.ExitCode -ne 0){throw 'LOCAL_CERT_FAILED'}
& (Join-Path $PostgresBin 'initdb.exe') -D $pmData -U postgres --auth=trust --encoding=UTF8 --no-locale > (Join-Path $pmRun 'init.log')
if($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath (Join-Path $pmData 'PG_VERSION'))){throw 'LOCAL_INIT_FAILED'}
$pmCert=(Join-Path $pmRun 'server.crt').Replace('\','/')
$pmKey=(Join-Path $pmRun 'server.key').Replace('\','/')
Add-Content -LiteralPath (Join-Path $pmData 'postgresql.conf') -Value "`nssl=on`nssl_cert_file='$pmCert'`nssl_key_file='$pmKey'"
$pmStarted=$false
$pmPrevious=@{}
foreach($pmEnvName in @('DATABASE_URL','DATABASE_CA_FILE','DATABASE_CA_PEM','PM_ALIGNMENT_LOCAL','PM_EVENTS_LOCAL','EVENT_DATABASE_URL','WORKER_DATABASE_URL','APP_URL')){$pmPrevious[$pmEnvName]=[Environment]::GetEnvironmentVariable($pmEnvName,'Process')}
try{
 $pmStart=Start-Process -FilePath (Join-Path $PostgresBin 'pg_ctl.exe') -WindowStyle Hidden -PassThru -ArgumentList @('-D',$pmData,'-l',(Join-Path $pmRun 'server.log'),'-o',"`"-h 127.0.0.1 -p $pmPort`"",'-w','start') -RedirectStandardOutput (Join-Path $pmRun 'start.log') -RedirectStandardError (Join-Path $pmRun 'start-error.log')
 $pmStarted=$true
 if(-not $pmStart.WaitForExit(30000)){throw 'LOCAL_START_FAILED'}
 & (Join-Path $PostgresBin 'pg_ctl.exe') -D $pmData status > (Join-Path $pmRun 'status.log')
 if($LASTEXITCODE -ne 0){throw 'LOCAL_START_FAILED'}
 # The only auth/Storage stand-ins live inside this new disposable local cluster.
 $pmBootstrap="create role anon nologin; create role authenticated nologin; create schema auth; create table auth.users(id uuid primary key); create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint);"
 $pmBootstrap | & (Join-Path $PostgresBin 'psql.exe') -X -q -h 127.0.0.1 -p $pmPort -U postgres -d postgres -v ON_ERROR_STOP=1 > (Join-Path $pmRun 'bootstrap.log')
 if($LASTEXITCODE -ne 0){throw 'LOCAL_BOOTSTRAP_FAILED'}
 foreach($pmSql in (Get-ChildItem -LiteralPath 'supabase/migrations' -Filter '*.sql' | Sort-Object Name)){
  & (Join-Path $PostgresBin 'psql.exe') -X -q -h 127.0.0.1 -p $pmPort -U postgres -d postgres -v ON_ERROR_STOP=1 -f $pmSql.FullName >> (Join-Path $pmRun 'migrations.log')
  if($LASTEXITCODE -ne 0){throw ('LOCAL_MIGRATION_FAILED: '+$pmSql.Name)}
 }
 $env:DATABASE_URL="postgresql://partmeasure_runtime@127.0.0.1:$pmPort/postgres"
 $env:DATABASE_CA_FILE=Join-Path $pmRun 'server.crt'
 $env:DATABASE_CA_PEM=$null
 $env:PM_ALIGNMENT_LOCAL='disposable-native-pg'
 $env:PM_EVENTS_LOCAL='disposable-native-pg'
 $env:EVENT_DATABASE_URL=$env:DATABASE_URL
 $env:WORKER_DATABASE_URL="postgresql://partmeasure_worker@127.0.0.1:$pmPort/postgres"
 $env:APP_URL='http://127.0.0.1:3105'
 & node --conditions=react-server --import tsx scripts/lightweight/native.ts
 if($LASTEXITCODE -ne 0){throw 'LOCAL_SERVICE_CHECK_FAILED'}
}finally{
 foreach($pmEnvName in $pmPrevious.Keys){[Environment]::SetEnvironmentVariable($pmEnvName,$pmPrevious[$pmEnvName],'Process')}
 if($pmStarted){& (Join-Path $PostgresBin 'pg_ctl.exe') -D $pmData -m fast -w stop > (Join-Path $pmRun 'stop.log')}
}
