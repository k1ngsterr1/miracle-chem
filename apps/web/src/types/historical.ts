export interface HistoricalSource {
  id: string;
  workbookId: string;
  fileName: string;
  sourceSheet: string;
  sourceRows: number[];
}

export interface HistoricalSale extends HistoricalSource {
  date: string;
  customer: string;
  quantityM3: string;
  unitPrice: string | null;
  total: string | null;
  acceptedDate: string | null;
  acceptedQuantity: string | null;
}

export interface HistoricalFormula extends HistoricalSource {
  number: string;
  customer: string | null;
  components: Array<{ name: string; quantity: string; unitPrice: string; lineTotal: string; sourceRow: number }>;
  total: string;
  costPerUnit: string | null;
}

export interface HistoricalMaterialUsage extends HistoricalSource {
  name: string;
  rate: string;
  consumed: string;
  sourceRow: number;
  dateFrom: string;
  dateTo: string;
  customer: string | null;
  volumeM3: string;
}

export interface HistoricalWarehouseClaim {
  id: string;
  workbookId: string;
  fileName: string;
  sourceSheet: string;
  sourceRow: number;
  supplier: string | null;
  material: string;
  quantityKg: string;
}

export interface HistoricalWarehouseCheckpoint extends HistoricalSource {
  periodLabel: string;
  dateFrom: string;
  dateTo: string;
  materials: Array<{ name: string; before: string | null; used: string | null; after: string | null }>;
}
