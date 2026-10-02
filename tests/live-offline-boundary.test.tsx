import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const route = vi.hoisted(() => ({ kind: "play", roomId: "offline-game" }));
const legacy = vi.hoisted(() => ({ loaded: vi.fn() }));
vi.mock("../src/router", () => ({ useRoute: () => route }));
vi.mock("../src/supabaseClient", () => ({ supabase: null }));
vi.mock("../src/App", () => {
  legacy.loaded();
  return { default: () => <div>Private local state</div> };
});
vi.mock("../src/app/NonPlayApplication", () => ({ default: () => <div>Local lobby</div> }));
import { AppRoot } from "../src/app/AppRoot";

describe("offline live boundary", () => {
  afterEach(cleanup);
  for (const kind of ["play", "room"]) {
    it(`blocks ${kind} without reading or overwriting saved local data`, () => {
      route.kind = kind;
      window.localStorage.setItem("historic-local-record", "saved record");
      render(<AppRoot />);
      expect(screen.getByText("Online play is required")).toBeInTheDocument();
      expect(legacy.loaded).not.toHaveBeenCalled();
      expect(window.localStorage.getItem("historic-local-record")).toBe("saved record");
    });
  }
});
