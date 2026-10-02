import { useEffect, useState } from "react";
import { useAuth } from "../../auth";
import {
  listSurvivalLevels,
  listSurvivalAttemptStats,
  sealStageStart,
  startSurvivalPractice,
  type SurvivalLevel,
} from "../../features/survival/repository";
import { navigate } from "../../router";
import { liveGameClient } from "../../liveGame/client";

const SEASON = "2026-09-poc";

export function SurvivalAdminPanel() {
  const { profile, userId } = useAuth();
  const [levels, setLevels] = useState<SurvivalLevel[]>([]);
  const [attemptStats, setAttemptStats] = useState<
    Record<string, { attempts: number; wins: number }>
  >({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      setLevels(await listSurvivalLevels());
      setAttemptStats(await listSurvivalAttemptStats());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }
  useEffect(() => {
    void load();
  }, []);

  async function importDrafts() {
    await liveGameClient.stageAdmin("import");
    await load();
  }

  async function approve(level: SurvivalLevel) {
    const note = (notes[level.id] ?? level.admin_note).trim();
    if (!note) throw new Error("เขียนเหตุผลที่โจทย์เหมาะกับด่านนี้ก่อนอนุมัติ");
    await liveGameClient.stageAdmin("approve", level.id, note);
    await load();
  }

  async function testLevel(level: SurvivalLevel) {
    const roomId = await startSurvivalPractice(
      level,
      profile?.display_name?.trim() || "Admin",
      userId,
    );
    navigate({ kind: "play", roomId });
  }

  async function act(key: string, action: () => Promise<void>) {
    setBusy(key);
    setError(null);
    try {
      await action();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="eq-section eq-feature-section" aria-label="Survival level approval">
      <div className="eq-section-heading eq-section-heading-actions">
        <div>
          <span className="eq-eyebrow">Season {SEASON}</span>
          <h2>คัดด่าน Survival</h2>
          <p>
            เปอร์เซ็นต์มาจากผู้เล่นจำลอง 4 แบบใน 20 รอบตามนโยบายที่กำหนด
            ยังไม่ใช่โอกาสชนะของผู้เล่นจริง แอดมินต้องเล่นและตัดสินความเหมาะสม
          </p>
        </div>
        <button
          className="eq-button eq-button-secondary"
          type="button"
          disabled={busy !== null || levels.some((level) => level.season_key === SEASON)}
          onClick={() => void act("import", importDrafts)}
        >
          นำเข้าด่านทดลอง
        </button>
      </div>
      {error && (
        <p className="eq-alert eq-alert-error" role="alert">
          {error}
        </p>
      )}
      <div className="eq-survival-grid">
        {levels
          .filter((level) => level.season_key === SEASON)
          .map((level) => (
            <article
              className={`eq-survival-card${level.status === "approved" ? " is-approved" : ""}`}
              key={level.id}
            >
              <span className="eq-eyebrow">ด่าน {level.level_no}</span>
              <h3>{level.status === "approved" ? "อนุมัติแล้ว" : "รอตรวจ"}</h3>
              <p>
                ชนะ {level.win_count}/{level.sample_count} ครั้ง (
                {Math.round((level.win_count / level.sample_count) * 100)}%)
              </p>
              <p>
                Authur p50 {level.bot_latency_ms?.p50 ?? "—"} ms · p95{" "}
                {level.bot_latency_ms?.p95 ?? "—"} ms
              </p>
              <p>ตัวอย่าง replay ที่ชนะ {level.winning_replay_count}/3</p>
              <p>
                ชนะในตาแรกได้ {level.immediate_winning_moves} ทาง · replay สั้นสุด{" "}
                {level.shortest_winning_replay_turns} ตา
              </p>
              <p>
                ผู้เล่นจริงช่วงทดลอง: {attemptStats[level.id]?.wins ?? 0}/
                {attemptStats[level.id]?.attempts ?? 0} ชนะ (ข้อมูลยังไม่ยืนยันผลจากเซิร์ฟเวอร์)
              </p>
              <label className="eq-field">
                เหตุผลที่เหมาะกับด่านนี้
                <textarea
                  value={notes[level.id] ?? level.admin_note}
                  onChange={(event) =>
                    setNotes((current) => ({ ...current, [level.id]: event.target.value }))
                  }
                  rows={2}
                />
              </label>
              <div className="eq-page-actions">
                <button
                  className="eq-button eq-button-secondary"
                  type="button"
                  disabled={busy !== null}
                  onClick={() => void act(`test-${level.id}`, () => testLevel(level))}
                >
                  เล่นทดสอบ
                </button>
                {!level.start_sealed_at && (
                  <button
                    className="eq-button eq-button-secondary"
                    type="button"
                    disabled={busy !== null}
                    onClick={() =>
                      void act(`seal-${level.id}`, async () => {
                        await sealStageStart(level);
                        await load();
                      })
                    }
                  >
                    ยืนยันตำแหน่งเริ่มต้น
                  </button>
                )}
                <span className="eq-status" data-testid={`stage-seal-${level.id}`}>
                  {level.start_sealed_at
                    ? "ตำแหน่งเริ่มต้นยืนยันแล้ว"
                    : "ยังไม่ยืนยันตำแหน่งเริ่มต้น"}
                </span>
                {level.status === "draft" && (
                  <button
                    className="eq-button eq-button-primary"
                    type="button"
                    disabled={
                      busy !== null ||
                      level.winning_replay_count < 3 ||
                      level.immediate_winning_moves !== 0 ||
                      level.shortest_winning_replay_turns < 5
                    }
                    onClick={() => void act(`approve-${level.id}`, () => approve(level))}
                  >
                    อนุมัติด่าน
                  </button>
                )}
              </div>
            </article>
          ))}
      </div>
    </section>
  );
}
