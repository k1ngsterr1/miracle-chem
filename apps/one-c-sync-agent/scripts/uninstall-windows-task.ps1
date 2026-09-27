[CmdletBinding()]
param([string]$TaskName = "MiracleChemOneCSyncAgent")

$ErrorActionPreference = "Stop"
if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
  Write-Host "Задача $TaskName удалена." -ForegroundColor Green
} else {
  Write-Host "Задача $TaskName не найдена."
}
