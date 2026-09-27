[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$PlatformExe,
  [string]$BuildRoot = (Join-Path $env:ProgramData 'MiracleChem\OneCSyncSetup'),
  [string]$OutputPath = ''
)

$ErrorActionPreference = 'Stop'
if (-not (Test-Path -LiteralPath $PlatformExe -PathType Leaf)) { throw "1C platform not found: $PlatformExe" }
if ([string]::IsNullOrWhiteSpace($OutputPath)) { $OutputPath = Join-Path $BuildRoot 'MiracleChemFullSnapshot.epf' }

# The Designer needs an infobase context to compile .epf. Use a new empty
# infobase: never open or update the production accounting configuration here.
$sourceRoot = Join-Path $PSScriptRoot 'epf-src'
$module = Join-Path $PSScriptRoot 'MiracleChemFullSnapshot.bsl'
if (-not (Test-Path (Join-Path $sourceRoot 'MiracleChemFullSnapshot.xml'))) { throw 'EPF XML source is missing' }
if (-not (Test-Path $module)) { throw 'EPF object module is missing' }
New-Item -ItemType Directory -Path $BuildRoot -Force | Out-Null
$stage = Join-Path $BuildRoot 'epf-build-source'
New-Item -ItemType Directory -Path $stage -Force | Out-Null
Copy-Item -Path (Join-Path $sourceRoot '*') -Destination $stage -Recurse -Force
$objectModule = Join-Path $stage 'MiracleChemFullSnapshot\Ext\ObjectModule.bsl'
New-Item -ItemType Directory -Path (Split-Path -Parent $objectModule) -Force | Out-Null
Copy-Item -LiteralPath $module -Destination $objectModule -Force

$base = Join-Path $BuildRoot 'BuildBase'
if (-not (Test-Path (Join-Path $base '1Cv8.1CD'))) {
  $createLog = Join-Path $BuildRoot 'create-base.log'
  $createArgs = 'CREATEINFOBASE File="' + $base + '" /DisableStartupDialogs /Out "' + $createLog + '"'
  $create = Start-Process -FilePath $PlatformExe -ArgumentList $createArgs -Wait -PassThru -NoNewWindow
  if ($create.ExitCode -ne 0 -or -not (Test-Path (Join-Path $base '1Cv8.1CD'))) { throw "Failed to create isolated build infobase; see $createLog" }
}

$built = Join-Path $BuildRoot 'MiracleChemFullSnapshot-built.epf'
$buildLog = Join-Path $BuildRoot 'build-epf.log'
$rootXml = Join-Path $stage 'MiracleChemFullSnapshot.xml'
$args = 'DESIGNER /F "' + $base + '" /DisableStartupDialogs /LoadExternalDataProcessorOrReportFromFiles "' + $rootXml + '" "' + $built + '" /Out "' + $buildLog + '"'
$build = Start-Process -FilePath $PlatformExe -ArgumentList $args -Wait -PassThru -NoNewWindow
if ($build.ExitCode -ne 0 -or -not (Test-Path $built)) { throw "Failed to compile external processing; see $buildLog" }
Copy-Item -LiteralPath $built -Destination $OutputPath -Force
Write-Output "External processing built: $OutputPath"
