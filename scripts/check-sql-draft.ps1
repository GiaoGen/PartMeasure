param([string]$PostgresBin = 'C:\Program Files\PostgreSQL\18\bin')
$ErrorActionPreference = 'Stop'
$taskRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
Set-Location -LiteralPath $taskRoot
$taskRun = Join-Path $taskRoot ('tmp\sql-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $taskRun | Out-Null
$taskData = Join-Path $taskRun 'data'
$taskPort = 55439
# Only creates a new disposable cluster under workspace/tmp; never touches installed clusters.
& (Join-Path $PostgresBin 'initdb.exe') -D $taskData -U postgres --auth=trust --encoding=UTF8 --no-locale | Out-File (Join-Path $taskRun 'init.log')
if ($LASTEXITCODE -ne 0) { throw 'initdb failed' }
$taskStarted = $false
try {
  $taskStart = Start-Process -FilePath (Join-Path $PostgresBin 'pg_ctl.exe') -WindowStyle Hidden -PassThru -ArgumentList @('-D', $taskData, '-l', (Join-Path $taskRun 'server.log'), '-o', "`"-h 127.0.0.1 -p $taskPort`"", '-w', 'start') -RedirectStandardOutput (Join-Path $taskRun 'start.log') -RedirectStandardError (Join-Path $taskRun 'start-error.log')
  # Start-Process -Wait waits for descendants too (the server); wait on pg_ctl only.
  $taskStarted = $true
  if (-not $taskStart.WaitForExit(30000)) { throw 'pg_ctl startup timeout' }
  & (Join-Path $PostgresBin 'pg_ctl.exe') -D $taskData status | Out-File (Join-Path $taskRun 'status.log')
  if ($LASTEXITCODE -ne 0) { throw "pg_ctl failed: $taskRun" }
  & (Join-Path $PostgresBin 'psql.exe') -X -q -h 127.0.0.1 -p $taskPort -U postgres -d postgres -v ON_ERROR_STOP=1 -f tests/sql/draft-smoke.sql 2>&1 | Tee-Object -FilePath (Join-Path $taskRun 'checks.log')
  if ($LASTEXITCODE -ne 0) { throw 'SQL draft checks failed' }
  Write-Output "PASS: local PostgreSQL structural draft checks. NOT Supabase integration. Logs: $taskRun"
} finally {
  if ($taskStarted) {
    & (Join-Path $PostgresBin 'pg_ctl.exe') -D $taskData -m fast -w stop | Out-File (Join-Path $taskRun 'stop.log')
  }
}
