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
    expect(screen.getByRole("link", { name: "Public" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Create game" })).toHaveAttribute("href", "#/create");
    expect(navigation.querySelectorAll(":scope > a")).toHaveLength(5);
    expect(screen.getByRole("main")).toHaveAttribute("id", "main-content");
    expect(screen.getByRole("button", { name: "Back" }).closest("header")).toHaveClass(
      "eq-app-header",
    );
    expect(document.querySelector(".eq-page-header .eq-back-button")).toBeNull();
  });
});
