import { isSupabaseConfigured, supabase } from "./supabaseClient";

const STORAGE_KEY = "amath-lab-members-v1";

export type Member = {
  id: string;
  name: string;
  institution?: string;
  createdAt: string;
};

export type NewMember = {
  name: string;
  institution?: string;
};

type MemberRow = {
  id: string;
  owner_id: string;
  name: string;
  institution: string | null;
  created_at: string;
};

function readLocalMembers(): Member[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Array<Partial<Member> & { alias?: string; role?: string }>;
    return Array.isArray(parsed)
      ? parsed.map(normalizeMember).filter((member) => member.name)
      : [];
  } catch {
    return [];
  }
}

function writeLocalMembers(list: Member[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  emitLocalChange();
}

export function listMembers(): Member[] {
  return sortMembers(readLocalMembers());
}

export async function loadMembers(ownerId: string | null): Promise<Member[]> {
  if (!isSupabaseConfigured || !supabase) return listMembers();
  if (!ownerId) return [];
  const { data, error } = await supabase
    .from("members")
    .select("id,owner_id,name,institution,created_at")
    .eq("owner_id", ownerId)
    .order("name", { ascending: true });
  if (error) throw memberDatabaseError(error);
  return sortMembers(((data ?? []) as MemberRow[]).map(memberFromRow));
}

export async function createMember(input: NewMember, ownerId: string | null): Promise<Member[]> {
  const name = input.name.trim();
  if (!name) return loadMembers(ownerId);
  const current = await loadMembers(ownerId);
  const institution = resolveInstitution(input.institution, current);

  if (!isSupabaseConfigured || !supabase) {
    const next = [
      ...current,
      { id: crypto.randomUUID(), name, institution, createdAt: new Date().toISOString() },
    ];
    writeLocalMembers(next);
    return sortMembers(next);
  }
  if (!ownerId) throw new Error("Sign in before adding a member.");

  const { data, error } = await supabase
    .from("members")
    .insert({ owner_id: ownerId, name, institution: institution ?? null })
    .select("id,owner_id,name,institution,created_at")
    .single();
  if (error) throw memberDatabaseError(error);
  return sortMembers([...current, memberFromRow(data as MemberRow)]);
}

export async function updateMember(
  id: string,
  patch: Partial<NewMember>,
  ownerId: string | null,
): Promise<Member[]> {
  const current = await loadMembers(ownerId);
  const existing = current.find((member) => member.id === id);
  if (!existing) return current;
  const name = patch.name?.trim() || existing.name;
  const institution =
    patch.institution !== undefined
      ? resolveInstitution(patch.institution, current)
      : existing.institution;

  if (!isSupabaseConfigured || !supabase) {
    const next = current.map((member) =>
      member.id === id ? { ...member, name, institution } : member,
    );
    writeLocalMembers(next);
    return sortMembers(next);
  }
  if (!ownerId) throw new Error("Sign in before editing a member.");

  const { data, error } = await supabase
    .from("members")
    .update({ name, institution: institution ?? null, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("owner_id", ownerId)
    .select("id,owner_id,name,institution,created_at")
    .maybeSingle();
  if (error) throw memberDatabaseError(error);
  if (!data) throw new Error("This member does not belong to your account.");
  const updated = memberFromRow(data as MemberRow);
  return sortMembers(current.map((member) => (member.id === id ? updated : member)));
}

export async function deleteMember(id: string, ownerId: string | null): Promise<Member[]> {
  const current = await loadMembers(ownerId);
  if (!isSupabaseConfigured || !supabase) {
    const next = current.filter((member) => member.id !== id);
    writeLocalMembers(next);
    return next;
  }
  if (!ownerId) throw new Error("Sign in before deleting a member.");

  const { error } = await supabase
    .from("members")
    .delete()
    .eq("id", id)
    .eq("owner_id", ownerId);
  if (error) throw memberDatabaseError(error);
  return current.filter((member) => member.id !== id);
}

export function getMemberInitials(member: Member): string {
  const parts = member.name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

type Listener = () => void;
const localListeners = new Set<Listener>();

function emitLocalChange() {
  for (const listener of localListeners) listener();
}

function ensureCrossTabSync(): void {
  const flagged = window as unknown as { __amathMembersHooked?: boolean };
  if (flagged.__amathMembersHooked) return;
  flagged.__amathMembersHooked = true;
  window.addEventListener("storage", (event) => {
    if (event.key === STORAGE_KEY) emitLocalChange();
  });
}

export function subscribeMembers(ownerId: string | null, listener: Listener): () => void {
  if (!isSupabaseConfigured || !supabase) {
    ensureCrossTabSync();
    localListeners.add(listener);
    return () => localListeners.delete(listener);
  }
  if (!ownerId) return () => undefined;
  const client = supabase;
  const channel = client
    .channel(`members:${ownerId}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "members", filter: `owner_id=eq.${ownerId}` },
      listener,
    )
    .subscribe();
  return () => {
    void client.removeChannel(channel);
  };
}

function memberFromRow(row: MemberRow): Member {
  return {
    id: row.id,
    name: row.name.trim(),
    institution: normalizeInstitution(row.institution ?? undefined),
    createdAt: row.created_at,
  };
}

function normalizeMember(member: Partial<Member> & { alias?: string; role?: string }): Member {
  return {
    id: member.id || crypto.randomUUID(),
    name: (member.name ?? member.alias ?? "").trim(),
    institution: normalizeInstitution(member.institution ?? member.role),
    createdAt: member.createdAt || new Date().toISOString(),
  };
}

function sortMembers(list: Member[]): Member[] {
  return [...list].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
  );
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

function memberDatabaseError(error: { code?: string; message?: string }): Error {
  const text = `${error.code ?? ""} ${error.message ?? ""}`;
  if (/42P01|PGRST205|members.*schema cache|relation.*members/i.test(text)) {
    return new Error("Members database is not ready. Run supabase/members_migration.sql first.");
  }
  return new Error(error.message ?? "Unable to sync members.");
}
