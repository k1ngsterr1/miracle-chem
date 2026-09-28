[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$InfobasePath,
  [Parameter(Mandatory = $true)][string]$OutputDirectory,
  [switch]$MaintenanceWindowApproved
)

# A physical file-mode backup must be taken while users are out of the infobase.
# The exclusive source handle prevents a new session from opening the database
# during the copy. Never run this against a live, in-use 1C database.
$ErrorActionPreference = 'Stop'
if (-not $MaintenanceWindowApproved) {
  throw 'A maintenance window with no 1C users must be approved explicitly.'
}
if (-not [Environment]::Is64BitProcess) { throw 'Use 64-bit Windows PowerShell.' }

function Get-NormalizedDirectory([string]$Path) {
  $full = [IO.Path]::GetFullPath($Path)
  if ($full.Equals([IO.Path]::GetPathRoot($full), [StringComparison]::OrdinalIgnoreCase)) { return $full }
  $full.TrimEnd('\')
}

function Assert-PrivateDirectory([string]$Path, [Security.Principal.SecurityIdentifier[]]$AllowedSids) {
  $info = [IO.DirectoryInfo]::new($Path)
  if (-not $info.Exists -or ($info.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
    throw "Backup parent is missing or is a reparse point: $Path"
  }
  $acl = $info.GetAccessControl()
  if (-not $acl.AreAccessRulesProtected) { throw "Backup parent must have protected ACL: $Path" }
  foreach ($rule in $acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier])) {
    if ($rule.AccessControlType -eq [Security.AccessControl.AccessControlType]::Allow -and
        $rule.IdentityReference.Value -notin @($AllowedSids | ForEach-Object { $_.Value })) {
      throw "Backup parent grants access outside the approved administrators: $Path"
    }
  }
}

$sourceDirectory = Get-NormalizedDirectory $InfobasePath
$sourcePath = Join-Path $sourceDirectory '1Cv8.1CD'
$destination = Get-NormalizedDirectory $OutputDirectory
if (-not [IO.File]::Exists($sourcePath)) { throw "1C database file not found: $sourcePath" }
if ([IO.Directory]::Exists($destination) -or [IO.File]::Exists($destination)) {
  throw 'Output directory exists; choose a new, empty destination.'
}
if ($destination.StartsWith($sourceDirectory + '\', [StringComparison]::OrdinalIgnoreCase) -or
    $destination.Equals($sourceDirectory, [StringComparison]::OrdinalIgnoreCase)) {
  throw 'Backup destination must be outside the live infobase directory.'
}
$driveRoot = [IO.Path]::GetPathRoot($destination)
if ($driveRoot -notmatch '^[A-Za-z]:\\$') { throw 'Use a local Windows drive for the physical backup.' }
$drive = [IO.DriveInfo]::new($driveRoot)
if ($drive.DriveType -ne [IO.DriveType]::Fixed) { throw 'Backup destination must be on a fixed local disk.' }
$backupParent = [IO.Path]::GetDirectoryName($destination)
if ($backupParent.Equals($driveRoot, [StringComparison]::OrdinalIgnoreCase)) {
  throw 'Prepare a private backup directory below the drive root first.'
}
$currentSid = [Security.Principal.WindowsIdentity]::GetCurrent().User
$allowedSids = @($currentSid, [Security.Principal.SecurityIdentifier]::new('S-1-5-18'), [Security.Principal.SecurityIdentifier]::new('S-1-5-32-544'))
$ancestor = $backupParent
while (-not $ancestor.Equals($driveRoot, [StringComparison]::OrdinalIgnoreCase)) {
  if (([IO.DirectoryInfo]::new($ancestor)).Attributes -band [IO.FileAttributes]::ReparsePoint) {
    throw "Backup destination contains a reparse point: $ancestor"
  }
  $ancestor = [IO.Path]::GetDirectoryName($ancestor)
}
Assert-PrivateDirectory $backupParent $allowedSids
$sourceLength = [IO.FileInfo]::new($sourcePath).Length
if ($drive.AvailableFreeSpace -lt $sourceLength + [Math]::Max([long]1073741824, [long]($sourceLength * 0.1))) {
  throw 'Not enough free disk space for the database copy and safety margin.'
}

$security = [Security.AccessControl.DirectorySecurity]::new()
$security.SetAccessRuleProtection($true, $false)
foreach ($sid in $allowedSids) {
  $security.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($sid, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow'))
}
[void][IO.Directory]::CreateDirectory($destination, $security)
Assert-PrivateDirectory $destination $allowedSids
$partialPath = Join-Path $destination '1Cv8.1CD.partial'
$backupPath = Join-Path $destination '1Cv8.1CD'
$startedAt = [datetime]::UtcNow
$sourceStream = $null
$targetStream = $null
$verifyStream = $null
$sha = $null
try {
  # FileShare.None fails if another process still has the database open and
  # remains held until both the copy and both checksum passes have finished.
  $sourceStream = [IO.FileStream]::new($sourcePath, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::None, 1048576, [IO.FileOptions]::SequentialScan)
  if ($sourceStream.Length -ne $sourceLength) { throw 'Database size changed before the exclusive lock was acquired.' }
  $sha = [Security.Cryptography.SHA256]::Create()
  $sourceHash = [BitConverter]::ToString($sha.ComputeHash($sourceStream)).Replace('-', '').ToLowerInvariant()
  $sourceStream.Position = 0
  $targetStream = [IO.FileStream]::new($partialPath, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None, 1048576, [IO.FileOptions]::SequentialScan)
  $sourceStream.CopyTo($targetStream, 1048576)
  $targetStream.Flush($true)
  $targetStream.Dispose()
  $targetStream = $null
  if ([IO.FileInfo]::new($partialPath).Length -ne $sourceLength) { throw 'Copied database size does not match the source.' }
  $verifyStream = [IO.File]::OpenRead($partialPath)
  $targetHash = [BitConverter]::ToString($sha.ComputeHash($verifyStream)).Replace('-', '').ToLowerInvariant()
  $verifyStream.Dispose()
  $verifyStream = $null
  if ($targetHash -ne $sourceHash) { throw 'Copied database SHA-256 does not match the source.' }
  [IO.File]::Move($partialPath, $backupPath)
  $manifest = [ordered]@{
    format = '1C_FILE_DATABASE_BACKUP_V1'
    source = $sourcePath
    backup = $backupPath
    startedAtUtc = $startedAt.ToString('o')
    completedAtUtc = [datetime]::UtcNow.ToString('o')
    sourceExclusivelyLocked = $true
    bytes = $sourceLength
    sha256 = $sourceHash
    restoreVerified = $false
  }
  [IO.File]::WriteAllText((Join-Path $destination 'manifest.json'), ($manifest | ConvertTo-Json -Depth 4), [Text.UTF8Encoding]::new($false))
  $completePath = Join-Path $destination 'COMPLETE'
  [IO.File]::WriteAllText(($completePath + '.tmp'), ($sourceHash + "`n"), [Text.Encoding]::ASCII)
  [IO.File]::Move(($completePath + '.tmp'), $completePath)
  Write-Output ($manifest | ConvertTo-Json -Compress)
} finally {
  if ($null -ne $targetStream) { $targetStream.Dispose() }
  if ($null -ne $verifyStream) { $verifyStream.Dispose() }
  if ($null -ne $sourceStream) { $sourceStream.Dispose() }
  if ($null -ne $sha) { $sha.Dispose() }
}
