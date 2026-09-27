[CmdletBinding()]
param([string]$ExporterPath = (Join-Path $PSScriptRoot 'Export-BkzSnapshot.ps1'))

# Dependency-free unit tests. Load ONLY the query function, never the COM entry point.
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$tokens = $null
$errors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile($ExporterPath, [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw ($errors | Out-String) }
$definition = $ast.Find({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Read-OneCQuery'}, $false)
if (-not $definition) { throw 'Query function not found.' }
. ([scriptblock]::Create($definition.Extent.Text))
$script:connection = [pscustomobject]@{kind = 'connection'}
$script:rowCount = 0
$script:index = 0
$script:tests = 0

function Invoke-OneCMethod($Object, [string]$Name, [object[]]$Arguments = @()) {
  switch ($Name) {
    'NewObject' { [pscustomobject]@{kind = 'query'} }
    'Execute' { [pscustomobject]@{kind = 'result'} }
    'Select' { $script:index = 0; [pscustomobject]@{kind = 'selection'} }
    'Next' { $script:index++; $script:index -le $script:rowCount }
    'XMLString' { '11111111-1111-4111-8111-111111111111' }
    default { throw "Unexpected method: $Name" }
  }
}

function Get-OneCProperty($Object, [string]$Name) {
  switch ($Name) {
    'amount' { [decimal]1234.500 }
    'receivedAt' { [datetime]::new(2026, 9, 26, 8, 30, 0) }
    'name' { 'Глюконат натрия' }
    'externalId' { [pscustomobject]@{kind = 'reference'} }
    default { throw "Unexpected property: $Name" }
  }
}

function Assert([bool]$Condition, [string]$Message) {
  if (-not $Condition) { throw "FAILED: $Message" }
  $script:tests++
}

$previousCulture = [Threading.Thread]::CurrentThread.CurrentCulture
try {
  [Threading.Thread]::CurrentThread.CurrentCulture = [Globalization.CultureInfo]::GetCultureInfo('ru-RU')
  $script:rowCount = 0
  $rows = @(Read-OneCQuery 'test' @('name'))
  Assert ($rows.Count -eq 0) 'Empty collection must stay empty.'
  $script:rowCount = 1
  $rows = @(Read-OneCQuery 'test' @('externalId', 'amount', 'receivedAt', 'name') @('externalId') @('amount') @('receivedAt'))
  Assert ($rows.Count -eq 1) 'Single row must stay an array at the call boundary.'
  Assert ($rows[0].amount -is [string] -and $rows[0].amount -match '^1234\.5(0+)?$') 'Decimal must use invariant dot formatting.'
  Assert ($rows[0].receivedAt -eq '2026-09-26T08:30:00') '1C wall time must not receive an invented timezone.'
  Assert ($rows[0].externalId -eq '11111111-1111-4111-8111-111111111111') 'Reference must be serialized as a stable GUID.'
  Assert ($rows[0].name -eq 'Глюконат натрия') 'Cyrillic data must be preserved.'
  $script:rowCount = 2000
  $rows = @(Read-OneCQuery 'test' @('name'))
  Assert ($rows.Count -eq 2000) 'Exactly 2000 rows must succeed.'
  $script:rowCount = 2001
  $rejected = $false
  try { $null = @(Read-OneCQuery 'test' @('name')) } catch { $rejected = $_.Exception.Message -like '*exceeds 2000*' }
  Assert $rejected '2001 rows must fail instead of silently truncating.'
  [ordered]@{status = 'PASSED'; assertions = $script:tests; powershell = $PSVersionTable.PSVersion.ToString()} | ConvertTo-Json -Compress
} finally {
  [Threading.Thread]::CurrentThread.CurrentCulture = $previousCulture
}
