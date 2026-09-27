[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$SourceConfig,
  [Parameter(Mandatory = $true)][string]$Mapping,
  [Parameter(Mandatory = $true)][string]$AgentConfig,
  [Parameter(Mandatory = $true)][string]$StateDirectory,
  [string]$PackageRoot = (Split-Path -Parent $PSScriptRoot)
)

# One bounded collection/send cycle. Schedule at most once per 15 minutes.
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$node = (Get-Command node.exe -ErrorAction Stop).Source
$cli = Join-Path $PackageRoot 'app\src\cli.js'
$stateRoot = [IO.Path]::GetFullPath($StateDirectory).TrimEnd('\')
if (-not (Test-Path -LiteralPath $cli)) { throw 'Packaged agent CLI not found.' }
if (-not (Test-Path -LiteralPath (Join-Path $stateRoot 'checkpoint.json'))) { throw 'Create and reconcile an explicit baseline first. No source data was read.' }
foreach ($file in @($SourceConfig, $Mapping, $AgentConfig)) {
  if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { throw 'A required configuration file is missing.' }
}

$sha = [Security.Cryptography.SHA256]::Create()
try { $name = [BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($stateRoot.ToUpperInvariant()))).Replace('-', '') }
finally { $sha.Dispose() }
$mutex = [Threading.Mutex]::new($false, ('Global\MiracleChemBkz-' + $name))
$owned = $false
$snapshotPath = $null
$snapshotCreated = $false
try {
  try { $owned = $mutex.WaitOne(0) } catch [Threading.AbandonedMutexException] { $owned = $true }
  if (-not $owned) { throw 'Another collector cycle is already running.' }
  # Only the named-mutex owner may recover a dead CLI process's lock.
  # Direct CLI calls deliberately never auto-delete another process's lock.
  $lockPath = Join-Path $stateRoot 'collector.lock'
  if (Test-Path -LiteralPath $lockPath) {
    $lock = Get-Content -LiteralPath $lockPath -Raw -Encoding UTF8 | ConvertFrom-Json
    if (-not $lock.pid -or [int]$lock.pid -lt 1) { throw 'Invalid collector lock; inspect it manually without deleting checkpoint.json.' }
    if (Get-Process -Id ([int]$lock.pid) -ErrorAction SilentlyContinue) { throw 'Collector CLI is still running.' }
    Remove-Item -LiteralPath $lockPath
  }
  $snapshotPath = Join-Path $stateRoot ('snapshot-' + [guid]::NewGuid().ToString('N') + '.json')
  & (Join-Path $PSScriptRoot 'Export-BkzSnapshot.ps1') -ConfigPath $SourceConfig -OutputPath $snapshotPath
  $snapshotCreated = $true
  & $node $cli bkz-sync --snapshot $snapshotPath --mapping $Mapping --state-directory $stateRoot --config $AgentConfig
  if ($LASTEXITCODE -ne 0) { throw 'Collector stopped. Inspect report.json and the preserved checkpoint; do not reinitialize the baseline.' }
} finally {
  if ($snapshotCreated -and $snapshotPath -and (Test-Path -LiteralPath $snapshotPath)) { Remove-Item -LiteralPath $snapshotPath }
  if ($owned) { $mutex.ReleaseMutex() }
  $mutex.Dispose()
}
