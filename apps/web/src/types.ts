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
  };
  criticalMaterials: Material[];
  deviations: BatchComponent[];
  productionTrend: Array<{ date: string; produced: string; sent: string; loss: string }>;
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
  certificateNumber: string | null;
  supplier?: { name: string } | null;
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
  densityKgPerM3: string | null;
  isCritical?: boolean;
  freeStock?: string;
  lots?: MaterialLot[];
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
