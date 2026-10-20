$ErrorActionPreference='Stop'
Set-Location -LiteralPath (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '../..')).Path
$pmChecks=@()
foreach($pmScript in @('lint','typecheck','test','build')) {
 $pmWatch=[Diagnostics.Stopwatch]::StartNew()
 & npm run $pmScript
 $pmCode=$LASTEXITCODE
 $pmWatch.Stop()
 $pmChecks+=@{command="npm run $pmScript";status=$(if($pmCode -eq 0){'PASS'}else{'FAIL'});exitCode=$pmCode;milliseconds=$pmWatch.ElapsedMilliseconds}
}
New-Item -ItemType Directory -Force docs/evidence/annotation-collaboration | Out-Null
@{checkedAt=[DateTime]::UtcNow.ToString('o');scope='Local lint/strict types/unit tests/production build; no browser or phone';results=$pmChecks} | ConvertTo-Json -Depth 6 | Set-Content docs/evidence/annotation-collaboration/checks.json
if($pmChecks.Where({$_.status -ne 'PASS'}).Count -gt 0){exit 1}
