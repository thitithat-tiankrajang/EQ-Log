import type { NewGameSettings } from "../game";
import type { CreateRoomPolicy } from "../remoteRooms";
import { readSafeArchiveReplay } from "../completedGame/client";
import { supabase } from "../supabaseClient";
import { serverErrorNotice } from "../i18n/serverErrors";
import type { RankedAction } from "../features/ranked/rules";
import type { HostedAction } from "./hostedAdmin";
import type { LiveGameView } from "./projection";
import type { PhysicalAction } from "./physical";
import type { LiveControl } from "./controls";

async function call<T>(body: Record<string, unknown>): Promise<T> {
  if (!supabase) throw new Error("An online account is required.");
  const { data, error } = await supabase.functions.invoke("live-game", { body });
  if (error) {
    const response = error.context;
    const detail = response instanceof Response ? await response.json().catch(() => null) : null;
    const message = detail?.error ?? error.message ?? "Live game unavailable. Reload and retry.";
    throw new Error(serverErrorNotice(message) ?? message);
  }
  return data as T;
}

const pendingIntents = new Map<string, string>();
const handoffs = new Map<string, string>();
const handoffEpochs = new Map<string, number>();
const intentTokens = new Map<string, string>();
const botComputations = new Map<
  string,
  { revision: number; abort: AbortController; promise: Promise<{ match: LiveGameView }> }
>();
const botProposals = new Map<string, unknown>();
function conceal(id: string) {
  handoffs.delete(id);
  handoffEpochs.set(id, (handoffEpochs.get(id) ?? 0) + 1);
}
async function command(
  id: string,
  revision: number,
  operation: string,
  action: unknown,
  suppliedId?: string,
) {
  const key = JSON.stringify([id, revision, operation, action]);
  const commandId = suppliedId ?? pendingIntents.get(key) ?? crypto.randomUUID();
  pendingIntents.set(key, commandId);
  const token = handoffs.get(id) ?? intentTokens.get(commandId);
  if (token) intentTokens.set(commandId, token);
  conceal(id);
  // Keep the same intent and claim on lost acknowledgements. A retry cannot
  // submit a second move or reveal the outgoing rack in a refreshed view.
  const result = await call<{ match: LiveGameView }>({
    operation,
    id,
    revision,
    action,
    commandId,
    ...(token ? { handoffToken: token } : {}),
  });
  pendingIntents.delete(key);
  intentTokens.delete(commandId);
  return result;
}
export function concealLocalView(view: LiveGameView): LiveGameView {
  const publicLog = ({
    rackBefore: _before,
    rackAfter: _after,
    analysisContext: _analysis,
    ...log
  }: LiveGameView["logs"][number]) => log;
  return {
    ...view,
    yourSide: null,
    yourRack: [],
    localConfirmed: false,
    logs: view.logs.map(publicLog),
    ...(view.timeline
      ? {
          timeline: {
            ...view.timeline,
            lines: view.timeline.lines.map((line) => ({ ...line, logs: line.logs.map(publicLog) })),
          },
        }
      : {}),
  };
}

export const liveGameClient = {
  subscribe: (id: string, refresh: () => void) => {
    const channel = supabase
      ?.channel(`game:${id}`, { config: { private: true } })
      .on("broadcast", { event: "commit" }, refresh)
      .subscribe((status) => {
        if (status === "SUBSCRIBED") refresh();
      });
    window.addEventListener("online", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      conceal(id);
      botComputations.get(id)?.abort.abort();
      if (channel) void supabase?.removeChannel(channel);
      window.removeEventListener("online", refresh);
      window.removeEventListener("focus", refresh);
    };
  },
  createStage: (levelId: string, playerName: string, requestId: string) =>
    call<{ id: string }>({ operation: "create-stage", levelId, playerName, requestId }),
  stageAdmin: (action: "import" | "approve" | "seal", levelId?: string, note?: string) =>
    call({ operation: "stage-admin", action, levelId, note }),
  create: (
    settings: NewGameSettings,
    policy: CreateRoomPolicy,
    requestId: string,
    funding?: string,
  ) =>
    call<{ id: string; roomCode: string }>({
      operation: "create",
      settings,
      policy,
      requestId,
      funding,
    }),
  read: async (id: string) => {
    try {
      const epoch = handoffEpochs.get(id);
      const result = await call<{ match: LiveGameView }>({
        operation: "read",
        id,
        handoffToken: handoffs.get(id),
      });
      if (result.match.localHandoff && epoch !== handoffEpochs.get(id))
        result.match = concealLocalView(result.match);
      return result;
    } catch (error) {
      const replay = await readSafeArchiveReplay(id).catch(() => null);
      if (replay)
        window.dispatchEvent(new CustomEvent("eq-lab:archive-replay-ready", { detail: replay }));
      throw error;
    }
  },
  action: (id: string, revision: number, action: RankedAction, commandId?: string) =>
    command(id, revision, "action", action, commandId),
  handoff: async (id: string, revision: number, side: "A" | "B") => {
    const result = await call<{ match: LiveGameView; handoffToken: string }>({
      operation: "handoff",
      id,
      revision,
      side,
    });
    handoffs.set(id, result.handoffToken);
    handoffEpochs.set(id, (handoffEpochs.get(id) ?? 0) + 1);
    return result;
  },
  physical: (id: string, revision: number, action: PhysicalAction) =>
    command(id, revision, "physical", action),
  record: (id: string, revision: number, side: "A" | "B", move: RankedAction) =>
    command(id, revision, "admin", { kind: "record", side, move }),
  administer: (id: string, revision: number, action: HostedAction) =>
    command(id, revision, "admin", action),
  control: (id: string, revision: number, action: LiveControl, commandId?: string) =>
    command(id, revision, "control", action, commandId),
  ready: async (id: string) => {
    const { match } = await liveGameClient.read(id);
    return command(id, match.revision, "control", { kind: "ready", ready: true });
  },
  botTurn: (id: string, revision: number): Promise<{ match: LiveGameView }> => {
    const running = botComputations.get(id);
    if (running?.revision === revision) return running.promise;
    running?.abort.abort();
    const abort = new AbortController();
    const key = `${id}:${revision}`;
    const promise = (async () => {
      const { match } = await liveGameClient.read(id);
      if (match.revision !== revision) return { match };
      if (!match.practiceBot)
        return call<{ match: LiveGameView }>({ operation: "bot-turn", id, revision });
      let proposal = botProposals.get(key);
      if (!proposal) {
        const { createArchBotEngine } = await import("../bot/archbot/client");
        const engine = createArchBotEngine();
        try {
          const answer = await engine.decide({
            key: { roomId: id, revision },
            request: match.practiceBot.request,
            signal: abort.signal,
          });
          proposal = {
            type: answer.decision.type,
            placements: answer.decision.placements,
            exchange: answer.decision.exchange,
          };
          botProposals.set(key, proposal);
        } finally {
          engine.dispose();
        }
      }
      if (abort.signal.aborted) throw new Error("ArchBot turn cancelled.");
      const result = await command(id, revision, "practice-bot", proposal);
      botProposals.delete(key);
      return result;
    })().finally(() => {
      if (botComputations.get(id)?.abort === abort) botComputations.delete(id);
    });
    // A polling refresh shares the ongoing calculation. A lost acknowledgement
    // retries the same in-memory proposal and stable command UUID.
    botComputations.set(id, { revision, abort, promise });
    return promise;
  },
  cancel: (id: string) => call<{ cancelled: boolean }>({ operation: "cancel", id }),
};
