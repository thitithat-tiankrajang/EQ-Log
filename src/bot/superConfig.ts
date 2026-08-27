// ── The Super bot's configuration, fetched, cached and PINNED ────────────────
//
// Three jobs, and the third is the one that is easy to get wrong.
//
//   1. Fetch what the backend says the client-side engine should run
//      (`GET /v1/bot-config`) — the rollout flag, the engine version, the
//      weights version, the weights themselves, and the calibration reference.
//   2. Cache it, so a bot move never costs a config round trip. The weights are
//      a few hundred bytes and change on the order of weeks; fetching them per
//      move would add a network hop to the one path that is supposed to have
//      stopped needing the network.
//   3. PIN it to a game. Once a game has started under `v17`, it plays out
//      under `v17` — even if `v18` ships mid-match, even across a reload, even
//      on a second device.
//
// Why (3) matters more than it looks: a weights change is a change to how the
// bot evaluates a position. A game that switched tables at move 12 was played
// by two different opponents, and no amount of records afterwards can say which
// one made which decision. Pinning is what keeps a finished game reproducible.
//
// The pin lives in the GAME, not in this module's cache — see
// `pinnedVersions()` below and `superEngineVersion`/`superWeightsVersion` on
// `GameState`. A cache is per-tab and per-device; a game is neither.
import { fetchBotConfig, type BotConfigResponse } from "./engineApi";
import { supabase } from "../supabaseClient";

export type SuperConfig = BotConfigResponse;

// v2: entries now carry the user they were fetched FOR. A v1 entry has no
// `userId`, so it is treated as a miss rather than as belonging to whoever is
// signed in now — see `readStorage`.
const CACHE_KEY = "eq-lab:super-config:v2";
/**
 * How long a cached config is used without asking again.
 *
 * Ten minutes is the compromise between the two failure modes. Too short and a
 * player opening five games pays five round trips for a document that did not
 * change. Too long and turning the rollout flag OFF — the thing an operator
 * reaches for when the client-side path misbehaves — takes an hour to reach
 * anybody.
 *
 * A running game is unaffected either way: it holds a pin, not a cache entry.
 */
const CACHE_TTL_MS = 10 * 60 * 1000;

/**
 * A cached config, and WHO it was fetched for.
 *
 * The user id is here because `clientSuperEnabled` is now a per-caller answer:
 * the backend serves `true` to a Champion and `false` to everybody else. A
 * cache holding one user's answer in `localStorage` is a cache that can hand it
 * to the next person who signs in on the same browser — a shared laptop, a
 * demo machine, an account switch — and for the ten minutes of the TTL that
 * general user would be running Super locally on the strength of a Champion's
 * rollout flag.
 *
 * Keeping the id and comparing it turns that into an ordinary cache miss.
 */
type CacheEntry = { fetchedAt: number; userId: string | null; config: SuperConfig };

/** Who is signed in, or `null` when nobody is (or Supabase is not configured).
 *  Read per fetch rather than held, because signing out has to be visible here
 *  immediately. */
async function currentUserId(): Promise<string | null> {
  if (!supabase) return null;
  try {
    const { data } = await supabase.auth.getSession();
    return data.session?.user?.id ?? null;
  } catch {
    // An unreadable session is not a reason to fail a bot turn. It IS a reason
    // not to reuse somebody else's cached answer, and returning `null` here
    // makes every stored entry mismatch, which is the safe direction.
    return null;
  }
}

let memory: CacheEntry | null = null;
let inFlight: Promise<SuperConfig> | null = null;

function readStorage(): CacheEntry | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CacheEntry;
    if (typeof parsed?.fetchedAt !== "number" || !parsed.config?.engineVersion) return null;
    return parsed;
  } catch {
    // Private mode, disabled storage, corrupt entry — all the same answer: no
    // cache. Never a reason to fail a bot turn.
    return null;
  }
}

function writeStorage(entry: CacheEntry): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(entry));
  } catch {
    // Storage is a convenience here, never a requirement.
  }
}

/**
 * Usable: not expired, AND fetched for the person who is asking now.
 *
 * A plain boolean rather than a type predicate on purpose. `entry is CacheEntry`
 * would tell the compiler that a `false` answer means "not a CacheEntry" — but
 * the interesting `false` here is a perfectly well-formed entry belonging to
 * somebody else, which the caller then has to look at in order to evict.
 */
function fresh(entry: CacheEntry | null, userId: string | null): boolean {
  if (!entry) return false;
  if (Date.now() - entry.fetchedAt >= CACHE_TTL_MS) return false;
  // A v1 entry has `undefined` here and can belong to anyone, so it never
  // matches — which is the intended upgrade path, not an oversight.
  return entry.userId === userId;
}

/**
 * The current configuration for NEW games.
 *
 * Never call this for a game already in progress — use `configForGame`, which
 * honours the pin. This one deliberately returns whatever is current, which is
 * the right answer only at the moment a game is about to start.
 */
export async function currentConfig(): Promise<SuperConfig> {
  const userId = await currentUserId();
  memory ??= readStorage();
  if (memory && fresh(memory, userId)) return memory.config;
  // A cached answer belonging to somebody else is not merely unusable, it is
  // the thing that must not survive an account switch. Drop it outright rather
  // than leaving it to expire on its own clock.
  if (memory && memory.userId !== userId) {
    memory = null;
    try {
      localStorage.removeItem(CACHE_KEY);
    } catch {
      // Storage is a convenience here, never a requirement.
    }
  }
  // One fetch, however many callers. Opening a room can ask three times in the
  // same tick (the flag check, the calibration gate, the first turn).
  inFlight ??= fetchBotConfig({})
    .then((config) => {
      const entry = { fetchedAt: Date.now(), userId, config };
      memory = entry;
      writeStorage(entry);
      return config;
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

/**
 * The configuration a GAME must be played under.
 *
 * If the game carries a pin, that pin is honoured — including fetching a
 * weights version that is no longer the default. If it does not (a game created
 * before pinning existed, or one that never started a Super turn), the current
 * config is used and the caller is expected to write the pin onto the game.
 *
 * A pinned version this deployment no longer carries is a REFUSAL, not a
 * fallback: answering with different weights under the pinned version's name is
 * the exact outcome pinning exists to prevent. The caller falls back to the
 * backend engine, which is why that path is still there.
 */
export async function configForGame(pin: {
  engineVersion?: string;
  weightsVersion?: string;
}): Promise<SuperConfig> {
  if (!pin.weightsVersion) return currentConfig();
  const current = await currentConfig();
  if (current.weightsVersion === pin.weightsVersion) return current;
  // A different version than the default: fetch it by name, uncached. This
  // happens once per game per tab and only after a retune has shipped.
  return fetchBotConfig({ weightsVersion: pin.weightsVersion });
}

/** Forget the cache. For tests, and for an operator-facing "reload config"
 *  action that must not require a page refresh. */
export function invalidateConfigCache(): void {
  memory = null;
  inFlight = null;
  try {
    localStorage.removeItem(CACHE_KEY);
  } catch {
    // As above.
  }
}
