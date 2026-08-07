import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ChevronLeft,
  Folder,
  FolderOpen,
  FolderPlus,
  Play,
  RotateCcw,
  Square,
  Trash2,
  TrendingUp,
  X,
} from "lucide-react";
import {
  closeBotFolder,
  computeFolderStats,
  createBotFolder,
  deleteBotFolder,
  listBotFolders,
  loadFolderGames,
  openBotFolder,
  type BotFolder,
  type BotFolderStats,
  type BotGameRow,
} from "../../botStats";
import { formatWinRate } from "../../stats";
import { ScoreDensityChart } from "./ScoreDensityChart";

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "—";
  }
}

export function BotStatsPanel({ onClose }: { onClose: () => void }) {
  const [folders, setFolders] = useState<BotFolder[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");

  const load = useCallback(async () => {
    try {
      setError(null);
      setFolders(await listBotFolders());
    } catch (err) {
      setError(describeError(err));
      setFolders([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const openFolder = folders?.find((f) => f.isOpen) ?? null;
  const selected = folders?.find((f) => f.id === selectedId) ?? null;

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      await load();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  }

  async function submitCreate() {
    const name = newName.trim();
    if (!name) return;
    await run(async () => {
      await createBotFolder(name, true);
    });
    setNewName("");
    setCreating(false);
  }

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <section
        aria-modal="true"
        className="bstat-modal"
        role="dialog"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="modal-head">
          <div>
            <span className="eyebrow">Admin</span>
            <h2>{selected ? selected.name : "Bot stat folders"}</h2>
          </div>
          <div className="admin-head-actions">
            {!selected && (
              <button className="icon-button" type="button" onClick={() => void load()} disabled={busy}>
                <RotateCcw size={16} />
                Refresh
              </button>
            )}
            <button className="icon-button" type="button" onClick={onClose}>
              <X size={18} />
              Close
            </button>
          </div>
        </header>

        <div className="bstat-body">
          {error && <p className="auth-error">{error}</p>}

          {!selected && (
            <>
              <RecordingBanner openFolder={openFolder} />

              <div className="bstat-toolbar">
                {creating ? (
                  <form
                    className="bstat-create"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void submitCreate();
                    }}
                  >
                    <input
                      autoFocus
                      className="bstat-input"
                      placeholder="Folder name (e.g. Hard bot — Aug batch)"
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                    />
                    <button className="bstat-btn bstat-btn-primary" type="submit" disabled={busy || !newName.trim()}>
                      Create &amp; open
                    </button>
                    <button
                      className="bstat-btn"
                      type="button"
                      onClick={() => {
                        setCreating(false);
                        setNewName("");
                      }}
                    >
                      Cancel
                    </button>
                  </form>
                ) : (
                  <button className="bstat-btn bstat-btn-primary" type="button" onClick={() => setCreating(true)}>
                    <FolderPlus size={16} />
                    New folder
                  </button>
                )}
              </div>

              {folders === null ? (
                <p className="empty-text">Loading…</p>
              ) : folders.length === 0 ? (
                <p className="empty-text">
                  No folders yet. Create one to start collecting bot-play statistics.
                </p>
              ) : (
                <ul className="bstat-grid">
                  {folders.map((folder) => (
                    <FolderCard
                      key={folder.id}
                      folder={folder}
                      busy={busy}
                      onOpenDetail={() => setSelectedId(folder.id)}
                      onToggle={() =>
                        run(async () => {
                          if (folder.isOpen) await closeBotFolder(folder.id);
                          else await openBotFolder(folder.id);
                        })
                      }
                      onDelete={() =>
                        run(async () => {
                          await deleteBotFolder(folder.id);
                        })
                      }
                    />
                  ))}
                </ul>
              )}
            </>
          )}

          {selected && (
            <FolderDetail
              folder={selected}
              busy={busy}
              onBack={() => setSelectedId(null)}
              onToggle={() =>
                run(async () => {
                  if (selected.isOpen) await closeBotFolder(selected.id);
                  else await openBotFolder(selected.id);
                })
              }
            />
          )}
        </div>
      </section>
    </div>
  );
}

function RecordingBanner({ openFolder }: { openFolder: BotFolder | null }) {
  if (openFolder) {
    return (
      <div className="bstat-recording is-live">
        <span className="bstat-live-dot" />
        <span>
          Recording bot games into <strong>{openFolder.name}</strong>
        </span>
      </div>
    );
  }
  return (
    <div className="bstat-recording">
      <span className="bstat-idle-dot" />
      <span>No folder open — finished bot games are not being recorded.</span>
    </div>
  );
}

function FolderCard({
  folder,
  busy,
  onOpenDetail,
  onToggle,
  onDelete,
}: {
  folder: BotFolder;
  busy: boolean;
  onOpenDetail: () => void;
  onToggle: () => void;
  onDelete: () => void;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  return (
    <li className={`bstat-folder ${folder.isOpen ? "is-open" : ""}`}>
      <button className="bstat-folder-face" type="button" onClick={onOpenDetail}>
        <span className="bstat-folder-tab" />
        <span className="bstat-folder-icon">
          {folder.isOpen ? <FolderOpen size={24} /> : <Folder size={24} />}
        </span>
        <span className="bstat-folder-name">{folder.name}</span>
        <span className="bstat-folder-meta">Created {fmtDate(folder.createdAt)}</span>
        {folder.isOpen && (
          <span className="bstat-open-pill">
            <span className="bstat-live-dot" /> Recording
          </span>
        )}
      </button>
      <div className="bstat-folder-actions">
        <button
          className={`bstat-btn ${folder.isOpen ? "bstat-btn-warn" : "bstat-btn-primary"}`}
          type="button"
          disabled={busy}
          onClick={onToggle}
          title={folder.isOpen ? "Stop recording into this folder" : "Make this the active recording folder"}
        >
          {folder.isOpen ? <Square size={14} /> : <Play size={14} />}
          {folder.isOpen ? "Close" : "Open"}
        </button>
        {confirmDelete ? (
          <>
            <button className="bstat-btn bstat-btn-danger" type="button" disabled={busy} onClick={onDelete}>
              Delete?
            </button>
            <button className="bstat-btn" type="button" onClick={() => setConfirmDelete(false)}>
              No
            </button>
          </>
        ) : (
          <button
            className="bstat-btn bstat-btn-ghost"
            type="button"
            disabled={busy}
            onClick={() => setConfirmDelete(true)}
            title="Delete this folder and its records"
          >
            <Trash2 size={14} />
          </button>
        )}
      </div>
    </li>
  );
}

function FolderDetail({
  folder,
  busy,
  onBack,
  onToggle,
}: {
  folder: BotFolder;
  busy: boolean;
  onBack: () => void;
  onToggle: () => void;
}) {
  const [games, setGames] = useState<BotGameRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    loadFolderGames(folder.id)
      .then((rows) => {
        if (active) setGames(rows);
      })
      .catch((err) => {
        if (active) setError(describeError(err));
      });
    return () => {
      active = false;
    };
  }, [folder.id]);

  const stats: BotFolderStats | null = useMemo(
    () => (games ? computeFolderStats(games) : null),
    [games],
  );

  return (
    <div className="bstat-detail">
      <div className="bstat-detail-head">
        <button className="bstat-btn bstat-btn-ghost" type="button" onClick={onBack}>
          <ChevronLeft size={16} /> All folders
        </button>
        <button
          className={`bstat-btn ${folder.isOpen ? "bstat-btn-warn" : "bstat-btn-primary"}`}
          type="button"
          disabled={busy}
          onClick={onToggle}
        >
          {folder.isOpen ? <Square size={14} /> : <Play size={14} />}
          {folder.isOpen ? "Close folder" : "Open folder"}
        </button>
      </div>

      {error && <p className="auth-error">{error}</p>}
      {games === null && <p className="empty-text">Loading games…</p>}

      {stats && stats.games === 0 && (
        <p className="empty-text">
          No games recorded here yet.{" "}
          {folder.isOpen
            ? "This folder is open — the next finished bot game will land here."
            : "Open this folder, then play the bot."}
        </p>
      )}

      {stats && stats.games > 0 && (
        <>
          <div className="bstat-tiles">
            <StatTile label="Games" value={String(stats.games)} />
            <StatTile
              label="Bot win rate"
              value={formatWinRate(stats.winRate)}
              sub={`${stats.wins}W · ${stats.losses}L · ${stats.draws}D`}
              tone="accent"
            />
            <StatTile label="Avg score" value={stats.avgBotScore.toFixed(1)} sub={`vs ${stats.avgOppScore.toFixed(1)}`} />
            <StatTile
              label="Avg margin"
              value={`${stats.avgMargin >= 0 ? "+" : ""}${stats.avgMargin.toFixed(1)}`}
              tone={stats.avgMargin >= 0 ? "accent" : "danger"}
            />
            <StatTile label="Best / worst" value={`${stats.bestScore} / ${stats.worstScore}`} />
            <StatTile label="Std dev" value={stats.scoreStdDev.toFixed(1)} sub={`median ${stats.medianScore}`} />
          </div>

          <section className="bstat-section">
            <h3 className="bstat-section-title">
              <TrendingUp size={15} /> Score density
            </h3>
            <p className="bstat-section-hint">
              How the bot's per-game score is distributed. A long tail means some games ran away from the norm.
            </p>
            <ScoreDensityChart bins={stats.density} mean={stats.avgBotScore} />
          </section>

          {stats.outliers.length > 0 && (
            <div className="bstat-outliers">
              <strong>{stats.outliers.length} outlier game{stats.outliers.length > 1 ? "s" : ""}</strong>
              <span> (≥2σ from the mean of {stats.avgBotScore.toFixed(1)}): </span>
              {stats.outliers.slice(0, 4).map((g) => (
                <span key={g.id} className="bstat-outlier-chip">
                  {g.botScore} vs {g.playerName}
                </span>
              ))}
            </div>
          )}

          <section className="bstat-section">
            <h3 className="bstat-section-title">History · {games?.length ?? 0}</h3>
            <div className="bstat-table-wrap">
              <table className="bstat-table">
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Opponent</th>
                    <th>Diff.</th>
                    <th className="num">Bot</th>
                    <th className="num">Opp</th>
                    <th>Result</th>
                    <th className="num">Turns</th>
                  </tr>
                </thead>
                <tbody>
                  {(games ?? []).map((g) => (
                    <tr key={g.id}>
                      <td>{fmtDate(g.finishedAt ?? g.createdAt)}</td>
                      <td>{g.playerName}</td>
                      <td>{g.botDifficulty ?? "—"}</td>
                      <td className="num">{g.botScore}</td>
                      <td className="num">{g.oppScore}</td>
                      <td>
                        <span className={`bstat-outcome bstat-outcome-${g.outcome}`}>
                          {g.outcome === "bot_win" ? "Bot won" : g.outcome === "bot_loss" ? "Bot lost" : "Draw"}
                        </span>
                      </td>
                      <td className="num">{g.turns}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}

function StatTile({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "accent" | "danger";
}) {
  return (
    <div className={`bstat-tile ${tone ? `tone-${tone}` : ""}`}>
      <span className="bstat-tile-label">{label}</span>
      <span className="bstat-tile-value">{value}</span>
      {sub && <span className="bstat-tile-sub">{sub}</span>}
    </div>
  );
}

function describeError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  if (/relation .*bot_stat|PGRST205|does not exist|schema cache/i.test(message)) {
    return "Bot stats aren't enabled in Supabase yet. Run supabase/bot_stats_migration.sql, then refresh.";
  }
  return message;
}
