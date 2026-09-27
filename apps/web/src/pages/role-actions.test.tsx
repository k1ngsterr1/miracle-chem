import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { BatchesPage } from "./BatchesPage.js";
import { ClientsPage } from "./ClientsPage.js";

const customer = {
  id: "customer-1",
  name: "ТОО Бетон",
  taxId: null,
  contactPerson: null,
  phone: null,
  email: null,
  address: null,
  notes: null,
  active: true,
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
  concreteRecipes: [],
  receivables: [],
};

describe("read-only and quality role actions", () => {
  it("does not expose customer write actions to read-only roles", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const payload = url.endsWith("/customers/customer-1")
        ? { ...customer, timeline: [] }
        : url.endsWith("/customers")
          ? { items: [customer], summary: { activeCustomers: 1, concreteRecipes: 0, formulasInUse: 0 } }
          : { items: [] };
      return { ok: true, status: 200, json: async () => payload } as Response;
    }));

    render(<ClientsPage actorRole="VIEWER" />);
    await screen.findByRole("heading", { name: "Клиенты" });
    expect(screen.queryByRole("button", { name: "Новый клиент" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("ТОО Бетон"));
    await screen.findByRole("heading", { name: "ТОО Бетон" });
    expect(screen.queryByRole("button", { name: "Редактировать" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Добавить состав бетона" })).not.toBeInTheDocument();
  });

  it("keeps the quality manager out of production-creation actions", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const payload = url.includes("/batches") || url.includes("/recipes") ? { items: [] } : {};
      return { ok: true, status: 200, json: async () => payload } as Response;
    }));

    render(<BatchesPage actorRole="QUALITY_MANAGER" meta={null} />);
    await waitFor(() => expect(screen.getByRole("heading", { name: "Замесы" })).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Запланировать замес" })).not.toBeInTheDocument();
  });
});
