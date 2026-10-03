import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./live-shell.css";
import { PreGameShell } from "../../components/pages/pregame/PreGameShell";
import { RankedReadyConfirmation } from "../../components/pages/ranked/RankedStakes";
import { rankedClient } from "../../features/ranked/client";
import type { RankedMatchView } from "../../features/ranked/publicView";
import type { RankedAction } from "../../features/ranked/rules";
import type { Side } from "../../game";
import { useLocale } from "../../i18n/LocaleProvider";
import { navigate } from "../../router";
import { STORAGE_KEYS } from "../../constants/storage";
import type { AnalysisLevel } from "../../bot/engineApi";
import { loadPlayTools, type PlayTool } from "../../playModeTools";
import { analyzeOwnTurn } from "../analysis";
import { concealLocalView } from "../client";
import { WaitingControls } from "../CompatibilityControls";
import type { LiveControl } from "../controls";
import type { LiveGameView } from "../projection";
import { useLiveTileDrag } from "../tileDrag";
import { LivePractice } from "../LivePractice";
import { playTurnCue, useBackgroundTurnSignal, useSoundPreference } from "./attention";
import { computeLiveLayout } from "./layout";
import { LiveGameShell, type ShellHandlers } from "./LiveGameShell";
import { toShellModel, type MatchClient, type ShellModel } from "./model";
import { useLiveMatch } from "./useLiveMatch";
import { useTurnDraft } from "./useTurnDraft";
import { sweepWorkspaces, useLiveWorkspace, type WorkspaceSlot } from "./workspace";
import { useWorkspaceUser } from "./workspaceUser";

const NO_TOOLS: ReadonlySet<PlayTool> = new Set();

/** Viewport size, including the visual viewport on phones (address bar shown or hidden). */
export function useViewport() {
  const read = () => ({
    width: window.visualViewport?.width ?? window.innerWidth,
    height: window.visualViewport?.height ?? window.innerHeight,
  });
  const [size, setSize] = useState(read);
  useEffect(() => {
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() =>
        setSize((current) => {
          const next = read();
          return current.width === next.width && current.height === next.height ? current : next;
        }),
      );
    };
    window.addEventListener("resize", update);
    window.visualViewport?.addEventListener("resize", update);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", update);
      window.visualViewport?.removeEventListener("resize", update);
    };
  }, []);
  return size;
}

function liveClockLine(view: LiveGameView, t: ReturnType<typeof useLocale>["t"]) {
  const minutes = (side: Side) =>
    view.clockPolicy.untimed[side] ? null : Math.round(view.timers[side] / 60);
  const a = minutes("A"),
    b = minutes("B");
  if (a === null && b === null) return t("live.waiting.untimed");
  if (a === b) return t("live.waiting.eachSide", { count: a! });
  const label = (value: number | null) =>
    value === null ? t("live.waiting.untimed") : t("live.waiting.minutes", { count: value });
  return `A ${label(a)} · B ${label(b)}`;
}

/**
 * The live game screen for every online mode — Direct, Hosted, Physical, Pass &
 * Play, Authur, ArchBot, Solo, Stage — and Ranked. It owns data and commands;
 * LiveGameShell owns presentation. Every command is the existing typed client
 * call with unchanged payloads; the recipient projection is the only game data.
 */
export function LiveGameScreen({
  matchId,
  client = rankedClient,
  title,
  ranked = true,
  onOpenReplay,
}: {
  matchId: string;
  client?: MatchClient;
  title?: string;
  ranked?: boolean;
  onOpenReplay?: () => void;
}) {
  const { t } = useLocale();
  const userId = useWorkspaceUser();
  const { match, setMatch, accept, error, setError, now } = useLiveMatch(
    matchId,
    client,
    t("live.errors.open"),
  );
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const [playTools, setPlayTools] = useState<ReadonlySet<PlayTool>>(NO_TOOLS);
  const [botBusy, setBotBusy] = useState(false);
  const [selectedLogId, setSelectedLogId] = useState<string | null>(null);
  const [reviewPhase, setReviewPhase] = useState<"before" | "after">("after");
  const [practice, setPractice] = useState(false);
  const [analysisLevel, setAnalysisLevel] = useState<AnalysisLevel>("quick");
  const [analysis, setAnalysis] = useState<{ running: boolean; result: string | null }>({
    running: false,
    result: null,
  });
  const analysisAbort = useRef<AbortController | null>(null);
  const sound = useSoundPreference();
  const viewport = useViewport();
  const layout = useMemo(() => computeLiveLayout(viewport), [viewport]);
  const live = !ranked && match && "mode" in match ? (match as LiveGameView) : null;

  useEffect(() => sweepWorkspaces(), []);

  const toolMode = live ? String(live.mode) : "";
  useEffect(() => {
    let alive = true;
    setPlayTools(NO_TOOLS);
    if (toolMode)
      void loadPlayTools(toolMode === "stage" ? "authur_strong" : toolMode).then((tools) => {
        if (alive) setPlayTools(tools);
      });
    return () => {
      alive = false;
    };
  }, [toolMode]);

  const inGame = Boolean(match && (match.status === "playing" || match.status === "finished"));
  const model: ShellModel | null = useMemo(
    () => (match && inGame ? toShellModel(match, { ranked, now, playTools, client }) : null),
    [match, inGame, ranked, now, playTools, client],
  );
  const selectedLog =
    [...(match?.logs ?? []), ...(live?.timeline?.lines.flatMap((line) => line.logs) ?? [])].find(
      (log) => log.id === selectedLogId,
    ) ?? null;
  const reviewing = Boolean(selectedLog);
  const canPlay = Boolean(model?.caps.turn.act && !reviewing && !busy);

  // ── Bot turns (Authur on the server, ArchBot on this device): unchanged. ──
  const botId = match?.id;
  const botRevision = match?.revision;
  const shouldRunBot = Boolean(match && "botTurn" in match && match.botTurn && match.yourSide);
  useEffect(() => {
    if (!botId || botRevision === undefined || !shouldRunBot || !client.botTurn) return;
    let alive = true;
    setBotBusy(true);
    void client
      .botTurn(botId, botRevision)
      .then(({ match: next }) => alive && accept(next))
      .catch(
        (cause) => alive && setError(cause instanceof Error ? cause.message : t("live.errors.bot")),
      )
      .finally(() => alive && setBotBusy(false));
    return () => {
      alive = false;
    };
  }, [client, botId, botRevision, shouldRunBot, accept, setError, t]);

  // ── Launch countdown (waiting room): unchanged. ──
  useEffect(() => {
    if (!client.control || !live?.launchAt || !live.canConfigure) return;
    const timer = window.setTimeout(
      () => {
        void client.control!(live.id, live.revision, { kind: "start" })
          .then(({ match: next }) => accept(next))
          .catch((cause) => setError(String(cause)));
      },
      Math.max(0, Date.parse(String(live.launchAt)) - Date.now()),
    );
    return () => window.clearTimeout(timer);
  }, [client, live, accept, setError]);

  // A new revision ends a running analysis and practice, as before.
  useEffect(() => {
    analysisAbort.current?.abort();
    setAnalysis({ running: false, result: null });
    setPractice(false);
  }, [match?.revision]);
  useEffect(() => () => analysisAbort.current?.abort(), []);

  const conceal = useCallback(() => {
    if (!live?.localHandoff) return;
    analysisAbort.current?.abort();
    setAnalysis({ running: false, result: null });
    setPractice(false);
    setMatch(concealLocalView(live));
  }, [live, setMatch]);

  const run = useCallback(
    async (task: () => Promise<{ match: RankedMatchView }>) => {
      if (submitting.current) return;
      submitting.current = true;
      setBusy(true);
      setError(null);
      conceal();
      try {
        const { match: next } = await task();
        accept(next);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : t("live.errors.action"));
        const fresh = await client.read(matchId).catch(() => null);
        if (fresh) accept(fresh.match);
      } finally {
        submitting.current = false;
        setBusy(false);
      }
    },
    [accept, client, conceal, matchId, setError, t],
  );

  // ── Workspace: rack order + Notes (local; Pass & Play memory-only). ──
  const slot: WorkspaceSlot | null = model
    ? model.role === "physical-host"
      ? model.activeSide === "A"
        ? "host:A"
        : "host:B"
      : model.yourSide
    : null;
  const rackIds = useMemo(() => (model?.rack ?? []).map((tile) => tile.id), [model?.rack]);
  const workspace = useLiveWorkspace({
    userId,
    gameId: matchId,
    slot,
    mode: model?.caps.workspace.persistence ?? "none",
    rackIds,
    finished: Boolean(model?.finished),
  });

  const submit = useCallback(
    (action: RankedAction) => {
      if (!match) return;
      void run(() =>
        model?.caps.turn.recordForActiveSide && client.record
          ? client.record(match.id, match.revision, match.activeSide, action)
          : client.action(match.id, match.revision, action),
      );
    },
    [client, match, model?.caps.turn.recordForActiveSide, run],
  );

  const draft = useTurnDraft({
    board: model?.board ?? null,
    rack: model?.rack ?? [],
    order: workspace.order,
    setOrder: workspace.setOrder,
    canPlay,
    turnKey: model?.turnKey ?? "",
    bagCount: model?.bagCount ?? 0,
    onSubmit: submit,
  });
  useLiveTileDrag(Boolean(model?.rackSide && !busy && !reviewing && !model.finished), draft.onDrop);

  // ── Turn transitions: derived from the newest state only; never queued. ──
  const [transitionKey, setTransitionKey] = useState(0);
  const [announcement, setAnnouncement] = useState("");
  const seen = useRef<{ id: string; side: Side; at: number; finished: boolean } | null>(null);
  useEffect(() => {
    if (!model) return;
    const previous = seen.current;
    seen.current = {
      id: model.id,
      side: model.activeSide,
      at: Date.now(),
      finished: model.finished,
    };
    if (!previous || previous.id !== model.id) return;
    if (model.finished && !previous.finished) {
      setAnnouncement(t("live.announce.finished"));
      return;
    }
    if (previous.side === model.activeSide) return;
    setTransitionKey((key) => key + 1);
    const moved = model.lastMove;
    const what = moved
      ? moved.kind === "place"
        ? t("live.announce.placed", {
            name: model.players[moved.side],
            what: moved.expression ?? "",
            count: moved.score,
          })
        : moved.kind === "exchange"
          ? t("live.announce.exchanged", {
              name: model.players[moved.side],
              count: moved.exchangedCount,
            })
          : t("live.announce.passed", { name: model.players[moved.side] })
      : "";
    if (model.turnRole === "active" && model.caps.turn.act) {
      setSelectedLogId(null);
      setAnnouncement(`${what} ${t("live.announce.yourTurn")}`.trim());
      // A fresh observation only: not the catch-up after a sleeping tab.
      if (sound.on && Date.now() - previous.at < 30000) playTurnCue();
    } else
      setAnnouncement(
        `${what} ${t("live.announce.turnOf", { name: model.players[model.activeSide] })}`.trim(),
      );
  }, [model, sound.on, t]);
  useBackgroundTurnSignal(
    Boolean(model && model.turnRole === "active" && model.caps.turn.act),
    t("live.attention.title"),
  );

  async function control(action: LiveControl) {
    if (!match || !client.control) return;
    analysisAbort.current?.abort();
    await run(() => client.control!(match.id, match.revision, action));
  }
  async function leaveBoard(coffee: boolean) {
    if (!match) return;
    analysisAbort.current?.abort();
    setSelectedLogId(null);
    if (live?.localHandoff) setMatch(concealLocalView(live));
    try {
      if (!coffee && live?.canSaveExit && client.control && match.status !== "finished")
        await client.control(match.id, match.revision, { kind: "save-exit" });
      if (coffee) window.localStorage.setItem(STORAGE_KEYS.coffeeRoom, match.id);
      navigate({ kind: ranked ? "ranked" : "arena" });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("live.errors.leave"));
    }
  }
  function analyzeTurn() {
    if (!match) return;
    const controller = new AbortController();
    analysisAbort.current?.abort();
    analysisAbort.current = controller;
    setAnalysis({ running: true, result: null });
    void analyzeOwnTurn(match, controller.signal, {
      level: analysisLevel,
      ...(selectedLog ? { logId: selectedLog.id } : {}),
    })
      .then(({ response }) => {
        if (!controller.signal.aborted)
          setAnalysis({
            running: false,
            result: t("live.tools.result", { type: response.type, count: response.score }),
          });
      })
      .catch((cause) => {
        if (controller.signal.aborted) return;
        setAnalysis({ running: false, result: null });
        setError(cause instanceof Error ? cause.message : t("live.errors.analysis"));
      });
  }

  // Board callbacks must be stable: the board is memoized.
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const onCellClick = useCallback(
    (row: number, col: number) => draftRef.current.onCellClick(row, col),
    [],
  );
  const onCellFocus = useCallback(
    (row: number, col: number) =>
      draftRef.current.setCursor((current) =>
        current?.row === row && current.col === col
          ? current
          : { row, col, dir: current?.dir ?? "right" },
      ),
    [],
  );
  const onEditFace = useCallback((id: string) => draftRef.current.editFace(id), []);

  if (!match)
    return (
      <PreGameShell
        eyebrow={ranked ? "Ranked" : t("live.eyebrow")}
        title={t("live.loading.title")}
        onBack={() => navigate({ kind: ranked ? "ranked" : "arena" })}
      >
        {error ? <p role="alert">{error}</p> : <p role="status">{t("live.loading.body")}</p>}
      </PreGameShell>
    );

  if (match.status === "waiting" || match.status === "matched") {
    const roomActions = (
      <>
        <button
          className="eq-button eq-button-secondary"
          type="button"
          onClick={() => void navigator.clipboard.writeText(window.location.href)}
        >
          {t("live.waiting.copyLink")}
        </button>
        <button
          className="eq-button eq-button-secondary"
          type="button"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void client
              .cancel(match.id)
              .then(() => navigate({ kind: ranked ? "ranked" : "arena" }))
              .catch((cause) =>
                setError(cause instanceof Error ? cause.message : t("live.errors.cancel")),
              )
              .finally(() => setBusy(false));
          }}
        >
          {t("live.waiting.cancel")}
        </button>
      </>
    );
    return (
      <PreGameShell
        eyebrow={ranked ? "Ranked" : t("live.eyebrow")}
        title={title ?? (ranked ? "Ranked match" : (live?.name ?? t("live.eyebrow")))}
        subtitle={`${match.players.A} vs ${match.players.B}`}
        onBack={() => navigate({ kind: ranked ? "ranked" : "arena" })}
        variant="waiting"
      >
        {error && (
          <p className="sync-banner" role="alert">
            {error}
          </p>
        )}
        <div className="pregame-card live-waiting-card">
          <div className="eq-section-heading">
            <div>
              <h2>
                {match.status === "waiting"
                  ? t("live.waiting.forSecond")
                  : t("live.waiting.bothHere")}
              </h2>
              <p>
                {match.status === "waiting"
                  ? t("live.waiting.anyApproved")
                  : t("live.waiting.ready", {
                      a: match.readyBySide.A
                        ? t("live.waiting.isReady")
                        : t("live.waiting.notReady"),
                      b: match.readyBySide.B
                        ? t("live.waiting.isReady")
                        : t("live.waiting.notReady"),
                    })}
              </p>
              <p>
                {live
                  ? liveClockLine(live, t)
                  : t("live.waiting.rankedLine", { count: Math.round(match.timers.A / 60) })}
              </p>
            </div>
          </div>
          {match.status === "matched" &&
            ranked &&
            match.yourSide &&
            !match.readyBySide[match.yourSide] && (
              <RankedReadyConfirmation
                matchId={match.id}
                busy={busy}
                onReady={() => void run(() => client.ready(match.id))}
              />
            )}
          {live && client.control ? (
            <WaitingControls
              key={match.revision}
              match={live}
              busy={busy}
              onAction={(action) => void control(action)}
              onLeave={() => {
                if (live.yourSide && live.readyBySide[live.yourSide])
                  void client.control!(match.id, match.revision, { kind: "ready", ready: false })
                    .then(() => navigate({ kind: "arena" }))
                    .catch((cause) => setError(String(cause)));
                else navigate({ kind: "arena" });
              }}
            >
              {roomActions}
            </WaitingControls>
          ) : (
            <div className="live-tool-actions">{roomActions}</div>
          )}
        </div>
      </PreGameShell>
    );
  }

  if (live?.canHandoff && !live.localConfirmed && match.status !== "finished")
    return (
      <PreGameShell
        eyebrow="Pass & Play"
        title={t("live.handoff.title", { name: match.players[match.activeSide] })}
        onBack={() => navigate({ kind: "arena" })}
      >
        <div className="pregame-card live-handoff-card">
          <div className="eq-section-heading">
            <div>
              <p>{t("live.handoff.concealed")}</p>
              <p>{t("live.handoff.device")}</p>
            </div>
          </div>
          {error && <p role="alert">{error}</p>}
          <div className="live-tool-actions">
            <button
              type="button"
              className="eq-button eq-button-primary"
              disabled={busy || !client.handoff}
              onClick={() =>
                void run(() => client.handoff!(match.id, match.revision, match.activeSide))
              }
            >
              {t("live.handoff.confirm", { name: match.players[match.activeSide] })}
            </button>
          </div>
        </div>
      </PreGameShell>
    );

  if (!model) return null;
  const shownBoard = selectedLog
    ? reviewPhase === "before"
      ? (selectedLog.boardBefore ?? selectedLog.boardAfter)
      : selectedLog.boardAfter
    : model.board;

  const handlers: ShellHandlers = {
    onControl: (action) => void control(action),
    onHosted: (action) =>
      client.administer && void run(() => client.administer!(match.id, match.revision, action)),
    onPhysical: (action) =>
      client.physical && void run(() => client.physical!(match.id, match.revision, action)),
    onSurrender: () => submit({ kind: "resign" }),
    onLeave: (coffee) => void leaveBoard(coffee),
    onOpenReplay: model.finished && !ranked ? onOpenReplay : undefined,
    onSelectLog: (id) => {
      setSelectedLogId(id);
      setReviewPhase("after");
      setPractice(false);
    },
    onReviewPhase: setReviewPhase,
    onPractice: () => setPractice(true),
    onAnalysisLevel: setAnalysisLevel,
    onAnalyze: analyzeTurn,
    onRetryBot: client.botTurn
      ? () => void run(() => client.botTurn!(match.id, match.revision))
      : undefined,
    onCellClick,
    onCellFocus,
    onEditFace,
  };

  return (
    <>
      <LiveGameShell
        model={model}
        layout={layout}
        draft={draft}
        canPlay={canPlay}
        busy={busy}
        error={error}
        review={{ log: selectedLog, phase: reviewPhase }}
        shownBoard={shownBoard}
        workspace={{
          notes: workspace.notes,
          setNotes: workspace.setNotes,
          mode: workspace.persisted,
        }}
        analysis={{ level: analysisLevel, ...analysis }}
        botBusy={botBusy}
        sound={sound}
        transitionKey={transitionKey}
        announcement={announcement}
        handlers={handlers}
      />
      {practice &&
        selectedLog?.rackBefore &&
        selectedLog.boardBefore &&
        selectedLog.side === match.yourSide && (
          <LivePractice
            key={`${match.revision}:${selectedLog.id}`}
            log={selectedLog}
            onClose={() => setPractice(false)}
          />
        )}
    </>
  );
}
