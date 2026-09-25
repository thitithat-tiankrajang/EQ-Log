import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/auth", () => ({
  useAuth: () => ({ profile: { display_name: "Ada Lovelace" } }),
}));

import { BotRoomPanel } from "../src/components/pages/pregame/BotRoomPanel";

describe("Aether room setup", () => {
  afterEach(cleanup);

  it("defaults the required player name from the account and still allows editing", () => {
    const onSubmit = vi.fn();
    render(<BotRoomPanel engine="aether" busy={false} onSubmit={onSubmit} />);

    const name = screen.getByRole("textbox", { name: /name/i });
    expect(name).toHaveValue("Ada Lovelace");
    expect(name).toBeRequired();

    fireEvent.change(name, { target: { value: "" } });
    fireEvent.submit(name.closest("form")!);
    expect(onSubmit).not.toHaveBeenCalled();

    fireEvent.change(name, { target: { value: "Grace" } });
    fireEvent.submit(name.closest("form")!);
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ playerA: "Grace" }));
  });

  it("creates an Authur room without pretending it is Aether", () => {
    const onSubmit = vi.fn();
    render(<BotRoomPanel engine="authur" busy={false} onSubmit={onSubmit} />);
    expect(screen.getAllByText("Authur").length).toBeGreaterThan(0);
    expect(screen.queryByRole("radiogroup", { name: "Difficulty" })).not.toBeInTheDocument();
    fireEvent.submit(screen.getByRole("button", { name: "Start Authur match" }).closest("form")!);
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        playerB: "Authur",
        botEngine: "authur",
        botDifficulty: "super",
        tileDrawMode: "play",
      }),
    );
  });
});
