// ── Board Labeler storage: this browser only ─────────────────────────────────
//
// Photos and labels never leave the machine: boards and their image blobs are
// kept in IndexedDB (autosave, survives refresh and crashes) and leave only
// through an explicit JSON export. `memoryStore` is the same interface for
// tests.

import type { BoardLabels } from "./boardLabels";

export interface LabelStore {
  listBoards(): Promise<BoardLabels[]>;
  getBoard(boardId: string): Promise<BoardLabels | null>;
  putBoard(board: BoardLabels): Promise<void>;
  getImage(boardId: string): Promise<Blob | null>;
  putImage(boardId: string, image: Blob): Promise<void>;
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

export function memoryStore(): LabelStore & {
  boards: Map<string, BoardLabels>;
  images: Map<string, Blob>;
} {
  const boards = new Map<string, BoardLabels>();
  const images = new Map<string, Blob>();
  return {
    boards,
    images,
    listBoards: async () => [...boards.values()].map(clone),
    getBoard: async (id) => (boards.has(id) ? clone(boards.get(id)!) : null),
    putBoard: async (b) => void boards.set(b.boardId, clone(b)),
    getImage: async (id) => images.get(id) ?? null,
    putImage: async (id, blob) => void images.set(id, blob),
  };
}

const DB = "eq-lab-board-labeler";
const VERSION = 1;

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("boards"))
        db.createObjectStore("boards", { keyPath: "boardId" });
      if (!db.objectStoreNames.contains("images")) db.createObjectStore("images");
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(
  db: IDBDatabase,
  store: string,
  mode: IDBTransactionMode,
  run: (s: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const req = run(t.objectStore(store));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export function indexedDbStore(): LabelStore {
  const db = open();
  return {
    listBoards: async () =>
      (await tx<BoardLabels[]>(await db, "boards", "readonly", (s) => s.getAll())) ?? [],
    getBoard: async (id) =>
      (await tx<BoardLabels | undefined>(await db, "boards", "readonly", (s) => s.get(id))) ?? null,
    putBoard: async (b) => void (await tx(await db, "boards", "readwrite", (s) => s.put(clone(b)))),
    getImage: async (id) =>
      (await tx<Blob | undefined>(await db, "images", "readonly", (s) => s.get(id))) ?? null,
    putImage: async (id, blob) =>
      void (await tx(await db, "images", "readwrite", (s) => s.put(blob, id))),
  };
}
