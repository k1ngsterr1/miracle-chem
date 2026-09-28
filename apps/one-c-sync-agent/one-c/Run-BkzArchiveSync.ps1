[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$SourceConfig,
  [Parameter(Mandatory = $true)][string]$Mapping,
  [string]$AgentConfig = (Join-Path $env:ProgramData 'MiracleChem\OneCSyncAgent\config.json'),
  [string]$PackageRoot = (Split-Path -Parent $PSScriptRoot),
  [string]$ArchiveRoot = (Join-Path $env:ProgramData 'MiracleChem\OneCArchives')
)

# A daily, read-only logical export. The local outbox survives network failures
# and process termination; only COMPLETE responses move an archive to sent-*.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [Text.Encoding]::UTF8

function Assert-PrivateDirectory([string]$Path) {
  $item = Get-Item -LiteralPath $Path -Force
  if (-not $item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
    throw 'Archive root must be a real local directory.'
  }
  $acl = Get-Acl -LiteralPath $Path
  if (-not $acl.AreAccessRulesProtected) { throw 'Archive root must have inheritance disabled.' }
  $allowed = @(
    [Security.Principal.WindowsIdentity]::GetCurrent().User.Value,
    'S-1-5-18', # SYSTEM
    'S-1-5-32-544' # Administrators
  )
  foreach ($rule in $acl.Access) {
    $sid = $rule.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value
    if ($sid -notin $allowed -or $rule.AccessControlType -ne 'Allow') {
      throw 'Archive root has an unexpected access rule.'
    }
  }
}

function Invoke-ArchiveCli([string]$Command, [string]$Directory) {
  if ($Command -eq 'bkz-archive-preview') {
    $output = & $script:node $script:cli $Command --directory $Directory
  } else {
    $output = & $script:node $script:cli $Command --directory $Directory --mapping $Mapping --config $AgentConfig
  }
  if ($LASTEXITCODE -ne 0) { throw "Archive CLI failed: $Command" }
  $response = ($output -join "`n") | ConvertFrom-Json
  if ($Command -eq 'bkz-archive-preview' -and $response.status -ne 'READY_FOR_UPLOAD') {
    throw 'Local archive was not verified.'
  }
  if ($Command -eq 'bkz-archive-upload' -and $response.status -ne 'COMPLETE') {
    throw 'CRM did not confirm the complete archive.'
  }
  return $response
}

function Move-Archive([string]$Directory, [string]$Prefix) {
  $item = Get-Item -LiteralPath $Directory -Force
  if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Archive directory is a reparse point.' }
  $id = $item.Name.Substring($item.Name.IndexOf('-') + 1)
  $name = "$Prefix-$id"
  if (Test-Path -LiteralPath (Join-Path $script:root $name)) { throw 'Archive directory name collision.' }
  Rename-Item -LiteralPath $Directory -NewName $name
  return (Join-Path $script:root $name)
}

function Write-ArchiveLog([string]$Event, [string]$Id, [string]$Detail = '') {
  $line = "{0} {1} {2} {3}" -f [DateTime]::UtcNow.ToString('o'), $Event, $Id, $Detail
  Add-Content -LiteralPath (Join-Path $script:root 'archive-sync.log') -Value $line -Encoding UTF8
}

if (-not [Environment]::Is64BitProcess) { throw 'Use 64-bit Windows PowerShell.' }
foreach ($file in @($SourceConfig, $Mapping, $AgentConfig)) {
  if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { throw 'A required configuration file is missing.' }
}
$source = Get-Content -LiteralPath $SourceConfig -Raw -Encoding UTF8 | ConvertFrom-Json
if ([string]::IsNullOrWhiteSpace($source.infobasePath)) { throw '1C infobase path is missing.' }
$sourceRoot = [IO.Path]::GetFullPath($source.infobasePath).TrimEnd('\') + '\'
$script:root = [IO.Path]::GetFullPath($ArchiveRoot).TrimEnd('\')
if ($script:root.StartsWith($sourceRoot, [StringComparison]::OrdinalIgnoreCase)) {
  throw 'Archive root must be outside the live 1C infobase.'
}
$drive = [IO.DriveInfo]::new([IO.Path]::GetPathRoot($script:root))
if ($drive.DriveType -ne [IO.DriveType]::Fixed) { throw 'Archive root must be on a fixed local disk.' }
if (-not (Test-Path -LiteralPath $script:root)) {
  $security = [Security.AccessControl.DirectorySecurity]::new()
  $security.SetAccessRuleProtection($true, $false)
  foreach ($sid in @([Security.Principal.WindowsIdentity]::GetCurrent().User,
      [Security.Principal.SecurityIdentifier]::new('S-1-5-18'),
      [Security.Principal.SecurityIdentifier]::new('S-1-5-32-544'))) {
    $security.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new(
      $sid, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow'))
  }
  [void][IO.Directory]::CreateDirectory($script:root, $security)
}
Assert-PrivateDirectory $script:root
$script:node = (Get-Command node.exe -ErrorAction Stop).Source
$script:cli = Join-Path $PackageRoot 'app\src\cli.js'
$exporter = Join-Path $PackageRoot 'one-c\Export-BkzArchive.ps1'
foreach ($file in @($script:cli, $exporter)) {
  if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { throw 'Packaged archive agent is missing.' }
}

$cycleMutex = [Threading.Mutex]::new($false, 'Global\MiracleChemBkzArchiveSync')
$cycleOwned = $false
try {
  try { $cycleOwned = $cycleMutex.WaitOne(0) }
  catch [Threading.AbandonedMutexException] { $cycleOwned = $true }
  if (-not $cycleOwned) { Write-Output 'SKIPPED_ALREADY_RUNNING'; return }

  # A previous process may have died after export or after server finalize.
  foreach ($directory in @(Get-ChildItem -LiteralPath $script:root -Directory -Filter 'staging-*' | Sort-Object Name)) {
    if ($directory.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Archive staging directory is a reparse point.' }
    try {
      [void](Invoke-ArchiveCli 'bkz-archive-preview' $directory.FullName)
      $pending = Move-Archive $directory.FullName 'pending'
      Write-ArchiveLog 'RECOVERED' (Split-Path -Leaf $pending)
    } catch {
      $failed = Move-Archive $directory.FullName 'failed'
      Write-ArchiveLog 'INCOMPLETE_EXPORT' (Split-Path -Leaf $failed)
    }
  }
  $recoveredCount = 0
  foreach ($directory in @(Get-ChildItem -LiteralPath $script:root -Directory -Filter 'pending-*' | Sort-Object Name)) {
    if ($directory.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Pending archive directory is a reparse point.' }
    $result = Invoke-ArchiveCli 'bkz-archive-upload' $directory.FullName
    $sent = Move-Archive $directory.FullName 'sent'
    Write-ArchiveLog 'COMPLETE' (Split-Path -Leaf $sent) "archiveId=$($result.archiveId) collections=$($result.collections) rows=$($result.rows)"
    $recoveredCount++
  }
  # Task Scheduler retries after a failed upload. Do not perform another full
  # COM scan in that retry; the delivered pending archive is the successful run.
  if ($recoveredCount -gt 0) {
    [ordered]@{ status = 'COMPLETE'; recoveredArchives = $recoveredCount } | ConvertTo-Json -Compress
    return
  }

  $sourceFile = Join-Path $sourceRoot '1Cv8.1CD'
  if (-not (Test-Path -LiteralPath $sourceFile -PathType Leaf)) { throw '1C infobase file is missing.' }
  $minimumFree = [Math]::Max(2GB, 2 * (Get-Item -LiteralPath $sourceFile).Length)
  if ($drive.AvailableFreeSpace -lt $minimumFree) { throw 'Not enough free disk space for a full 1C archive.' }

  # The 15-minute working snapshot uses the same mutex for its COM read.
  $exportMutex = [Threading.Mutex]::new($false, 'Global\MiracleChemBkzOneCExport')
  $exportOwned = $false
  $stamp = [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssfffZ') + '-' + [guid]::NewGuid().ToString('N')
  $staging = Join-Path $script:root "staging-$stamp"
  try {
    try { $exportOwned = $exportMutex.WaitOne([TimeSpan]::FromMinutes(10)) }
    catch [Threading.AbandonedMutexException] { $exportOwned = $true }
    if (-not $exportOwned) { throw 'Timed out waiting for the 1C export lock.' }
    & $exporter -ConfigPath $SourceConfig -OutputDirectory $staging | Out-Null
    [void](Invoke-ArchiveCli 'bkz-archive-preview' $staging)
    $pending = Move-Archive $staging 'pending'
  } finally {
    if ($exportOwned) { $exportMutex.ReleaseMutex() }
    $exportMutex.Dispose()
  }
  $result = Invoke-ArchiveCli 'bkz-archive-upload' $pending
  $sent = Move-Archive $pending 'sent'
  Write-ArchiveLog 'COMPLETE' (Split-Path -Leaf $sent) "archiveId=$($result.archiveId) collections=$($result.collections) rows=$($result.rows)"
  [ordered]@{ status = 'COMPLETE'; archiveId = $result.archiveId; collections = $result.collections;
    rows = $result.rows; chunks = $result.chunks } | ConvertTo-Json -Compress
} catch {
  $message = $_.Exception.Message -replace '(?i)(Pwd|password|apiKey)=[^;\s]*', '$1=[REDACTED]'
  Write-ArchiveLog 'FAILED' '-' $message
  throw
} finally {
  if ($cycleOwned) { $cycleMutex.ReleaseMutex() }
  $cycleMutex.Dispose()
}
