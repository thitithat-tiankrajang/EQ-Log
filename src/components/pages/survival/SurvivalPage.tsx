import { useEffect, useState } from "react";
import { AccountChip, useAuth } from "../../../auth";
import { ApplicationShell } from "../../../app/shells/ApplicationShell";
import {
  listSurvivalLevels,
  listMySurvivalWins,
  startSurvivalPractice,
  type SurvivalLevel,
} from "../../../features/survival/repository";
import { useLocale } from "../../../i18n/LocaleProvider";
import { navigate } from "../../../router";
import {
  survivalPlaytestSource,
  type SurvivalLevel as PlaytestLevel,
} from "../../../features/survivalPlay/api";
import { survivalLevelRoomId } from "../../../features/survivalPlay/route";

/**
 * Stage: the Arena's set-position challenges against Authur. Presentation
 * only — the levels, the player's recorded wins and the attempt start are the
 * existing ones. An attempt is created by the server (`create_stage_attempt`),
 * which checks the level's sealed start; nothing here decides availability
 * beyond showing that a level's start is not sealed yet.
 */
export function SurvivalPage() {
  const { profile, userId } = useAuth();
  const { t } = useLocale();
  const [levels, setLevels] = useState<SurvivalLevel[]>([]);
  const [wonLevels, setWonLevels] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void Promise.all([listSurvivalLevels(), listMySurvivalWins(userId)])
      .then(([loadedLevels, wins]) => {
        setLevels(loadedLevels);
        setWonLevels(wins);
      })
      .catch((cause: Error) => setError(cause.message));
  }, [userId]);

  async function start(level: SurvivalLevel) {
    setBusy(level.level_no);
    setError(null);
    try {
      const roomId = await startSurvivalPractice(
        level,
        profile?.display_name?.trim() || "Player",
        userId,
      );
      navigate({ kind: "play", roomId, returnTo: { kind: "stage" } });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  }

  const openLevels = levels.filter((level) => level.status === "approved");

  return (
    <ApplicationShell
      title={t("stage.title")}
      description={t("stage.description")}
      routeKey="stage"
      actions={<AccountChip />}
    >
      {error && (
        <p className="eq-alert eq-alert-error" role="alert">
          {error}
        </p>
      )}
      <section className="eq-section eq-feature-section" aria-label={t("stage.listLabel")}>
        <p className="eq-stage-note">{t("stage.unranked")}</p>
        {openLevels.length === 0 ? (
          <p>{t("stage.empty")}</p>
        ) : (
          <ul className="eq-survival-grid" aria-label={t("stage.listLabel")}>
            {openLevels.map((level) => {
              // Only an unsealed start is known to be refused by the server.
              const notReady = level.start_sealed_at === null;
              const won = wonLevels.has(level.id);
              return (
                <li className="eq-survival-card" key={level.id}>
                  <h2>{t("stage.level", { number: level.level_no })}</h2>
                  {won && <p className="eq-stage-won">{t("stage.won")}</p>}
                  {level.admin_note && <p>{level.admin_note}</p>}
                  {notReady ? (
                    <p className="eq-stage-not-ready">{t("stage.notReady")}</p>
                  ) : (
                    <button
                      className="eq-button eq-button-primary"
                      type="button"
                      disabled={busy !== null}
                      aria-label={
                        busy === level.level_no
                          ? undefined
                          : t("stage.play", { number: level.level_no })
                      }
                      onClick={() => void start(level)}
                    >
                      {busy === level.level_no ? t("stage.starting") : t("stage.playShort")}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
      {import.meta.env.DEV && <PlaytestLevels />}
    </ApplicationShell>
  );
}

/**
 * DEV ONLY — the offline playtest levels (tools/survival-generator), played on
 * the Play page against the Survival server the dev server hosts. Absent from
 * production builds.
 */
function PlaytestLevels() {
  const [levels, setLevels] = useState<PlaytestLevel[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    survivalPlaytestSource
      .levels()
      .then(setLevels)
      .catch((cause: Error) => setError(cause.message));
  }, []);
  return (
    <section className="eq-section eq-feature-section" aria-label="Survival playtest levels">
      <h2>ด่านทดลอง · offline</h2>
      {error ? (
        <p className="eq-alert eq-alert-error" role="alert">
          {error}
        </p>
      ) : !levels ? (
        <p>กำลังโหลดด่านทดลอง…</p>
      ) : (
        <div className="eq-survival-grid">
          {levels.map((level) => (
            <article className="eq-survival-card" key={level.id}>
              <span className="eq-eyebrow">ด่านทดลอง {level.number}</span>
              <h2>ตามอยู่ {level.deficit} แต้ม</h2>
              <p>
                คุณ {level.scores.player} : Authur {level.scores.authur} · ตาที่ {level.turnNumber}{" "}
                · เบี้ยในถุง {level.bagRemaining}
              </p>
              <button
                className="eq-button eq-button-primary"
                type="button"
                onClick={() => navigate({ kind: "play", roomId: survivalLevelRoomId(level.id) })}
              >
                เล่นในหน้า Play
              </button>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
