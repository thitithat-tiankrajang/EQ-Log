import { useEffect, useRef, useState } from "react";
import {
  changeMySavedGame,
  getSavedUsage,
  listMySavedGames,
  type SavedItem,
  type SavedState,
  type SavedUsage,
} from "../../../features/gameRecords/saved";

export function SavedSection({ userId, revision }: { userId: string | null; revision: number }) {
  const currentUser = useRef(userId);
  currentUser.current = userId;
  const [tab, setTab] = useState<SavedState>("active");
  const currentTab = useRef(tab);
  currentTab.current = tab;
  const [items, setItems] = useState<SavedItem[]>([]);
  const [usage, setUsage] = useState<SavedUsage | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mutating, setMutating] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    setItems([]);
    setCursor(null);
    setUsage(null);
    setError(null);
    if (!userId)
      return () => {
        active = false;
      };
    setLoading(true);
    void Promise.all([getSavedUsage(), listMySavedGames(null, 20, tab)])
      .then(([nextUsage, page]) => {
        if (!active) return;
        setUsage(nextUsage);
        setItems(page.items);
        setCursor(page.nextCursor);
      })
      .catch((cause) => {
        if (active)
          setError(cause instanceof Error ? cause.message : "Unable to load Saved games.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [userId, revision, tab]);

  async function loadMore() {
    if (!cursor || loading) return;
    setLoading(true);
    setError(null);
    try {
      const page = await listMySavedGames(cursor, 20, tab);
      if (currentUser.current !== userId || currentTab.current !== tab) return;
      setItems((current) => [...current, ...page.items]);
      setCursor(page.nextCursor);
    } catch (cause) {
      if (currentUser.current === userId && currentTab.current === tab)
        setError(cause instanceof Error ? cause.message : "Unable to load more Saved games.");
    } finally {
      if (currentUser.current === userId && currentTab.current === tab) setLoading(false);
    }
  }

  async function change(item: SavedItem, action: "trash" | "restore" | "activate" | "delete") {
    if (mutating) return;
    const key = `${item.sourceKind}:${item.sourceId}`;
    setMutating(key);
    setError(null);
    try {
      await changeMySavedGame(item, action);
      if (currentUser.current !== userId || currentTab.current !== tab) return;
      const [nextUsage, page] = await Promise.all([
        getSavedUsage(),
        listMySavedGames(null, 20, tab),
      ]);
      if (currentUser.current !== userId || currentTab.current !== tab) return;
      setUsage(nextUsage);
      setItems(page.items);
      setCursor(page.nextCursor);
      setConfirmDelete(null);
    } catch (cause) {
      if (currentUser.current === userId && currentTab.current === tab)
        setError(cause instanceof Error ? cause.message : "Unable to update Saved games.");
    } finally {
      if (currentUser.current === userId && currentTab.current === tab) setMutating(null);
    }
  }

  return (
    <section className="eq-history-section" aria-labelledby="my-saved-heading">
      <div className="eq-section-heading">
        <div>
          <span className="eq-eyebrow">Me</span>
          <h2 id="my-saved-heading">Saved</h2>
          <p>Your retained replays, including recoverable Trash and Overflow.</p>
          {usage && (
            <p>
              {usage.activeCount.toLocaleString()} / {usage.capacity.toLocaleString()} saved ·{" "}
              {usage.planName}
            </p>
          )}
        </div>
      </div>
      <div className="eq-saved-tabs" role="group" aria-label="Saved game state">
        {(["active", "overflow", "trashed"] as const).map((state) => (
          <button
            key={state}
            type="button"
            className="eq-button"
            aria-pressed={tab === state}
            onClick={() => {
              setTab(state);
              setConfirmDelete(null);
            }}
          >
            {state === "active" ? "Active" : state === "overflow" ? "Overflow" : "Trash"}
          </button>
        ))}
      </div>
      {error && (
        <p className="eq-alert eq-alert-error" role="alert">
          {error}
        </p>
      )}
      {loading && items.length === 0 ? (
        <p role="status">Loading Saved games…</p>
      ) : items.length === 0 ? (
        <p>
          No {tab === "trashed" ? "Trash" : tab === "overflow" ? "Overflow" : "active Saved"} games.
        </p>
      ) : (
        <ol className="eq-history-list">
          {items.map((item) => (
            <li key={`${item.sourceKind}:${item.sourceId}`} className="eq-history-item">
              <div>
                <strong>{item.gameName}</strong>
                <span>{item.opponentLabel ? `vs ${item.opponentLabel}` : item.modeKey}</span>
                <small>
                  Saved {new Date(item.savedAt).toLocaleString()} ·{" "}
                  {item.replayFormat === "compact" ? "Compact" : "Legacy v3"}
                </small>
              </div>
              <div>
                <strong>
                  {item.scoreFor === null
                    ? "Completed"
                    : item.scoreAgainst === null
                      ? `${item.scoreFor} points`
                      : `${item.scoreFor}–${item.scoreAgainst}`}
                </strong>
              </div>
              <a href={`#/play/${encodeURIComponent(item.gameId)}`}>Open replay</a>
              {tab === "active" && (
                <button
                  type="button"
                  className="eq-button"
                  disabled={mutating !== null}
                  onClick={() => void change(item, "trash")}
                >
                  Move to Trash
                </button>
              )}
              {tab === "overflow" && (
                <>
                  <button
                    type="button"
                    className="eq-button"
                    disabled={mutating !== null}
                    onClick={() => void change(item, "activate")}
                  >
                    Activate
                  </button>
                  <button
                    type="button"
                    className="eq-button"
                    disabled={mutating !== null}
                    onClick={() => void change(item, "trash")}
                  >
                    Move to Trash
                  </button>
                </>
              )}
              {tab === "trashed" && (
                <>
                  <button
                    type="button"
                    className="eq-button"
                    disabled={mutating !== null}
                    onClick={() => void change(item, "restore")}
                  >
                    Restore
                  </button>
                  {confirmDelete === `${item.sourceKind}:${item.sourceId}` ? (
                    <button
                      type="button"
                      className="eq-button"
                      disabled={mutating !== null}
                      onClick={() => void change(item, "delete")}
                    >
                      Confirm permanent delete
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="eq-button"
                      disabled={mutating !== null}
                      onClick={() => setConfirmDelete(`${item.sourceKind}:${item.sourceId}`)}
                    >
                      Permanently delete
                    </button>
                  )}
                </>
              )}
            </li>
          ))}
        </ol>
      )}
      {cursor && (
        <button
          className="eq-button"
          type="button"
          disabled={loading}
          onClick={() => void loadMore()}
        >
          {loading ? "Loading…" : "Load more"}
        </button>
      )}
    </section>
  );
}
