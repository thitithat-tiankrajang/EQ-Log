import { useState } from "react";
import { Check, Pencil, Plus, Trash2, X } from "lucide-react";
import {
  type Member,
  MEMBER_COLORS,
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

  function handleCreate(input: { name: string; alias?: string; role?: string; note?: string; color?: string }) {
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
                    onCancel={() => setEditingId(null)}
                    onSave={(patch) => handleUpdate(member.id, patch)}
                    submitLabel="Save changes"
                  />
                </li>
              );
            }
            return (
              <li key={member.id} className="member-card">
                <span className="member-card-avatar" style={{ background: member.color }} aria-hidden>
                  {getMemberInitials(member)}
                </span>
                <div className="member-card-body">
                  <div className="member-card-title">
                    <strong>{member.name}</strong>
                    {member.alias && <em>· {member.alias}</em>}
                  </div>
                  {member.role && <div className="member-card-role">{member.role}</div>}
                  {member.note && <div className="member-card-note">{member.note}</div>}
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
  onSave,
  onCancel,
  submitLabel,
}: {
  initial?: Member;
  onSave: (input: { name: string; alias?: string; role?: string; note?: string; color?: string }) => void;
  onCancel: () => void;
  submitLabel: string;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [alias, setAlias] = useState(initial?.alias ?? "");
  const [role, setRole] = useState(initial?.role ?? "");
  const [note, setNote] = useState(initial?.note ?? "");
  const [color, setColor] = useState(initial?.color ?? MEMBER_COLORS[0]);

  return (
    <form
      className="member-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (!name.trim()) return;
        onSave({ name, alias, role, note, color });
      }}
    >
      <div className="member-form-row">
        <label className="member-form-field grow">
          <span>Full name</span>
          <input value={name} onChange={(event) => setName(event.target.value)} autoFocus required />
        </label>
        <label className="member-form-field">
          <span>Nickname</span>
          <input value={alias} onChange={(event) => setAlias(event.target.value)} placeholder="optional" />
        </label>
      </div>
      <div className="member-form-row">
        <label className="member-form-field grow">
          <span>Role / team</span>
          <input value={role} onChange={(event) => setRole(event.target.value)} placeholder="optional" />
        </label>
        <label className="member-form-field grow">
          <span>Note</span>
          <input value={note} onChange={(event) => setNote(event.target.value)} placeholder="optional" />
        </label>
      </div>
      <fieldset className="member-form-colors">
        <legend>Color tag</legend>
        <div>
          {MEMBER_COLORS.map((swatch) => (
            <button
              key={swatch}
              type="button"
              aria-label={`Pick color ${swatch}`}
              className={`color-swatch ${swatch === color ? "active" : ""}`}
              style={{ background: swatch }}
              onClick={() => setColor(swatch)}
            />
          ))}
        </div>
      </fieldset>
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
