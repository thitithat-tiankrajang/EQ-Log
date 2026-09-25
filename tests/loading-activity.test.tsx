import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GlobalActivity } from "../src/components/feedback/LoadingActivity";

describe("background activity", () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("keeps routine background work quiet and only reports a long sync", () => {
    vi.useFakeTimers();
    render(<GlobalActivity foreground={null} syncing />);
    act(() => vi.advanceTimersByTime(1_500));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    act(() => vi.advanceTimersByTime(4_500));
    expect(screen.getByRole("status")).toHaveTextContent("Syncing…");
    expect(screen.queryByText("Saving changes...")).not.toBeInTheDocument();
  });

  it("does not show a late status after a short sync finishes", () => {
    vi.useFakeTimers();
    const { rerender } = render(<GlobalActivity foreground={null} syncing />);
    act(() => vi.advanceTimersByTime(1_500));
    rerender(<GlobalActivity foreground={null} syncing={false} />);
    act(() => vi.advanceTimersByTime(6_000));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("still shows a failure when background work fails", () => {
    render(<GlobalActivity foreground={null} syncing={false} error="Connection lost" />);
    expect(screen.getByRole("alert")).toHaveTextContent("Connection lost");
  });
});
