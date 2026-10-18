param([switch]$Web)
$ErrorActionPreference='Stop'
$pmRoot=(Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
if($pmRoot -ne 'D:\PartMeasure'){throw 'UNEXPECTED_WORKSPACE'}
Set-Location -LiteralPath $pmRoot
$pmStarted=@()
if(-not (Get-NetTCPConnection -State Listen -LocalPort 3310 -ErrorAction SilentlyContinue)){
 $pmScan=Start-Process -FilePath (Join-Path $pmRoot 'tmp\p0-1\clamav\clamav-1.5.4.win.x64\clamd.exe') -ArgumentList '--config-file=D:/PartMeasure/tmp/p0-1/clamd.conf' -WorkingDirectory $pmRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $pmRoot 'tmp\p0-4\clamd.stdout.log') -RedirectStandardError (Join-Path $pmRoot 'tmp\p0-4\clamd.stderr.log')
 $pmStarted+=@{kind='scanner';pid=$pmScan.Id}
}
$pmWorker=Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -like '*scripts/p0-1/worker.ts*' }
if(-not $pmWorker){
 $pmWorkerProcess=Start-Process -FilePath 'powershell.exe' -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File','scripts/p0-1/run.ps1','-Action','worker' -WorkingDirectory $pmRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $pmRoot 'tmp\p0-4\worker.stdout.log') -RedirectStandardError (Join-Path $pmRoot 'tmp\p0-4\worker.stderr.log')
 $pmStarted+=@{kind='worker';pid=$pmWorkerProcess.Id}
}
if($Web -and -not (Get-NetTCPConnection -State Listen -LocalPort 3001 -ErrorAction SilentlyContinue)){
 $pmWebProcess=Start-Process -FilePath 'powershell.exe' -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File','scripts/p0-4/run.ps1','-Action','start' -WorkingDirectory $pmRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $pmRoot 'tmp\p0-4\web.stdout.log') -RedirectStandardError (Join-Path $pmRoot 'tmp\p0-4\web.stderr.log')
 $pmStarted+=@{kind='web';pid=$pmWebProcess.Id}
}
$pmStarted | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $pmRoot 'tmp\p0-4\local-processes.json')
Write-Output ('Started local processes: '+$pmStarted.Count)
