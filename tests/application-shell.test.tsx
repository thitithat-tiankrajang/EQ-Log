import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ApplicationShell } from "../src/app/shells/ApplicationShell";

describe("ApplicationShell", () => {
  it("provides landmarks and exactly five primary navigation destinations", () => {
    window.location.hash = "#/public";
    const onBack = vi.fn();
    render(
      <ApplicationShell title="Public" description="Games every member can watch" onBack={onBack}>
        <p>Page content</p>
      </ApplicationShell>,
    );

    expect(screen.getByRole("link", { name: "Skip to content" })).toHaveAttribute(
      "href",
      "#main-content",
    );
    expect(screen.getByRole("heading", { level: 1, name: "Public" })).toBeVisible();
    const navigation = screen.getByRole("navigation", { name: "Primary navigation" });
    expect(navigation).toBeVisible();
    // The live-games lobby belongs to no primary destination.
    expect(navigation.querySelector('[aria-current="page"]')).toBeNull();
    expect(screen.getByRole("link", { name: "Home" })).toHaveAttribute("href", "#/");
    expect(screen.getByRole("link", { name: "Create game" })).toHaveAttribute("href", "#/create");
    expect(navigation.querySelectorAll(":scope > a")).toHaveLength(5);
    expect(screen.getByRole("link", { name: "EQ Lab home" })).toHaveAttribute("href", "#/");
    expect(screen.getByRole("main")).toHaveAttribute("id", "main-content");
    expect(screen.getByRole("button", { name: "Back" }).closest("header")).toHaveClass(
      "eq-page-header",
    );
    expect(document.querySelector(".eq-page-header .eq-back-button")).toBeNull();
  });
});
