[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$SourceConfig,
  [Parameter(Mandatory = $true)][string]$Mapping,
  [Parameter(Mandatory = $true)][string]$PackageRoot,
  [string]$AgentConfig = (Join-Path $env:ProgramData 'MiracleChem\OneCSyncAgent\config.json'),
  [string]$ArchiveRoot = (Join-Path $env:ProgramData 'MiracleChem\OneCArchives'),
  [string]$ReferenceTaskName = 'MiracleChemOneCFullSync',
  [string]$TaskName = 'MiracleChemOneCFullArchive',
  [string]$DailyAt = '02:30'
)

$ErrorActionPreference = 'Stop'
if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw 'Run the installer from an elevated Windows PowerShell session.'
}
$reference = Get-ScheduledTask -TaskName $ReferenceTaskName -ErrorAction Stop
if ($reference.Principal.UserId -match '(?i)^(SYSTEM|NT AUTHORITY\\SYSTEM|S-1-5-18)$') {
  throw 'The reference task runs as SYSTEM; the 1C COM connector needs its configured Windows user.'
}
if ($reference.Principal.LogonType -ne 'S4U') {
  throw 'The reference 1C task does not use the expected S4U logon type.'
}
$script = Join-Path $PackageRoot 'one-c\Run-BkzArchiveSync.ps1'
foreach ($file in @($script, $SourceConfig, $Mapping, $AgentConfig)) {
  if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { throw "Required file is missing: $file" }
  if ($file.Contains('"')) { throw 'Double quotes are not supported in task paths.' }
}
foreach ($path in @($PackageRoot, $ArchiveRoot)) {
  if ($path.Contains('"')) { throw 'Double quotes are not supported in task paths.' }
}
[void][TimeSpan]::ParseExact($DailyAt, 'hh\:mm', [Globalization.CultureInfo]::InvariantCulture)
$arguments = '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + $script +
  '" -SourceConfig "' + $SourceConfig + '" -Mapping "' + $Mapping +
  '" -AgentConfig "' + $AgentConfig + '" -PackageRoot "' + $PackageRoot +
  '" -ArchiveRoot "' + $ArchiveRoot + '"'
$action = New-ScheduledTaskAction -Execute (Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe') -Argument $arguments
$trigger = New-ScheduledTaskTrigger -Daily -At $DailyAt
$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Hours 8) -RestartCount 6 -RestartInterval (New-TimeSpan -Minutes 45)
$principal = New-ScheduledTaskPrincipal -UserId $reference.Principal.UserId -LogonType S4U -RunLevel Highest
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null
$task = Get-ScheduledTask -TaskName $TaskName
$info = Get-ScheduledTaskInfo -TaskName $TaskName
[ordered]@{ status = 'REGISTERED'; task = $TaskName; user = $task.Principal.UserId;
  logonType = $task.Principal.LogonType.ToString(); nextRun = $info.NextRunTime.ToString('o') } | ConvertTo-Json -Compress
