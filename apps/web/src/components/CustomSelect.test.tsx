import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { CustomSelect } from "./CustomSelect.js";

const OPTIONS = [
  { value: "line-1", label: "БСУ №1", description: "60 м³/ч" },
  { value: "line-2", label: "БСУ №2", description: "80 м³/ч" },
  { value: "service", label: "На обслуживании", disabled: true },
];

function SelectHarness() {
  const [value, setValue] = useState("line-1");
  return <CustomSelect ariaLabel="Производственная линия" value={value} options={OPTIONS} onChange={setValue} />;
}

describe("CustomSelect", () => {
  it("opens a custom listbox and selects an option", () => {
    render(<SelectHarness />);

    const trigger = screen.getByRole("combobox", { name: "Производственная линия" });
    expect(trigger).toHaveTextContent("БСУ №1");
    fireEvent.click(trigger);

    expect(screen.getByRole("listbox", { name: "Производственная линия: варианты" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "БСУ №1 60 м³/ч" })).toHaveAttribute("aria-selected", "true");
    fireEvent.click(screen.getByRole("option", { name: "БСУ №2 80 м³/ч" }));

    expect(trigger).toHaveTextContent("БСУ №2");
    expect(screen.queryByRole("listbox", { name: "Производственная линия: варианты" })).not.toBeInTheDocument();
  });

  it("supports arrow-key selection and skips disabled options", () => {
    render(<SelectHarness />);

    const trigger = screen.getByRole("combobox", { name: "Производственная линия" });
    fireEvent.keyDown(trigger, { key: "ArrowUp" });
    const listbox = screen.getByRole("listbox", { name: "Производственная линия: варианты" });
    fireEvent.keyDown(listbox, { key: "Enter" });

    expect(trigger).toHaveTextContent("БСУ №2");
  });

  it("closes on Escape without changing the value", () => {
    render(<SelectHarness />);

    const trigger = screen.getByRole("combobox", { name: "Производственная линия" });
    fireEvent.click(trigger);
    fireEvent.keyDown(screen.getByRole("listbox"), { key: "Escape" });

    expect(trigger).toHaveTextContent("БСУ №1");
    expect(trigger).toHaveFocus();
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });
});
