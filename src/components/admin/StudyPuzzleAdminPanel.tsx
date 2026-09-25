import { useCallback, useEffect, useRef, useState } from "react";
import { BookOpen, Download, FileText, GraduationCap, RefreshCw } from "lucide-react";
import {
  studyPuzzleSource,
  type AnySet,
  type LegacyMode,
  type SetSummary,
  type StudyPuzzleConfig,
  type StudyPuzzleSource,
  type StudyPuzzleStatus,
} from "../../features/studyPuzzles/api";
import {
  PRESETS,
  StudyPuzzleForm,
  applyPreset,
  defaultStudyConfig,
  randomSeed,
} from "./StudyPuzzleForm";
import { StudyPuzzleJobPanel } from "./StudyPuzzleJobPanel";
import { StudyPuzzleSetView } from "./StudyPuzzleSetView";
import { MODE_LABELS, StudyPuzzleSetViewer } from "./StudyPuzzleSetViewer";
import { MOVE_LABEL_TEXT, STATUS_TEXT } from "./studyPuzzleLabels";
import "./study-puzzles.css";

const messageOf = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));

const setTitle = (set: SetSummary) =>
  set.label || (set.version === 1 ? MODE_LABELS[(set.mode ?? "any") as LegacyMode] : "ชุดโจทย์");

export function StudyPuzzleAdminPanel({
  source = studyPuzzleSource,
}: {
  source?: StudyPuzzleSource;
}) {
  const [status, setStatus] = useState<StudyPuzzleStatus | null>(null);
  // The server exists only in `npm run dev`; a production build has nothing to ask.
  const [unavailable, setUnavailable] = useState<string | null>(
    import.meta.env.DEV ? null : "production",
  );
  const [sets, setSets] = useState<SetSummary[] | null>(null);
  const [config, setConfig] = useState<StudyPuzzleConfig>(() =>
    applyPreset(defaultStudyConfig(), PRESETS[0]!.patch),
  );
  const [preset, setPreset] = useState<string | null>(PRESETS[0]!.key);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openSet, setOpenSet] = useState<AnySet | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  const lastJob = useRef<string | null>(null);
  const viewerRef = useRef<HTMLDivElement | null>(null);

  const refreshStatus = useCallback(async () => {
    try {
      setStatus(await source.status());
      setUnavailable(null);
    } catch (cause) {
      setUnavailable(messageOf(cause));
    }
  }, [source]);

  const refreshSets = useCallback(async () => {
    try {
      setSets(await source.sets());
    } catch (cause) {
      setError(messageOf(cause));
    }
  }, [source]);

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    void refreshStatus();
    void refreshSets();
  }, [refreshStatus, refreshSets]);

  // While a search runs, ask how it is going once a second.
  const job = status?.job ?? null;
  const running = job?.state === "running";
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => void refreshStatus(), 1000);
    return () => clearInterval(timer);
  }, [running, refreshStatus]);

  // A search that has just ended belongs in the archive; the next one gets a fresh seed.
  useEffect(() => {
    const previous = lastJob.current;
    lastJob.current = job ? `${job.id}:${job.state}` : null;
    if (!job || job.state === "running" || previous !== `${job.id}:running`) return;
    void refreshSets();
    if (job.matched > 0) setConfig((current) => ({ ...current, seed: randomSeed() }));
  }, [job, refreshSets]);

  async function generate() {
    setBusy(true);
    setError(null);
    try {
      await source.generate(config);
      await refreshStatus();
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setBusy(false);
    }
  }

  async function stop() {
    setBusy(true);
    setError(null);
    try {
      await source.cancel();
      await refreshStatus();
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setBusy(false);
    }
  }

  async function open(id: string) {
    setOpening(id);
    setError(null);
    try {
      setOpenSet(await source.set(id));
      requestAnimationFrame(() =>
        viewerRef.current?.scrollIntoView?.({ behavior: "smooth", block: "start" }),
      );
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setOpening(null);
    }
  }

  if (unavailable !== null) {
    return (
      <section className="eq-state eq-study-unavailable">
        <BookOpen aria-hidden size={22} />
        <h2>สร้างโจทย์ได้เฉพาะบนเครื่องที่รันเว็บด้วย npm run dev</h2>
        <p>
          ตัวสร้างโจทย์เล่นเกม self-play ด้วย Stage 5B และตรวจด้วยตัวตรวจกติกาจาก amath-engine
          บนเครื่องนี้ จึงยังไม่มีบนเว็บที่ deploy แล้ว เปิดหน้านี้จาก <code>npm run dev</code>{" "}
          โดยมี amath-engine อยู่ข้าง EQ-Lab (หรือตั้ง <code>AMATH_ENGINE_DIR</code>)
        </p>
        {unavailable !== "production" && <p className="eq-study-muted">{unavailable}</p>}
        {import.meta.env.DEV && (
          <button
            className="eq-button eq-button-secondary"
            type="button"
            onClick={() => {
              void refreshStatus();
              void refreshSets();
            }}
          >
            <RefreshCw aria-hidden size={16} /> ลองอีกครั้ง
          </button>
        )}
      </section>
    );
  }

  const engine = status?.engine;
  const canGenerate = Boolean(engine?.ready) && !running && !busy;

  return (
    <div className="eq-study-admin">
      {error && (
        <div className="eq-alert eq-alert-error" role="alert">
          <span>{error}</span>
          <button
            className="eq-button eq-button-secondary"
            type="button"
            onClick={() => setError(null)}
          >
            ปิด
          </button>
        </div>
      )}

      <section className="eq-section eq-study-generate" aria-labelledby="study-generate-title">
        <div className="eq-section-heading">
          <div>
            <span className="eq-eyebrow">Find Best Play</span>
            <h2 id="study-generate-title">สร้างชุดโจทย์</h2>
            <p>
              ใช้กระดานจากเกม self-play แล้วค้นหาชุดเบี้ยตามรูปแบบที่เลือก
              เก็บเฉพาะโจทย์ที่ตาอันดับหนึ่งของ Stage 5B ตรงทุกเงื่อนไข จนได้ครบหรือกดหยุด
            </p>
          </div>
        </div>

        {engine && !engine.ready && (
          <div className="eq-alert eq-alert-error" role="alert">
            <span>ยังสร้างโจทย์ไม่ได้: {engine.problems.join(" · ")}</span>
          </div>
        )}

        <StudyPuzzleForm
          config={config}
          preset={preset}
          canGenerate={canGenerate}
          onChange={(next) => {
            setConfig(next);
            setPreset(null);
          }}
          onPreset={(key) => {
            const chosen = PRESETS.find((item) => item.key === key);
            if (!chosen) return;
            setConfig((current) => applyPreset(current, chosen.patch));
            setPreset(key);
          }}
          onSubmit={() => void generate()}
        />

        {job && (
          <StudyPuzzleJobPanel
            job={job}
            busy={busy}
            onStop={() => void stop()}
            onOpen={(id) => void open(id)}
          />
        )}
      </section>

      <div ref={viewerRef}>
        {openSet?.version === 2 ? (
          <StudyPuzzleSetView set={openSet} source={source} onClose={() => setOpenSet(null)} />
        ) : openSet?.version === 1 ? (
          <StudyPuzzleSetViewer set={openSet} source={source} onClose={() => setOpenSet(null)} />
        ) : (
          <section className="eq-section eq-study-archive" aria-labelledby="study-archive-title">
            <div className="eq-section-heading eq-section-heading-actions">
              <div>
                <span className="eq-eyebrow">Archive</span>
                <h2 id="study-archive-title">คลังชุดโจทย์</h2>
                <p>ทุกชุดที่สร้าง รวมถึงชุดที่หยุดกลางทาง (เก็บข้อที่ได้แล้วไว้ครบ)</p>
              </div>
              <button
                className="eq-button eq-button-secondary"
                type="button"
                onClick={() => void refreshSets()}
              >
                <RefreshCw aria-hidden size={16} /> Refresh
              </button>
            </div>
            {sets === null ? (
              <div className="eq-skeleton-list" role="status" aria-label="กำลังโหลดคลังชุดโจทย์">
                <span />
                <span />
              </div>
            ) : sets.length === 0 ? (
              <div className="eq-state">
                <h3>ยังไม่มีชุดโจทย์</h3>
                <p>สร้างชุดแรกจากด้านบน แล้วจะเก็บไว้ที่นี่</p>
              </div>
            ) : (
              <ul className="eq-study-set-list">
                {sets.map((set) => (
                  <li key={set.id} className="eq-study-set-row">
                    <div>
                      <strong>{setTitle(set)}</strong>
                      <small>
                        {set.version === 1 ? (
                          <span className="eq-study-status is-legacy">v1 · Codex</span>
                        ) : (
                          <span className={`eq-study-status is-${set.status}`}>
                            {STATUS_TEXT[set.status]}
                          </span>
                        )}{" "}
                        {set.count}/{set.requested} ข้อ
                        {set.moveTypes &&
                          set.moveTypes.length > 0 &&
                          ` · ${set.moveTypes.map((type) => MOVE_LABEL_TEXT[type]?.name.split(" · ")[0] ?? type).join(", ")}`}
                        {set.scoreRange &&
                          ` · แต้ม ${set.scoreRange[0]}${set.scoreRange[1] !== set.scoreRange[0] ? `–${set.scoreRange[1]}` : ""}`}
                        {" · "}
                        {new Date(set.createdAt).toLocaleString("th-TH", {
                          dateStyle: "medium",
                          timeStyle: "short",
                        })}
                      </small>
                    </div>
                    <div className="eq-study-set-actions">
                      <button
                        className="eq-button eq-button-primary"
                        type="button"
                        disabled={opening !== null || set.count === 0}
                        onClick={() => void open(set.id)}
                      >
                        <BookOpen aria-hidden size={15} />
                        {opening === set.id ? "กำลังเปิด…" : "ดูโจทย์"}
                      </button>
                      {set.version === 1 && (
                        <>
                          <a
                            className="eq-button eq-button-secondary"
                            href={source.fileUrl(set.id, "student.html")}
                            target="_blank"
                            rel="noreferrer"
                          >
                            <FileText aria-hidden size={15} /> โจทย์
                          </a>
                          <a
                            className="eq-button eq-button-secondary"
                            href={source.fileUrl(set.id, "teacher.html")}
                            target="_blank"
                            rel="noreferrer"
                          >
                            <GraduationCap aria-hidden size={15} /> เฉลย
                          </a>
                          <a
                            className="eq-button eq-button-secondary"
                            href={source.fileUrl(set.id, "puzzles.json")}
                            aria-label={`ดาวน์โหลด JSON ของ ${setTitle(set)}`}
                            download
                          >
                            <Download aria-hidden size={15} /> JSON
                          </a>
                        </>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
