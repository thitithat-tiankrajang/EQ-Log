import { useEffect, useMemo, useState, type DragEvent, type MouseEvent } from "react";
import {
  ArchiveRestore,
  ChevronRight,
  FileClock,
  Folder,
  FolderInput,
  FolderPlus,
  Pencil,
  PlayCircle,
  Search,
  Trash2,
  Copy,
  Check,
  GripVertical,
  ArrowUpRight,
  X,
} from "lucide-react";
import { AccountChip, useAuth } from "../../auth";
import { AdminButton } from "../../admin";
import { ApplicationShell } from "../../app/shells/ApplicationShell";
import { listPrivateRooms } from "../../remoteRooms";
import type { RoomMeta } from "../../rooms";
import { routeToHash } from "../../router";
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
import { CheckboxControl } from "../ui/CheckboxControl";

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
  const [selectionAnchor, setSelectionAnchor] = useState<string | null>(null);
  const [draggingIds, setDraggingIds] = useState<string[]>([]);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [mutating, setMutating] = useState(false);
  const [createFolderOpen, setCreateFolderOpen] = useState(false);
  const [renaming, setRenaming] = useState<PrivateLibraryItem | null>(null);
  const [movingIds, setMovingIds] = useState<string[]>([]);
  const [deleting, setDeleting] = useState<PrivateLibraryItem | null>(null);
  const [moveTarget, setMoveTarget] = useState<string | null>(null);
  const [boardLimit, setBoardLimit] = useState(1_000);

  async function load(silent = false) {
    if (!silent) setLoading(true);
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
      if (!silent) setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [userId]);
  useEffect(() => {
    setSelected([]);
    setSelectionAnchor(null);
  }, [folderId, trash]);

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

  async function mutate(operation: () => Promise<void>): Promise<boolean> {
    setError(null);
    setMutating(true);
    try {
      await operation();
      await load(true);
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to update Private Library.");
      return false;
    } finally {
      setMutating(false);
    }
  }

  function selectItem(id: string, event: MouseEvent<HTMLButtonElement>) {
    if (event.shiftKey && selectionAnchor) {
      const start = visibleItems.findIndex((item) => item.id === selectionAnchor);
      const end = visibleItems.findIndex((item) => item.id === id);
      if (start >= 0 && end >= 0) {
        const range = visibleItems
          .slice(Math.min(start, end), Math.max(start, end) + 1)
          .map((item) => item.id);
        setSelected(
          event.metaKey || event.ctrlKey
            ? (current) => [...new Set([...current, ...range])]
            : range,
        );
        return;
      }
    }
    if (event.metaKey || event.ctrlKey) {
      setSelected((current) =>
        current.includes(id) ? current.filter((itemId) => itemId !== id) : [...current, id],
      );
    } else {
      setSelected([id]);
    }
    setSelectionAnchor(id);
  }

  function openMove(ids: string[]) {
    setMovingIds(ids);
    setMoveTarget(null);
  }

  function canDrop(ids: string[], destinationId: string | null) {
    if (
      ids.length === 0 ||
      (destinationId && !allFolders.some((folder) => folder.id === destinationId))
    )
      return false;
    return (
      ids.every((id) => items.some((item) => item.id === id && !item.trashedAt)) &&
      !ids.some(
        (id) => id === destinationId || (destinationId && isDescendantOf(items, destinationId, id)),
      ) &&
      ids.some((id) => items.find((item) => item.id === id)?.parentId !== destinationId)
    );
  }

  function dragStart(event: DragEvent<HTMLElement>, id: string) {
    const ids = selected.includes(id) ? selected : [id];
    setSelected(ids);
    setSelectionAnchor(id);
    setDraggingIds(ids);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("application/x-eq-private-items", ids.join(","));
  }

  function dragOver(event: DragEvent<HTMLElement>, destinationId: string | null) {
    if (!canDrop(draggingIds, destinationId)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setDropTarget(destinationId ?? "root");
  }

  function drop(event: DragEvent<HTMLElement>, destinationId: string | null) {
    event.preventDefault();
    event.stopPropagation();
    const ids = event.dataTransfer
      .getData("application/x-eq-private-items")
      .split(",")
      .filter(Boolean);
    setDropTarget(null);
    setDraggingIds([]);
    if (ids.join(",") !== draggingIds.join(",") || !canDrop(ids, destinationId)) return;
    void mutate(async () => {
      await movePrivateItems(ids, destinationId);
      setSelected([]);
    });
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
        description="Your saved game space"
        actions={<AccountChip />}
      >
        <section className="eq-state eq-state-access">
          <Folder size={30} />
          <h2>Sign in to open Private Library</h2>
          <p>Saved boards and folders are kept with your account.</p>
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
          <nav
            className={`eq-breadcrumbs eq-file-root-drop${dropTarget === "root" ? " is-drop-target" : ""}`}
            aria-label="Folder path"
            onDragOver={!trash ? (event) => dragOver(event, null) : undefined}
            onDragLeave={() => setDropTarget(null)}
            onDrop={!trash ? (event) => drop(event, null) : undefined}
          >
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
                    ? routeToHash({
                        kind: "room",
                        roomId: room.id,
                        returnTo: { kind: "private", folderId },
                      })
                    : routeToHash({
                        kind: "play",
                        roomId: room.id,
                        returnTo: { kind: "private", folderId },
                      })
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
              onChange={(event) => {
                setQuery(event.target.value);
                setSelected([]);
              }}
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
          {!trash && userId && (
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
                : userId
                  ? "Save a replay from Public or Region, or create a folder here."
                  : "Saved games and folders appear here when you use an account."}
            </p>
          </div>
        ) : (
          <div>
            <div className="eq-file-browser" aria-busy={mutating}>
              <div className="eq-file-toolbar" role="toolbar" aria-label="Private file selection">
                <CheckboxControl
                  checked={selected.length === visibleItems.length}
                  mixed={selected.length > 0 && selected.length < visibleItems.length}
                  ariaLabel="Select all visible files"
                  onChange={(checked) =>
                    setSelected(checked ? visibleItems.map((item) => item.id) : [])
                  }
                />
                <span className="eq-file-selection-status" aria-live="polite">
                  {selected.length > 0 ? (
                    <strong>{selected.length} selected</strong>
                  ) : (
                    <span>Choose files to move or manage</span>
                  )}
                </span>
                {mutating && (
                  <span className="eq-file-updating" role="status">
                    Updating…
                  </span>
                )}
                <div className="eq-file-toolbar-actions">
                  {selected.length > 0 && !trash && (
                    <button
                      className="eq-file-tool"
                      type="button"
                      disabled={mutating}
                      onClick={() => openMove([...selected])}
                    >
                      <FolderInput size={16} /> Move to…
                    </button>
                  )}
                  {selected.length > 0 && (
                    <button
                      className="eq-file-tool is-danger"
                      type="button"
                      disabled={mutating}
                      onClick={() => void restoreOrTrashSelected()}
                    >
                      {trash ? <ArchiveRestore size={16} /> : <Trash2 size={16} />}
                      {trash ? "Restore" : "Trash"}
                    </button>
                  )}
                  {selected.length > 0 && (
                    <button
                      className="eq-file-clear"
                      type="button"
                      aria-label="Clear selection"
                      onClick={() => setSelected([])}
                    >
                      <X size={16} />
                    </button>
                  )}
                </div>
              </div>
              <div
                className="eq-file-list"
                role="list"
                aria-label={trash ? "Private trash" : "Private files"}
              >
                {visibleItems.map((item) => {
                  const isSelected = selected.includes(item.id);
                  const contentHref =
                    item.itemType === "folder"
                      ? `#/private/${encodeURIComponent(item.id)}`
                      : routeToHash({
                          kind: "play",
                          roomId: item.gameId ?? "",
                          returnTo: { kind: "private", folderId, trash },
                        });
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
                          onSelect: () => openMove([item.id]),
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
                    <article
                      key={item.id}
                      role="listitem"
                      className={`eq-file-row${isSelected ? " is-selected" : ""}${dropTarget === item.id ? " is-drop-target" : ""}${draggingIds.includes(item.id) ? " is-dragging" : ""}`}
                      draggable={!trash && !mutating}
                      onDragStart={!trash ? (event) => dragStart(event, item.id) : undefined}
                      onDragEnd={() => {
                        setDraggingIds([]);
                        setDropTarget(null);
                      }}
                      onDragOver={
                        item.itemType === "folder" && !trash
                          ? (event) => dragOver(event, item.id)
                          : undefined
                      }
                      onDragLeave={() => setDropTarget(null)}
                      onDrop={
                        item.itemType === "folder" && !trash
                          ? (event) => drop(event, item.id)
                          : undefined
                      }
                    >
                      <CheckboxControl
                        checked={isSelected}
                        ariaLabel={`Select ${item.name}`}
                        onChange={(checked) => {
                          setSelected((current) =>
                            checked
                              ? [...new Set([...current, item.id])]
                              : current.filter((id) => id !== item.id),
                          );
                          setSelectionAnchor(item.id);
                        }}
                      />
                      <button
                        className="eq-file-main"
                        type="button"
                        aria-pressed={isSelected}
                        aria-label={`${isSelected ? "Selected" : "Select"} ${item.name}`}
                        onClick={(event) => selectItem(item.id, event)}
                        onDoubleClick={
                          !trash
                            ? () => {
                                window.location.hash = contentHref;
                              }
                            : undefined
                        }
                        onKeyDown={(event) => {
                          if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "a") {
                            event.preventDefault();
                            setSelected(visibleItems.map((visible) => visible.id));
                          } else if (event.key === "Escape") {
                            setSelected([]);
                          } else if (!trash && event.key === "Enter") {
                            event.preventDefault();
                            window.location.hash = contentHref;
                          }
                        }}
                      >
                        <span className={`eq-file-icon is-${item.itemType}`} aria-hidden="true">
                          {item.itemType === "folder" ? (
                            <Folder size={22} />
                          ) : (
                            <FileClock size={21} />
                          )}
                        </span>
                        <span className="eq-file-copy">
                          <strong>{item.name}</strong>
                          <small>
                            {item.itemType === "folder"
                              ? "Folder"
                              : `${item.modeKey?.replaceAll("_", " ") ?? "Saved game"} · ${item.scoreA ?? 0}:${item.scoreB ?? 0}`}
                            <span aria-hidden="true"> · </span>
                            <time dateTime={item.updatedAt}>{formatFileDate(item.updatedAt)}</time>
                          </small>
                        </span>
                      </button>
                      <span className="eq-file-row-actions">
                        {trash ? (
                          <button
                            className="eq-file-open"
                            type="button"
                            disabled={mutating}
                            onClick={() =>
                              void mutate(() =>
                                updatePrivateItem(item.id, {
                                  trashedAt: null,
                                  ...(item.parentId &&
                                  items.find((candidate) => candidate.id === item.parentId)
                                    ?.trashedAt
                                    ? { parentId: null }
                                    : {}),
                                }),
                              )
                            }
                          >
                            <ArchiveRestore size={15} /> Restore
                          </button>
                        ) : (
                          <a
                            className="eq-file-open"
                            href={contentHref}
                            aria-label={`Open ${item.name}`}
                          >
                            Open{" "}
                            {item.itemType === "folder" ? (
                              <ChevronRight size={15} />
                            ) : (
                              <ArrowUpRight size={15} />
                            )}
                          </a>
                        )}
                        <OverflowMenu label={`Actions for ${item.name}`} items={overflowItems} />
                      </span>
                      {!trash && (
                        <GripVertical className="eq-file-drag-hint" size={16} aria-hidden="true" />
                      )}
                    </article>
                  );
                })}
              </div>
            </div>
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
        onClose={() => {
          if (!mutating) setMovingIds([]);
        }}
      >
        <p className="eq-file-move-hint">
          Choose where to put{" "}
          {movingIds.length === 1 ? "this item" : `these ${movingIds.length} items`}.
        </p>
        <div className="eq-file-destinations" role="group" aria-label="Destination folder">
          {[
            { id: "", name: "Private", path: "Top level" },
            ...allFolders
              .filter(
                (folder) =>
                  !movingIds.includes(folder.id) &&
                  !movingIds.some((id) => isDescendantOf(items, folder.id, id)),
              )
              .map((folder) => ({
                id: folder.id,
                name: folder.name,
                path:
                  buildBreadcrumbs(items, folder)
                    .slice(0, -1)
                    .map((ancestor) => ancestor.name)
                    .join(" / ") || "Private",
              }))
              .sort((a, b) => `${a.path}/${a.name}`.localeCompare(`${b.path}/${b.name}`)),
          ].map((destination) => {
            const alreadyHere = movingIds.every(
              (id) => items.find((item) => item.id === id)?.parentId === (destination.id || null),
            );
            return (
              <label
                key={destination.id}
                className={`eq-file-destination${moveTarget === destination.id ? " is-selected" : ""}${alreadyHere ? " is-current" : ""}`}
              >
                <input
                  type="radio"
                  name="private-file-destination"
                  aria-label={`${destination.name} — ${alreadyHere ? "Already here" : destination.path}`}
                  checked={moveTarget === destination.id}
                  disabled={mutating || alreadyHere}
                  onChange={() => setMoveTarget(destination.id)}
                />
                <Folder size={20} aria-hidden="true" />
                <span>
                  <strong>{destination.name}</strong>
                  <small>{alreadyHere ? "Already here" : destination.path}</small>
                </span>
                {moveTarget === destination.id && <Check size={17} aria-hidden="true" />}
              </label>
            );
          })}
        </div>
        {error && (
          <p className="eq-alert eq-alert-error" role="alert">
            {error}
          </p>
        )}
        <div className="ui-sheet-actions">
          <button
            className="eq-button eq-button-secondary"
            type="button"
            disabled={mutating}
            onClick={() => setMovingIds([])}
          >
            Cancel
          </button>
          <button
            className="eq-button eq-button-primary"
            type="button"
            disabled={moveTarget === null || mutating}
            onClick={async () => {
              if (moveTarget === null) return;
              const moved = await mutate(() => movePrivateItems(movingIds, moveTarget || null));
              if (moved) {
                setMovingIds([]);
                setSelected([]);
              }
            }}
          >
            {mutating ? "Moving…" : "Move here"}
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

function formatFileDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}
