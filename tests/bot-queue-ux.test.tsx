// What a player sees while the bot's turn is being computed on a shared server.
//
// The property under test is that "waiting for a CPU" and "thinking" are
// visibly different. A human playing against the bot has no other way to tell a
// busy server from a broken app, and a board that sits still with no
// explanation is the same experience as a crash.
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { BotThinkingCard } from "../src/components/game/BotThinkingCard";

// This suite renders the same card in many states; without this each render
// would be queried against the leftovers of the last one.
afterEach(cleanup);

describe("the bot is queued", () => {
  it("says it is waiting for its turn on the engine, not that it is thinking", () => {
    render(<BotThinkingCard state={{ kind: "queued", position: 1 }} botName="Aether" />);
    expect(screen.getByText(/Aether กำลังรอคิว/)).toBeInTheDocument();
    expect(screen.queryByText(/กำลังคิด/)).not.toBeInTheDocument();
  });

  it("names the number of jobs ahead only when the server gave one", () => {
    const { rerender, container } = render(
      <BotThinkingCard state={{ kind: "queued", position: 3 }} botName="Aether" />,
    );
    expect(screen.getByText("รออีก 2 งานก่อนหน้า")).toBeInTheDocument();

    // No trustworthy position: says it is waiting, and invents nothing.
    rerender(<BotThinkingCard state={{ kind: "queued", position: null }} botName="Aether" />);
    expect(screen.getByText("รอเครื่องว่าง")).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/คิวที่|งานก่อนหน้า/);
  });

  it("draws no progress fraction, because there is nothing to be a fraction of", () => {
    const { container } = render(
      <BotThinkingCard state={{ kind: "queued", position: 2 }} botName="Aether" />,
    );
    const fill = container.querySelector(".bot-thinking-fill");
    expect(fill).toHaveClass("is-indeterminate");
    expect((fill as HTMLElement).style.width).toBe("");
  });

  it("keeps the queued state visually distinct from a live search", () => {
    const { container } = render(
      <BotThinkingCard state={{ kind: "queued", position: 1 }} botName="Aether" />,
    );
    expect(container.querySelector(".bot-thinking-card")).toHaveClass("is-queued");
  });

  it("announces itself politely, so it is not silent to a screen reader", () => {
    render(<BotThinkingCard state={{ kind: "queued", position: 1 }} botName="Aether" />);
    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("aria-live", "polite");
  });
});

describe("the bot is running", () => {
  it("says it is thinking once an engine process actually has it", () => {
    render(<BotThinkingCard state={{ kind: "running", progress: null }} botName="Aether" />);
    expect(screen.getByText(/Aether กำลังคิด/)).toBeInTheDocument();
  });

  it("stays indeterminate until the engine reports its own numbers", () => {
    // The alternative is drawing 0%, which is a figure nobody produced.
    const { container } = render(
      <BotThinkingCard state={{ kind: "running", progress: null }} botName="Aether" />,
    );
    expect(container.querySelector(".bot-thinking-fill")).toHaveClass("is-indeterminate");
    expect(container.querySelector(".bot-thinking-card")).not.toHaveClass("is-queued");
  });

  it("shows the engine's real progress and ETA once they exist", () => {
    const { container } = render(
      <BotThinkingCard
        state={{
          kind: "running",
          progress: {
            phase: "sim",
            percent: 42,
            elapsedMs: 3200,
            etaMs: 4400,
            bestScore: 0,
            detail: "samples=2/4",
          },
        }}
        botName="Aether"
      />,
    );
    const fill = container.querySelector(".bot-thinking-fill") as HTMLElement;
    expect(fill).not.toHaveClass("is-indeterminate");
    expect(fill.style.width).toBe("42%");
    expect(screen.getByText("~5s")).toBeInTheDocument();
    expect(screen.getByText("กำลังจำลองการตอบของคู่แข่ง")).toBeInTheDocument();
  });

  it("shows the same thinking state for a request that has not left yet", () => {
    // "requesting" is a fraction of a second; treating it as thinking avoids a
    // flash of a third card nobody can read.
    render(<BotThinkingCard state={{ kind: "requesting" }} botName="Aether" />);
    expect(screen.getByText(/Aether กำลังคิด/)).toBeInTheDocument();
  });
});

describe("the transition", () => {
  it("moves queued → running → gone without ever going backwards", () => {
    const { rerender, container } = render(
      <BotThinkingCard state={{ kind: "queued", position: 2 }} botName="Aether" />,
    );
    expect(container.querySelector(".bot-thinking-card")).toHaveClass("is-queued");

    rerender(<BotThinkingCard state={{ kind: "running", progress: null }} botName="Aether" />);
    expect(container.querySelector(".bot-thinking-card")).not.toHaveClass("is-queued");
    expect(screen.getByText(/กำลังคิด/)).toBeInTheDocument();

    rerender(
      <BotThinkingCard
        state={{
          kind: "running",
          progress: {
            phase: "endgame",
            percent: 90,
            elapsedMs: 9000,
            etaMs: 100,
            bestScore: 0,
            detail: "",
          },
        }}
        botName="Aether"
      />,
    );
    expect((container.querySelector(".bot-thinking-fill") as HTMLElement).style.width).toBe("90%");
  });
});

describe("what is never shown to a player", () => {
  it("exposes no server internals in any state", () => {
    const states = [
      { kind: "requesting" } as const,
      { kind: "queued", position: 4 } as const,
      { kind: "running", progress: null } as const,
    ];
    for (const state of states) {
      const { container, unmount } = render(<BotThinkingCard state={state} botName="Aether" />);
      const text = container.textContent ?? "";
      for (const leak of ["concurrency", "worker", "amath_cli", "http", "token", "queue_full"]) {
        expect(text.toLowerCase()).not.toContain(leak);
      }
      unmount();
    }
  });
});
