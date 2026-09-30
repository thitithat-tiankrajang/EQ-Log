import { useEffect, useRef, useState } from "react";
import { listMyHistory, type HistoryItem } from "../../../features/gameRecords/history";
import { saveCompletedGame } from "../../../features/gameRecords/saved";

function modeLabel(item: HistoryItem): string {
  if (item.sourceKind === "ranked") return "Ranked";
  if (item.sourceKind === "stage") return "Stage";
  if (item.botKey || item.modeKey.startsWith("authur_") || item.modeKey.startsWith("aether_"))
    return "Bot game";
  if (item.gameMode === "solo") return "Solo";
  return item.modeKey === "hosted_versus" ? "Hosted" : "Versus";
}

function replayLabel(item: HistoryItem): string {
  if (item.replayAvailability === "legacy_available") return "Open legacy replay";
  if (item.replayAvailability === "legacy_partial") return "View limited legacy record";
  if (item.replayAvailability === "compact_available") return "Open replay";
  if (item.replayAvailability === "unsupported_legacy") return "Older result · no full replay";
  return "Replay unavailable";
}

export function HistorySection({
  userId,
  onSaved,
}: {
  userId: string | null;
  onSaved?: () => void;
}) {
  const currentUser = useRef(userId);
  currentUser.current = userId;
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setItems([]);
    setCursor(null);
    setError(null);
    if (!userId)
      return () => {
        active = false;
      };
    setLoading(true);
    void listMyHistory()
      .then((page) => {
        if (!active) return;
        setItems(page.items);
        setCursor(page.nextCursor);
      })
      .catch((cause) => {
        if (active) setError(cause instanceof Error ? cause.message : "Unable to load History.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [userId]);

  async function loadMore() {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    setError(null);
    try {
      const page = await listMyHistory(cursor);
      if (currentUser.current !== userId) return;
      setItems((current) => [...current, ...page.items]);
      setCursor(page.nextCursor);
    } catch (cause) {
      if (currentUser.current === userId)
        setError(cause instanceof Error ? cause.message : "Unable to load more History.");
    } finally {
      if (currentUser.current === userId) setLoadingMore(false);
    }
  }

  async function save(item: HistoryItem) {
    const key = `${item.sourceKind}:${item.sourceId}`;
    if (saving) return;
    setSaving(key);
    setError(null);
    try {
      await saveCompletedGame(item);
      if (currentUser.current !== userId) return;
      setItems((current) =>
        current.map((row) =>
          row.sourceKind === item.sourceKind && row.sourceId === item.sourceId
            ? { ...row, isSaved: true, savedState: "active" }
            : row,
        ),
      );
      onSaved?.();
    } catch (cause) {
      if (currentUser.current === userId)
        setError(cause instanceof Error ? cause.message : "Unable to save this replay.");
    } finally {
      if (currentUser.current === userId) setSaving(null);
    }
  }

  return (
    <section className="eq-history-section" aria-labelledby="my-history-heading">
      <div className="eq-section-heading">
        <div>
          <span className="eq-eyebrow">Me</span>
          <h2 id="my-history-heading">History</h2>
          <p>Games you played, kept even when a replay is no longer stored.</p>
        </div>
      </div>
      {error && (
        <p className="eq-alert eq-alert-error" role="alert">
          {error}
        </p>
      )}
      {loading ? (
        <div className="eq-skeleton-list" role="status" aria-label="Loading your game History">
          <span />
          <span />
        </div>
      ) : items.length === 0 ? (
        <p>No completed games in your History yet.</p>
      ) : (
        <ol className="eq-history-list">
          {items.map((item) => {
            const hasReplay =
              item.replayAvailability === "legacy_available" ||
              item.replayAvailability === "legacy_partial" ||
              item.replayAvailability === "compact_available";
            return (
              <li key={`${item.sourceKind}:${item.sourceId}`} className="eq-history-item">
                <div>
                  <strong>
                    {modeLabel(item)} · {item.gameName}
                  </strong>
                  <span>{item.opponentLabel ? `vs ${item.opponentLabel}` : "Solo game"}</span>
                  <small>{new Date(item.completedAt).toLocaleString()}</small>
                  {item.isRecent && <small>Recent replay</small>}
                  {item.savedState && (
                    <small>
                      {item.savedState === "active"
                        ? "Saved"
                        : item.savedState === "trashed"
                          ? "Saved · Trash"
                          : "Saved · Overflow"}
                    </small>
                  )}
                </div>
                <div>
                  <strong>{item.outcome ? item.outcome.toUpperCase() : "Completed"}</strong>
                  <span>
                    {item.scoreFor === null
                      ? "Score unavailable"
                      : item.scoreAgainst === null
                        ? `${item.scoreFor} points`
                        : `${item.scoreFor}–${item.scoreAgainst}`}
                  </span>
                  {(item.resultAuthority === "captured_client_state" ||
                    item.resultAuthority === "client_reported") && (
                    <small>Client-reported result</small>
                  )}
                  {item.resultAuthority === "advisory" && <small>Legacy advisory result</small>}
                </div>
                {hasReplay ? (
                  <a href={`#/play/${encodeURIComponent(item.gameId)}`}>{replayLabel(item)}</a>
                ) : (
                  <span>{replayLabel(item)}</span>
                )}
                {item.canSave && !item.isSaved && (
                  <button
                    className="eq-button"
                    type="button"
                    disabled={saving !== null}
                    onClick={() => void save(item)}
                  >
                    {saving === `${item.sourceKind}:${item.sourceId}`
                      ? "Saving…"
                      : hasReplay
                        ? "Save replay"
                        : "Save to open replay"}
                  </button>
                )}
              </li>
            );
          })}
        </ol>
      )}
      {cursor && !loading && (
        <button
          className="eq-button"
          type="button"
          disabled={loadingMore}
          onClick={() => void loadMore()}
        >
          {loadingMore ? "Loading…" : "Load more"}
        </button>
      )}
    </section>
  );
}
