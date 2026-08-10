import { useEffect, useState } from "react";
import { Archive, Bot, FolderInput, PlayCircle, Save } from "lucide-react";
import { useAuth } from "../../../auth";
import type { RoomVisibility } from "../../../roomScope";
import {
  getPublicArchiveMoveContext,
  movePublicArchivesToRegion,
  type ArchiveGame,
} from "../../../features/gameRecords/repository";
import { Sheet } from "../../ui/Sheet";
import { SelectControl } from "../../ui/SelectControl";
import { GameTable, GameTableRow } from "./GameTable";

type RegionOption = { id: string; name: string };

export function ArchiveView({
  games,
  total,
  loading,
  loadingMore,
  scope,
  onSave,
  onChanged,
  onLoadMore,
}: {
  games: ArchiveGame[];
  total: number;
  loading: boolean;
  loadingMore: boolean;
  scope: RoomVisibility;
  onSave: (gameId: string) => Promise<void>;
  onChanged?: () => void;
  onLoadMore?: () => void;
}) {
  const { profile } = useAuth();
  const [regions, setRegions] = useState<RegionOption[]>([]);
  const [canMove, setCanMove] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [moveSheetOpen, setMoveSheetOpen] = useState(false);
  const [targetRegionId, setTargetRegionId] = useState("");
  const [moving, setMoving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (scope !== "public" || !profile?.is_admin) {
      setCanMove(false);
      setRegions([]);
      setSelectedIds([]);
      return;
    }
    let active = true;
    void getPublicArchiveMoveContext()
      .then((context) => {
        if (!active) return;
        setCanMove(context.canMove);
        setRegions(context.regions);
      })
      .catch((cause: unknown) => {
        if (!active) return;
        setCanMove(false);
        setError(cause instanceof Error ? cause.message : "Unable to verify admin access.");
      });
    return () => {
      active = false;
    };
  }, [profile?.is_admin, scope]);

  const loadedIds = new Set(games.map((game) => game.gameId));
  const selectedLoadedIds = selectedIds.filter((id) => loadedIds.has(id));
  const allSelected = games.length > 0 && selectedLoadedIds.length === games.length;

  if (loading) {
    return (
      <div className="eq-skeleton-list" aria-label="Loading game history" role="status">
        <span />
        <span />
        <span />
      </div>
    );
  }
  if (games.length === 0) {
    return (
      <section className="eq-state">
        <Archive size={28} />
        <h2>No retained games yet</h2>
        <p>Finished games will appear here automatically.</p>
      </section>
    );
  }

  return (
    <section className="eq-section" aria-labelledby="archive-title">
      <div className="eq-section-heading eq-section-heading-actions">
        <div>
          <span className="eq-eyebrow">Immutable snapshots</span>
          <h2 id="archive-title">Game history</h2>
        </div>
        <div className="eq-archive-heading-actions">
          <span className="eq-count">{total.toLocaleString()}</span>
          {canMove && (
            <button
              className="eq-button eq-button-primary eq-archive-move-button"
              type="button"
              disabled={selectedLoadedIds.length === 0 || regions.length === 0}
              title={regions.length === 0 ? "Create a region before moving games." : undefined}
              onClick={() => setMoveSheetOpen(true)}
            >
              <FolderInput size={17} /> Move to region
              {selectedLoadedIds.length > 0 && <strong>{selectedLoadedIds.length}</strong>}
            </button>
          )}
        </div>
      </div>
      {error && (
        <p className="eq-alert eq-alert-error" role="alert">
          {error}
        </p>
      )}

      <GameTable
        label="Game history"
        emptyMessage="No retained games yet."
        selectable={canMove}
        allSelected={allSelected}
        someSelected={selectedLoadedIds.length > 0}
        onSelectAll={(selected) => setSelectedIds(selected ? games.map((game) => game.gameId) : [])}
      >
        {games.map((game) => {
          const selected = selectedLoadedIds.includes(game.gameId);
          return (
            <GameTableRow
              key={game.gameId}
              selected={selected}
              selectionLabel={canMove ? `Select ${game.name}` : undefined}
              onSelectedChange={
                canMove
                  ? (nextSelected) =>
                      setSelectedIds((current) =>
                        nextSelected
                          ? [...new Set([...current, game.gameId])]
                          : current.filter((id) => id !== game.gameId),
                      )
                  : undefined
              }
              primary={
                <>
                  <span className={`eq-completion-badge is-${game.completionKind}`}>
                    {game.completionKind === "natural" ? "Natural finish" : "Terminated"}
                  </span>
                  <strong className="eq-game-row-name">{game.name}</strong>
                  <span className="eq-archive-score">
                    <strong>{game.playerA}</strong> {game.scoreA}
                    {game.gameMode === "versus" && (
                      <>
                        {" "}
                        · <strong>{game.playerB}</strong> {game.scoreB}
                      </>
                    )}
                  </span>
                </>
              }
              secondary={
                <>
                  <time dateTime={game.finishedAt}>{formatDate(game.finishedAt)}</time>
                  <span>
                    {game.modeKey.startsWith("aether_") && <Bot size={14} />}
                    {modeLabel(game.modeKey)}
                  </span>
                  <span>Turn {game.turnNumber}</span>
                  <span>{reasonLabel(game.completionReason)}</span>
                </>
              }
              actions={
                <>
                  <a
                    className="eq-button eq-button-secondary eq-game-row-action"
                    href={`#/play/${encodeURIComponent(game.gameId)}`}
                  >
                    <PlayCircle size={16} /> View replay
                  </a>
                  <button
                    className="eq-button eq-button-secondary eq-game-row-action"
                    type="button"
                    disabled={busyId === game.gameId}
                    onClick={async () => {
                      setBusyId(game.gameId);
                      setError(null);
                      try {
                        await onSave(game.gameId);
                      } catch (cause) {
                        setError(cause instanceof Error ? cause.message : "Unable to save game.");
                      } finally {
                        setBusyId(null);
                      }
                    }}
                  >
                    <Save size={16} /> {busyId === game.gameId ? "Saving…" : "Save"}
                  </button>
                </>
              }
            />
          );
        })}
      </GameTable>

      {games.length < total && (
        <div className="eq-load-more">
          <button
            className="eq-button eq-button-secondary"
            type="button"
            disabled={loadingMore}
            onClick={onLoadMore}
          >
            {loadingMore ? "Loading…" : `Load more (${games.length} of ${total})`}
          </button>
        </div>
      )}

      <Sheet
        open={moveSheetOpen}
        title="Move selected games to a region"
        onClose={() => {
          if (!moving) setMoveSheetOpen(false);
        }}
      >
        <p className="ui-confirm-consequence">
          Move {selectedLoadedIds.length} selected game
          {selectedLoadedIds.length === 1 ? "" : "s"} out of Public History. Region snapshots cannot
          be moved back to Public.
        </p>
        <div className="eq-field">
          <span id="archive-region-destination-label">Destination region</span>
          <SelectControl<string>
            ariaLabelledBy="archive-region-destination-label"
            value={targetRegionId}
            disabled={moving}
            options={[
              { value: "", label: "Choose a region" },
              ...regions.map((region) => ({ value: region.id, label: region.name })),
            ]}
            onChange={setTargetRegionId}
          />
        </div>
        <div className="ui-sheet-actions">
          <button
            className="eq-button eq-button-secondary"
            type="button"
            disabled={moving}
            onClick={() => setMoveSheetOpen(false)}
          >
            Cancel
          </button>
          <button
            className="eq-button eq-button-primary"
            type="button"
            disabled={!targetRegionId || selectedLoadedIds.length === 0 || moving}
            onClick={async () => {
              if (!targetRegionId || selectedLoadedIds.length === 0) return;
              setMoving(true);
              setError(null);
              try {
                await movePublicArchivesToRegion(selectedLoadedIds, targetRegionId);
                setMoveSheetOpen(false);
                setTargetRegionId("");
                setSelectedIds([]);
                onChanged?.();
              } catch (cause) {
                setError(cause instanceof Error ? cause.message : "Unable to move games.");
              } finally {
                setMoving(false);
              }
            }}
          >
            {moving ? "Moving…" : `Move ${selectedLoadedIds.length} games`}
          </button>
        </div>
      </Sheet>
    </section>
  );
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(value));
}

function modeLabel(value: string): string {
  if (value.startsWith("aether_")) {
    const difficulty = value.slice("aether_".length);
    return `Aether · ${difficulty[0]?.toUpperCase()}${difficulty.slice(1)}`;
  }
  return (
    (
      {
        solo_practice: "Solo Practice",
        online_versus: "Online Versus",
        hosted_versus: "Hosted Versus",
        local_versus: "Pass & Play",
      } as Record<string, string>
    )[value] ?? value
  );
}

function reasonLabel(value: string): string {
  return value.replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase());
}
