import { useEffect, useState } from "react";
import { AccountChip, useAuth } from "../../../auth";
import { ApplicationShell } from "../../../app/shells/ApplicationShell";
import {
  listSurvivalLevels,
  listMySurvivalWins,
  startSurvivalPractice,
  type SurvivalLevel,
} from "../../../features/survival/repository";
import { navigate } from "../../../router";
import {
  survivalPlaytestSource,
  type SurvivalLevel as PlaytestLevel,
} from "../../../features/survivalPlay/api";
import { survivalLevelRoomId } from "../../../features/survivalPlay/route";

export function SurvivalPage() {
  const { profile, userId } = useAuth();
  const [levels, setLevels] = useState<SurvivalLevel[]>([]);
  const [wonLevels, setWonLevels] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void Promise.all([listSurvivalLevels(), listMySurvivalWins()])
      .then(([loadedLevels, wins]) => {
        setLevels(loadedLevels);
        setWonLevels(wins);
      })
      .catch((cause: Error) => setError(cause.message));
  }, []);

  async function start(level: SurvivalLevel) {
    setBusy(level.level_no);
    setError(null);
    try {
      const roomId = await startSurvivalPractice(
        level,
        profile?.display_name?.trim() || "Player",
        userId,
      );
      navigate({
        kind: "play",
        roomId,
        returnTo: { kind: "home", visibility: "public", section: "live" },
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  }

  return (
    <ApplicationShell
      eyebrow="Survival · MVP"
      title="เอาชนะ Authur ให้ได้"
      description="เริ่มจากสถานการณ์ที่กำหนด สลับตากับ Authur ไปจนเกมจบ และต้องมีคะแนนสุดท้ายสูงกว่าจึงจะชนะ ด่านทดลองยังไม่นับอันดับฤดูกาล"
      actions={<AccountChip />}
    >
      {error && (
        <p className="eq-alert eq-alert-error" role="alert">
          {error}
        </p>
      )}
      <section className="eq-section eq-feature-section" aria-label="Survival levels">
        {levels.filter((level) => level.status === "approved").length === 0 ? (
          <p>ยังไม่มีด่านที่แอดมินอนุมัติ</p>
        ) : (
          <div className="eq-survival-grid">
            {levels
              .filter((level) => level.status === "approved")
              .map((level) => (
                <article className="eq-survival-card" key={level.id}>
                  <span className="eq-eyebrow">ด่าน {level.level_no}</span>
                  <h2>สถานการณ์ #{level.seed}</h2>
                  {wonLevels.has(level.id) && <p>ผ่านด่านแล้ว · คะแนนสุดท้ายชนะ Authur</p>}
                  <p>
                    ผู้เล่นจำลองชนะ {level.win_count}/{level.sample_count}{" "}
                    ครั้งในนโยบายทดสอบที่กำหนด
                  </p>
                  <p>{level.admin_note}</p>
                  <button
                    className="eq-button eq-button-primary"
                    type="button"
                    disabled={busy !== null}
                    onClick={() => void start(level)}
                  >
                    {busy === level.level_no ? "กำลังเตรียมด่าน…" : "ลองเล่นฟรี"}
                  </button>
                </article>
              ))}
          </div>
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
