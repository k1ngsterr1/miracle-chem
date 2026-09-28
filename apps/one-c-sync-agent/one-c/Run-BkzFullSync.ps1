[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$SourceConfig,
  [Parameter(Mandatory = $true)][string]$Mapping,
  [string]$AgentConfig = (Join-Path $env:ProgramData 'MiracleChem\OneCSyncAgent\config.json'),
  [string]$PackageRoot = (Split-Path -Parent $PSScriptRoot),
  [string]$SnapshotDirectory = (Join-Path $env:ProgramData 'MiracleChem\OneCSyncSetup')
)

$ErrorActionPreference = 'Stop'
$mutex = New-Object System.Threading.Mutex($false, 'Global\MiracleChemBkzOneCExport')
$hasMutex = $false
$snapshotPath = $null
try {
  try { $hasMutex = $mutex.WaitOne(0) }
  catch [Threading.AbandonedMutexException] { $hasMutex = $true }
  if (-not $hasMutex) { Write-Output 'SKIPPED_ALREADY_RUNNING'; exit 0 }
  $stamp = [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssfffZ')
  $snapshotPath = Join-Path $SnapshotDirectory "snapshot-$stamp-$([guid]::NewGuid().ToString('N')).json"
  & (Join-Path $PackageRoot 'one-c\Export-BkzSnapshot.ps1') -ConfigPath $SourceConfig -OutputPath $snapshotPath
  if ($LASTEXITCODE -and $LASTEXITCODE -ne 0) { throw 'Выгрузка 1С завершилась с ошибкой' }
  & node.exe (Join-Path $PackageRoot 'app\src\cli.js') bkz-full-sync --snapshot $snapshotPath --mapping $Mapping --config $AgentConfig
  if ($LASTEXITCODE -ne 0) { throw 'Полный снимок не принят агентом или CRM' }
  # The durable agent queue contains the exact payload before this file is removed.
  Remove-Item -LiteralPath $snapshotPath -Force
  $snapshotPath = $null
} catch {
  $message = $_.Exception.Message -replace '(?i)(Pwd|password|apiKey)=[^;\s]*', '$1=[REDACTED]'
  $logPath = Join-Path $SnapshotDirectory 'full-sync-task.log'
  Add-Content -LiteralPath $logPath -Value "$([DateTime]::UtcNow.ToString('o')) $message" -Encoding UTF8
  throw
} finally {
  if ($snapshotPath -and (Test-Path -LiteralPath $snapshotPath)) {
    Write-Warning "Снимок оставлен для разбора ошибки: $snapshotPath"
  }
  if ($hasMutex) { $mutex.ReleaseMutex() }
  $mutex.Dispose()
}
