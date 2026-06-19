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
  institution?: string;
  createdAt: string;
  alias?: string;
  role?: string;
  note?: string;
  color?: string;
};

function readRaw(): Member[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Member[];
    return Array.isArray(parsed) ? parsed.map(normalizeMember).filter((member) => member.name) : [];
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

export function listInstitutions(): string[] {
  return [...new Set(readRaw().map((member) => member.institution).filter(Boolean) as string[])].sort(
    (a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }),
  );
}

export function findMember(id: string | null | undefined): Member | null {
  if (!id) return null;
  return readRaw().find((member) => member.id === id) ?? null;
}

export type NewMember = {
  name: string;
  institution?: string;
};

export function createMember(input: NewMember): Member[] {
  const list = readRaw();
  const name = input.name.trim();
  if (!name) return list;
  const member: Member = {
    id: crypto.randomUUID(),
    name,
    institution: resolveInstitution(input.institution, list),
    createdAt: new Date().toISOString(),
  };
  const next = [...list, member];
  writeRaw(next);
  return next;
}

export function updateMember(id: string, patch: Partial<NewMember>): Member[] {
  const raw = readRaw();
  const list = raw.map((member) => {
    if (member.id !== id) return member;
    return {
      id: member.id,
      name: patch.name?.trim() || member.name,
      institution:
        patch.institution !== undefined
          ? resolveInstitution(patch.institution, raw)
          : member.institution,
      createdAt: member.createdAt,
    };
  });
  writeRaw(list);
  return list;
}

export function deleteMember(id: string): Member[] {
  const list = readRaw().filter((member) => member.id !== id);
  writeRaw(list);
  return list;
}

export function getMemberInitials(member: Member): string {
  const source = member.name.trim();
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function normalizeMember(member: Partial<Member>): Member {
  const name = (member.name ?? member.alias ?? "").trim();
  return {
    id: member.id || crypto.randomUUID(),
    name,
    institution: normalizeInstitution(member.institution ?? member.role),
    createdAt: member.createdAt || new Date().toISOString(),
  };
}

function resolveInstitution(value: string | undefined, list: Member[]): string | undefined {
  const institution = normalizeInstitution(value);
  if (!institution) return undefined;
  return (
    list.find(
      (member) =>
        member.institution &&
        member.institution.localeCompare(institution, undefined, { sensitivity: "base" }) === 0,
    )?.institution ?? institution
  );
}

function normalizeInstitution(value: string | undefined): string | undefined {
  const institution = value?.trim().replace(/\s+/g, " ");
  return institution || undefined;
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
