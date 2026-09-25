import { lazy, Suspense, useEffect, useState } from "react";
import { Trophy } from "lucide-react";
import { useAuth } from "../../../auth";
import {
  rankedClient,
  type RankedLeaderboardRow,
  type RankedOpenRoom,
  type RankedRating,
} from "../../../features/ranked/client";
import { rankTier } from "../../../features/ranked/rating";
import { navigate } from "../../../router";
import { ApplicationShell } from "../../../app/shells/ApplicationShell";
const RankedMatchPage = lazy(() =>
  import("./RankedMatchPage").then((module) => ({ default: module.RankedMatchPage })),
);

export function RankedPage({ matchId }: { matchId?: string }) {
  const { userId, isApproved } = useAuth();
  const [open, setOpen] = useState<RankedOpenRoom[]>([]);
  const [mine, setMine] = useState<{ id: string; status: string }[]>([]);
  const [leaders, setLeaders] = useState<RankedLeaderboardRow[]>([]);
  const [own, setOwn] = useState<RankedRating | null>(null);
  const [tab, setTab] = useState<"rooms" | "leaderboard">("rooms");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!isApproved || matchId) return;
    let alive = true;
    const refresh = async () => {
      try {
        const [rooms, leaderboard] = await Promise.all([
          rankedClient.list(),
          rankedClient.leaderboard(),
        ]);
        if (alive) {
          setOpen(rooms.open);
          setMine(rooms.mine);
          setLeaders(leaderboard.rows);
          setOwn(leaderboard.own);
          setError(null);
        }
      } catch (cause) {
        if (alive) setError(cause instanceof Error ? cause.message : "โหลดห้องจัดอันดับไม่สำเร็จ");
      }
    };
    void refresh();
    const interval = window.setInterval(() => void refresh(), 8000);
    return () => {
      alive = false;
      window.clearInterval(interval);
    };
  }, [isApproved, matchId]);

  if (!isApproved || !userId)
    return (
      <ApplicationShell title="Ranked">
        <div className="ranked-page">
          <p>ต้องเข้าสู่ระบบด้วยบัญชีที่ได้รับอนุมัติจึงจะเล่นแรงก์ได้</p>
        </div>
      </ApplicationShell>
    );
  if (matchId)
    return (
      <Suspense
        fallback={
          <ApplicationShell title="Ranked">
            <p role="status">กำลังเปิดห้องจัดอันดับ…</p>
          </ApplicationShell>
        }
      >
        <RankedMatchPage key={matchId} matchId={matchId} />
      </Suspense>
    );

  async function join(id: string) {
    setBusy(true);
    setError(null);
    try {
      const { match } = await rankedClient.join(id);
      navigate({ kind: "ranked", matchId: match.id });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "เข้าร่วมห้องไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  return (
    <ApplicationShell title="Ranked">
      <div className="ranked-page">
        <header className="ranked-head">
          <div>
            <span className="eq-eyebrow">
              <Trophy size={16} /> จัดอันดับ
            </span>
            <h2>สนามจัดอันดับ</h2>
            <p>แข่งจริง เบี้ยปิด คะแนนขึ้นลงตามผลแพ้ชนะ</p>
          </div>
          <button
            className="eq-button eq-button-primary"
            type="button"
            onClick={() => navigate({ kind: "create", visibility: "public", preset: "ranked" })}
          >
            สร้างห้องจัดอันดับ
          </button>
        </header>
        {error && (
          <p className="eq-alert eq-alert-error" role="alert">
            {error}
          </p>
        )}
        <div className="ranked-tabs" role="tablist" aria-label="Ranked sections">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "rooms"}
            onClick={() => setTab("rooms")}
          >
            ห้องจัดอันดับ
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "leaderboard"}
            onClick={() => setTab("leaderboard")}
          >
            Leaderboard
          </button>
        </div>
        {tab === "rooms" ? (
          <>
            {mine.length > 0 && (
              <section className="ranked-card">
                <h2>เกมของฉัน</h2>
                <div className="ranked-room-list">
                  {mine.map((room) => (
                    <button
                      key={room.id}
                      type="button"
                      onClick={() => navigate({ kind: "ranked", matchId: room.id })}
                    >
                      เกม {room.id.slice(0, 8)} · {room.status}
                    </button>
                  ))}
                </div>
              </section>
            )}
            <section className="ranked-card">
              <h2>รอคู่แข่ง</h2>
              {open.length === 0 ? (
                <p>ยังไม่มีห้องที่รอผู้เล่น</p>
              ) : (
                <div className="ranked-room-list">
                  {open.map((room) => (
                    <div key={room.id}>
                      <span>
                        {room.creator} · {room.minutesA} นาทีต่อฝ่าย
                      </span>
                      <button
                        type="button"
                        disabled={busy || room.creatorId === userId}
                        onClick={() => void join(room.id)}
                      >
                        เข้าร่วม
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </>
        ) : (
          <section className="ranked-card">
            <h2>Leaderboard</h2>
            <p>
              แรงก์ของคุณ:{" "}
              <strong>
                {rankTier(own?.rating ?? 1000)} · {own?.rating ?? 1000}
              </strong>{" "}
              ({own?.games ?? 0} เกม)
            </p>
            <p>แสดงผู้เล่นที่แข่งครบ 10 เกม เรียงตาม rating</p>
            <ol className="ranked-leaders">
              {leaders.map((row) => (
                <li key={row.player_id}>
                  <span>
                    #{row.place} {row.name}
                  </span>
                  <strong>
                    {rankTier(row.rating)} · {row.rating}
                  </strong>
                  <small>
                    {row.wins}W {row.losses}L {row.draws}D
                  </small>
                </li>
              ))}
            </ol>
          </section>
        )}
      </div>
    </ApplicationShell>
  );
}
