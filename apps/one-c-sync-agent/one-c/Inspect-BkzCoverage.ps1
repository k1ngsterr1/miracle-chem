[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$ConfigPath,
  [switch]$IncludeRegisters,
  [switch]$IncludeOtherKinds,
  [switch]$IncludeTabularSections,
  [switch]$CountRows,
  [switch]$MetadataOnly
)

# Read-only inventory of populated 1C metadata objects. It does not export rows.
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
if ($MetadataOnly -and $CountRows) { throw 'MetadataOnly and CountRows cannot be combined.' }

function Get-OneCProperty($Object, [string]$Name) {
  ,$Object.GetType().InvokeMember($Name, [Reflection.BindingFlags]::GetProperty, $null, $Object, $null)
}

function Invoke-OneCMethod($Object, [string]$Name, [object[]]$Arguments = @()) {
  ,$Object.GetType().InvokeMember($Name, [Reflection.BindingFlags]::InvokeMethod, $null, $Object, $Arguments)
}

function Quote-ConnectionValue([string]$Value) {
  '"' + $Value.Replace('"', '""') + '"'
}

function Test-OneCObjectHasRows($Connection, [string]$QuerySource, [string]$SelectClause = '*') {
  $query = $null
  $result = $null
  $selection = $null
  try {
    $query = Invoke-OneCMethod $Connection 'NewObject' @('Query', "ВЫБРАТЬ ПЕРВЫЕ 1 $SelectClause ИЗ $QuerySource КАК Т")
    $result = Invoke-OneCMethod $query 'Execute'
    $selection = Invoke-OneCMethod $result 'Select'
    [bool](Invoke-OneCMethod $selection 'Next')
  } finally {
    foreach ($item in @($selection, $result, $query)) {
      if ($null -ne $item -and [Runtime.InteropServices.Marshal]::IsComObject($item)) {
        [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($item)
      }
    }
  }
}

function Get-OneCObjectRowCount($Connection, [string]$QuerySource) {
  $query = $null
  $result = $null
  $selection = $null
  try {
    $query = Invoke-OneCMethod $Connection 'NewObject' @('Query', "ВЫБРАТЬ КОЛИЧЕСТВО(*) КАК rowCount ИЗ $QuerySource")
    $result = Invoke-OneCMethod $query 'Execute'
    $selection = Invoke-OneCMethod $result 'Select'
    if (-not (Invoke-OneCMethod $selection 'Next')) { throw 'Aggregate query returned no row.' }
    [long](Get-OneCProperty $selection 'rowCount')
  } finally {
    foreach ($item in @($selection, $result, $query)) {
      if ($null -ne $item -and [Runtime.InteropServices.Marshal]::IsComObject($item)) {
        [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($item)
      }
    }
  }
}

if (-not [Environment]::Is64BitProcess) { throw 'Use 64-bit Windows PowerShell.' }
$config = Get-Content -LiteralPath $ConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json
if ([string]::IsNullOrWhiteSpace($config.infobasePath) -or -not (Test-Path -LiteralPath (Join-Path $config.infobasePath '1Cv8.1CD'))) {
  throw 'infobasePath must point to an existing file-based 1C infobase.'
}
if ([string]::IsNullOrWhiteSpace($config.oneCUser)) { throw 'oneCUser is required.' }
$password = ''
if ($config.passwordFile) {
  $credential = Import-Clixml -LiteralPath $config.passwordFile
  if ($credential -isnot [Management.Automation.PSCredential]) { throw 'passwordFile must contain an exported PSCredential.' }
  if ($credential.UserName -ne $config.oneCUser) { throw 'Credential user does not match oneCUser.' }
  $password = $credential.GetNetworkCredential().Password
} elseif ($config.allowEmptyPassword -ne $true) {
  throw 'Provide passwordFile or explicitly allow an empty 1C password.'
}

$connector = $null
$connection = $null
$metadata = $null
$items = [Collections.Generic.List[object]]::new()
try {
  $connector = New-Object -ComObject V83.COMConnector
  $connectionString = 'File=' + (Quote-ConnectionValue $config.infobasePath) + ';Usr=' + (Quote-ConnectionValue $config.oneCUser) + ';Pwd=' + (Quote-ConnectionValue $password) + ';'
  $connection = $connector.Connect($connectionString)
  $password = $null
  $connectionString = $null
  $metadata = Get-OneCProperty $connection 'Metadata'
  $configurationName = [string](Get-OneCProperty $metadata 'Name')
  if ($configurationName -ne 'БухгалтерияДляКазахстана') { throw 'Unsupported 1C configuration.' }

  $kinds = @(
    @{ collection = 'Catalogs'; queryPrefix = 'Справочник'; coverage = @('Организации', 'Контрагенты', 'Номенклатура', 'Склады', 'ДоговорыКонтрагентов', 'СпецификацииНоменклатуры') },
    @{ collection = 'Documents'; queryPrefix = 'Документ'; coverage = @('ПоступлениеТоваровУслуг', 'РеализацияТоваровУслуг', 'СчетНаОплатуПокупателю', 'ПлатежноеПоручениеВходящее', 'ПлатежноеПоручениеИсходящее', 'ОтчетПроизводстваЗаСмену') }
  )
  if ($IncludeRegisters) {
    $kinds += @(
      @{ collection = 'AccumulationRegisters'; queryPrefix = 'РегистрНакопления'; coverage = @('ТоварыОрганизацийБУ') },
      @{ collection = 'AccountingRegisters'; queryPrefix = 'РегистрБухгалтерии'; coverage = @('Типовой') },
      @{ collection = 'InformationRegisters'; queryPrefix = 'РегистрСведений'; coverage = @() }
    )
  }
  if ($IncludeOtherKinds) {
    $kinds += @(
      @{ collection = 'ExchangePlans'; queryPrefix = 'ПланОбмена'; coverage = @() },
      @{ collection = 'ChartsOfCharacteristicTypes'; queryPrefix = 'ПланВидовХарактеристик'; coverage = @() },
      @{ collection = 'ChartsOfAccounts'; queryPrefix = 'ПланСчетов'; coverage = @() },
      @{ collection = 'ChartsOfCalculationTypes'; queryPrefix = 'ПланВидовРасчета'; coverage = @() },
      @{ collection = 'CalculationRegisters'; queryPrefix = 'РегистрРасчета'; coverage = @() },
      @{ collection = 'BusinessProcesses'; queryPrefix = 'БизнесПроцесс'; coverage = @() },
      @{ collection = 'Tasks'; queryPrefix = 'Задача'; coverage = @() },
      @{ collection = 'Sequences'; queryPrefix = 'Последовательность'; coverage = @() },
      @{ collection = 'Constants'; queryPrefix = 'Константа'; coverage = @() }
    )
  }

  foreach ($kind in $kinds) {
    try { $collection = Get-OneCProperty $metadata $kind.collection }
    catch {
      $items.Add([pscustomobject][ordered]@{ kind = $kind.collection; name = '*'; parentName = $null;
        status = 'METADATA_UNAVAILABLE'; rowCount = $null; coveredByCurrentSnapshot = $false;
        errorType = $_.Exception.GetType().Name })
      continue
    }
    try {
      $count = [int](Invoke-OneCMethod $collection 'Count')
      for ($index = 0; $index -lt $count; $index++) {
        $item = Invoke-OneCMethod $collection 'Get' @($index)
        try {
          $name = [string](Get-OneCProperty $item 'Name')
          $status = 'UNKNOWN'
          $errorType = $null
          $rowCount = $null
          try {
            if ($MetadataOnly) { $status = 'METADATA_ONLY' }
            else {
              $hasRows = Test-OneCObjectHasRows $connection ($kind.queryPrefix + '.' + $name)
              $status = if ($hasRows) { 'POPULATED' } else { 'EMPTY' }
              if ($hasRows -and $CountRows) { $rowCount = Get-OneCObjectRowCount $connection ($kind.queryPrefix + '.' + $name) }
            }
          } catch {
            $status = 'QUERY_ERROR'
            $errorType = $_.Exception.GetType().Name
          }
          $items.Add([pscustomobject][ordered]@{
            kind = $kind.collection
            name = $name
            parentName = $null
            status = $status
            rowCount = $rowCount
            coveredByCurrentSnapshot = ($kind.coverage -contains $name)
            errorType = $errorType
          })
          if ($IncludeTabularSections -and $kind.collection -in @('Catalogs', 'Documents', 'ExchangePlans',
              'ChartsOfCharacteristicTypes', 'ChartsOfAccounts', 'ChartsOfCalculationTypes', 'BusinessProcesses', 'Tasks')) {
            $sections = Get-OneCProperty $item 'TabularSections'
            try {
              $sectionCount = [int](Invoke-OneCMethod $sections 'Count')
              for ($sectionIndex = 0; $sectionIndex -lt $sectionCount; $sectionIndex++) {
                $section = Invoke-OneCMethod $sections 'Get' @($sectionIndex)
                try {
                  $sectionName = [string](Get-OneCProperty $section 'Name')
                  $sectionSource = $kind.queryPrefix + '.' + $name + '.' + $sectionName
                  $sectionStatus = 'UNKNOWN'
                  $sectionRows = $null
                  $sectionError = $null
                  try {
                    if ($MetadataOnly) { $sectionStatus = 'METADATA_ONLY' }
                    else {
                      $hasSectionRows = Test-OneCObjectHasRows $connection $sectionSource 'Т.НомерСтроки КАК rowNumber'
                      $sectionStatus = if ($hasSectionRows) { 'POPULATED' } else { 'EMPTY' }
                      if ($hasSectionRows -and $CountRows) { $sectionRows = Get-OneCObjectRowCount $connection $sectionSource }
                    }
                  } catch {
                    $sectionStatus = 'QUERY_ERROR'
                    $sectionError = $_.Exception.GetType().Name
                  }
                  $items.Add([pscustomobject][ordered]@{
                    kind = 'TabularSections'
                    name = $sectionSource
                    parentName = $name
                    status = $sectionStatus
                    rowCount = $sectionRows
                    coveredByCurrentSnapshot = $false
                    errorType = $sectionError
                  })
                } finally {
                  if ($null -ne $section -and [Runtime.InteropServices.Marshal]::IsComObject($section)) {
                    [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($section)
                  }
                }
              }
            } finally {
              if ($null -ne $sections -and [Runtime.InteropServices.Marshal]::IsComObject($sections)) {
                [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($sections)
              }
            }
          }
        } finally {
          if ($null -ne $item -and [Runtime.InteropServices.Marshal]::IsComObject($item)) {
            [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($item)
          }
        }
      }
    } finally {
      if ($null -ne $collection -and [Runtime.InteropServices.Marshal]::IsComObject($collection)) {
        [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($collection)
      }
    }
  }
  [ordered]@{
    configuration = $configurationName
    configurationVersion = [string](Get-OneCProperty $metadata 'Version')
    inspectedAt = [datetime]::UtcNow.ToString('o')
    totalObjects = $items.Count
    populated = @($items | Where-Object { $_.status -eq 'POPULATED' }).Count
    populatedNotCovered = @($items | Where-Object { $_.status -eq 'POPULATED' -and -not $_.coveredByCurrentSnapshot }).Count
    errors = @($items | Where-Object { $_.status -eq 'QUERY_ERROR' -or $_.status -eq 'METADATA_UNAVAILABLE' }).Count
    objects = $items.ToArray()
  } | ConvertTo-Json -Depth 5
} finally {
  $password = $null
  $connectionString = $null
  foreach ($item in @($metadata, $connection, $connector)) {
    if ($null -ne $item -and [Runtime.InteropServices.Marshal]::IsComObject($item)) {
      [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($item)
    }
  }
}
