import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SettingsPage } from "./SettingsPage.js";

const company = {
  workspaceId: "workspace-1",
  legalName: "ТОО Miracle Chem",
  taxId: null,
  address: null,
  phone: null,
  email: null,
  bankName: null,
  iban: null,
  bic: null,
  directorName: null,
  accountantName: null,
  signatoryName: null,
  signatoryPosition: null,
  documentFooter: null,
  currency: "KZT",
};

const user = {
  id: "employee-1",
  name: "Тестовый сотрудник",
  email: "employee@miracle-chem.test",
  role: "MANAGER",
  active: true,
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
};

describe("SettingsPage API contracts", () => {
  it("uses PUT for company requisites and PATCH for an existing employee", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const payload = url.endsWith("/admin/users") ? { items: [user] } : company;
      return { ok: true, status: 200, json: async () => payload } as Response;
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<SettingsPage actorRole="ADMIN" />);
    await screen.findByRole("heading", { name: "Команда и реквизиты" });

    fireEvent.click(screen.getByRole("button", { name: "Сохранить реквизиты" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/admin/company-profile"),
      expect.objectContaining({ method: "PUT" }),
    ));

    fireEvent.click(screen.getByRole("button", { name: "Изменить Тестовый сотрудник" }));
    const dialog = await screen.findByRole("dialog", { name: "Доступ: Тестовый сотрудник" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Сохранить" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/admin/users/employee-1"),
      expect.objectContaining({ method: "PATCH" }),
    ));
  });
});
