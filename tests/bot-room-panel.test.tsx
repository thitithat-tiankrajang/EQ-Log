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
    render(<BotRoomPanel busy={false} onSubmit={onSubmit} />);

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
});
