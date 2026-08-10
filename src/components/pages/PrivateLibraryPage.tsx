import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArchiveRestore,
  Check,
  ChevronRight,
  FileClock,
  Folder,
  FolderInput,
  FolderPlus,
  ListChecks,
  Pencil,
  PlayCircle,
  Search,
  Trash2,
  Copy,
} from "lucide-react";
import { AccountChip, useAuth } from "../../auth";
import { AdminButton } from "../../admin";
import { ApplicationShell } from "../../app/shells/ApplicationShell";
import { listPrivateRooms } from "../../remoteRooms";
import type { RoomMeta } from "../../rooms";
import {
  createPrivateFolder,
  copyPrivateGameItem,
  deletePrivateItem,
  getGameStorageLimits,
  listPrivateLibrary,
  movePrivateItems,
  updatePrivateItem,
  type PrivateLibraryItem,
} from "../../features/gameRecords/repository";
import { ConfirmSheet, Sheet, TextPromptSheet } from "../ui/Sheet";
import { OverflowMenu } from "../ui/OverflowMenu";
import { SelectControl } from "../ui/SelectControl";
import { GameTable, GameTableRow } from "./lobby/GameTable";

export function PrivateLibraryPage({
  folderId,
  trash = false,
}: {
  folderId: string | null;
  trash?: boolean;
}) {
  const { configured, userId } = useAuth();
  const [items, setItems] = useState<PrivateLibraryItem[]>([]);
  const [liveRooms, setLiveRooms] = useState<RoomMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<"updated" | "name">("updated");
  const [selected, setSelected] = useState<string[]>([]);
  const [multiSelect, setMultiSelect] = useState(false);
  const [createFolderOpen, setCreateFolderOpen] = useState(false);
  const [renaming, setRenaming] = useState<PrivateLibraryItem | null>(null);
  const [movingIds, setMovingIds] = useState<string[]>([]);
  const [deleting, setDeleting] = useState<PrivateLibraryItem | null>(null);
  const [moveTarget, setMoveTarget] = useState<string>("");
  const [boardLimit, setBoardLimit] = useState(1_000);
  const tableAreaRef = useRef<HTMLDivElement | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [nextItems, limits, nextLiveRooms] = await Promise.all([
        listPrivateLibrary(),
        getGameStorageLimits(),
        listPrivateRooms(),
      ]);
      setItems(nextItems);
      setBoardLimit(limits.privateBoards);
      setLiveRooms(nextLiveRooms);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to load Private Library.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [userId]);
  useEffect(() => {
    setSelected([]);
    setMultiSelect(false);
  }, [folderId, trash]);
  useEffect(() => {
    const clearSelectionOutsideTable = (event: PointerEvent) => {
      if (!tableAreaRef.current?.contains(event.target as Node)) setSelected([]);
    };
    document.addEventListener("pointerdown", clearSelectionOutsideTable);
    return () => document.removeEventListener("pointerdown", clearSelectionOutsideTable);
  }, []);

  const currentFolder =
    items.find((item) => item.id === folderId && item.itemType === "folder") ?? null;
  const breadcrumbs = buildBreadcrumbs(items, currentFolder);
  const visibleItems = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    const result = items.filter((item) => {
      if (trash)
        return (
          Boolean(item.trashedAt) && (!normalized || item.name.toLowerCase().includes(normalized))
        );
      return (
        !item.trashedAt &&
        item.parentId === folderId &&
        (!normalized || item.name.toLowerCase().includes(normalized))
      );
    });
    return result.sort((a, b) =>
      sort === "name" ? a.name.localeCompare(b.name) : b.updatedAt.localeCompare(a.updatedAt),
    );
  }, [folderId, items, query, sort, trash]);
  const boardCount = items.filter((item) => item.itemType === "game").length;
  const allFolders = items.filter((item) => item.itemType === "folder" && !item.trashedAt);

  async function mutate(operation: () => Promise<void>) {
    setError(null);
    try {
      await operation();
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to update Private Library.");
    }
  }

  async function restoreOrTrashSelected() {
    await mutate(async () => {
      for (const id of selected) {
        const item = items.find((candidate) => candidate.id === id);
        const parentIsTrashed = Boolean(
          item?.parentId && items.find((candidate) => candidate.id === item.parentId)?.trashedAt,
        );
        await updatePrivateItem(id, {
          trashedAt: trash ? null : new Date().toISOString(),
          ...(trash && parentIsTrashed ? { parentId: null } : {}),
        });
      }
      setSelected([]);
    });
  }

  if (configured && !userId) {
    return (
      <ApplicationShell
        title="Private"
        description="Your permanent personal replay library."
        actions={<AccountChip />}
      >
        <section className="eq-state eq-state-access">
          <Folder size={30} />
          <h2>Sign in to open Private Library</h2>
          <p>Saved boards and folders belong to your account.</p>
        </section>
      </ApplicationShell>
    );
  }

  return (
    <ApplicationShell
      title={trash ? "Trash" : (currentFolder?.name ?? "Private")}
      description={`${boardCount.toLocaleString()} of ${boardLimit.toLocaleString()} saved boards`}
      routeKey={`private:${folderId ?? "root"}:${trash}`}
      actions={
        <>
          <AccountChip />
          <AdminButton />
        </>
      }
      secondaryNavigation={
        <div className="eq-library-toolbar">
          <nav className="eq-breadcrumbs" aria-label="Folder path">
            <a href="#/private">Private</a>
            {!trash &&
              breadcrumbs.map((folder) => (
                <span key={folder.id}>
                  <ChevronRight size={14} />
                  <a href={`#/private/${folder.id}`}>{folder.name}</a>
                </span>
              ))}
            {trash && (
              <span>
                <ChevronRight size={14} />
                Trash
              </span>
            )}
          </nav>
          <div className="eq-library-view-links">
            <a className={!trash ? "is-active" : ""} href="#/private">
              My files
            </a>
            <a className={trash ? "is-active" : ""} href="#/private?view=trash">
              Trash
            </a>
          </div>
        </div>
      }
    >
      {!trash && folderId === null && liveRooms.length > 0 && (
        <section className="eq-section" aria-labelledby="private-live-heading">
          <div className="eq-section-heading">
            <div>
              <span className="eq-eyebrow">Private live games</span>
              <h2 id="private-live-heading">Continue playing</h2>
            </div>
            <span className="eq-count">{liveRooms.length}</span>
          </div>
          <div className="eq-private-live-grid">
            {liveRooms.map((room) => (
              <a
                className="eq-private-live-card"
                href={
                  room.status === "draft"
                    ? `#/room/${encodeURIComponent(room.id)}`
                    : `#/play/${encodeURIComponent(room.id)}`
                }
                key={room.id}
              >
                <span>
                  <strong>{room.name}</strong>
                  <small>
                    {room.status === "draft" ? "Waiting or paused" : "Playing"} · Turn{" "}
                    {room.turnNumber}
                  </small>
                </span>
                <PlayCircle size={19} />
              </a>
            ))}
          </div>
        </section>
      )}
      <section className="eq-section eq-library-section">
        <div className="eq-library-controls">
          <label className="eq-search-field">
            <Search size={17} />
            <input
              type="search"
              placeholder="Search this folder"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <SelectControl<"updated" | "name">
            className="eq-select"
            ariaLabel="Sort private files"
            value={sort}
            options={[
              { value: "updated", label: "Recently updated" },
              { value: "name", label: "Name" },
            ]}
            onChange={(value) => value && setSort(value)}
          />
          {!trash && (
            <button
              className="eq-button eq-button-primary"
              type="button"
              onClick={() => setCreateFolderOpen(true)}
            >
              <FolderPlus size={17} /> New folder
            </button>
          )}
        </div>

        {error && (
          <p className="eq-alert eq-alert-error" role="alert">
            {error}
          </p>
        )}

        {loading ? (
          <div className="eq-skeleton-list" role="status" aria-label="Loading private files">
            <span />
            <span />
            <span />
          </div>
        ) : visibleItems.length === 0 ? (
          <div className="eq-state">
            <Folder size={30} />
            <h2>{trash ? "Trash is empty" : "This folder is empty"}</h2>
            <p>
              {trash
                ? "Deleted files remain recoverable for 30 days."
                : "Save a replay from Public or Region, or create a folder here."}
            </p>
          </div>
        ) : (
          <div ref={tableAreaRef}>
            <GameTable
              label={trash ? "Private trash" : "Private files"}
              emptyMessage={trash ? "Trash is empty" : "This folder is empty"}
              className="eq-private-library-table"
              primaryHeading="Name"
              toolbar={
                <div
                  className="eq-library-selection-toolbar"
                  role="toolbar"
                  aria-label="Private file selection"
                >
                  <span className="eq-library-selection-status" aria-live="polite">
                    {selected.length > 0 ? (
                      <strong>{selected.length} selected</strong>
                    ) : (
                      <span>{multiSelect ? "Select multiple items" : "Select an item"}</span>
                    )}
                  </span>
                  <span className="eq-library-selection-actions">
                    {selected.length > 0 && !trash && (
                      <button
                        className="eq-button eq-button-secondary"
                        type="button"
                        aria-label={`Move ${selected.length} selected item${selected.length === 1 ? "" : "s"}`}
                        onClick={() => setMovingIds([...selected])}
                      >
                        <FolderInput size={16} /> <span>Move</span>
                      </button>
                    )}
                    {selected.length > 0 && (
                      <button
                        className={`eq-button ${trash ? "eq-button-secondary" : "eq-button-danger"}`}
                        type="button"
                        aria-label={`${trash ? "Restore" : "Move to Trash"} ${selected.length} selected item${selected.length === 1 ? "" : "s"}`}
                        onClick={() => void restoreOrTrashSelected()}
                      >
                        {trash ? <ArchiveRestore size={16} /> : <Trash2 size={16} />}
                        <span>{trash ? "Restore" : "Move to Trash"}</span>
                      </button>
                    )}
                    <button
                      className="eq-button eq-button-secondary eq-library-multi-select-button"
                      type="button"
                      aria-label={
                        multiSelect ? "Finish selecting multiple items" : "Select multiple items"
                      }
                      aria-pressed={multiSelect}
                      onClick={() => setMultiSelect((current) => !current)}
                    >
                      {multiSelect ? <Check size={16} /> : <ListChecks size={16} />}
                      <span>{multiSelect ? "Done selecting" : "Select multiple"}</span>
                    </button>
                  </span>
                </div>
              }
            >
              {visibleItems.map((item) => {
                const isSelected = selected.includes(item.id);
                const contentHref =
                  item.itemType === "folder"
                    ? `#/private/${encodeURIComponent(item.id)}`
                    : `#/play/${encodeURIComponent(item.gameId ?? "")}`;
                const overflowItems = trash
                  ? [
                      {
                        icon: <ArchiveRestore size={16} />,
                        label: "Restore",
                        onSelect: () =>
                          void mutate(() =>
                            updatePrivateItem(item.id, {
                              trashedAt: null,
                              ...(item.parentId &&
                              items.find((candidate) => candidate.id === item.parentId)?.trashedAt
                                ? { parentId: null }
                                : {}),
                            }),
                          ),
                      },
                      {
                        icon: <Trash2 size={16} />,
                        label: "Delete permanently",
                        danger: true,
                        onSelect: () => setDeleting(item),
                      },
                    ]
                  : [
                      ...(item.itemType === "game"
                        ? [
                            {
                              icon: <Copy size={16} />,
                              label: "Make a copy",
                              onSelect: () => void mutate(() => copyPrivateGameItem(item.id)),
                            },
                          ]
                        : []),
                      {
                        icon: <Pencil size={16} />,
                        label: "Rename",
                        onSelect: () => setRenaming(item),
                      },
                      {
                        icon: <FolderInput size={16} />,
                        label: "Move",
                        onSelect: () => setMovingIds([item.id]),
                      },
                      {
                        icon: <Trash2 size={16} />,
                        label: "Move to Trash",
                        danger: true,
                        onSelect: () =>
                          void mutate(() =>
                            updatePrivateItem(item.id, { trashedAt: new Date().toISOString() }),
                          ),
                      },
                    ];
                return (
                  <GameTableRow
                    key={item.id}
                    selected={isSelected}
                    contentHref={trash ? "#/private?view=trash" : contentHref}
                    contentLabel={
                      isSelected
                        ? multiSelect || trash
                          ? `Deselect ${item.name}`
                          : `Open ${item.name}`
                        : multiSelect
                          ? `Add ${item.name} to selection`
                          : `Select ${item.name}; activate again to open`
                    }
                    onContentClick={(event) => {
                      const additiveSelection = multiSelect || event.ctrlKey || event.metaKey;
                      if (additiveSelection) {
                        event.preventDefault();
                        setSelected((current) =>
                          current.includes(item.id)
                            ? current.filter((id) => id !== item.id)
                            : [...current, item.id],
                        );
                        return;
                      }
                      if (!isSelected) {
                        event.preventDefault();
                        setSelected([item.id]);
                        return;
                      }
                      if (trash) event.preventDefault();
                    }}
                    primary={
                      <>
                        {item.itemType === "folder" ? (
                          <Folder size={19} className="eq-private-library-icon" />
                        ) : (
                          <FileClock size={19} className="eq-private-library-icon" />
                        )}
                        <strong className="eq-game-row-name">{item.name}</strong>
                      </>
                    }
                    secondary={
                      item.itemType === "folder" ? (
                        <span>Folder</span>
                      ) : (
                        <>
                          <span>Saved game</span>
                          <span>
                            {item.scoreA ?? 0} · {item.scoreB ?? 0}
                          </span>
                          {item.modeKey && <span>{item.modeKey.replaceAll("_", " ")}</span>}
                          {item.turnNumber !== null && <span>Turn {item.turnNumber}</span>}
                        </>
                      )
                    }
                    actions={
                      <>
                        {!trash && (
                          <a
                            className="eq-icon-button"
                            aria-label={`${item.itemType === "folder" ? "Open" : "View"} ${item.name}`}
                            href={contentHref}
                          >
                            {item.itemType === "folder" ? (
                              <ChevronRight size={17} />
                            ) : (
                              <PlayCircle size={17} />
                            )}
                          </a>
                        )}
                        <OverflowMenu label={`Actions for ${item.name}`} items={overflowItems} />
                      </>
                    }
                  />
                );
              })}
            </GameTable>
          </div>
        )}
      </section>

      <TextPromptSheet
        open={createFolderOpen}
        title="New folder"
        label="Folder name"
        initialValue=""
        submitLabel="Create folder"
        onCancel={() => setCreateFolderOpen(false)}
        onSubmit={(name) => {
          setCreateFolderOpen(false);
          if (userId) void mutate(() => createPrivateFolder(userId, name, folderId));
        }}
      />
      <TextPromptSheet
        open={Boolean(renaming)}
        title="Rename item"
        label="Name"
        initialValue={renaming?.name ?? ""}
        submitLabel="Save name"
        onCancel={() => setRenaming(null)}
        onSubmit={(name) => {
          const item = renaming;
          setRenaming(null);
          if (item) void mutate(() => updatePrivateItem(item.id, { name }));
        }}
      />
      <Sheet
        open={movingIds.length > 0}
        title={movingIds.length > 1 ? `Move ${movingIds.length} items` : "Move item"}
        onClose={() => setMovingIds([])}
      >
        <div className="eq-field">
          <span id="private-move-destination-label">Destination</span>
          <SelectControl<string>
            ariaLabelledBy="private-move-destination-label"
            value={moveTarget}
            options={[
              { value: "", label: "Private root" },
              ...allFolders
                .filter(
                  (folder) =>
                    !movingIds.includes(folder.id) &&
                    !movingIds.some((id) => isDescendantOf(items, folder.id, id)),
                )
                .map((folder) => ({ value: folder.id, label: folder.name })),
            ]}
            onChange={setMoveTarget}
          />
        </div>
        <div className="ui-sheet-actions">
          <button
            className="eq-button eq-button-secondary"
            type="button"
            onClick={() => setMovingIds([])}
          >
            Cancel
          </button>
          <button
            className="eq-button eq-button-primary"
            type="button"
            onClick={() => {
              const ids = movingIds;
              setMovingIds([]);
              void mutate(async () => {
                await movePrivateItems(ids, moveTarget || null);
                setSelected([]);
              });
            }}
          >
            Move
          </button>
        </div>
      </Sheet>
      <ConfirmSheet
        open={Boolean(deleting)}
        title="Delete permanently"
        consequence={`Permanently delete “${deleting?.name ?? "this item"}”? This cannot be undone.`}
        confirmLabel="Delete permanently"
        onCancel={() => setDeleting(null)}
        onConfirm={() => {
          const item = deleting;
          setDeleting(null);
          if (item)
            void mutate(async () => {
              for (const id of descendantsDeepestFirst(items, item.id)) await deletePrivateItem(id);
              await deletePrivateItem(item.id);
            });
        }}
      />
    </ApplicationShell>
  );
}

function buildBreadcrumbs(
  items: PrivateLibraryItem[],
  current: PrivateLibraryItem | null,
): PrivateLibraryItem[] {
  const result: PrivateLibraryItem[] = [];
  let cursor = current;
  while (cursor) {
    result.unshift(cursor);
    cursor = items.find((item) => item.id === cursor?.parentId) ?? null;
  }
  return result;
}

function descendantsDeepestFirst(items: PrivateLibraryItem[], parentId: string): string[] {
  const result: string[] = [];
  for (const child of items.filter((item) => item.parentId === parentId)) {
    result.push(...descendantsDeepestFirst(items, child.id), child.id);
  }
  return result;
}

function isDescendantOf(
  items: PrivateLibraryItem[],
  candidateId: string,
  ancestorId: string,
): boolean {
  let cursor = items.find((item) => item.id === candidateId) ?? null;
  while (cursor?.parentId) {
    if (cursor.parentId === ancestorId) return true;
    cursor = items.find((item) => item.id === cursor?.parentId) ?? null;
  }
  return false;
}
