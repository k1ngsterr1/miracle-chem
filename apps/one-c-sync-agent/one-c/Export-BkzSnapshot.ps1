[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$ConfigPath,
  [Parameter(Mandatory = $true)][string]$OutputPath
)

# Read-only adapter for Бухгалтерия для Казахстана 3.0 (verified on 3.0.74.2).
# Run in 64-bit Windows PowerShell 5.1 with the matching V83.COMConnector.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [Text.Encoding]::UTF8

function Get-OneCProperty($Object, [string]$Name) {
  ,$Object.GetType().InvokeMember($Name, [Reflection.BindingFlags]::GetProperty, $null, $Object, $null)
}

function Invoke-OneCMethod($Object, [string]$Name, [object[]]$Arguments = @()) {
  ,$Object.GetType().InvokeMember($Name, [Reflection.BindingFlags]::InvokeMethod, $null, $Object, $Arguments)
}

function Quote-ConnectionValue([string]$Value) {
  '"' + $Value.Replace('"', '""') + '"'
}

function Read-OneCQuery([string]$Text, [string[]]$Fields, [string[]]$ReferenceFields = @(), [string[]]$DecimalFields = @(), [string[]]$DateFields = @()) {
  $query = Invoke-OneCMethod $script:connection 'NewObject' @('Query', $Text)
  $result = $null
  $selection = $null
  try {
    $result = Invoke-OneCMethod $query 'Execute'
    $selection = Invoke-OneCMethod $result 'Select'
    $rows = [Collections.Generic.List[object]]::new()
    while (Invoke-OneCMethod $selection 'Next') {
      if ($rows.Count -ge 2000) { throw 'Snapshot exceeds 2000 rows per collection. Add paging before enabling synchronization; no truncated snapshot was saved.' }
      $row = [ordered]@{}
      foreach ($field in $Fields) {
        $value = Get-OneCProperty $selection $field
        if ($ReferenceFields -contains $field) {
          $row[$field] = [string](Invoke-OneCMethod $script:connection 'XMLString' @($value))
        } elseif ($DecimalFields -contains $field) {
          $row[$field] = ([decimal]$value).ToString([Globalization.CultureInfo]::InvariantCulture)
        } elseif ($DateFields -contains $field) {
          # A 1C date has no offset. Preserve source wall time, do not invent UTC.
          $row[$field] = ([datetime]$value).ToString('yyyy-MM-ddTHH:mm:ss', [Globalization.CultureInfo]::InvariantCulture)
        } else {
          $row[$field] = $value
        }
      }
      $rows.Add([pscustomobject]$row)
    }
    $rows.ToArray()
  } finally {
    foreach ($item in @($selection, $result, $query)) {
      if ($null -ne $item -and [Runtime.InteropServices.Marshal]::IsComObject($item)) {
        [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($item)
      }
    }
  }
}

if (-not [Environment]::Is64BitProcess) { throw 'Use 64-bit Windows PowerShell.' }
$destination = [IO.Path]::GetFullPath($OutputPath)
if (Test-Path -LiteralPath $destination) { throw 'Output already exists. Use a new filename; existing snapshots are preserved.' }
$config = Get-Content -LiteralPath $ConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json
if ([string]::IsNullOrWhiteSpace($config.infobasePath) -or -not (Test-Path -LiteralPath (Join-Path $config.infobasePath '1Cv8.1CD'))) {
  throw 'infobasePath must point to an existing file-based 1C infobase.'
}
if ([string]::IsNullOrWhiteSpace($config.oneCUser)) { throw 'oneCUser is required.' }
$password = ''
if ($config.passwordFile) {
  # Export-Clixml PSCredential is tied to the same Windows user and machine.
  $credential = Import-Clixml -LiteralPath $config.passwordFile
  if ($credential -isnot [Management.Automation.PSCredential]) { throw 'passwordFile must contain an exported PSCredential.' }
  if ($credential.UserName -ne $config.oneCUser) { throw 'Credential user does not match oneCUser.' }
  $password = $credential.GetNetworkCredential().Password
} elseif ($config.allowEmptyPassword -ne $true) {
  throw 'Provide passwordFile or explicitly allow an empty 1C password.'
}

$connector = $null
$script:connection = $null
$metadata = $null
$temporary = $null
try {
  $connector = New-Object -ComObject V83.COMConnector
  $connectionString = 'File=' + (Quote-ConnectionValue $config.infobasePath) + ';Usr=' + (Quote-ConnectionValue $config.oneCUser) + ';Pwd=' + (Quote-ConnectionValue $password) + ';'
  $script:connection = $connector.Connect($connectionString)
  $password = $null
  $connectionString = $null
  $metadata = Get-OneCProperty $script:connection 'Metadata'
  $configurationName = [string](Get-OneCProperty $metadata 'Name')
  if ($configurationName -ne 'БухгалтерияДляКазахстана') { throw 'Unsupported 1C configuration. No snapshot was saved.' }
  $readStartedAt = [datetime]::UtcNow.ToString('o')

  $organizations = @(Read-OneCQuery @'
ВЫБРАТЬ ПЕРВЫЕ 2001 Н.Ссылка КАК externalId, Н.Код КАК code, Н.Наименование КАК name
ИЗ Справочник.Организации КАК Н
УПОРЯДОЧИТЬ ПО Н.Код
'@ @('externalId', 'code', 'name') @('externalId'))

  $counterparties = @(Read-OneCQuery @'
ВЫБРАТЬ ПЕРВЫЕ 2001 Н.Ссылка КАК externalId, Н.Код КАК code, Н.Наименование КАК name,
Н.Родитель.Наименование КАК groupName,
Н.ИдентификационныйКодЛичности КАК taxId, Н.ПометкаУдаления КАК deleted
ИЗ Справочник.Контрагенты КАК Н ГДЕ НЕ Н.ЭтоГруппа
УПОРЯДОЧИТЬ ПО Н.Код
'@ @('externalId', 'code', 'name', 'groupName', 'taxId', 'deleted') @('externalId'))

  $materials = @(Read-OneCQuery @'
ВЫБРАТЬ ПЕРВЫЕ 2001 Н.Ссылка КАК externalId, Н.Код КАК code, Н.Наименование КАК name,
Н.Родитель.Наименование КАК groupName,
Н.БазоваяЕдиницаИзмерения.Ссылка КАК unitId, Н.БазоваяЕдиницаИзмерения.Наименование КАК unitName,
Н.Услуга КАК service, Н.ПометкаУдаления КАК deleted
ИЗ Справочник.Номенклатура КАК Н ГДЕ НЕ Н.ЭтоГруппа
УПОРЯДОЧИТЬ ПО Н.Код
'@ @('externalId', 'code', 'name', 'groupName', 'unitId', 'unitName', 'service', 'deleted') @('externalId', 'unitId'))

  $receipts = @(Read-OneCQuery @'
ВЫБРАТЬ ПЕРВЫЕ 2001 Т.Ссылка КАК documentId, Т.НомерСтроки КАК lineNumber,
Т.Ссылка.Номер КАК number, Т.Ссылка.Дата КАК receivedAt,
Т.Ссылка.Проведен КАК posted, Т.Ссылка.ПометкаУдаления КАК deleted,
Т.Ссылка.Организация КАК organizationId, Т.Ссылка.Контрагент КАК supplierId,
Т.Ссылка.Склад КАК warehouseId, Т.Номенклатура КАК materialId,
Т.ЕдиницаИзмерения КАК unitId, Т.ЕдиницаИзмерения.Наименование КАК unitName,
Т.Коэффициент КАК coefficient, Т.Количество КАК quantity, Т.Цена КАК unitPrice,
Т.Сумма КАК amount, Т.СуммаНДС КАК vatAmount,
Т.Ссылка.СуммаВключаетНДС КАК amountIncludesVat,
Т.Ссылка.НДСВключенВСтоимость КАК vatInCost,
Т.Ссылка.ВалютаДокумента.Наименование КАК currencyName,
Т.Ссылка.КурсВзаиморасчетов КАК exchangeRate,
Т.Ссылка.КратностьВзаиморасчетов КАК exchangeMultiplicity
ИЗ Документ.ПоступлениеТоваровУслуг.Товары КАК Т
УПОРЯДОЧИТЬ ПО Т.Ссылка.Дата, Т.Ссылка, Т.НомерСтроки
'@ @('documentId', 'lineNumber', 'number', 'receivedAt', 'posted', 'deleted', 'organizationId', 'supplierId', 'warehouseId', 'materialId', 'unitId', 'unitName', 'coefficient', 'quantity', 'unitPrice', 'amount', 'vatAmount', 'amountIncludesVat', 'vatInCost', 'currencyName', 'exchangeRate', 'exchangeMultiplicity') @('documentId', 'organizationId', 'supplierId', 'warehouseId', 'materialId', 'unitId') @('coefficient', 'quantity', 'unitPrice', 'amount', 'vatAmount', 'exchangeRate', 'exchangeMultiplicity') @('receivedAt'))

  $balances = @(Read-OneCQuery @'
ВЫБРАТЬ ПЕРВЫЕ 2001 О.Организация КАК organizationId, О.Склад КАК warehouseId,
О.Товар КАК materialId, СУММА(О.КоличествоОстаток) КАК quantity
ИЗ РегистрНакопления.ТоварыОрганизацийБУ.Остатки КАК О
СГРУППИРОВАТЬ ПО О.Организация, О.Склад, О.Товар
'@ @('organizationId', 'warehouseId', 'materialId', 'quantity') @('organizationId', 'warehouseId', 'materialId') @('quantity'))

  # The accumulation register above is diagnostic only. Actual stock and its
  # book value are on accounts 1310 (materials), 1320 (finished goods), 1330 (goods).
  $accountingInventory = @(Read-OneCQuery @'
ВЫБРАТЬ ПЕРВЫЕ 2001 О.Организация КАК organizationId, О.Счет.Код КАК accountCode,
О.Субконто1 КАК materialId, О.Субконто2 КАК warehouseId,
О.КоличествоОстатокДт КАК quantityDebit, О.КоличествоОстатокКт КАК quantityCredit,
О.СуммаОстатокДт КАК amountDebit, О.СуммаОстатокКт КАК amountCredit
ИЗ РегистрБухгалтерии.Типовой.Остатки КАК О
ГДЕ О.Счет.Код = "1310" ИЛИ О.Счет.Код = "1320" ИЛИ О.Счет.Код = "1330"
'@ @('organizationId', 'accountCode', 'materialId', 'warehouseId', 'quantityDebit', 'quantityCredit', 'amountDebit', 'amountCredit') @('organizationId', 'materialId', 'warehouseId') @('quantityDebit', 'quantityCredit', 'amountDebit', 'amountCredit'))

  $receivables = @(Read-OneCQuery @'
ВЫБРАТЬ ПЕРВЫЕ 2001 О.Организация КАК organizationId, О.Субконто1 КАК counterpartyId,
О.Субконто2 КАК contractId, О.СуммаОстатокДт КАК amountDebit,
О.СуммаОстатокКт КАК amountCredit
ИЗ РегистрБухгалтерии.Типовой.Остатки КАК О
ГДЕ О.Счет.Код = "1210"
'@ @('organizationId', 'counterpartyId', 'contractId', 'amountDebit', 'amountCredit') @('organizationId', 'counterpartyId', 'contractId') @('amountDebit', 'amountCredit'))

  $sales = @(Read-OneCQuery @'
ВЫБРАТЬ ПЕРВЫЕ 2001 Д.Ссылка КАК externalId, Д.Номер КАК number, Д.Дата КАК documentAt,
Д.Организация КАК organizationId, Д.Контрагент КАК counterpartyId,
Д.СуммаДокумента КАК amount, Д.Проведен КАК posted, Д.ПометкаУдаления КАК deleted
ИЗ Документ.РеализацияТоваровУслуг КАК Д
УПОРЯДОЧИТЬ ПО Д.Дата, Д.Ссылка
'@ @('externalId', 'number', 'documentAt', 'organizationId', 'counterpartyId', 'amount', 'posted', 'deleted') @('externalId', 'organizationId', 'counterpartyId') @('amount') @('documentAt'))

  $saleLines = @(Read-OneCQuery @'
ВЫБРАТЬ ПЕРВЫЕ 2001 Т.Ссылка КАК documentId, Т.НомерСтроки КАК lineNumber,
Т.Номенклатура КАК materialId, Т.ЕдиницаИзмерения КАК unitId,
Т.ЕдиницаИзмерения.Наименование КАК unitName, Т.Количество КАК quantity,
Т.Цена КАК unitPrice, Т.Сумма КАК amount, Т.СуммаНДС КАК vatAmount
ИЗ Документ.РеализацияТоваровУслуг.Товары КАК Т
УПОРЯДОЧИТЬ ПО Т.Ссылка, Т.НомерСтроки
'@ @('documentId', 'lineNumber', 'materialId', 'unitId', 'unitName', 'quantity', 'unitPrice', 'amount', 'vatAmount') @('documentId', 'materialId', 'unitId') @('quantity', 'unitPrice', 'amount', 'vatAmount'))

  $invoices = @(Read-OneCQuery @'
ВЫБРАТЬ ПЕРВЫЕ 2001 Д.Ссылка КАК externalId, Д.Номер КАК number, Д.Дата КАК documentAt,
Д.Организация КАК organizationId, Д.Контрагент КАК counterpartyId,
Д.СуммаДокумента КАК amount, Д.Проведен КАК posted, Д.ПометкаУдаления КАК deleted
ИЗ Документ.СчетНаОплатуПокупателю КАК Д
УПОРЯДОЧИТЬ ПО Д.Дата, Д.Ссылка
'@ @('externalId', 'number', 'documentAt', 'organizationId', 'counterpartyId', 'amount', 'posted', 'deleted') @('externalId', 'organizationId', 'counterpartyId') @('amount') @('documentAt'))

  $invoiceLines = @(Read-OneCQuery @'
ВЫБРАТЬ ПЕРВЫЕ 2001 Т.Ссылка КАК documentId, Т.НомерСтроки КАК lineNumber,
Т.Номенклатура КАК materialId, Т.ЕдиницаИзмерения КАК unitId,
Т.ЕдиницаИзмерения.Наименование КАК unitName, Т.Количество КАК quantity,
Т.Цена КАК unitPrice, Т.Сумма КАК amount, Т.СуммаНДС КАК vatAmount
ИЗ Документ.СчетНаОплатуПокупателю.Товары КАК Т
УПОРЯДОЧИТЬ ПО Т.Ссылка, Т.НомерСтроки
'@ @('documentId', 'lineNumber', 'materialId', 'unitId', 'unitName', 'quantity', 'unitPrice', 'amount', 'vatAmount') @('documentId', 'materialId', 'unitId') @('quantity', 'unitPrice', 'amount', 'vatAmount'))

  $incomingPayments = @(Read-OneCQuery @'
ВЫБРАТЬ ПЕРВЫЕ 2001 Д.Ссылка КАК externalId, Д.Номер КАК number, Д.Дата КАК documentAt,
Д.Организация КАК organizationId, Д.Контрагент КАК counterpartyId,
Д.СуммаДокумента КАК amount, Д.ВалютаДокумента.Наименование КАК currencyName,
Д.НазначениеПлатежа КАК purpose, Д.Проведен КАК posted, Д.ПометкаУдаления КАК deleted
ИЗ Документ.ПлатежноеПоручениеВходящее КАК Д
УПОРЯДОЧИТЬ ПО Д.Дата, Д.Ссылка
'@ @('externalId', 'number', 'documentAt', 'organizationId', 'counterpartyId', 'amount', 'currencyName', 'purpose', 'posted', 'deleted') @('externalId', 'organizationId', 'counterpartyId') @('amount') @('documentAt'))

  $outgoingPayments = @(Read-OneCQuery @'
ВЫБРАТЬ ПЕРВЫЕ 2001 Д.Ссылка КАК externalId, Д.Номер КАК number, Д.Дата КАК documentAt,
Д.Организация КАК organizationId, Д.Контрагент КАК counterpartyId,
Д.СуммаДокумента КАК amount, Д.ВалютаДокумента.Наименование КАК currencyName,
Д.НазначениеПлатежа КАК purpose, Д.Проведен КАК posted, Д.ПометкаУдаления КАК deleted
ИЗ Документ.ПлатежноеПоручениеИсходящее КАК Д
УПОРЯДОЧИТЬ ПО Д.Дата, Д.Ссылка
'@ @('externalId', 'number', 'documentAt', 'organizationId', 'counterpartyId', 'amount', 'currencyName', 'purpose', 'posted', 'deleted') @('externalId', 'organizationId', 'counterpartyId') @('amount') @('documentAt'))

  $snapshot = [ordered]@{
    schemaVersion = 1
    source = '1C'
    configuration = $configurationName
    configurationVersion = [string](Get-OneCProperty $metadata 'Version')
    generatedAt = [datetime]::UtcNow.ToString('o')
    # Sequential read-only queries: reconciliation snapshot, not an atomic accounting close.
    readStartedAt = $readStartedAt
    consistency = 'SEQUENTIAL_READ_ONLY_NOT_ACCOUNTING_CLOSE'
    organizations = $organizations
    counterparties = $counterparties
    materials = $materials
    receipts = $receipts
    balances = $balances
    accountingInventory = $accountingInventory
    receivables = $receivables
    sales = $sales
    saleLines = $saleLines
    invoices = $invoices
    invoiceLines = $invoiceLines
    incomingPayments = $incomingPayments
    outgoingPayments = $outgoingPayments
  }
  [void][IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($destination))
  $temporary = $destination + '.' + [guid]::NewGuid().ToString('N') + '.tmp'
  # Apply a private DACL at creation, before any business data reaches disk.
  $security = [Security.AccessControl.FileSecurity]::new()
  $security.SetAccessRuleProtection($true, $false)
  $currentSid = [Security.Principal.WindowsIdentity]::GetCurrent().User
  foreach ($sid in @($currentSid, [Security.Principal.SecurityIdentifier]::new('S-1-5-18'), [Security.Principal.SecurityIdentifier]::new('S-1-5-32-544'))) {
    $security.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($sid, 'FullControl', 'Allow'))
  }
  $stream = [IO.FileStream]::new($temporary, [IO.FileMode]::CreateNew, [Security.AccessControl.FileSystemRights]::Write, [IO.FileShare]::None, 4096, [IO.FileOptions]::None, $security)
  try {
    $bytes = [Text.UTF8Encoding]::new($false).GetBytes(($snapshot | ConvertTo-Json -Depth 8 -Compress))
    $stream.Write($bytes, 0, $bytes.Length)
    $stream.Flush($true)
  } finally { $stream.Dispose() }
  [IO.File]::Move($temporary, $destination)
  $temporary = $null
  [ordered]@{status = 'EXPORTED_READ_ONLY'; path = $destination; configurationVersion = $snapshot.configurationVersion; organizations = $organizations.Count; counterparties = $counterparties.Count; materials = $materials.Count; receiptLines = $receipts.Count; diagnosticBalances = $balances.Count; accountingInventory = $accountingInventory.Count; receivables = $receivables.Count; sales = $sales.Count; invoices = $invoices.Count; incomingPayments = $incomingPayments.Count; outgoingPayments = $outgoingPayments.Count} | ConvertTo-Json -Compress
} finally {
  $password = $null
  $connectionString = $null
  if ($temporary -and (Test-Path -LiteralPath $temporary)) { [IO.File]::Delete($temporary) }
  foreach ($item in @($metadata, $script:connection, $connector)) {
    if ($null -ne $item -and [Runtime.InteropServices.Marshal]::IsComObject($item)) {
      [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($item)
    }
  }
  [GC]::Collect()
  [GC]::WaitForPendingFinalizers()
}
