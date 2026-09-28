// Test-only: mounts the real Home view with fixed games and bots, so
// Playwright can check its layout on real screens without a Supabase backend.
// Served by the Vite dev server; never part of the app build.
import { createRoot } from "react-dom/client";
import "../../../src/styles.css";
import { AuthProvider } from "../../../src/auth";
import type { ProBotStatus } from "../../../src/bot/catalog";
import { ArenaHomeView } from "../../../src/components/pages/home/ArenaHome";
import { arenaBots, type CatalogBot } from "../../../src/features/arena/arenaBots";
import type { ArenaBots, ArenaGames } from "../../../src/features/arena/useArenaHome";
import { LocaleProvider } from "../../../src/i18n/LocaleProvider";
import { chooseLocale } from "../../../src/i18n/locale";
import type { RoomMeta } from "../../../src/rooms";

type Recorder = { continued: string[]; opened: string[] };
declare global {
  interface Window {
    harness: Recorder;
  }
}

const params = new URLSearchParams(window.location.search);
const scenario = params.get("scenario") ?? "busy";
if (params.get("lang") === "th") chooseLocale("th");
window.harness = { continued: [], opened: [] };

const room = (id: string, overrides: Partial<RoomMeta>): RoomMeta => ({
  id,
  name: id,
  createdAt: "2026-09-28T10:00:00Z",
  updatedAt: "2026-09-28T10:00:00Z",
  playerA: "Ann",
  playerB: "Ben",
  turnNumber: 4,
  scoreA: 40,
  scoreB: 35,
  status: "playing",
  accessScope: "public",
  joinPolicy: "open",
  hasOpponent: true,
  ...overrides,
});

const rooms: RoomMeta[] = [
  room("Evening match with a rather long name that has to wrap on a phone", {
    accessScope: "private",
    updatedAt: "2026-09-28T11:00:00Z",
  }),
  room("Lunch rematch", { status: "draft", accessScope: "region" }),
  room("Open table", { status: "draft", hasOpponent: false, ownerName: "Nokkaew Srisawat" }),
  room("Second open table", { status: "draft", hasOpponent: false, ownerName: "Pim" }),
];
const MINE = new Set([rooms[0].id, rooms[1].id]);

const authur: CatalogBot = {
  bot_key: "authur_strong",
  display_name: "Authur",
  engine_family: "authur",
  difficulty: "super",
  execution_type: "SERVER",
  access_tier: "pro",
  enabled: true,
  new_rooms_allowed: true,
  lifecycle: "active",
  sort_order: 10,
};
// As the Phase 3b migration opens it: free, on the player's device.
const archbot: CatalogBot = {
  ...authur,
  bot_key: "stage5b",
  display_name: "ArchBot",
  engine_family: "stage5b",
  difficulty: "stage5b64",
  execution_type: "CLIENT",
  access_tier: "free",
  sort_order: 20,
};
const probot: ProBotStatus = {
  evaluated_at: "2026-09-28T10:00:00Z",
  plan_key: "pro",
  plan_name: "EQ Pro",
  plan_ends_at: null,
  allowance: { capacity: 5, available: 3, regen_minutes: 30, next_unit_at: null, reason: "ok" },
  weekly: { used: 1, cap: 30, remaining: 29, week_start: "", week_end: "" },
  credits: 2,
  boards: { active: 3, limit: 3 },
};

const SCENARIOS: Record<string, { games: ArenaGames; bots: ArenaBots }> = {
  busy: {
    games: {
      status: "ready",
      rooms,
      ranked: { mine: [{ id: "ranked-1", status: "matched" }], waitingForOpponent: 2 },
    },
    bots: {
      status: "ready",
      bots: arenaBots([authur, archbot], { serverAvailable: true }),
      probot,
    },
  },
  empty: {
    games: { status: "ready", rooms: [], ranked: { mine: [], waitingForOpponent: 0 } },
    bots: {
      status: "ready",
      bots: arenaBots([{ ...authur, enabled: false }], { serverAvailable: true }),
      probot: null,
    },
  },
  loading: { games: { status: "loading" }, bots: { status: "loading" } },
  error: { games: { status: "error" }, bots: { status: "error" } },
};
const { games, bots } = SCENARIOS[scenario] ?? SCENARIOS.busy;

createRoot(document.getElementById("root")!).render(
  <LocaleProvider>
    <AuthProvider>
      <ArenaHomeView
        games={games}
        bots={bots}
        regionAvailable
        roleOf={(r) => (MINE.has(r.id) ? "Player A" : "Spectator")}
        onContinue={(r) => window.harness.continued.push(r.id)}
        onOpenListed={(r) => window.harness.opened.push(r.id)}
        onReloadGames={() => undefined}
        onReloadBots={() => undefined}
        opening={false}
      />
    </AuthProvider>
  </LocaleProvider>,
);
