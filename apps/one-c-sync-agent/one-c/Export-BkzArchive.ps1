[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$ConfigPath,
  [Parameter(Mandatory = $true)][string]$OutputDirectory,
  [ValidateRange(64, 1000)][int]$MaxRowsPerChunk = 250,
  [ValidateRange(65536, 1500000)][int]$MaxChunkBytes = 750000,
  [string]$OnlySource = ''
)

# Read-only logical export of all catalogs, documents, register records and
# catalog/document tabular sections. An incomplete export is NEVER uploadable.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$utf8 = [Text.UTF8Encoding]::new($false)

function Get-OneCProperty($Object, [string]$Name) {
  ,$Object.GetType().InvokeMember($Name, [Reflection.BindingFlags]::GetProperty, $null, $Object, $null)
}

function Invoke-OneCMethod($Object, [string]$Name, [object[]]$Arguments = @()) {
  ,$Object.GetType().InvokeMember($Name, [Reflection.BindingFlags]::InvokeMethod, $null, $Object, $Arguments)
}

function Quote-ConnectionValue([string]$Value) {
  '"' + $Value.Replace('"', '""') + '"'
}

function Convert-OneCValue($Value, [string]$Source, [string]$Field) {
  if ($null -eq $Value -or $Value -is [DBNull]) { return $null }
  if ($Value -is [string] -or $Value -is [bool] -or $Value -is [int] -or $Value -is [long]) { return $Value }
  if ($Value -is [datetime]) {
    return [ordered]@{ type = 'LocalDateTime'; value = $Value.ToString('yyyy-MM-ddTHH:mm:ss.fffffff', [Globalization.CultureInfo]::InvariantCulture) }
  }
  if ($Value -is [decimal]) {
    return [ordered]@{ type = 'Decimal'; value = $Value.ToString([Globalization.CultureInfo]::InvariantCulture) }
  }
  if ($Value -is [double] -or $Value -is [single]) {
    return [ordered]@{ type = 'FloatingPoint'; value = $Value.ToString('R', [Globalization.CultureInfo]::InvariantCulture) }
  }
  if ($Value -is [byte[]]) {
    return [ordered]@{ type = 'Binary'; base64 = [Convert]::ToBase64String($Value) }
  }
  if ([Runtime.InteropServices.Marshal]::IsComObject($Value)) {
    try {
      $serialized = [string](Invoke-OneCMethod $script:connection 'ValueToStringInternal' @($Value))
      return [ordered]@{ type = 'OneCInternal'; value = $serialized }
    } catch {
      try {
        $serialized = [string](Invoke-OneCMethod $script:connection 'XMLString' @($Value))
        return [ordered]@{ type = 'OneCXml'; value = $serialized }
      } catch {
        throw "Unsupported 1C value in $Source field $Field (type $($Value.GetType().FullName))."
      }
    }
  }
  throw "Unsupported .NET value in $Source field $Field (type $($Value.GetType().FullName))."
}

function Get-Sensitivity([string]$Source, [string[]]$Fields) {
  if ($Source -match '(?i)пользоват|парол|токен|сертификат|крипто|подпис|эцп|электронн.*почт|рассыл|настройк|профил|праваролей|ключианалитики|идентификатор') {
    return 'SYSTEM_SECRET'
  }
  if (($Fields -join ' ') -match '(?i)парол|токен|секрет|эцп|закрытыйключ|хранилищеучетн') {
    return 'SYSTEM_SECRET'
  }
  if ($Source -match '(?i)зарплат|работник|сотрудник|физическ|пенсион|удержан|вычет|ипн|сн(?:расчет|и)|осмс|приемнаработу|увольнен|социальн.*отчислен') {
    return 'HR'
  }
  'BUSINESS'
}

function Save-OneCChunk([int]$CollectionIndex, [int]$ChunkIndex, [Collections.Generic.List[string]]$Rows) {
  $filename = ('{0:D4}-{1:D4}.json' -f $CollectionIndex, $ChunkIndex)
  $json = '[' + [string]::Join(',', $Rows.ToArray()) + ']'
  $bytes = $utf8.GetBytes($json)
  if ($bytes.Length -gt 1900000) { throw "Archive chunk $filename exceeds HTTP limit." }
  [IO.File]::WriteAllBytes((Join-Path $destination $filename), $bytes)
  $filename
}

function Read-OneCCollection([string]$Source, [string]$Kind, [string]$Name, [int]$CollectionIndex, $TabularSection = $null) {
  $query = $null
  $result = $null
  $selection = $null
  $columns = $null
  $fieldNames = [Collections.Generic.List[string]]::new()
  try {
    if ($null -eq $TabularSection) {
      $queryText = "ВЫБРАТЬ * ИЗ $Source КАК Т"
    } else {
      $fieldNames.Add('Ссылка')
      $fieldNames.Add('НомерСтроки')
      $attributes = Get-OneCProperty $TabularSection 'Attributes'
      try {
        for ($index = 0; $index -lt [int](Invoke-OneCMethod $attributes 'Count'); $index++) {
          $attribute = Invoke-OneCMethod $attributes 'Get' @($index)
          try { $fieldNames.Add([string](Get-OneCProperty $attribute 'Name')) }
          finally {
            if ($null -ne $attribute -and [Runtime.InteropServices.Marshal]::IsComObject($attribute)) {
              [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($attribute)
            }
          }
        }
      } finally {
        if ($null -ne $attributes -and [Runtime.InteropServices.Marshal]::IsComObject($attributes)) {
          [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($attributes)
        }
      }
      $selectFields = [Collections.Generic.List[string]]::new()
      for ($index = 0; $index -lt $fieldNames.Count; $index++) {
        $selectFields.Add(('Т.{0} КАК f{1}' -f $fieldNames[$index], $index))
      }
      $queryText = 'ВЫБРАТЬ ' + [string]::Join(', ', $selectFields.ToArray()) + " ИЗ $Source КАК Т"
    }
    $query = Invoke-OneCMethod $script:connection 'NewObject' @('Query', $queryText)
    $result = Invoke-OneCMethod $query 'Execute'
    $columns = Get-OneCProperty $result 'Columns'
    $columnCount = [int](Invoke-OneCMethod $columns 'Count')
    if ($null -eq $TabularSection) {
      for ($index = 0; $index -lt $columnCount; $index++) {
        $column = Invoke-OneCMethod $columns 'Get' @($index)
        try { $fieldNames.Add([string](Get-OneCProperty $column 'Name')) }
        finally {
          if ($null -ne $column -and [Runtime.InteropServices.Marshal]::IsComObject($column)) {
            [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($column)
          }
        }
      }
    }
    if ($fieldNames.Count -ne $columnCount) { throw "Column count mismatch in $Source." }
    $selection = Invoke-OneCMethod $result 'Select'
    $files = [Collections.Generic.List[string]]::new()
    $rows = [Collections.Generic.List[string]]::new()
    $rowCount = 0
    $chunkBytes = 2
    while (Invoke-OneCMethod $selection 'Next') {
      $record = [ordered]@{}
      for ($index = 0; $index -lt $columnCount; $index++) {
        $record[$fieldNames[$index]] = Convert-OneCValue (Invoke-OneCMethod $selection 'Get' @($index)) $Source $fieldNames[$index]
      }
      $encoded = $record | ConvertTo-Json -Depth 20 -Compress
      $encodedBytes = $utf8.GetByteCount($encoded)
      if ($encodedBytes + 2 -gt $MaxChunkBytes) { throw "Single row in $Source exceeds MaxChunkBytes; export binary data separately." }
      if ($rows.Count -gt 0 -and ($rows.Count -ge $MaxRowsPerChunk -or $chunkBytes + $encodedBytes + 1 -gt $MaxChunkBytes)) {
        $files.Add((Save-OneCChunk $CollectionIndex $files.Count $rows))
        $rows.Clear()
        $chunkBytes = 2
      }
      $rows.Add($encoded)
      $chunkBytes += $encodedBytes + 1
      $rowCount++
    }
    if ($rows.Count -gt 0) { $files.Add((Save-OneCChunk $CollectionIndex $files.Count $rows)) }
    [ordered]@{ key = $Source; kind = $Kind; name = $Name; sensitivity = (Get-Sensitivity $Source $fieldNames.ToArray());
      rowCount = $rowCount; fieldNames = $fieldNames.ToArray(); chunkFiles = $files.ToArray(); status = 'EXPORTED' }
  } finally {
    foreach ($item in @($selection, $columns, $result, $query)) {
      if ($null -ne $item -and [Runtime.InteropServices.Marshal]::IsComObject($item)) {
        [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($item)
      }
    }
  }
}

if (-not [Environment]::Is64BitProcess) { throw 'Use 64-bit Windows PowerShell.' }
$destination = [IO.Path]::GetFullPath($OutputDirectory)
if (Test-Path -LiteralPath $destination) { throw 'Output directory exists; use a new path.' }
$config = Get-Content -LiteralPath $ConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json
if ([string]::IsNullOrWhiteSpace($config.infobasePath) -or -not (Test-Path -LiteralPath (Join-Path $config.infobasePath '1Cv8.1CD'))) {
  throw 'infobasePath must point to an existing file-based 1C infobase.'
}
if ([string]::IsNullOrWhiteSpace($config.oneCUser)) { throw 'oneCUser is required.' }
$password = ''
if ($config.passwordFile) {
  $credential = Import-Clixml -LiteralPath $config.passwordFile
  if ($credential -isnot [Management.Automation.PSCredential] -or $credential.UserName -ne $config.oneCUser) {
    throw 'Invalid 1C credential.'
  }
  $password = $credential.GetNetworkCredential().Password
} elseif ($config.allowEmptyPassword -ne $true) {
  throw 'Provide passwordFile or explicitly allow an empty 1C password.'
}

$security = [Security.AccessControl.DirectorySecurity]::new()
$security.SetAccessRuleProtection($true, $false)
$currentSid = [Security.Principal.WindowsIdentity]::GetCurrent().User
foreach ($sid in @($currentSid, [Security.Principal.SecurityIdentifier]::new('S-1-5-18'), [Security.Principal.SecurityIdentifier]::new('S-1-5-32-544'))) {
  $security.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($sid, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow'))
}
[void][IO.Directory]::CreateDirectory($destination, $security)
$connector = $null
$script:connection = $null
$metadata = $null
$entries = [Collections.Generic.List[object]]::new()
$errors = [Collections.Generic.List[object]]::new()
try {
  $connector = New-Object -ComObject V83.COMConnector
  $connectionString = 'File=' + (Quote-ConnectionValue $config.infobasePath) + ';Usr=' + (Quote-ConnectionValue $config.oneCUser) + ';Pwd=' + (Quote-ConnectionValue $password) + ';'
  $script:connection = $connector.Connect($connectionString)
  $password = $null
  $connectionString = $null
  $metadata = Get-OneCProperty $script:connection 'Metadata'
  $configurationName = [string](Get-OneCProperty $metadata 'Name')
  if ($configurationName -ne 'БухгалтерияДляКазахстана') { throw 'Unsupported 1C configuration.' }
  $readStartedAt = [datetime]::UtcNow.ToString('o')
  $kinds = @(
    @{ collection = 'Catalogs'; prefix = 'Справочник' },
    @{ collection = 'Documents'; prefix = 'Документ' },
    @{ collection = 'AccumulationRegisters'; prefix = 'РегистрНакопления' },
    @{ collection = 'AccountingRegisters'; prefix = 'РегистрБухгалтерии' },
    @{ collection = 'InformationRegisters'; prefix = 'РегистрСведений' },
    @{ collection = 'ExchangePlans'; prefix = 'ПланОбмена' },
    @{ collection = 'ChartsOfCharacteristicTypes'; prefix = 'ПланВидовХарактеристик' },
    @{ collection = 'ChartsOfAccounts'; prefix = 'ПланСчетов' },
    @{ collection = 'ChartsOfCalculationTypes'; prefix = 'ПланВидовРасчета' },
    @{ collection = 'CalculationRegisters'; prefix = 'РегистрРасчета' },
    @{ collection = 'BusinessProcesses'; prefix = 'БизнесПроцесс' },
    @{ collection = 'Tasks'; prefix = 'Задача' },
    @{ collection = 'Sequences'; prefix = 'Последовательность' },
    @{ collection = 'Constants'; prefix = 'Константа' }
  )
  foreach ($kind in $kinds) {
    $objects = Get-OneCProperty $metadata $kind.collection
    try {
      for ($objectIndex = 0; $objectIndex -lt [int](Invoke-OneCMethod $objects 'Count'); $objectIndex++) {
        $item = Invoke-OneCMethod $objects 'Get' @($objectIndex)
        try {
          $name = [string](Get-OneCProperty $item 'Name')
          $source = $kind.prefix + '.' + $name
          if (-not $OnlySource -or $source -eq $OnlySource) {
            try { $entries.Add((Read-OneCCollection $source $kind.collection $name $entries.Count)) }
            catch {
              $errors.Add([ordered]@{ source = $source; errorType = $_.Exception.GetType().Name; message = $_.Exception.Message })
              $entries.Add([ordered]@{ key = $source; kind = $kind.collection; name = $name;
                sensitivity = (Get-Sensitivity $source @()); rowCount = 0; fieldNames = @(); chunkFiles = @(); status = 'ERROR' })
            }
          }
          if ($kind.collection -in @('Catalogs', 'Documents', 'ExchangePlans', 'ChartsOfCharacteristicTypes',
              'ChartsOfAccounts', 'ChartsOfCalculationTypes', 'BusinessProcesses', 'Tasks')) {
            $sections = Get-OneCProperty $item 'TabularSections'
            try {
              for ($sectionIndex = 0; $sectionIndex -lt [int](Invoke-OneCMethod $sections 'Count'); $sectionIndex++) {
                $section = Invoke-OneCMethod $sections 'Get' @($sectionIndex)
                try {
                  $sectionName = [string](Get-OneCProperty $section 'Name')
                  $sectionSource = $source + '.' + $sectionName
                  if (-not $OnlySource -or $sectionSource -eq $OnlySource) {
                    try { $entries.Add((Read-OneCCollection $sectionSource 'TabularSections' $sectionName $entries.Count $section)) }
                    catch {
                      $errors.Add([ordered]@{ source = $sectionSource; errorType = $_.Exception.GetType().Name; message = $_.Exception.Message })
                      $entries.Add([ordered]@{ key = $sectionSource; kind = 'TabularSections'; name = $sectionName;
                        sensitivity = (Get-Sensitivity $sectionSource @()); rowCount = 0; fieldNames = @(); chunkFiles = @(); status = 'ERROR' })
                    }
                  }
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
      if ($null -ne $objects -and [Runtime.InteropServices.Marshal]::IsComObject($objects)) {
        [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($objects)
      }
    }
  }
  $manifest = [ordered]@{ schemaVersion = 1; source = '1C'; configuration = $configurationName;
    configurationVersion = [string](Get-OneCProperty $metadata 'Version'); consistency = 'SEQUENTIAL_READ_ONLY_NOT_ACCOUNTING_CLOSE';
    readStartedAt = $readStartedAt; generatedAt = [datetime]::UtcNow.ToString('o'); sourceMetadataCount = $entries.Count;
    complete = ($errors.Count -eq 0 -and -not $OnlySource); collections = $entries.ToArray(); errors = $errors.ToArray() }
  [IO.File]::WriteAllText((Join-Path $destination 'manifest.json'), ($manifest | ConvertTo-Json -Depth 10 -Compress), $utf8)
  $totalRows = [long]0
  foreach ($entry in $entries) { $totalRows += [long]$entry.rowCount }
  [ordered]@{ status = if ($OnlySource) { 'PROBE_ONLY' } elseif ($manifest.complete) { 'EXPORTED' } else { 'INCOMPLETE_DO_NOT_UPLOAD' };
    path = $destination; collections = $entries.Count; rows = $totalRows;
    errors = $errors.Count } | ConvertTo-Json -Compress
} finally {
  $password = $null
  $connectionString = $null
  foreach ($item in @($metadata, $script:connection, $connector)) {
    if ($null -ne $item -and [Runtime.InteropServices.Marshal]::IsComObject($item)) {
      [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($item)
    }
  }
}
