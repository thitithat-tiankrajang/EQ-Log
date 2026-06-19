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
  isAdmin,
  onChange,
}: {
  members: Member[];
  statsByMember: Map<string, MemberStats>;
  isAdmin: boolean;
  onChange: (next: Member[]) => void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftOpen, setDraftOpen] = useState(false);
  const institutions = useMemo(
    () =>
      [...new Set(members.map((member) => member.institution).filter(Boolean) as string[])].sort(
        (a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }),
      ),
    [members],
  );

  function handleCreate(input: { name: string; institution?: string }) {
    onChange(createMember(input));
    setDraftOpen(false);
  }

  function handleUpdate(id: string, patch: Parameters<typeof updateMember>[1]) {
    onChange(updateMember(id, patch));
    setEditingId(null);
  }

  function handleDelete(id: string) {
    const member = members.find((entry) => entry.id === id);
    if (!member) return;
    if (!window.confirm(`Remove ${member.name} from the directory?\nExisting game records keep the name on file.`)) {
      return;
    }
    onChange(deleteMember(id));
  }

  return (
    <div className="members-view">
      <div className="members-view-head">
        <div>
          <h2>Organization members</h2>
          <p>
            {isAdmin
              ? "Add the people who play in your organization. They don't sign in — the admin just keeps the directory."
              : "These are the people in this organization. Only an admin can edit the list."}
          </p>
        </div>
        {isAdmin && !draftOpen && (
          <button className="solid-button" type="button" onClick={() => setDraftOpen(true)}>
            <Plus size={15} />
            Add member
          </button>
        )}
      </div>

      {draftOpen && isAdmin && (
        <MemberFormCard
          onCancel={() => setDraftOpen(false)}
          institutions={institutions}
          onSave={handleCreate}
          submitLabel="Add to directory"
        />
      )}

      {members.length === 0 && !draftOpen ? (
        <p className="empty-state">
          The directory is empty. {isAdmin ? "Add the first member to get started." : "Ask an admin to set this up."}
        </p>
      ) : (
        <ul className="member-list">
          {members.map((member) => {
            const stats = statsByMember.get(member.id);
            if (editingId === member.id && isAdmin) {
              return (
                <li key={member.id}>
                  <MemberFormCard
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
                {isAdmin && (
                  <div className="member-card-actions">
                    <button type="button" aria-label="Edit member" onClick={() => setEditingId(member.id)}>
                      <Pencil size={14} />
                    </button>
                    <button
                      type="button"
                      className="danger"
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
  initial,
  institutions,
  onSave,
  onCancel,
  submitLabel,
}: {
  initial?: Member;
  institutions: string[];
  onSave: (input: { name: string; institution?: string }) => void;
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
        onSave({ name, institution: selectedInstitution });
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
        <button type="button" className="ghost-button" onClick={onCancel}>
          <X size={14} />
          Cancel
        </button>
        <button type="submit" className="solid-button">
          <Check size={14} />
          {submitLabel}
        </button>
      </div>
    </form>
  );
}
