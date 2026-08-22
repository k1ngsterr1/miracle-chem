export type Unit = "G" | "KG" | "T" | "ML" | "L" | "M3";

export interface QuantityMetric {
  value: string;
  unit: Unit;
}

export interface DashboardData {
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
  };
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

export interface ProductionLine {
  id: string;
  code: string;
  name: string;
  capacity: string;
  capacityUnit: Unit;
}

export interface MetaData {
  workspace: { id: string; name: string; timezone: string; currency: string };
  actor: UserSummary;
  users: UserSummary[];
  productionLines: ProductionLine[];
  productLots: ProductLot[];
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
  status: string;
  versions: RecipeVersion[];
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

export interface Batch {
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
  operator: UserSummary;
  productionLine: ProductionLine;
  recipeVersion: RecipeVersion & { recipe: Pick<Recipe, "name" | "code"> };
  components?: BatchComponent[];
  productLots?: ProductLot[];
  qualityChecks?: unknown[];
  materialMovements?: Array<{ id: string; type: string }>;
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
  receiverName: string | null;
  transport: string | null;
  sender: UserSummary;
  receiver?: UserSummary | null;
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

export type AccountingDocumentType = "WAYBILL" | "PAYMENT_INVOICE" | "COMPLETION_ACT";
export type AccountingDocumentStatus = "DRAFT" | "ISSUED" | "PAID" | "CANCELLED";

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
  basis: string | null;
  subtotal: string;
  vatRate: string;
  vatAmount: string;
  totalAmount: string;
  currency: string;
  transfer: { id: string; number: string } | null;
  expense: { id: string; number: string } | null;
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
