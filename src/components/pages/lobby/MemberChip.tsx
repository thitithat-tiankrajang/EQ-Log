import type { Member } from "../../../members";
import { getMemberInitials } from "../../../members";

type Size = "sm" | "md";

export function MemberAvatar({ member, size = "sm" }: { member: Member; size?: Size }) {
  return (
    <span
      aria-hidden
      className={`member-avatar member-avatar-${size}`}
      style={{ background: member.color }}
    >
      {getMemberInitials(member)}
    </span>
  );
}

export function MemberChip({
  member,
  hint,
  size = "sm",
}: {
  member: Member;
  hint?: string | null;
  size?: Size;
}) {
  return (
    <span className={`member-chip member-chip-${size}`} title={member.name}>
      <MemberAvatar member={member} size={size} />
      <span className="member-chip-name">
        {member.alias?.trim() || member.name}
        {hint && <em>{hint}</em>}
      </span>
    </span>
  );
}

export function MemberPlaceholderChip({ name, hint }: { name: string; hint?: string | null }) {
  const initials = (() => {
    const trimmed = name.trim();
    if (!trimmed) return "?";
    const parts = trimmed.split(/\s+/);
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  })();
  return (
    <span className="member-chip member-chip-sm member-chip-placeholder" title={name}>
      <span aria-hidden className="member-avatar member-avatar-sm member-avatar-placeholder">
        {initials}
      </span>
      <span className="member-chip-name">
        {name || "Unknown"}
        {hint && <em>{hint}</em>}
      </span>
    </span>
  );
}
