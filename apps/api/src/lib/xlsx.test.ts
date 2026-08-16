import { unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { createXlsx } from "./xlsx.js";

describe("createXlsx", () => {
  it("creates a valid OOXML archive and escapes worksheet values", () => {
    const file = createXlsx([{ material: "Цемент & песок", quantity: "12.5" }]);
    const entries = unzipSync(file);
    expect(Object.keys(entries)).toContain("xl/worksheets/sheet1.xml");
    const sheet = Buffer.from(entries["xl/worksheets/sheet1.xml"] ?? []).toString("utf8");
    expect(sheet).toContain("Цемент &amp; песок");
    expect(sheet).toContain("<autoFilter");
  });
});
