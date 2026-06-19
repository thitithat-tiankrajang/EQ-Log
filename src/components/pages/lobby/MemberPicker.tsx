import { useEffect, useRef, useState } from "react";
import { ChevronDown, X } from "lucide-react";
import type { Member } from "../../../members";
import { MemberAvatar } from "./MemberChip";

export function MemberPicker({
  members,
  selectedId,
  freeText,
  placeholder,
  onSelectMember,
  onChangeFreeText,
}: {
  members: Member[];
  selectedId: string | null;
  freeText: string;
  placeholder?: string;
  onSelectMember: (memberId: string | null) => void;
  onChangeFreeText: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onPointer);
    return () => window.removeEventListener("mousedown", onPointer);
  }, [open]);

  const selected = selectedId ? members.find((member) => member.id === selectedId) ?? null : null;
  const displayValue = selected ? selected.name : freeText;

  return (
    <div className="member-picker" ref={ref}>
      <div className={`member-picker-input ${selected ? "linked" : ""}`}>
        {selected && (
          <span className="member-picker-avatar" aria-hidden>
            {selected.name.slice(0, 1).toUpperCase()}
          </span>
        )}
        <input
          type="text"
          value={displayValue}
          placeholder={placeholder ?? "Player name"}
          onChange={(event) => {
            if (selected) onSelectMember(null);
            onChangeFreeText(event.target.value);
          }}
          onFocus={() => setOpen(true)}
        />
        {selected && (
          <button
            type="button"
            className="member-picker-clear"
            aria-label="Unlink member"
            onClick={() => {
              onSelectMember(null);
              onChangeFreeText("");
            }}
          >
            <X size={14} />
          </button>
        )}
        <button
          type="button"
          className="member-picker-toggle"
          aria-label="Pick from members"
          onClick={() => setOpen((value) => !value)}
        >
          <ChevronDown size={16} />
        </button>
      </div>
      {open && (
        <div className="member-picker-popover" role="listbox">
          {members.length === 0 ? (
            <p className="member-picker-empty">
              No members yet. Use the Members tab to add the people in your organization.
            </p>
          ) : (
            <ul>
              {members.map((member) => (
                <li key={member.id}>
                  <button
                    type="button"
                    className={`member-picker-row ${selectedId === member.id ? "active" : ""}`}
                    onClick={() => {
                      onSelectMember(member.id);
                      onChangeFreeText(member.name);
                      setOpen(false);
                    }}
                  >
                    <MemberAvatar member={member} />
                    <span className="member-picker-name">
                      {member.name}
                      {member.institution && <em>{member.institution}</em>}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
