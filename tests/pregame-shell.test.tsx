import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("../src/auth", () => ({ AccountChip: () => null }));
vi.mock("../src/admin", () => ({ AdminButton: () => null }));

import { PreGameShell } from "../src/components/pages/pregame/PreGameShell";

describe("PreGameShell", () => {
  it("exposes its visual variant to scoped form styles", () => {
    const { container } = render(
      <PreGameShell eyebrow="Create" title="Play vs Aether" visual="glass">
        <p>Form</p>
      </PreGameShell>,
    );

    expect(container.querySelector(".eq-flow-page")).toHaveAttribute("data-visual", "glass");
  });
});
