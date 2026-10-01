import { describe, expect, it } from "vitest";
import { historicalWorkbookInputSchema } from "./historical-workbook-input-schema.js";

describe("historical workbook import schema", () => {
  it("preserves nested source references and financial fields", () => {
    const payload = historicalWorkbookInputSchema.parse({
      schemaVersion: 1, sourceKey: "2026-september", fileName: "report.xlsx", sha256: "a".repeat(64),
      sheets: [{ name: "производство", maxRow: 2, maxColumn: 6, rows: [] }],
      production: [{ sourceSheet: "производство", sourceRows: [1, 2], dateFrom: "2026-09-01",
        dateTo: "2026-09-01", customer: "ETG", volumeM3: "10",
        ingredients: [{ name: "КТ1", rate: "270", consumed: "2700", sourceRow: 2 }] }],
      formulas: [{ sourceSheet: "Формулы", sourceRows: [3], number: "1", customer: "ETG",
        components: [{ name: "КТ1", quantity: "2700", unitPrice: "10", lineTotal: "27000", sourceRow: 3 }],
        total: "27000", costPerUnit: "27" }],
      sales: [{ sourceSheet: "реализация", sourceRows: [4], date: "2026-09-01", customer: "ETG",
        quantityM3: "10", unitPrice: "5000", total: "50000", acceptedDate: null, acceptedQuantity: null }],
      unlabelledSalesMetrics: [{ sourceSheet: "реализация", sourceRows: [5], date: "2026-09-01",
        label: "Источник", columnE: "10", columnF: null }],
    });

    expect(payload.sheets[0]?.maxRow).toBe(2);
    expect(payload.production[0]?.sourceRows).toEqual([1, 2]);
    expect(payload.production[0]?.ingredients[0]?.rate).toBe("270");
    expect(payload.formulas[0]?.total).toBe("27000");
    expect(payload.sales[0]?.unitPrice).toBe("5000");
    expect(payload.unlabelledSalesMetrics[0]?.label).toBe("Источник");
  });
});
