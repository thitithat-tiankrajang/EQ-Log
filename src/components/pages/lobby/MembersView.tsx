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
import { OverflowMenu } from "../../ui/OverflowMenu";
import { ConfirmSheet, Sheet } from "../../ui/Sheet";

export function MembersView({
  members,
  statsByMember,
  canManage,
  error,
  loading,
  ownerId,
  onChange,
  onShowStats,
}: {
  members: Member[];
  statsByMember: Map<string, MemberStats>;
  canManage: boolean;
  error: string | null;
  loading: boolean;
  ownerId: string | null;
  onChange: (next: Member[]) => void;
  onShowStats?: (memberId: string) => void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftOpen, setDraftOpen] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [operation, setOperation] = useState<string | null>(null);
  const [operationError, setOperationError] = useState<string | null>(null);
  const institutions = useMemo(
    () =>
      [...new Set(members.map((member) => member.institution).filter(Boolean) as string[])].sort(
        (a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }),
      ),
    [members],
  );
  const editingMember = editingId ? members.find((entry) => entry.id === editingId) ?? null : null;
  const deletingMember = deletingId ? members.find((entry) => entry.id === deletingId) ?? null : null;

  async function handleCreate(input: { name: string; institution?: string }) {
    setOperation("Saving member…");
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
    setOperation("Saving changes…");
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
    setOperation("Deleting member…");
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
          <h2>Members</h2>
          <p>
            {canManage
              ? "Private directory — link members when creating rooms to track their stats."
              : "Sign in with an approved account to manage your player directory."}
          </p>
        </div>
        {canManage && (
          <button
            className="solid-button"
            disabled={Boolean(operation)}
            type="button"
            onClick={() => setDraftOpen(true)}
          >
            <Plus size={15} />
            Add member
          </button>
        )}
      </div>

      {(operationError ?? error) && <p className="sync-banner">{operationError ?? error}</p>}
      {operation && <p className="info-banner member-operation" role="status">{operation}</p>}

      {loading ? (
        <p className="empty-state" role="status">Loading your members…</p>
      ) : members.length === 0 ? (
        <p className="empty-state">
          {canManage
            ? "Your directory is empty. Add the first member to get started."
            : "No member directory is available for this account."}
        </p>
      ) : (
        <ul className="member-list">
          {members.map((member) => {
            const stats = statsByMember.get(member.id);
            return (
              <li key={member.id} className="member-row">
                <button
                  type="button"
                  className="member-row-open"
                  onClick={() => onShowStats?.(member.id)}
                >
                  <span className="member-card-avatar" aria-hidden>
                    {getMemberInitials(member)}
                  </span>
                  <span className="member-row-copy">
                    <strong>{member.name}</strong>
                    <span>
                      {member.institution ?? "No institution"}
                      {" · "}
                      {stats?.games ?? 0} games
                      {stats && stats.games > 0 && ` · ${formatWinRate(stats.winRate)} win`}
                      {stats && stats.games > 0 && ` · avg ${formatAverage(stats.avgScore)}`}
                    </span>
                  </span>
                </button>
                {canManage && (
                  <OverflowMenu
                    label={`Member actions · ${member.name}`}
                    items={[
                      {
                        icon: <Pencil size={16} />,
                        label: "Edit",
                        disabled: Boolean(operation),
                        onSelect: () => setEditingId(member.id),
                      },
                      {
                        icon: <Trash2 size={16} />,
                        label: "Delete",
                        danger: true,
                        disabled: Boolean(operation),
                        onSelect: () => setDeletingId(member.id),
                      },
                    ]}
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}

      <Sheet
        open={draftOpen && canManage}
        title="Add member"
        onClose={() => setDraftOpen(false)}
      >
        <MemberForm
          busy={Boolean(operation)}
          institutions={institutions}
          onCancel={() => setDraftOpen(false)}
          onSave={handleCreate}
          submitLabel="Add to directory"
        />
      </Sheet>

      <Sheet
        open={Boolean(editingMember) && canManage}
        title={`Edit ${editingMember?.name ?? "member"}`}
        onClose={() => setEditingId(null)}
      >
        {editingMember && (
          <MemberForm
            busy={Boolean(operation)}
            initial={editingMember}
            institutions={institutions}
            onCancel={() => setEditingId(null)}
            onSave={(patch) => handleUpdate(editingMember.id, patch)}
            submitLabel="Save changes"
          />
        )}
      </Sheet>

      <ConfirmSheet
        open={Boolean(deletingMember)}
        title="Delete member"
        consequence={`Remove ${deletingMember?.name ?? "this member"} from the directory? Existing game records keep the name on file.`}
        confirmLabel="Delete member"
        busy={Boolean(operation)}
        onCancel={() => setDeletingId(null)}
        onConfirm={() => {
          const id = deletingId;
          setDeletingId(null);
          if (id) void handleDelete(id);
        }}
      />
    </div>
  );
}

function MemberForm({
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
              <option value="__new__">New institution…</option>
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
          <small>Pick an existing institution or type a new one to create its group.</small>
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
