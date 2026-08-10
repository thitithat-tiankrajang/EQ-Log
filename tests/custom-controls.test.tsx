import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CheckboxControl } from "../src/components/ui/CheckboxControl";
import { SelectControl } from "../src/components/ui/SelectControl";

describe("custom form controls", () => {
  afterEach(cleanup);

  it("exposes checkbox state without rendering a native checkbox", () => {
    const onChange = vi.fn();
    const { container } = render(
      <CheckboxControl checked ariaLabel="Save game" onChange={onChange}>
        Save game
      </CheckboxControl>,
    );

    const checkbox = screen.getByRole("checkbox", { name: "Save game" });
    expect(checkbox).toHaveAttribute("aria-checked", "true");
    expect(container.querySelector('input[type="checkbox"]')).toBeNull();
    fireEvent.click(checkbox);
    expect(onChange).toHaveBeenCalledWith(false);
  });

  it("opens a custom listbox and selects an option", () => {
    const onChange = vi.fn();
    const { container } = render(
      <SelectControl
        ariaLabel="Difficulty"
        value="easy"
        options={[
          { value: "easy", label: "Easy" },
          { value: "hard", label: "Hard" },
        ]}
        onChange={onChange}
      />,
    );

    fireEvent.click(screen.getByRole("combobox", { name: "Difficulty" }));
    fireEvent.click(screen.getByRole("option", { name: "Hard" }));
    expect(onChange).toHaveBeenCalledWith("hard");
    expect(container.querySelector("select")).toBeNull();
  });
});
