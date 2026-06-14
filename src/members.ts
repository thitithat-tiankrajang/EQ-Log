// Organization members directory. Persisted locally per-browser.
// Visible to anyone on the device; mutations are gated by the admin check in
// the UI layer (only admins see the create/edit/delete controls).
//
// We deliberately keep this independent of Supabase for now: members live in
// localStorage so the system works in both local and remote modes without a
// schema migration. When a member is referenced from a game, the reference is
// the member id stored on the game state (see GameSnapshot.playerMembers).

const STORAGE_KEY = "amath-lab-members-v1";

export type Member = {
  id: string;
  name: string;
  alias?: string;
  role?: string;
  note?: string;
  color: string;
  createdAt: string;
};

// Calm, low-saturation palette — assigned in round-robin so each new member
// gets a distinct color without the admin having to pick one.
export const MEMBER_COLORS = [
  "#3f7a6b",
  "#7d6cb0",
  "#c97a4c",
  "#3f6fa0",
  "#7f8b3e",
  "#a3563f",
  "#5d6f7d",
  "#a8843a",
  "#5a8b71",
  "#856489",
];

function nextColor(existing: Member[]): string {
  const used = new Set(existing.map((member) => member.color));
  const free = MEMBER_COLORS.find((color) => !used.has(color));
  if (free) return free;
  return MEMBER_COLORS[existing.length % MEMBER_COLORS.length];
}

function readRaw(): Member[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Member[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeRaw(list: Member[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  emit();
}

export function listMembers(): Member[] {
  return [...readRaw()].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
  );
}

export function findMember(id: string | null | undefined): Member | null {
  if (!id) return null;
  return readRaw().find((member) => member.id === id) ?? null;
}

export type NewMember = {
  name: string;
  alias?: string;
  role?: string;
  note?: string;
  color?: string;
};

export function createMember(input: NewMember): Member[] {
  const list = readRaw();
  const name = input.name.trim();
  if (!name) return list;
  const member: Member = {
    id: crypto.randomUUID(),
    name,
    alias: input.alias?.trim() || undefined,
    role: input.role?.trim() || undefined,
    note: input.note?.trim() || undefined,
    color: input.color ?? nextColor(list),
    createdAt: new Date().toISOString(),
  };
  const next = [...list, member];
  writeRaw(next);
  return next;
}

export function updateMember(id: string, patch: Partial<NewMember>): Member[] {
  const list = readRaw().map((member) =>
    member.id === id
      ? {
          ...member,
          name: patch.name?.trim() || member.name,
          alias:
            patch.alias !== undefined ? patch.alias.trim() || undefined : member.alias,
          role: patch.role !== undefined ? patch.role.trim() || undefined : member.role,
          note: patch.note !== undefined ? patch.note.trim() || undefined : member.note,
          color: patch.color ?? member.color,
        }
      : member,
  );
  writeRaw(list);
  return list;
}

export function deleteMember(id: string): Member[] {
  const list = readRaw().filter((member) => member.id !== id);
  writeRaw(list);
  return list;
}

export function getMemberInitials(member: Member): string {
  const source = member.alias?.trim() || member.name.trim();
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// ── Live notifications ────────────────────────────────────────────────────
// Lobby views and pickers should auto-refresh when the list changes. A tiny
// event bus + storage listener gives us both in-tab and cross-tab updates.
type Listener = () => void;
const listeners = new Set<Listener>();

function emit() {
  for (const listener of listeners) listener();
}

function ensureCrossTabSync(): void {
  if (typeof window === "undefined") return;
  const flagged = window as unknown as { __amathMembersHooked?: boolean };
  if (flagged.__amathMembersHooked) return;
  flagged.__amathMembersHooked = true;
  window.addEventListener("storage", (event) => {
    if (event.key === STORAGE_KEY) emit();
  });
}

export function subscribeMembers(listener: Listener): () => void {
  ensureCrossTabSync();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
