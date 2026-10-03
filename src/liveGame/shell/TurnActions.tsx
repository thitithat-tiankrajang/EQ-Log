import { Check, Repeat2, RotateCcw, SkipForward, X } from "lucide-react";
import { useLocale } from "../../i18n/LocaleProvider";
import { GuardedButton } from "./GuardedButton";
import type { ShellModel } from "./model";
import type { TurnDraft } from "./useTurnDraft";

/**
 * The compact turn controls. There is no Place button: putting a tile on the
 * board is the intent.
 *
 *   no tentative tiles   Exchange · Pass
 *   tentative tiles      Recall · Commit
 *   Exchange chosen      Cancel · Exchange N
 *   Pass chosen          Cancel · Confirm pass
 *
 * Off-turn nothing that changes the game is rendered (absent, not disabled).
 * The group is keyed by turn and every button is a GuardedButton, so a press
 * that began before the controls appeared cannot trigger them — without adding
 * any delay to a press that begins after.
 */
export function TurnActions({
  model,
  draft,
  canPlay,
  busy,
  reviewing,
  onOpenRecorder,
}: {
  model: ShellModel;
  draft: TurnDraft;
  canPlay: boolean;
  busy: boolean;
  reviewing: boolean;
  /** A physical draw is due and this viewer records it: the prompt opens the recorder. */
  onOpenRecorder?: () => void;
}) {
  const { t } = useLocale();
  if (model.finished || model.blocked) return null;
  if (!canPlay) {
    const name = model.players[model.activeSide];
    const text =
      reviewing && model.caps.turn.act
        ? t("live.actions.reviewing")
        : model.paused
          ? t("live.actions.paused")
          : model.awaitingRefill
            ? t("live.actions.awaitingRefill")
            : model.turnRole === "watching"
              ? t("live.actions.watching", { name })
              : busy && model.caps.turn.act
                ? t("live.actions.sending")
                : t("live.actions.thinking", { name });
    if (model.awaitingRefill && model.caps.record.physicalIntake && onOpenRecorder)
      return (
        <div className="lg-actions" role="group" aria-label={t("live.actions.label")}>
          <GuardedButton className="lg-btn lg-btn-primary lg-btn-record" onPress={onOpenRecorder}>
            {text}
          </GuardedButton>
        </div>
      );
    return (
      <div className={`lg-actions is-waiting side-${model.activeSide.toLowerCase()}`} role="status">
        <span className="lg-waiting-dots" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <span>{text}</span>
      </div>
    );
  }
  const recordFor = model.caps.turn.recordForActiveSide
    ? ` · ${t("live.actions.recordFor", { name: model.players[model.activeSide] })}`
    : "";
  const placed = draft.placements.length;
  const reason =
    placed && draft.validation && !draft.validation.isValid
      ? draft.unchosen
        ? t("live.picker.needed")
        : draft.validation.errors[0]
      : null;
  return (
    <div
      className="lg-actions"
      key={model.turnKey}
      data-mode={draft.mode}
      aria-label={t("live.actions.label")}
      role="group"
    >
      {draft.mode === "exchange" ? (
        <>
          <GuardedButton className="lg-btn lg-btn-quiet" onPress={draft.cancelMode}>
            <X size={17} aria-hidden="true" /> {t("live.actions.cancel")}
          </GuardedButton>
          <GuardedButton
            className="lg-btn lg-btn-primary"
            disabled={busy || !draft.exchangeReady}
            onPress={draft.confirmExchange}
          >
            <Repeat2 size={17} aria-hidden="true" />
            {t("live.actions.exchangeN", { count: draft.exchangeIds.length })}
          </GuardedButton>
          <p className="lg-actions-hint">{t("live.actions.exchangeHint")}</p>
        </>
      ) : draft.mode === "pass" ? (
        <>
          <GuardedButton className="lg-btn lg-btn-quiet" onPress={draft.cancelMode}>
            <X size={17} aria-hidden="true" /> {t("live.actions.cancel")}
          </GuardedButton>
          <GuardedButton
            className="lg-btn lg-btn-primary"
            disabled={busy}
            onPress={draft.confirmPass}
          >
            <SkipForward size={17} aria-hidden="true" /> {t("live.actions.confirmPass")}
          </GuardedButton>
        </>
      ) : placed ? (
        <>
          <GuardedButton className="lg-btn lg-btn-quiet" disabled={busy} onPress={draft.recallAll}>
            <RotateCcw size={17} aria-hidden="true" /> {t("live.actions.recall")}
          </GuardedButton>
          <GuardedButton
            className="lg-btn lg-btn-primary lg-btn-commit"
            disabled={busy || !draft.validation?.isValid}
            onPress={draft.commit}
            aria-describedby={reason ? "lg-commit-reason" : undefined}
          >
            <Check size={18} aria-hidden="true" />
            {busy
              ? t("live.actions.committing")
              : draft.validation?.isValid
                ? t("live.actions.commitScore", { count: draft.validation.score })
                : t("live.actions.commit")}
          </GuardedButton>
          {reason && (
            <p className="lg-actions-hint is-invalid" id="lg-commit-reason">
              {reason}
            </p>
          )}
        </>
      ) : (
        <>
          <GuardedButton
            className="lg-btn"
            disabled={busy || !model.caps.turn.exchange || model.bagCount === 0}
            title={!model.caps.turn.exchange ? t("live.actions.exchangeUnavailable") : undefined}
            onPress={draft.startExchange}
          >
            <Repeat2 size={17} aria-hidden="true" /> {t("live.actions.exchange")}
          </GuardedButton>
          <GuardedButton className="lg-btn" disabled={busy} onPress={draft.startPass}>
            <SkipForward size={17} aria-hidden="true" /> {t("live.actions.pass")}
          </GuardedButton>
          {recordFor && <p className="lg-actions-hint">{recordFor.slice(3)}</p>}
        </>
      )}
    </div>
  );
}
