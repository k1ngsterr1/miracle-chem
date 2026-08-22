import { useState } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Modal } from "./ui.js";

function NestedModalFixture({ onParentClose }: { onParentClose: () => void }) {
  const [nestedOpen, setNestedOpen] = useState(false);
  const submit = vi.fn();

  return (
    <Modal title="Основное окно" onClose={onParentClose} wide>
      <button type="button" onClick={() => setNestedOpen(true)}>Открыть подтверждение</button>
      {nestedOpen ? (
        <Modal title="Подтверждение" onClose={() => setNestedOpen(false)}>
          <form onSubmit={submit}>
            <label><span>Причина отмены</span><textarea required minLength={3} /></label>
            <button type="submit">Подтвердить</button>
          </form>
        </Modal>
      ) : null}
    </Modal>
  );
}

describe("Modal", () => {
  it("renders nested dialogs as body-level layers and closes only the top one", async () => {
    const onParentClose = vi.fn();
    render(<NestedModalFixture onParentClose={onParentClose} />);

    fireEvent.click(screen.getByRole("button", { name: "Открыть подтверждение" }));

    const backdrops = document.querySelectorAll<HTMLElement>("[data-modal-root=\"true\"]");
    expect(backdrops).toHaveLength(2);
    expect(backdrops[0]?.parentElement).toBe(document.body);
    expect(backdrops[1]?.parentElement).toBe(document.body);
    expect(backdrops[0]).toHaveClass("underlay");
    expect(backdrops[1]).not.toHaveClass("underlay");

    fireEvent.click(screen.getByRole("button", { name: "Подтвердить" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Заполните поле «Причина отмены».");

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Подтверждение" })).not.toBeInTheDocument());
    expect(screen.getByRole("dialog", { name: "Основное окно" })).toBeInTheDocument();
    expect(onParentClose).not.toHaveBeenCalled();
  });
});
