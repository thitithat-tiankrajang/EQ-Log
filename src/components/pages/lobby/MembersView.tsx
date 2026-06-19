import { useMemo, useState } from "react";
import { Check, Pencil, Plus, Trash2, X } from "lucide-react";
import {
  type Member,
  createMember,
  deleteMember,
  getMemberInitials,
  updateMember,
} from "../../../members";
import type { MemberStats } from "../../../stats";
import { formatAverage, formatWinRate } from "../../../stats";

export function MembersView({
  members,
  statsByMember,
  canManage,
  error,
  loading,
  ownerId,
  onChange,
}: {
  members: Member[];
  statsByMember: Map<string, MemberStats>;
  canManage: boolean;
  error: string | null;
  loading: boolean;
  ownerId: string | null;
  onChange: (next: Member[]) => void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftOpen, setDraftOpen] = useState(false);
  const [operation, setOperation] = useState<string | null>(null);
  const [operationError, setOperationError] = useState<string | null>(null);
  const institutions = useMemo(
    () =>
      [...new Set(members.map((member) => member.institution).filter(Boolean) as string[])].sort(
        (a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }),
      ),
    [members],
  );

  async function handleCreate(input: { name: string; institution?: string }) {
    setOperation("Saving member...");
    setOperationError(null);
    try {
      onChange(await createMember(input, ownerId));
      setDraftOpen(false);
    } catch (nextError) {
      setOperationError(nextError instanceof Error ? nextError.message : "Unable to add this member.");
    } finally {
      setOperation(null);
    }
  }

  async function handleUpdate(id: string, patch: Parameters<typeof updateMember>[1]) {
    setOperation("Saving changes...");
    setOperationError(null);
    try {
      onChange(await updateMember(id, patch, ownerId));
      setEditingId(null);
    } catch (nextError) {
      setOperationError(nextError instanceof Error ? nextError.message : "Unable to update this member.");
    } finally {
      setOperation(null);
    }
  }

  async function handleDelete(id: string) {
    const member = members.find((entry) => entry.id === id);
    if (!member) return;
    if (!window.confirm(`Remove ${member.name} from the directory?\nExisting game records keep the name on file.`)) {
      return;
    }
    setOperation("Deleting member...");
    setOperationError(null);
    try {
      onChange(await deleteMember(id, ownerId));
    } catch (nextError) {
      setOperationError(nextError instanceof Error ? nextError.message : "Unable to delete this member.");
    } finally {
      setOperation(null);
    }
  }

  return (
    <div className="members-view">
      <div className="members-view-head">
        <div>
          <h2>Organization members</h2>
          <p>
            {canManage
              ? "This is your private player directory. Only your account can use these members when creating rooms."
              : "Sign in with an approved account to manage your private player directory."}
          </p>
        </div>
        {canManage && !draftOpen && (
          <button className="solid-button" disabled={Boolean(operation)} type="button" onClick={() => setDraftOpen(true)}>
            <Plus size={15} />
            Add member
          </button>
        )}
      </div>

      {(operationError ?? error) && <p className="sync-banner">{operationError ?? error}</p>}
      {operation && <p className="info-banner member-operation" role="status">{operation}</p>}

      {draftOpen && canManage && (
        <MemberFormCard
          busy={Boolean(operation)}
          onCancel={() => setDraftOpen(false)}
          institutions={institutions}
          onSave={handleCreate}
          submitLabel="Add to directory"
        />
      )}

      {loading ? (
        <p className="empty-state" role="status">Loading your members...</p>
      ) : members.length === 0 && !draftOpen ? (
        <p className="empty-state">
          {canManage
            ? "Your directory is empty. Add the first member to get started."
            : "No member directory is available for this account."}
        </p>
      ) : (
        <ul className="member-list">
          {members.map((member) => {
            const stats = statsByMember.get(member.id);
            if (editingId === member.id && canManage) {
              return (
                <li key={member.id}>
                  <MemberFormCard
                    busy={Boolean(operation)}
                    initial={member}
                    institutions={institutions}
                    onCancel={() => setEditingId(null)}
                    onSave={(patch) => handleUpdate(member.id, patch)}
                    submitLabel="Save changes"
                  />
                </li>
              );
            }
            return (
              <li key={member.id} className="member-card">
                <span className="member-card-avatar" aria-hidden>
                  {getMemberInitials(member)}
                </span>
                <div className="member-card-body">
                  <div className="member-card-title">
                    <strong>{member.name}</strong>
                  </div>
                  <div className="member-card-institution">
                    {member.institution ?? "No institution"}
                  </div>
                </div>
                <div className="member-card-stats">
                  <span>
                    <em>{stats?.games ?? 0}</em>
                    games
                  </span>
                  <span>
                    <em>{stats ? formatWinRate(stats.winRate) : "—"}</em>
                    win rate
                  </span>
                  <span>
                    <em>{stats ? formatAverage(stats.avgScore) : "—"}</em>
                    avg score
                  </span>
                </div>
                {canManage && (
                  <div className="member-card-actions">
                    <button disabled={Boolean(operation)} type="button" aria-label="Edit member" onClick={() => setEditingId(member.id)}>
                      <Pencil size={14} />
                    </button>
                    <button
                      type="button"
                      className="danger"
                      disabled={Boolean(operation)}
                      aria-label="Delete member"
                      onClick={() => handleDelete(member.id)}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function MemberFormCard({
  busy,
  initial,
  institutions,
  onSave,
  onCancel,
  submitLabel,
}: {
  busy: boolean;
  initial?: Member;
  institutions: string[];
  onSave: (input: { name: string; institution?: string }) => void | Promise<void>;
  onCancel: () => void;
  submitLabel: string;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const hasInitialInstitution =
    initial?.institution &&
    institutions.some(
      (entry) =>
        entry.localeCompare(initial.institution ?? "", undefined, { sensitivity: "base" }) === 0,
    );
  const [institutionMode, setInstitutionMode] = useState<"existing" | "new">(
    institutions.length > 0 && hasInitialInstitution ? "existing" : "new",
  );
  const [existingInstitution, setExistingInstitution] = useState(
    hasInitialInstitution ? initial?.institution ?? "" : "",
  );
  const [newInstitution, setNewInstitution] = useState(hasInitialInstitution ? "" : initial?.institution ?? "");
  const selectedInstitution =
    institutionMode === "existing" ? existingInstitution : newInstitution;

  return (
    <form
      className="member-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (!name.trim()) return;
        if (!selectedInstitution.trim()) return;
        void onSave({ name, institution: selectedInstitution });
      }}
    >
      <div className="member-form-row">
        <label className="member-form-field grow">
          <span>Name</span>
          <input value={name} onChange={(event) => setName(event.target.value)} autoFocus required />
        </label>
        <div className="member-form-field grow">
          <span>Institution</span>
          <div className="institution-picker">
            <select
              value={institutionMode === "new" ? "__new__" : existingInstitution}
              required={institutionMode === "existing"}
              onChange={(event) => {
                if (event.target.value === "__new__") {
                  setInstitutionMode("new");
                  return;
                }
                setInstitutionMode("existing");
                setExistingInstitution(event.target.value);
              }}
            >
              <option value="" disabled>
                Select institution
              </option>
              {institutions.map((institution) => (
                <option key={institution} value={institution}>
                  {institution}
                </option>
              ))}
              <option value="__new__">New institution...</option>
            </select>
            {institutionMode === "new" && (
              <input
                value={newInstitution}
                onChange={(event) => setNewInstitution(event.target.value)}
                placeholder="Institution name"
                required
              />
            )}
          </div>
          <small>Choose an existing institution or type a new one to create its group.</small>
        </div>
      </div>
      <div className="member-form-actions">
        <button type="button" className="ghost-button" disabled={busy} onClick={onCancel}>
          <X size={14} />
          Cancel
        </button>
        <button type="submit" className="solid-button" disabled={busy}>
          <Check size={14} />
          {submitLabel}
        </button>
      </div>
    </form>
  );
}
