import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { DateTimePicker } from "./DateTimePicker.js";

function DateTimeHarness() {
  const [value, setValue] = useState("2026-08-16T13:20");
  return <DateTimePicker ariaLabel="Дата и время замеса" value={value} onChange={setValue} />;
}

function DateHarness() {
  const [value, setValue] = useState("2026-08-16");
  return <DateTimePicker mode="date" ariaLabel="Дата поступления" value={value} onChange={setValue} />;
}

describe("DateTimePicker", () => {
  it("uses a localized calendar and preserves time when the day changes", () => {
    render(<DateTimeHarness />);

    const trigger = screen.getByRole("button", { name: "Дата и время замеса" });
    expect(trigger).toHaveTextContent("16.08.2026, 13:20");
    fireEvent.click(trigger);

    expect(screen.getByRole("dialog", { name: "Дата и время замеса" })).toBeInTheDocument();
    expect(screen.getByText("Август 2026")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "17 августа 2026" }));
    expect(trigger).toHaveTextContent("17.08.2026, 13:20");

    fireEvent.click(screen.getByRole("combobox", { name: "Часы" }));
    fireEvent.click(screen.getByRole("option", { name: "14" }));
    expect(trigger).toHaveTextContent("17.08.2026, 14:20");
  });

  it("closes the date-only calendar after choosing a day", () => {
    render(<DateHarness />);

    const trigger = screen.getByRole("button", { name: "Дата поступления" });
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("button", { name: "24 августа 2026" }));

    expect(trigger).toHaveTextContent("24.08.2026");
    expect(screen.queryByRole("dialog", { name: "Дата поступления" })).not.toBeInTheDocument();
  });

  it("closes on Escape and returns focus to the trigger", () => {
    render(<DateTimeHarness />);

    const trigger = screen.getByRole("button", { name: "Дата и время замеса" });
    fireEvent.click(trigger);
    fireEvent.keyDown(document, { key: "Escape" });

    expect(screen.queryByRole("dialog", { name: "Дата и время замеса" })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("keeps the calendar open when Escape only closes a time dropdown", () => {
    render(<DateTimeHarness />);

    fireEvent.click(screen.getByRole("button", { name: "Дата и время замеса" }));
    fireEvent.click(screen.getByRole("combobox", { name: "Часы" }));
    fireEvent.keyDown(screen.getByRole("listbox", { name: "Часы: варианты" }), { key: "Escape" });

    expect(screen.queryByRole("listbox", { name: "Часы: варианты" })).not.toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Дата и время замеса" })).toBeInTheDocument();
  });

  it("exposes the required state to form labels", () => {
    render(<DateTimePicker required ariaLabel="Обязательная дата" value="2026-08-16" onChange={() => undefined} />);

    expect(screen.getByRole("button", { name: "Обязательная дата" })).toHaveAttribute("aria-required", "true");
  });
});
