import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RankedStakePreview } from "../src/features/ranked/stakes";

const client = vi.hoisted(() => ({
  list: vi.fn(),
  leaderboard: vi.fn(),
  preview: vi.fn(),
  join: vi.fn(),
  read: vi.fn(),
  ready: vi.fn(),
  cancel: vi.fn(),
  action: vi.fn(),
  create: vi.fn(),
}));
vi.mock("../src/features/ranked/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/features/ranked/client")>()),
  rankedClient: client,
}));
vi.mock("../src/auth", () => ({
  AccountChip: () => null,
  useAuth: () => ({ userId: "me", isApproved: true }),
}));
vi.mock("../src/admin", () => ({ AdminButton: () => null }));

import { RankedPage } from "../src/components/pages/ranked/RankedPage";
import { RankedMatchPage } from "../src/components/pages/ranked/RankedMatchPage";
import { RankedRequestError } from "../src/features/ranked/client";
import { rankedPublicView } from "../src/features/ranked/publicView";
import { createRankedGame } from "../src/features/ranked/rules";
import { LocaleProvider } from "../src/i18n/LocaleProvider";
import { chooseLocale, resetActiveLocale } from "../src/i18n/locale";

const ROOM = "3f0c1d2e-aaaa-4bbb-8ccc-123456789abc";
// Numbers no rating formula would produce from each other: the page can only
// show them if it shows the server's.
const PREVIEW: RankedStakePreview = {
  matchId: ROOM,
  opponent: { id: "creator", name: "Nok" },
  minutes: 15,
  rating: 1200,
  after: { win: 1219, draw: 1203, loss: 1188 },
  basis: "rs1:" + "a".repeat(64),
};
const FRESH: RankedStakePreview = {
  ...PREVIEW,
  rating: 1231,
  after: { win: 1247, draw: 1232, loss: 1214 },
  basis: "rs1:" + "b".repeat(64),
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function renderRanked() {
  return render(
    <LocaleProvider>
      <RankedPage />
    </LocaleProvider>,
  );
}

async function openConfirmation(user: ReturnType<typeof userEvent.setup>) {
  renderRanked();
  const joinButton = await screen.findByRole("button", { name: "เข้าร่วม" });
  await user.click(joinButton);
  return screen.getByRole("dialog", { name: "Join Ranked match" });
}

function outcome(dialog: HTMLElement, name: "Win" | "Draw" | "Loss") {
  return within(dialog).getByRole("listitem", { name: new RegExp(`^${name}:`) });
}

beforeEach(() => {
  window.localStorage.clear();
  resetActiveLocale();
  window.history.replaceState(null, "", "/#/ranked");
  for (const fn of Object.values(client)) fn.mockReset();
  client.list.mockResolvedValue({
    open: [
      {
        id: ROOM,
        creatorId: "creator",
        creator: "Nok",
        minutesA: 15,
        createdAt: "2026-09-28T00:00:00Z",
      },
    ],
    mine: [{ id: "held-match", status: "playing" }],
  });
  client.leaderboard.mockResolvedValue({
    rows: [],
    own: { rating: 1200, games: 12, wins: 6, losses: 5, draws: 1 },
  });
  client.preview.mockResolvedValue({ preview: PREVIEW });
});

afterEach(() => {
  cleanup();
});

describe("joining a waiting Ranked room", () => {
  it("asks the server for the stakes, and shows them before anything is joined", async () => {
    const user = userEvent.setup();
    const dialog = await openConfirmation(user);
    expect(client.preview).toHaveBeenCalledWith(ROOM);
    expect(client.join).not.toHaveBeenCalled();
    await within(dialog).findByText("Nok");
    expect(within(dialog).getByText("15 minutes each")).toBeVisible();
    // Current rating, and each result's rating, exactly as the server sent them.
    expect(within(dialog).getByText("Your rating now").nextSibling).toHaveTextContent("1200");
    expect(outcome(dialog, "Win")).toHaveAccessibleName("Win: 1200 to 1219, +19");
    expect(outcome(dialog, "Draw")).toHaveAccessibleName("Draw: 1200 to 1203, +3");
    expect(outcome(dialog, "Loss")).toHaveAccessibleName("Loss: 1200 to 1188, −12");
    expect(outcome(dialog, "Win")).toHaveTextContent("1200 → 1219+19");
    expect(within(dialog).getByText(/Ranked games change your rating/)).toBeVisible();
    // Nothing the preview did not give.
    expect(dialog.textContent).not.toMatch(/\bEXP\b|\blevel\b|1437/i);
    await act(async () => new Promise((resolve) => setTimeout(resolve, 20)));
    expect(client.join).not.toHaveBeenCalled();
  });

  it("joins only on the explicit confirmation, with exactly the preview's basis, then opens the match", async () => {
    const user = userEvent.setup();
    client.join.mockResolvedValue({ match: { id: ROOM } });
    const dialog = await openConfirmation(user);
    await user.click(await within(dialog).findByRole("button", { name: "Join Ranked" }));
    expect(client.join).toHaveBeenCalledTimes(1);
    expect(client.join).toHaveBeenCalledWith(ROOM, PREVIEW.basis);
    await waitFor(() => expect(window.location.hash).toBe(`#/ranked/${ROOM}`));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("closes on Cancel or Escape without joining, and asks again next time", async () => {
    const user = userEvent.setup();
    let dialog = await openConfirmation(user);
    await within(dialog).findByText("Nok");
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    await user.click(screen.getByRole("button", { name: "เข้าร่วม" }));
    dialog = screen.getByRole("dialog", { name: "Join Ranked match" });
    await within(dialog).findByText("Nok");
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    expect(client.join).not.toHaveBeenCalled();
    // Each opening is a fresh preview, never the old numbers.
    expect(client.preview).toHaveBeenCalledTimes(2);
  });

  it("shows a loading state and allows no second preview while the first is on its way", async () => {
    const user = userEvent.setup();
    const pending = deferred<{ preview: RankedStakePreview }>();
    client.preview.mockReturnValue(pending.promise);
    const dialog = await openConfirmation(user);
    expect(within(dialog).getByRole("status")).toHaveTextContent("Checking the rating at stake…");
    expect(within(dialog).queryByRole("button", { name: "Join Ranked" })).toBeNull();
    // The room's own button is behind the dialog and disabled.
    expect(screen.getByRole("button", { name: "เข้าร่วม", hidden: true })).toBeDisabled();
    expect(client.preview).toHaveBeenCalledTimes(1);
    await act(async () => pending.resolve({ preview: PREVIEW }));
    expect(await within(dialog).findByRole("button", { name: "Join Ranked" })).toBeEnabled();
  });

  it("sends one join however often it is pressed, and cannot be dismissed mid-join", async () => {
    const user = userEvent.setup();
    const pending = deferred<{ match: { id: string } }>();
    client.join.mockReturnValue(pending.promise);
    const dialog = await openConfirmation(user);
    const confirm = await within(dialog).findByRole("button", { name: "Join Ranked" });
    await user.click(confirm);
    expect(within(dialog).getByRole("button", { name: "Joining…" })).toBeDisabled();
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toBeDisabled();
    await user.click(within(dialog).getByRole("button", { name: "Joining…" }));
    await user.keyboard("{Escape}");
    expect(screen.getByRole("dialog")).toBeVisible();
    expect(client.join).toHaveBeenCalledTimes(1);
    await act(async () => pending.resolve({ match: { id: ROOM } }));
    await waitFor(() => expect(window.location.hash).toBe(`#/ranked/${ROOM}`));
  });
});

describe("changed stakes", () => {
  it("replace the numbers, say so, and wait for a new confirmation with the new basis", async () => {
    const user = userEvent.setup();
    client.join
      .mockRejectedValueOnce(
        new RankedRequestError(
          "ranked_stakes_changed: the stakes for this match have changed",
          "ranked_stakes_changed",
          FRESH,
        ),
      )
      .mockResolvedValueOnce({ match: { id: ROOM } });
    const dialog = await openConfirmation(user);
    await user.click(await within(dialog).findByRole("button", { name: "Join Ranked" }));

    expect(
      await within(dialog).findByText(
        "The rating at stake has changed. Check the new numbers and confirm again.",
      ),
    ).toBeVisible();
    expect(outcome(dialog, "Win")).toHaveAccessibleName("Win: 1231 to 1247, +16");
    expect(outcome(dialog, "Draw")).toHaveAccessibleName("Draw: 1231 to 1232, +1");
    expect(outcome(dialog, "Loss")).toHaveAccessibleName("Loss: 1231 to 1214, −17");
    expect(dialog.textContent).not.toMatch(/1219|1188/);
    // No automatic retry.
    await act(async () => new Promise((resolve) => setTimeout(resolve, 20)));
    expect(client.join).toHaveBeenCalledTimes(1);

    await user.click(within(dialog).getByRole("button", { name: "Join Ranked" }));
    expect(client.join).toHaveBeenCalledTimes(2);
    expect(client.join).toHaveBeenLastCalledWith(ROOM, FRESH.basis);
    expect(client.join.mock.calls.filter(([, basis]) => basis === PREVIEW.basis)).toHaveLength(1);
    await waitFor(() => expect(window.location.hash).toBe(`#/ranked/${ROOM}`));
  });

  it("fetch a fresh preview, not a claim, when the refusal carries none", async () => {
    const user = userEvent.setup();
    client.join.mockRejectedValueOnce(
      new RankedRequestError("ranked_stakes_changed: changed", "ranked_stakes_changed", null),
    );
    const dialog = await openConfirmation(user);
    client.preview.mockResolvedValue({ preview: FRESH });
    await user.click(await within(dialog).findByRole("button", { name: "Join Ranked" }));
    await within(dialog).findByText(/rating at stake has changed/);
    expect(client.preview).toHaveBeenCalledTimes(2);
    expect(client.join).toHaveBeenCalledTimes(1);
    expect(outcome(dialog, "Win")).toHaveAccessibleName("Win: 1231 to 1247, +16");
  });
});

describe("refusals", () => {
  it("are explained from the server's code, in the player's language", async () => {
    const user = userEvent.setup();
    client.join.mockRejectedValue(
      new RankedRequestError(
        "ranked_room_unavailable: this room's creator is in another Ranked match",
        "ranked_room_unavailable",
      ),
    );
    let dialog = await openConfirmation(user);
    await user.click(await within(dialog).findByRole("button", { name: "Join Ranked" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "This room's creator is playing another Ranked match right now. Try again later.",
    );
    expect(within(dialog).queryByRole("button", { name: "Join Ranked" })).toBeNull();
    await user.click(within(dialog).getAllByRole("button", { name: "Close" }).at(-1)!);
    cleanup();

    client.join.mockClear();
    chooseLocale("th");
    client.preview.mockRejectedValue(
      new RankedRequestError(
        "ranked_already_active: you are already in an active Ranked match",
        "ranked_already_active",
      ),
    );
    renderRanked();
    await user.click(await screen.findByRole("button", { name: "เข้าร่วม" }));
    dialog = screen.getByRole("dialog", { name: "เข้าร่วมแมตช์จัดอันดับ" });
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "คุณมีแมตช์จัดอันดับที่กำลังเล่นอยู่แล้ว — เล่นให้จบก่อนเข้าร่วมแมตช์ใหม่",
    );
    expect(client.join).not.toHaveBeenCalled();
  });

  it("leave the busy creator's room listed: the list is not the authority", async () => {
    const user = userEvent.setup();
    client.preview.mockRejectedValue(
      new RankedRequestError("ranked_room_unavailable: creator busy", "ranked_room_unavailable"),
    );
    const dialog = await openConfirmation(user);
    await within(dialog).findByRole("alert");
    await user.click(within(dialog).getAllByRole("button", { name: "Close" }).at(-1)!);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByRole("button", { name: "เข้าร่วม" })).toBeEnabled();
  });
});

describe("in Thai", () => {
  it("shows the whole confirmation in Thai", async () => {
    chooseLocale("th");
    const user = userEvent.setup();
    renderRanked();
    await user.click(await screen.findByRole("button", { name: "เข้าร่วม" }));
    const dialog = screen.getByRole("dialog", { name: "เข้าร่วมแมตช์จัดอันดับ" });
    await within(dialog).findByText("Nok");
    expect(within(dialog).getByText("ฝ่ายละ 15 นาที")).toBeVisible();
    expect(within(dialog).getByText("เรตติ้งของคุณตอนนี้")).toBeVisible();
    expect(
      within(dialog).getByRole("listitem", { name: /^ชนะ: จาก 1200 เป็น 1219, \+19$/ }),
    ).toBeVisible();
    expect(within(dialog).getByRole("button", { name: "เข้าร่วมจัดอันดับ" })).toBeEnabled();
    expect(within(dialog).getByRole("button", { name: "ยกเลิก" })).toBeEnabled();
  });
});

describe("matches you already hold", () => {
  it("open straight away, with no preview and no join", async () => {
    const user = userEvent.setup();
    renderRanked();
    await user.click(await screen.findByRole("button", { name: /held-mat/ }));
    await waitFor(() => expect(window.location.hash).toBe("#/ranked/held-match"));
    expect(client.preview).not.toHaveBeenCalled();
    expect(client.join).not.toHaveBeenCalled();
  });
});

describe("the Ready step", () => {
  function matchedView() {
    const game = createRankedGame("creator-id", "Creator", 15, 15, "A");
    game.playerUserIds = { A: "creator-id", B: "joiner-id" };
    game.players.B = "Joiner";
    return { ...rankedPublicView(ROOM, 1, game, "creator-id"), status: "matched" as const };
  }

  it("shows the creator their own stakes, and Ready is the confirmation", async () => {
    const user = userEvent.setup();
    client.read.mockResolvedValue({ match: matchedView() });
    const pending = deferred<{ preview: RankedStakePreview }>();
    client.preview.mockReturnValue(pending.promise);
    client.ready.mockResolvedValue({ match: matchedView() });
    render(
      <LocaleProvider>
        <RankedMatchPage matchId={ROOM} />
      </LocaleProvider>,
    );
    const section = await screen.findByRole("region", { name: "At stake for you" });
    const ready = within(section).getByRole("button", { name: "Ready — play for rating" });
    expect(ready).toBeDisabled();
    expect(client.preview).toHaveBeenCalledWith(ROOM);
    await act(async () =>
      pending.resolve({ preview: { ...PREVIEW, opponent: { id: "joiner-id", name: "Joiner" } } }),
    );
    expect(within(section).getByRole("listitem", { name: /^Loss: 1200 to 1188/ })).toBeVisible();
    expect(client.ready).not.toHaveBeenCalled();
    await user.click(ready);
    expect(client.ready).toHaveBeenCalledWith(ROOM);
  });

  it("offers a retry, and no Ready, when the stakes cannot be loaded", async () => {
    const user = userEvent.setup();
    client.read.mockResolvedValue({ match: matchedView() });
    client.preview.mockRejectedValueOnce(new Error("offline"));
    render(
      <LocaleProvider>
        <RankedMatchPage matchId={ROOM} />
      </LocaleProvider>,
    );
    const section = await screen.findByRole("region", { name: "At stake for you" });
    await within(section).findByRole("alert");
    expect(within(section).getByRole("button", { name: "Ready — play for rating" })).toBeDisabled();
    client.preview.mockResolvedValue({ preview: PREVIEW });
    await user.click(within(section).getByRole("button", { name: "Try again" }));
    await waitFor(() =>
      expect(
        within(section).getByRole("button", { name: "Ready — play for rating" }),
      ).toBeEnabled(),
    );
  });
});

describe("the confirmation code", () => {
  const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
  const sources = [
    "src/components/pages/ranked/RankedStakes.tsx",
    "src/components/pages/ranked/RankedPage.tsx",
    "src/features/ranked/stakes.ts",
  ].map((path) =>
    read(path)
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, ""),
  );

  it("computes no rating: only the server's after minus the server's now", () => {
    for (const source of sources) {
      expect(source).not.toMatch(/10\s*\*\*|Math\.pow|\/\s*400\b|games\s*<\s*10/);
    }
  });

  it("knows no EXP or level", () => {
    for (const source of sources) expect(source).not.toMatch(/\bexp\b|\blevel\b/i);
  });

  it("never joins without a basis from a preview", () => {
    const page = sources[1];
    expect(page).not.toMatch(/rankedClient\.join\(/);
    expect(sources[0]).toMatch(/\.join\(roomId, preview\.basis\)/);
  });
});
