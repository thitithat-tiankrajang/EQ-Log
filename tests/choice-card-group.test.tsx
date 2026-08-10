import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { ChoiceCardGroup } from "../src/components/ui/ChoiceCardGroup";

function Harness() {
  const [value, setValue] = useState("public");
  return (
    <ChoiceCardGroup
      label="Visibility"
      value={value}
      choices={[
        { value: "public", label: "Public", description: "Everyone can watch" },
        { value: "region", label: "Region", description: "Members only" },
      ]}
      onChange={setValue}
    />
  );
}

describe("ChoiceCardGroup", () => {
  it("supports radio-group arrow key selection", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const publicChoice = screen.getByRole("radio", { name: /Public/ });
    const regionChoice = screen.getByRole("radio", { name: /Region/ });
    publicChoice.focus();
    await user.keyboard("{ArrowDown}");
    expect(regionChoice).toHaveFocus();
    expect(regionChoice).toHaveAttribute("aria-checked", "true");
    expect(publicChoice).toHaveAttribute("tabindex", "-1");
  });
});
