// Test-only: mounts the real Ranked stake confirmation with a scripted client,
// so Playwright can check it on real layouts without a Supabase backend.
// Served by the Vite dev server; never part of the app build.
import { createRoot } from "react-dom/client";
import "../../../src/styles.css";
import {
  RankedJoinSheet,
  RankedReadyConfirmation,
} from "../../../src/components/pages/ranked/RankedStakes";
import { RankedRequestError } from "../../../src/features/ranked/client";
import type { RankedStakePreview } from "../../../src/features/ranked/stakes";
import { LocaleProvider } from "../../../src/i18n/LocaleProvider";
import { chooseLocale } from "../../../src/i18n/locale";

type Recorder = { joins: string[]; ready: number; closed: number; joined: string | null };
declare global {
  interface Window {
    harness: Recorder;
  }
}

const params = new URLSearchParams(window.location.search);
const scenario = params.get("scenario") ?? "join";
if (params.get("lang") === "th") chooseLocale("th");
window.harness = { joins: [], ready: 0, closed: 0, joined: null };

const ROOM = "3f0c1d2e-aaaa-4bbb-8ccc-123456789abc";
const preview: RankedStakePreview = {
  matchId: ROOM,
  opponent: { id: "creator", name: "Nokkaew Srisawat-Phongpanich" },
  minutes: 15,
  rating: 1200,
  after: { win: 1219, draw: 1203, loss: 1188 },
  basis: "rs1:first",
};
const fresh: RankedStakePreview = {
  ...preview,
  rating: 1231,
  after: { win: 1247, draw: 1232, loss: 1214 },
  basis: "rs1:fresh",
};
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const client = {
  preview: async () => {
    await wait(scenario === "ready" ? 400 : 150);
    return { preview };
  },
  join: async (_id: string, basis?: string) => {
    window.harness.joins.push(basis ?? "");
    await wait(150);
    if (scenario === "stale" && window.harness.joins.length === 1) {
      throw new RankedRequestError(
        "ranked_stakes_changed: the stakes for this match have changed",
        "ranked_stakes_changed",
        fresh,
      );
    }
    return { match: { id: ROOM } } as never;
  },
};

function Harness() {
  if (scenario === "ready") {
    return (
      <main className="eq-flow-page" style={{ padding: 16 }}>
        <div className="pregame-card">
          <RankedReadyConfirmation
            matchId={ROOM}
            busy={false}
            client={client}
            onReady={() => {
              window.harness.ready += 1;
            }}
          />
        </div>
      </main>
    );
  }
  return (
    <main>
      <RankedJoinSheet
        roomId={ROOM}
        client={client}
        onClose={() => {
          window.harness.closed += 1;
        }}
        onJoined={(id) => {
          window.harness.joined = id;
        }}
      />
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <LocaleProvider>
    <Harness />
  </LocaleProvider>,
);
