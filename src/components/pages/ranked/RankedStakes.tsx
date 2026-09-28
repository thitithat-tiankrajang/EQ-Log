import { useCallback, useEffect, useRef, useState } from "react";
import { RankedRequestError, rankedClient } from "../../../features/ranked/client";
import { rankedPreviewChanges, type RankedStakePreview } from "../../../features/ranked/stakes";
import { useLocale } from "../../../i18n/LocaleProvider";
import type { MessageKey } from "../../../i18n/translate";
import { Sheet } from "../../ui/Sheet";

type Outcome = "win" | "draw" | "loss";
const OUTCOMES: Array<{ key: Outcome; label: MessageKey }> = [
  { key: "win", label: "ranked.confirm.win" },
  { key: "draw", label: "ranked.confirm.draw" },
  { key: "loss", label: "ranked.confirm.loss" },
];

function signed(change: number): string {
  return change > 0 ? `+${change}` : change < 0 ? `−${-change}` : "0";
}

/**
 * The player's own rating consequences, exactly as the server previewed them:
 * the rating now and after each result. The change shown beside each is the
 * server's "after" minus the server's "now", for reading only.
 */
export function RankedStakesSummary({ preview }: { preview: RankedStakePreview }) {
  const { t } = useLocale();
  const changes = rankedPreviewChanges(preview);
  return (
    <div className="ranked-stakes">
      <dl className="ranked-stakes-facts">
        <div>
          <dt>{t("ranked.confirm.opponent")}</dt>
          <dd>
            <strong>{preview.opponent.name}</strong>
            <small>{t("ranked.confirm.clock", { minutes: preview.minutes })}</small>
          </dd>
        </div>
        <div>
          <dt>{t("ranked.confirm.current")}</dt>
          <dd>
            <strong>{preview.rating}</strong>
          </dd>
        </div>
      </dl>
      <h3 className="ranked-stakes-heading">{t("ranked.confirm.outcomes")}</h3>
      <ul className="ranked-stakes-outcomes">
        {OUTCOMES.map(({ key, label }) => (
          <li
            key={key}
            data-outcome={key}
            aria-label={t("ranked.confirm.outcomeLabel", {
              outcome: t(label),
              // Ratings read as written, like the visible text: no digit grouping.
              before: String(preview.rating),
              after: String(preview.after[key]),
              change: signed(changes[key]),
            })}
          >
            <span className="ranked-stakes-outcome" aria-hidden="true">
              {t(label)}
            </span>
            <span className="ranked-stakes-after" aria-hidden="true">
              {preview.rating} → <strong>{preview.after[key]}</strong>
            </span>
            <span
              className={`ranked-stakes-change is-${changes[key] > 0 ? "up" : changes[key] < 0 ? "down" : "even"}`}
              aria-hidden="true"
            >
              {signed(changes[key])}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The two Ranked calls the confirmation makes; the real client by default. */
type StakesClient = Pick<typeof rankedClient, "preview" | "join">;

type JoinState =
  | { step: "loading" }
  | { step: "confirm"; preview: RankedStakePreview; changed: boolean; joining: boolean }
  | { step: "refused"; message: string; preview: RankedStakePreview | null };

/**
 * Joining a waiting Ranked room: the server's preview, then the player's
 * explicit confirmation, then the claim with exactly that preview's basis.
 * If the stakes moved, the new ones replace the old and the player confirms
 * again; nothing is ever claimed without a confirmation of the stakes shown.
 */
export function RankedJoinSheet({
  roomId,
  onClose,
  onJoined,
  client = rankedClient,
}: {
  roomId: string;
  onClose: () => void;
  onJoined: (matchId: string) => void;
  client?: StakesClient;
}) {
  const { t } = useLocale();
  const [state, setState] = useState<JoinState>({ step: "loading" });
  const alive = useRef(true);
  const joining = useRef(false);

  const refusal = useCallback(
    (cause: unknown, preview: RankedStakePreview | null = null) =>
      setState({
        step: "refused",
        message: cause instanceof Error ? cause.message : t("ranked.confirm.failed"),
        preview,
      }),
    [t],
  );

  const load = useCallback(
    (changed: boolean) => {
      setState({ step: "loading" });
      client
        .preview(roomId)
        .then(({ preview }) => {
          if (alive.current) setState({ step: "confirm", preview, changed, joining: false });
        })
        .catch((cause: unknown) => {
          if (alive.current) refusal(cause);
        });
    },
    [client, refusal, roomId],
  );

  useEffect(() => {
    alive.current = true;
    load(false);
    return () => {
      alive.current = false;
    };
  }, [load]);

  function confirm(preview: RankedStakePreview) {
    if (joining.current) return;
    joining.current = true;
    setState({ step: "confirm", preview, changed: false, joining: true });
    client
      .join(roomId, preview.basis)
      .then(({ match }) => {
        if (alive.current) onJoined(match.id);
      })
      .catch((cause: unknown) => {
        if (!alive.current) return;
        if (cause instanceof RankedRequestError && cause.code === "ranked_stakes_changed") {
          // Never claimed: show the new stakes and wait for a new confirmation.
          if (cause.preview)
            setState({ step: "confirm", preview: cause.preview, changed: true, joining: false });
          else load(true);
          return;
        }
        refusal(cause, null);
      })
      .finally(() => {
        joining.current = false;
      });
  }

  const busy = state.step === "confirm" && state.joining;
  return (
    <Sheet
      open
      title={t("ranked.confirm.title")}
      closeLabel={t("ranked.confirm.close")}
      dismissible={!busy}
      onClose={onClose}
    >
      <div className="ranked-confirm" aria-busy={state.step === "loading" || busy}>
        {state.step === "loading" && (
          <p className="ranked-confirm-status" role="status">
            {t("ranked.confirm.loading")}
          </p>
        )}
        {state.step === "refused" && (
          <>
            <p className="eq-alert eq-alert-error" role="alert">
              {state.message}
            </p>
            <div className="ranked-confirm-actions">
              <button className="eq-button" type="button" onClick={onClose}>
                {t("ranked.confirm.close")}
              </button>
            </div>
          </>
        )}
        {state.step === "confirm" && (
          <>
            {state.changed && (
              <p className="eq-alert ranked-confirm-changed" role="alert">
                {t("ranked.confirm.changed")}
              </p>
            )}
            <RankedStakesSummary preview={state.preview} />
            <p className="ranked-confirm-note">{t("ranked.confirm.note")}</p>
            <div className="ranked-confirm-actions">
              <button className="eq-button" type="button" disabled={busy} onClick={onClose}>
                {t("ranked.confirm.cancel")}
              </button>
              <button
                className="eq-button eq-button-primary"
                type="button"
                disabled={busy}
                onClick={() => confirm(state.preview)}
              >
                {busy ? t("ranked.confirm.joining") : t("ranked.confirm.join")}
              </button>
            </div>
          </>
        )}
      </div>
    </Sheet>
  );
}

/**
 * The Ready step of a matched Ranked match: each player sees their own stakes
 * before the clock can start, and Ready is the confirmation. Ready itself is
 * unchanged on the server; the preview is the server's.
 */
export function RankedReadyConfirmation({
  matchId,
  busy,
  onReady,
  client = rankedClient,
}: {
  matchId: string;
  busy: boolean;
  onReady: () => void;
  client?: Pick<StakesClient, "preview">;
}) {
  const { t } = useLocale();
  const [preview, setPreview] = useState<RankedStakePreview | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let alive = true;
    setFailure(null);
    client
      .preview(matchId)
      .then((result) => {
        if (alive) setPreview(result.preview);
      })
      .catch((cause: unknown) => {
        if (alive) setFailure(cause instanceof Error ? cause.message : t("ranked.confirm.failed"));
      });
    return () => {
      alive = false;
    };
  }, [attempt, client, matchId, t]);

  return (
    <section
      className="ranked-ready"
      aria-labelledby="ranked-ready-heading"
      aria-busy={!preview && !failure}
    >
      <h2 id="ranked-ready-heading">{t("ranked.ready.heading")}</h2>
      {preview ? (
        <RankedStakesSummary preview={preview} />
      ) : failure ? (
        <>
          <p className="eq-alert eq-alert-error" role="alert">
            {failure}
          </p>
          <button className="eq-button" type="button" onClick={() => setAttempt((n) => n + 1)}>
            {t("ranked.confirm.retry")}
          </button>
        </>
      ) : (
        <p className="ranked-confirm-status" role="status">
          {t("ranked.ready.loading")}
        </p>
      )}
      <button
        className="eq-button eq-button-primary"
        type="button"
        disabled={busy || !preview}
        onClick={onReady}
      >
        {t("ranked.ready.confirm")}
      </button>
    </section>
  );
}
