import { useState } from "react";
import { cleanup, render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { AssignmentModal } from "../src/components/modals/AssignmentModal";
import type { TileInstance } from "../src/game";

// The in-game dialogs render inside #root rather than a portal, so they cannot
// reuse Sheet. These assertions are the contract for useDialogBehavior.

const CHOICE_TILE: TileInstance = { id: "tile-choice-1", token: "+/-" } as TileInstance;

function AssignmentHarness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open assignment
      </button>
      {open && (
        <AssignmentModal
          request={{ kind: "place", tile: CHOICE_TILE, row: 7, col: 7 }}
          onCancel={() => setOpen(false)}
          onSelect={() => setOpen(false)}
        />
      )}
    </>
  );
}

// This suite renders the same harness twice; the project does not enable
// Testing Library's global auto-cleanup, so unmount between cases explicitly.
afterEach(cleanup);

describe("in-game dialog behaviour", () => {
  it("names the dialog, moves focus into it, and closes on Escape", async () => {
    const user = userEvent.setup();
    const view = render(<AssignmentHarness />);
    const trigger = view.getByRole("button", { name: "Open assignment" });
    await user.click(trigger);

    const dialog = view.getByRole("dialog", { name: "Choose the tile value" });
    expect(dialog).toBeVisible();
    expect(dialog).toContainElement(document.activeElement as HTMLElement);

    await user.keyboard("{Escape}");
    expect(view.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("keeps Tab inside the dialog", async () => {
    const user = userEvent.setup();
    const view = render(<AssignmentHarness />);
    await user.click(view.getByRole("button", { name: "Open assignment" }));

    const dialog = view.getByRole("dialog");
    // Cycle past the last control; focus must wrap rather than escape to the page.
    for (let index = 0; index < 12; index += 1) {
      await user.tab();
      expect(dialog).toContainElement(document.activeElement as HTMLElement);
    }
  });
});
