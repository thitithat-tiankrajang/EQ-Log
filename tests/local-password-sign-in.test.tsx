import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

const { signInWithPassword } = vi.hoisted(() => ({ signInWithPassword: vi.fn() }));
vi.mock("../src/supabaseClient", () => ({ supabase: { auth: { signInWithPassword } } }));
import LocalPasswordSignIn from "../src/dev/LocalPasswordSignIn";

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe("disposable password sign-in", () => {
  it("submits credentials to Supabase Auth and displays authentication errors without entering the app", async () => {
    signInWithPassword.mockResolvedValue({ error: { message: "Invalid login credentials" } });
    render(<LocalPasswordSignIn />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Local email"), "local@example.test");
    await user.type(screen.getByLabelText("Local password"), "test-only-password");
    await user.click(screen.getByRole("button", { name: "Sign in locally" }));
    expect(signInWithPassword).toHaveBeenCalledWith({
      email: "local@example.test",
      password: "test-only-password",
    });
    expect(await screen.findByRole("alert")).toHaveTextContent("Invalid login credentials");
    expect(screen.getByLabelText("Local password")).toHaveValue("");
  });

  it("prevents duplicate submissions and restores the form after a network failure", async () => {
    let fail!: (error: Error) => void;
    signInWithPassword.mockReturnValue(
      new Promise((_resolve, reject) => {
        fail = reject;
      }),
    );
    render(<LocalPasswordSignIn />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Local email"), "local@example.test");
    await user.type(screen.getByLabelText("Local password"), "test-only-password");
    await user.click(screen.getByRole("button", { name: "Sign in locally" }));
    expect(screen.getByRole("button", { name: "Signing in…" })).toBeDisabled();
    fail(new Error("offline"));
    expect(await screen.findByRole("alert")).toHaveTextContent("Local sign-in failed");
    expect(signInWithPassword).toHaveBeenCalledTimes(1);
  });
});
