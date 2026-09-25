import { useEffect, useState } from "react";
import { useAuth } from "../../auth";
import {
  listSurvivalLevels,
  listSurvivalAttemptStats,
  startSurvivalPractice,
  type SurvivalLevel,
} from "../../features/survival/repository";
import { navigate } from "../../router";
import { supabase } from "../../supabaseClient";
import poc from "../../../docs/survival-poc-results.json";
import { SurvivalReplayViewer } from "./SurvivalReplayViewer";

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
    if (!supabase || !userId) throw new Error("เชื่อมต่อฐานข้อมูลและเข้าสู่ระบบก่อน");
    if (levels.some((level) => level.season_key === SEASON))
      throw new Error("มีด่านของฤดูกาลนี้อยู่แล้ว จึงไม่เขียนทับการอนุมัติของแอดมิน");
    const rows = poc.levels
      .filter(
        (level) =>
          level.status === "awaiting_admin_approval" &&
          "immediateWinningMoves" in level &&
          level.immediateWinningMoves === 0,
      )
      .slice(0, 10)
      .map((level) => ({
        season_key: SEASON,
        level_no: level.level,
        seed: level.seed,
        reference_key: "endgame-v1",
        sample_policy: level.samplePolicy,
        sample_count: level.trials,
        win_count: level.wins,
        immediate_winning_moves:
          "immediateWinningMoves" in level ? level.immediateWinningMoves : -1,
        shortest_winning_replay_turns: Math.min(
          ...level.winningReplays.map((replay) => replay.actions.length),
        ),
        bot_latency_ms: level.authurDecisionMs,
        winning_replays: level.winningReplays,
        status: "draft",
      }));
    const { error: writeError } = await supabase.from("survival_levels").insert(rows);
    if (writeError) throw writeError;
    await load();
  }

  async function approve(level: SurvivalLevel) {
    if (!supabase || !userId) throw new Error("เข้าสู่ระบบก่อน");
    if (level.winning_replays.length < 3) throw new Error("ต้องมี replay ที่ชนะอย่างน้อย 3 ครั้ง");
    if (level.immediate_winning_moves !== 0 || level.shortest_winning_replay_turns < 5)
      throw new Error("ด่านนี้ต้องไม่มีทางชนะทันที และ replay ทุกตัวอย่างต้องเล่นอย่างน้อย 5 ตา");
    const note = (notes[level.id] ?? level.admin_note).trim();
    if (!note) throw new Error("เขียนเหตุผลที่โจทย์เหมาะกับด่านนี้ก่อนอนุมัติ");
    const { error: writeError } = await supabase
      .from("survival_levels")
      .update({
        status: "approved",
        admin_note: note,
        approved_by: userId,
        approved_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", level.id);
    if (writeError) throw writeError;
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
      <p>
        Authur บนเซิร์ฟเวอร์: กลางเกมตัวอย่าง{" "}
        {poc.serverBenchmark.find((row) => row.name === "midgame")?.wallMs} ms ต่อหมาก;
        ต้องวัดหลายตำแหน่งก่อนตั้งงบ production
      </p>
      <div className="eq-survival-grid">
        {levels
          .filter((level) => level.season_key === SEASON)
          .map((level) => (
            <article
              className={`eq-survival-card${level.status === "approved" ? " is-approved" : ""}`}
              key={level.id}
            >
              <span className="eq-eyebrow">
                ด่าน {level.level_no} · seed {level.seed}
              </span>
              <h3>{level.status === "approved" ? "อนุมัติแล้ว" : "รอตรวจ"}</h3>
              <p>
                ชนะ {level.win_count}/{level.sample_count} ครั้ง (
                {Math.round((level.win_count / level.sample_count) * 100)}%)
              </p>
              <p>
                Authur p50 {level.bot_latency_ms?.p50 ?? "—"} ms · p95{" "}
                {level.bot_latency_ms?.p95 ?? "—"} ms
              </p>
              <p>ตัวอย่าง replay ที่ชนะ {level.winning_replays.length}/3</p>
              <p>
                ชนะในตาแรกได้ {level.immediate_winning_moves} ทาง · replay สั้นสุด{" "}
                {level.shortest_winning_replay_turns} ตา
              </p>
              <p>
                ผู้เล่นจริงช่วงทดลอง: {attemptStats[level.id]?.wins ?? 0}/
                {attemptStats[level.id]?.attempts ?? 0} ชนะ (ข้อมูลยังไม่ยืนยันผลจากเซิร์ฟเวอร์)
              </p>
              <details className="eq-survival-replays">
                <summary>ดู replay ตัวอย่าง</summary>
                {level.winning_replays.map((replay, index) => (
                  <SurvivalReplayViewer
                    key={`${replay.policy}-${replay.trial}-${index}`}
                    replay={replay}
                  />
                ))}
              </details>
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
                {level.status === "draft" && (
                  <button
                    className="eq-button eq-button-primary"
                    type="button"
                    disabled={
                      busy !== null ||
                      level.winning_replays.length < 3 ||
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
