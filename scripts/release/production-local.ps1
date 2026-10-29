$ErrorActionPreference = 'Stop'
$taskRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '../..')).Path
Set-Location -LiteralPath $taskRoot
$taskBin = 'C:\Program Files\PostgreSQL\18\bin'
& (Join-Path $taskBin 'pg_isready.exe') -h 127.0.0.1 -p 55449 -t 1 | Out-Null
if ($LASTEXITCODE -eq 0) { throw 'LOCAL_REPLAY_PORT_ALREADY_IN_USE' }
$taskRun = Join-Path $taskRoot ('tmp\production-replay-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $taskRun | Out-Null
$taskData = Join-Path $taskRun 'data'
& (Join-Path $taskBin 'initdb.exe') -D $taskData -U postgres --auth=trust --encoding=UTF8 --no-locale | Out-File (Join-Path $taskRun 'init.log')
if ($LASTEXITCODE -ne 0) { throw 'LOCAL_REPLAY_INIT_FAILED' }
$taskStarted = $false
try {
  $taskStart = Start-Process -FilePath (Join-Path $taskBin 'pg_ctl.exe') -WindowStyle Hidden -PassThru -ArgumentList @('-D', $taskData, '-l', (Join-Path $taskRun 'server.log'), '-o', '"-h 127.0.0.1 -p 55449"', '-w', 'start') -RedirectStandardOutput (Join-Path $taskRun 'start.log') -RedirectStandardError (Join-Path $taskRun 'start-error.log')
  $taskStarted = $true
  if (-not $taskStart.WaitForExit(30000)) { throw 'LOCAL_REPLAY_START_TIMEOUT' }
  & (Join-Path $taskBin 'pg_ctl.exe') -D $taskData status | Out-File (Join-Path $taskRun 'status.log')
  if ($LASTEXITCODE -ne 0) { throw 'LOCAL_REPLAY_START_FAILED' }
  $env:PM_PRODUCTION_REPLAY = 'disposable-local-cluster'
  & node --import tsx scripts/release/production-replay.ts --local-only
  if ($LASTEXITCODE -ne 0) { throw 'LOCAL_REPLAY_FAILED' }
} finally {
  Remove-Item Env:PM_PRODUCTION_REPLAY -ErrorAction SilentlyContinue
  if ($taskStarted) {
    & (Join-Path $taskBin 'pg_ctl.exe') -D $taskData -m fast -w stop | Out-File (Join-Path $taskRun 'stop.log')
    if ($LASTEXITCODE -ne 0) { Write-Warning 'LOCAL_REPLAY_CLUSTER_STOP_NOT_CONFIRMED' }
  }
}
