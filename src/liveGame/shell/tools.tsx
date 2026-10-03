import { useRef, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, Radio } from "lucide-react";
import { useLocale } from "../../i18n/LocaleProvider";
import type { RankedTurnView } from "../../features/ranked/publicView";
import { ANALYSIS_LEVELS, type AnalysisLevel } from "../../bot/engineApi";
import { HistoryControls } from "../CompatibilityControls";
import { HostedControls } from "../HostedControls";
import { PhysicalControls } from "../PhysicalControls";
import type { HostedAction } from "../hostedAdmin";
import type { LiveControl } from "../controls";
import type { PhysicalAction } from "../physical";
import { moveOf } from "./derive";
import type { ShellModel } from "./model";
import { ToolSection } from "../ToolSection";

export type ReviewState = {
  log: RankedTurnView | null;
  phase: "before" | "after";
};

/**
 * RECORD TOOLS: the Turn Log and review, then — only where the server's
 * capabilities allow them — undo/redo, alternate lines, annotations and a
 * host's score correction. Reviewing never mutates the game.
 */
export function RecordTools({
  model,
  busy,
  review,
  onSelectLog,
  onReviewPhase,
  onPractice,
  onControl,
  onHosted,
}: {
  model: ShellModel;
  busy: boolean;
  review: ReviewState;
  onSelectLog(id: string | null): void;
  onReviewPhase(phase: "before" | "after"): void;
  onPractice(): void;
  onControl(action: LiveControl): void;
  onHosted(action: HostedAction): void;
}) {
  const { t } = useLocale();
  const logs = model.logs;
  const index = review.log ? logs.findIndex((log) => log.id === review.log!.id) : -1;
  return (
    <div className="lg-record">
      {review.log && (
        <section
          className="lg-review"
          aria-label={t("live.record.reviewing", { turn: review.log.turnNumber })}
        >
          <div className="lg-review-head">
            <strong>{t("live.record.reviewing", { turn: review.log.turnNumber })}</strong>
            <button
              type="button"
              className="lg-btn lg-btn-small lg-btn-primary"
              onClick={() => onSelectLog(null)}
            >
              <Radio size={14} aria-hidden="true" /> {t("live.record.backToLive")}
            </button>
          </div>
          <div className="lg-review-row">
            <button
              type="button"
              className="lg-icon-btn"
              aria-label={t("live.record.previous")}
              disabled={index <= 0}
              onClick={() => onSelectLog(logs[Math.max(0, index - 1)]?.id ?? null)}
            >
              <ChevronLeft size={18} aria-hidden="true" />
            </button>
            <div className="lg-segmented" role="group" aria-label={t("live.record.position")}>
              {(["before", "after"] as const).map((phase) => (
                <button
                  key={phase}
                  type="button"
                  aria-pressed={review.phase === phase}
                  onClick={() => onReviewPhase(phase)}
                  disabled={phase === "before" && !review.log!.boardBefore}
                >
                  {t(`live.record.${phase}`)}
                </button>
              ))}
            </div>
            <button
              type="button"
              className="lg-icon-btn"
              aria-label={t("live.record.next")}
              disabled={index < 0 || index >= logs.length - 1}
              onClick={() => onSelectLog(logs[Math.min(logs.length - 1, index + 1)]?.id ?? null)}
            >
              <ChevronRight size={18} aria-hidden="true" />
            </button>
          </div>
          <p className="lg-review-note">
            {review.log.side === model.yourSide
              ? t("live.record.ownRack")
              : t("live.record.closedRack")}
          </p>
          {review.log.note && <p className="lg-review-note">{review.log.note}</p>}
          {model.caps.tools.practice &&
            review.log.side === model.yourSide &&
            review.log.rackBefore && (
              <button type="button" className="lg-btn lg-btn-small" onClick={onPractice}>
                {t("live.record.practice")}
              </button>
            )}
        </section>
      )}
      <section className="lg-log" aria-label={t("live.record.turnLog")}>
        <h3 className="lg-section-title">
          {t("live.record.turnLog")} <small>{t("live.record.turns", { count: logs.length })}</small>
        </h3>
        {logs.length === 0 ? (
          <p className="lg-empty">{t("live.record.noTurns")}</p>
        ) : (
          <ol className="lg-log-list">
            {[...logs].reverse().map((log) => {
              const move = log.action === "end_game" ? null : moveOf(log);
              const what = !move
                ? t("live.record.ended")
                : move.kind === "place"
                  ? `${move.expression ?? t("live.last.placed")} · +${move.score}`
                  : move.kind === "exchange"
                    ? t("live.last.exchanged", { count: move.exchangedCount })
                    : t("live.last.passed");
              return (
                <li key={log.id}>
                  <button
                    type="button"
                    className={`lg-log-row side-${log.side.toLowerCase()}`}
                    aria-current={review.log?.id === log.id ? "true" : undefined}
                    onClick={() => onSelectLog(review.log?.id === log.id ? null : log.id)}
                  >
                    <span className="lg-log-turn">T{log.turnNumber}</span>
                    <i className="lg-side-dot" aria-hidden="true" />
                    <span className="lg-log-who">{model.players[log.side]}</span>
                    <span className="lg-log-what">{what}</span>
                  </button>
                </li>
              );
            })}
          </ol>
        )}
      </section>
      {model.caps.record.history && model.live && (
        <HistoryControls
          key={`${model.revision}:${review.log?.id ?? ""}`}
          match={model.live}
          busy={busy}
          selectedLog={review.log}
          allowBranches={model.caps.record.branches}
          onAction={onControl}
          onSelectLog={onSelectLog}
        />
      )}
      {model.caps.record.correctScore && model.live && (
        <HostedControls match={model.live} busy={busy} onAction={onHosted} />
      )}
    </div>
  );
}

/** Mode-specific: the Physical host's console (both current racks, intake, corrections). */
export function PhysicalConsole({
  model,
  busy,
  onPhysical,
}: {
  model: ShellModel;
  busy: boolean;
  onPhysical(action: PhysicalAction): void;
}) {
  if (!model.caps.record.physicalIntake || !model.live) return null;
  return <PhysicalControls match={model.live} busy={busy} onAction={onPhysical} />;
}

/** GAME TOOLS: thinking aids the mode allows. Analysis reads only this viewer's projection. */
export function GameTools({
  model,
  busy,
  review,
  analysis,
  onAnalysisLevel,
  onAnalyze,
  botBusy,
  onRetryBot,
}: {
  model: ShellModel;
  busy: boolean;
  review: ReviewState;
  analysis: { level: AnalysisLevel; running: boolean; result: string | null };
  onAnalysisLevel(level: AnalysisLevel): void;
  onAnalyze(): void;
  botBusy: boolean;
  onRetryBot?: () => void;
}) {
  const { t } = useLocale();
  const historical = review.log?.side === model.yourSide && Boolean(review.log?.rackBefore);
  const canAnalyze = model.caps.tools.analysis && (model.caps.turn.act || historical);
  return (
    <div className="lg-tools">
      {model.caps.tools.analysis && (
        <ToolSection title={t("live.tools.analysis")}>
          <label className="eq-field">
            {t("live.tools.level")}
            <select
              value={analysis.level}
              onChange={(event) => onAnalysisLevel(event.target.value as AnalysisLevel)}
            >
              {ANALYSIS_LEVELS.map((level) => (
                <option key={level} value={level}>
                  {level === "stage5b64" ? "ArchBot" : level}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="lg-btn lg-btn-primary"
            disabled={busy || analysis.running || !canAnalyze}
            onClick={onAnalyze}
          >
            {analysis.running
              ? t("live.tools.analyzing")
              : historical && review.log
                ? t("live.tools.analyzeHistorical", { turn: review.log.turnNumber })
                : t("live.tools.analyzeTurn")}
          </button>
          {!canAnalyze && <p className="live-tool-note">{t("live.tools.analysisWhen")}</p>}
          {analysis.result && (
            <p className="live-tool-note" role="status">
              {analysis.result}
            </p>
          )}
        </ToolSection>
      )}
      {model.botThinking && onRetryBot && (
        <ToolSection title={t("live.tools.bot")}>
          <p className="live-tool-note" role="status">
            {t(model.bot?.where === "device" ? "live.card.botDevice" : "live.card.botServer")}
          </p>
          <button type="button" className="lg-btn" disabled={busy || botBusy} onClick={onRetryBot}>
            {t("live.tools.retryBot")}
          </button>
        </ToolSection>
      )}
      {!model.caps.tools.analysis && !model.botThinking && (
        <p className="lg-empty">{t("live.tools.none")}</p>
      )}
    </div>
  );
}

export type PanelTab = { id: string; label: string; badge?: string; content: ReactNode };

/** Accessible tabs (arrow keys move between tabs) for secondary panels. */
export function PanelTabs({
  tabs,
  selected,
  onSelect,
  label,
}: {
  tabs: PanelTab[];
  selected: string;
  onSelect(id: string): void;
  label: string;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const current = tabs.find((tab) => tab.id === selected) ?? tabs[0];
  if (!current) return null;
  const onKeyDown = (event: ReactKeyboardEvent, index: number) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    event.stopPropagation();
    const next = tabs[(index + (event.key === "ArrowLeft" ? tabs.length - 1 : 1)) % tabs.length];
    onSelect(next.id);
    listRef.current?.querySelector<HTMLElement>(`[data-tab="${next.id}"]`)?.focus();
  };
  return (
    <div className="lg-tabs">
      <div className="lg-tablist" role="tablist" aria-label={label} ref={listRef}>
        {tabs.map((tab, index) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            id={`lg-tab-${tab.id}`}
            data-tab={tab.id}
            aria-selected={tab.id === current.id}
            aria-controls={`lg-panel-${tab.id}`}
            tabIndex={tab.id === current.id ? 0 : -1}
            onClick={() => onSelect(tab.id)}
            onKeyDown={(event) => onKeyDown(event, index)}
          >
            {tab.label}
            {tab.badge && <span className="lg-tab-badge">{tab.badge}</span>}
          </button>
        ))}
      </div>
      <div
        className="lg-tabpanel"
        role="tabpanel"
        id={`lg-panel-${current.id}`}
        aria-labelledby={`lg-tab-${current.id}`}
      >
        {current.content}
      </div>
    </div>
  );
}
