export type Unit = "G" | "KG" | "T" | "ML" | "L" | "M3" | "PCS" | "M" | "PAIR";

export interface QuantityMetric {
  value: string;
  unit: Unit;
}

export interface DashboardData {
  financialBasis?: { source: "1C" | "CRM"; snapshotAt: string | null; receivablesScope: "CURRENT" };
  period: { from: string; to: string; timezone: string };
  metrics: {
    consumedMaterials: QuantityMetric[];
    produced: QuantityMetric[];
    sentToLrt: QuantityMetric[];
    availableProduct: QuantityMetric[];
    activeBatches: number;
    lossPercent: string;
    criticalStockCount: number;
    deviationBatchCount: number;
    productionCost: string;
    operatingExpenses: Array<{ amount: string; currency: string }>;
    dailyRevenue: Array<{ amount: string; currency: string }>;
    accountsReceivable: Array<{ amount: string; currency: string }>;
  };
  receivables: Array<{
    counterparty: string;
    counterpartyTaxId: string | null;
    currency: string;
    amount: string;
    overdueAmount: string;
    invoiceCount: number;
    linkedShipmentCount: number;
    lastDocumentAt: string;
    nearestDueAt: string | null;
  }>;
  mainReagents: Array<{
    id: string | null;
    code: string;
    name: string;
    currentStock: string;
    reservedStock: string;
    freeStock: string;
    minimumStock: string;
    plannedDemand: string;
    projectedStock: string;
    shortfall: string;
    baseUnit: Unit;
    isCritical: boolean;
    warningLevel: "MISSING" | "OUT_OF_STOCK" | "SHORTAGE" | "CRITICAL" | "LOW_AFTER_PLAN" | null;
    missing: boolean;
  }>;
  stockWarnings?: Array<{
    id: string;
    code: string;
    name: string;
    baseUnit: Unit;
    currentStock: string;
    reservedStock: string;
    freeStock: string;
    minimumStock: string;
    plannedDemand: string;
    projectedStock: string;
    shortfall: string;
    level: "OUT_OF_STOCK" | "SHORTAGE" | "CRITICAL" | "LOW_AFTER_PLAN";
    affectedBatches: Array<{
      id: string;
      number: string;
      scheduledAt: string;
      requiredQuantity: string;
      unit: Unit;
    }>;
  }>;
  criticalMaterials: Material[];
  deviations: BatchComponent[];
  productionTrend: Array<{ date: string; produced: string; sent: string; loss: string }>;
  analytics: {
    batchStatuses: Array<{ status: string; count: number }>;
    productionByLine: Array<{ line: string; produced: string; loss: string; unit: Unit }>;
    expenseTrend: Array<{ date: string; amount: string; currency: string }>;
  };
}

export interface UserSummary {
  id: string;
  name: string;
  role: string;
  email?: string;
}

export interface ManagedUser extends UserSummary {
  email: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CompanyProfile {
  workspaceId: string;
  legalName: string | null;
  taxId: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  bankName: string | null;
  iban: string | null;
  bic: string | null;
  directorName: string | null;
  accountantName: string | null;
  signatoryName: string | null;
  signatoryPosition: string | null;
  documentFooter: string | null;
}

export interface AuthSession {
  user: UserSummary & { email: string };
  workspace: { id: string; name: string; timezone: string; currency: string };
}

export interface ProductionLine {
  id: string;
  code: string;
  name: string;
  capacity: string;
  capacityUnit: Unit;
}

export interface ProductionTank {
  id: string;
  code: string;
  name: string;
  capacity: string | null;
  capacityUnit: Unit;
  productionLineId: string;
  productionLine: Pick<ProductionLine, "id" | "code" | "name">;
}

export interface MetaData {
  workspace: { id: string; name: string; timezone: string; currency: string };
  actor: UserSummary;
  users: UserSummary[];
  productionLines: ProductionLine[];
  productionTanks: ProductionTank[];
  productLots: ProductLot[];
  customers: Array<{
    id: string;
    name: string;
    taxId: string | null;
    contactPerson: string | null;
    contractNumber: string | null;
    paymentTermDays: number | null;
    creditLimit: string | null;
  }>;
}

export interface MaterialLot {
  id: string;
  lotNumber: string;
  receivedAt: string;
  expiresAt: string | null;
  availableQuantity: string;
  reservedQuantity: string;
  unit: Unit;
  unitCost: string;
  currency: string;
  certificateNumber: string | null;
  supplier?: { name: string } | null;
}

export interface MaterialPrice {
  id: string;
  pricePerBaseUnit: string;
  currency: string;
  effectiveAt: string;
  source: string;
  referenceId: string | null;
  note: string | null;
}

export interface MaterialMovement {
  id: string;
  type: string;
  quantity: string;
  unit: Unit;
  baseQuantity: string;
  baseUnit: Unit;
  stockBefore: string;
  stockAfter: string;
  reservedBefore: string;
  reservedAfter: string;
  reason: string | null;
  occurredAt: string;
  materialLot: { lotNumber: string };
  batch: { number: string } | null;
}

export interface Material {
  stockAuthority?: "1C" | "CRM";
  id: string;
  code: string;
  name: string;
  type: string;
  baseUnit: Unit;
  currentStock: string;
  reservedStock: string;
  minimumStock: string;
  costPerBaseUnit: string;
  currency: string;
  densityKgPerM3: string | null;
  isCritical?: boolean;
  freeStock?: string;
  lots?: MaterialLot[];
  priceHistory?: MaterialPrice[];
}

export interface MaterialListResponse {
  items: Material[];
  summary: {
    sodiumGluconate: {
      name: string;
      totalMassKg: string;
      freeMassKg: string;
      lotCount: number;
      priceVariants: number;
    };
  };
}

export interface SupplierSummary {
  id: string;
  name: string;
}

export interface PurchaseBatchItem {
  id: string;
  lotNumber: string;
  material: Pick<Material, "id" | "code" | "name" | "baseUnit">;
  supplier: SupplierSummary | null;
  initialQuantity: string;
  availableQuantity: string;
  reservedQuantity: string;
  unit: Unit;
  unitCost: string;
  lineCost: string;
}

export interface PurchaseBatchForecastComponent {
  materialId: string;
  code: string;
  name: string;
  requirementPerM3: string;
  unit: Unit;
  receivedInBatch: string;
  remainingInBatch: string;
  freeStock: string;
  remainingAfterOneM3: string;
  maximumOutput: string | null;
  outputFromBatch: string | null;
  unitCost: string;
  costPerM3: string;
}

export interface PurchaseBatch {
  id: string;
  number: string;
  receivedAt: string;
  currency: string;
  targetSalePrice: string | null;
  notes: string | null;
  totalCost: string;
  remainingCost: string;
  items: PurchaseBatchItem[];
  forecast: null | {
    recipe: {
      id: string;
      code: string;
      name: string;
      versionId: string;
      version: number;
      concreteGrade: string;
    };
    maximumOutput: string;
    outputFromBatch: string;
    costPerM3: string;
    targetSalePrice: string | null;
    marginPerM3: string | null;
    projectedRevenue: string | null;
    projectedProductionCost: string;
    projectedProfit: string | null;
    components: PurchaseBatchForecastComponent[];
  };
}

export interface RecipeComponent {
  id: string;
  materialId: string;
  normPerM3: string;
  unit: Unit;
  allowedDeviationPercent: string;
  moisturePercent: string;
  absorptionPercent: string;
  material: Material;
}

export interface RecipeVersion {
  id: string;
  version: number;
  concreteGrade: string;
  baseBatchVolume: string;
  volumeUnit: Unit;
  waterCementRatio: string | null;
  plannedYield: string;
  yieldUnit: Unit;
  technologyInstructions: string;
  snapshotHash: string;
  publishedAt: string | null;
  components: RecipeComponent[];
}

export interface Recipe {
  id: string;
  code: string;
  name: string;
  customerId: string | null;
  customer: { id: string; name: string } | null;
  status: string;
  versions: RecipeVersion[];
}

export interface AdditiveFormulaCalculation {
  formula: {
    id: string;
    code: string;
    name: string;
    versionId: string;
    version: number;
  };
  binderMass: string;
  binderMassUnit: Unit;
  dosagePercent: string;
  additiveQuantity: string;
  additiveQuantityUnit: Unit;
  compositionTotalPercent: string;
  totalCost: string;
  currency: string;
  sufficient: boolean;
  components: Array<{
    materialId: string;
    code: string;
    name: string;
    percentage: string;
    quantity: string;
    unit: Unit;
    freeStock: string;
    shortage: string;
    sufficient: boolean;
    unitCost: string;
    componentCost: string;
  }>;
}

export interface BatchComponent {
  id: string;
  materialNameSnapshot: string;
  materialTypeSnapshot: string;
  plannedQuantity: string;
  plannedUnit: Unit;
  reservedQuantity: string;
  actualQuantity: string;
  actualUnit: Unit;
  returnedQuantity: string;
  lossQuantity: string;
  deviationQuantity: string;
  deviationPercent: string;
  allowedDeviationPercent: string;
  withinTolerance: boolean;
  componentCost: string;
  batchId?: string;
  batch?: { id: string; number: string };
}

export interface BatchEconomics {
  calculationStatus: "NO_CONSUMPTION" | "NOT_COMPLETED" | "NO_SHIPMENT" | "NO_INVOICE" | "CURRENCY_MISMATCH" | "CALCULATED";
  consumptionConfirmed: boolean;
  currency: string;
  actualQuantities: Array<{ value: string; unit: Unit }>;
  actualMaterialCost: string;
  actualUnitCost: string;
  outputUnit: Unit;
  shippedQuantity: string;
  invoicedQuantity: string;
  invoicedRevenue: string;
  paidRevenue: string;
  soldCost: string;
  grossProfit: string | null;
  marginPercent: string | null;
  currencyMismatch: boolean;
  costSource: "WAREHOUSE_LOTS" | "RECORDED_BATCH";
  components: Array<{
    batchComponentId: string;
    materialId: string;
    materialName: string;
    plannedQuantity: string;
    plannedUnit: Unit;
    actualQuantity: string;
    actualUnit: Unit;
    lossQuantity: string;
    lossUnit: Unit;
    averageUnitCost: string;
    actualCost: string;
    currency: string;
    costSource: "WAREHOUSE_LOTS" | "RECORDED_COMPONENT";
    lots: Array<{
      allocationId: string;
      materialLotId: string;
      lotNumber: string;
      supplier: { id: string; name: string } | null;
      quantity: string;
      unit: Unit;
      unitCost: string;
      cost: string;
    }>;
  }>;
  revenueDocuments: Array<{
    id: string;
    number: string;
    status: AccountingDocumentStatus;
    transferId: string;
    transferNumber: string;
    allocatedAmount: string;
    currency: string;
  }>;
}

export interface Batch {
  stockManagedExternally?: boolean;
  id: string;
  number: string;
  status: string;
  scheduledAt: string;
  startedAt: string | null;
  completedAt: string | null;
  recipeVersionId: string;
  concreteGrade: string;
  plannedVolume: string;
  plannedVolumeUnit: Unit;
  actualVolume: string | null;
  plannedOutput: string;
  actualOutput: string | null;
  goodOutput: string | null;
  rejectedOutput: string;
  technologicalLoss: string;
  availableOutput: string;
  outputAccountingUnit: Unit;
  totalCost: string;
  costPerOutputUnit: string;
  currency: string;
  comments: string | null;
  operator: UserSummary;
  productionLine: ProductionLine;
  productionTank: Pick<ProductionTank, "id" | "code" | "name"> | null;
  recipeVersion: RecipeVersion & { recipe: Pick<Recipe, "name" | "code"> };
  components?: BatchComponent[];
  productLots?: ProductLot[];
  qualityChecks?: unknown[];
  materialMovements?: Array<{ id: string; type: string }>;
  economics?: BatchEconomics | null;
  stockReadiness?: {
    status: "READY" | "LOW" | "SHORTAGE" | "NOT_APPLICABLE";
    warnings: Array<{
      batchComponentId: string;
      materialName: string;
      level: "OUT_OF_STOCK" | "SHORTAGE" | "CRITICAL" | "LOW_AFTER_BATCH";
      freeStock: string;
      requiredQuantity: string;
      projectedStock: string;
      shortfall: string;
      minimumStock: string;
      unit: Unit;
    }>;
  };
}

export interface ProductLot {
  id: string;
  number: string;
  concreteGrade: string;
  status: string;
  availableQuantity: string;
  producedQuantity: string;
  unit: Unit;
  batchId: string;
  batch?: { id: string; number: string };
}

export interface TransferItem {
  id: string;
  requestedQuantity: string;
  sentQuantity: string;
  acceptedQuantity: string;
  rejectedQuantity: string;
  returnedQuantity: string;
  unit: Unit;
  productLot: ProductLot;
  batch: Pick<Batch, "id" | "number">;
}

export interface Transfer {
  id: string;
  number: string;
  status: string;
  transferAt: string;
  sentAt: string | null;
  acceptedAt: string | null;
  transport: string | null;
  sender: UserSummary;
  customerId: string | null;
  customer: { id: string; name: string; taxId?: string | null; contactPerson?: string | null } | null;
  items: TransferItem[];
}

export type WagonStatus = "EMPTY" | "LOADING" | "LOADED" | "IN_TRANSIT" | "AT_DESTINATION" | "UNLOADING" | "RETURNING" | "MAINTENANCE";

export interface WagonLocationEvent {
  id: string;
  status: WagonStatus;
  location: string;
  cargoDescription: string | null;
  cargoQuantity: string;
  cargoUnit: Unit;
  shipmentNumber: string | null;
  note: string | null;
  occurredAt: string;
  actor: Pick<UserSummary, "id" | "name">;
}

export interface Wagon {
  id: string;
  number: string;
  type: string;
  capacity: string;
  capacityUnit: Unit;
  tareWeightT: string | null;
  status: WagonStatus;
  currentLocation: string;
  cargoDescription: string | null;
  cargoQuantity: string;
  cargoUnit: Unit;
  shipmentNumber: string | null;
  lastReportedAt: string;
  locationEvents: WagonLocationEvent[];
}

export interface RecipeCalculation {
  calculatedFor: string;
  recipe: {
    id: string;
    code: string;
    name: string;
    versionId: string;
    version: number;
    concreteGrade: string;
  };
  plannedVolume: string;
  plannedVolumeUnit: Unit;
  plannedOutput: string;
  plannedOutputUnit: Unit;
  totalCost: string;
  costPerM3: string;
  costPerOutputUnit: string;
  currency: string;
  sufficient: boolean;
  components: Array<{
    materialId: string;
    code: string;
    name: string;
    quantity: string;
    unit: Unit;
    normPerM3: string;
    recipeUnit: Unit;
    unitCost: string;
    componentCost: string;
    freeStock: string;
    shortage: string;
    sufficient: boolean;
  }>;
}

export type ExpenseCategory = "RAW_MATERIALS" | "LOGISTICS" | "UTILITIES" | "MAINTENANCE" | "SALARY" | "TAXES" | "RENT" | "LABORATORY" | "OTHER";
export type ExpenseCostCenter = "PRODUCTION" | "WAREHOUSE" | "LOGISTICS" | "LABORATORY" | "ADMINISTRATION" | "OTHER";
export type ExpensePaymentMethod = "BANK_TRANSFER" | "CASH" | "CORPORATE_CARD" | "OFFSET" | "OTHER";
export type ExpenseStatus = "RECORDED" | "CANCELLED";

export interface ExpenseAttachment {
  id: string;
  name: string;
  storageKey: string;
  mimeType: string;
  sizeBytes: number;
  url: string | null;
  createdAt: string;
}

export interface Expense {
  id: string;
  number: string;
  category: ExpenseCategory;
  costCenter: ExpenseCostCenter;
  paymentMethod: ExpensePaymentMethod;
  status: ExpenseStatus;
  incurredAt: string;
  amount: string;
  currency: string;
  description: string;
  counterparty: string | null;
  documentNumber: string | null;
  note: string | null;
  createdBy: Pick<UserSummary, "id" | "name">;
  cancelledAt: string | null;
  cancelledBy: Pick<UserSummary, "id" | "name"> | null;
  cancellationReason: string | null;
  createdAt: string;
  attachments: ExpenseAttachment[];
}

export interface ExpenseResponse {
  items: Expense[];
  summary: {
    totals: Array<{ currency: string; amount: string }>;
    byCategory: Array<{ category: ExpenseCategory; currency: string; amount: string; count: number }>;
    recordedCount: number;
    cancelledCount: number;
  };
}

export type AccountingDocumentType = "WAYBILL" | "PAYMENT_INVOICE" | "COMPLETION_ACT" | "POWER_OF_ATTORNEY";
export type AccountingDocumentStatus = "DRAFT" | "PENDING_DIRECTOR_APPROVAL" | "PENDING_ACCOUNTANT_APPROVAL" | "ISSUED" | "PAID" | "CANCELLED";

export interface AccountingDocumentItem {
  id: string;
  description: string;
  quantity: string;
  unit: string;
  unitPrice: string;
  amount: string;
  position: number;
}

export interface AccountingDocument {
  id: string;
  number: string;
  type: AccountingDocumentType;
  status: AccountingDocumentStatus;
  documentAt: string;
  dueAt: string | null;
  issuedAt: string | null;
  paidAt: string | null;
  counterparty: string;
  counterpartyTaxId: string | null;
  customerId: string | null;
  customer: { id: string; name: string; taxId: string | null; contactPerson: string | null; address: string | null } | null;
  basis: string | null;
  subtotal: string;
  vatRate: string;
  vatAmount: string;
  totalAmount: string;
  currency: string;
  transfer: { id: string; number: string } | null;
  expense: { id: string; number: string } | null;
  details: null | {
    source?: string;
    representativeName?: string;
    representativePosition?: string;
    representativeIin?: string;
    identityDocument?: string;
    identityIssuedBy?: string;
    identityIssuedAt?: string;
  };
  notes: string | null;
  createdBy: Pick<UserSummary, "id" | "name">;
  cancelledAt: string | null;
  cancellationReason: string | null;
  createdAt: string;
  items: AccountingDocumentItem[];
}

export interface AccountingResponse {
  items: AccountingDocument[];
  summary: {
    totals: Array<{ currency: string; amount: string }>;
    byStatus: Array<{ status: AccountingDocumentStatus; count: number }>;
    byType: Array<{ type: AccountingDocumentType; count: number }>;
  };
}

export interface CustomerConcreteComponent {
  id: string;
  name: string;
  quantity: string;
  unit: Unit;
  position: number;
  note: string | null;
}

export interface CustomerConcreteRecipe {
  id: string;
  name: string;
  concreteGrade: string;
  basisVolume: string;
  basisUnit: Unit;
  binderMassKg: string;
  additiveDosagePercent: string;
  additiveQuantityKg: string;
  additiveQuantityPerM3Kg: string;
  recommendedDosagePercent: string | null;
  notes: string | null;
  additiveFormulaVersion: {
    id: string;
    version: number;
    dosagePercent: string | null;
    formula: { id: string; code: string; name: string };
  };
  components: CustomerConcreteComponent[];
  createdAt: string;
}

export interface Customer {
  id: string;
  name: string;
  taxId: string | null;
  contactPerson: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  contractNumber: string | null;
  contractSignedAt: string | null;
  contractValidUntil: string | null;
  paymentTermDays: number | null;
  creditLimit: string | null;
  notes: string | null;
  active: boolean;
  concreteRecipes: CustomerConcreteRecipe[];
  receivables: Array<{
    currency: string;
    amount: string;
    overdueAmount: string;
    invoiceCount: number;
    nearestDueAt: string | null;
  }>;
  timeline?: CustomerTimelineItem[];
  createdAt: string;
  updatedAt: string;
}

export interface CustomerTimelineItem {
  id: string;
  kind: "CONCRETE_RECIPE" | "TRANSFER" | "WAYBILL" | "DOCUMENT" | "PAYMENT" | "DEBT";
  occurredAt: string;
  title: string;
  description: string;
  status: string | null;
  amount: string | null;
  currency: string | null;
  relatedId: string | null;
}

export interface CustomerResponse {
  items: Customer[];
  summary: {
    activeCustomers: number;
    concreteRecipes: number;
    formulasInUse: number;
  };
}
