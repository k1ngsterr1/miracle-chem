[CmdletBinding()]
param(
  [string]$PackageRoot = "",
  [string]$ConfigPath = (Join-Path $env:ProgramData "MiracleChem\OneCSyncAgent\config.json"),
  [string]$TaskName = "MiracleChemOneCSyncAgent"
)

$ErrorActionPreference = "Stop"
if (-not ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw "Запустите PowerShell от имени администратора."
}

if ([string]::IsNullOrWhiteSpace($PackageRoot)) {
  # The release package puts this script at its root; the source tree keeps it
  # in scripts/. Accept both layouts without asking operators to override it.
  $PackageRoot = $PSScriptRoot
  if (-not (Test-Path (Join-Path $PackageRoot "app\src\cli.js"))) {
    $PackageRoot = Split-Path -Parent $PSScriptRoot
  }
}

$node = (Get-Command node.exe -ErrorAction Stop).Source
$cli = Join-Path $PackageRoot "app\src\cli.js"
if (-not (Test-Path $cli)) { throw "Не найден файл агента: $cli" }

$agentDirectory = Split-Path -Parent $ConfigPath
New-Item -ItemType Directory -Path $agentDirectory -Force | Out-Null
# Config and the durable queue contain API credentials and 1C financial data.
# Windows ignores Node's POSIX mode bits, so explicitly remove inherited
# access before creating config.json and the queue.
& icacls.exe $agentDirectory /inheritance:r /grant:r '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' | Out-Null
if ($LASTEXITCODE -ne 0) { throw "Не удалось ограничить доступ к $agentDirectory" }

if (-not (Test-Path $ConfigPath)) {
  & $node $cli init --config $ConfigPath
  Write-Host "Заполните crmSyncUrl и apiKey в $ConfigPath, затем повторно выполните этот скрипт." -ForegroundColor Yellow
  exit 0
}

& $node $cli validate-config --config $ConfigPath
if ($LASTEXITCODE -ne 0) {
  throw "config.json не прошёл проверку. Проверьте crmSyncUrl, apiKey и localIngestKey."
}

$arguments = ('"{0}" serve --config "{1}"' -f $cli, $ConfigPath)
$action = New-ScheduledTaskAction -Execute $node -Argument $arguments
$trigger = New-ScheduledTaskTrigger -AtStartup
$principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description "Локальный агент обмена офлайн 1С с Miracle Chem" -Force | Out-Null
Start-ScheduledTask -TaskName $TaskName
Write-Host "Агент установлен как задача $TaskName и запущен." -ForegroundColor Green
