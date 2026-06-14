import { Search, X } from "lucide-react";
import type { Member } from "../../../members";
import { MemberAvatar } from "./MemberChip";

export type MemberFilterPosition = "any" | "first" | "second";
export type RoomStatusFilter = "all" | "playing" | "draft" | "finished";

export type MemberFilter = {
  memberId: string;
  position: MemberFilterPosition;
};

export type RoomsFilterState = {
  search: string;
  status: RoomStatusFilter;
  members: MemberFilter[];
};

export function defaultRoomsFilter(): RoomsFilterState {
  return { search: "", status: "all", members: [] };
}

export function RoomFilters({
  filter,
  members,
  totalCount,
  visibleCount,
  onChange,
}: {
  filter: RoomsFilterState;
  members: Member[];
  totalCount: number;
  visibleCount: number;
  onChange: (next: RoomsFilterState) => void;
}) {
  const usedIds = new Set(filter.members.map((entry) => entry.memberId));
  const remaining = members.filter((member) => !usedIds.has(member.id));

  return (
    <div className="room-filters">
      <div className="room-filters-row">
        <label className="room-filters-search">
          <Search size={15} aria-hidden />
          <input
            type="search"
            placeholder="Search room name or player"
            value={filter.search}
            onChange={(event) => onChange({ ...filter, search: event.target.value })}
          />
        </label>
        <div className="room-filters-segment" role="tablist" aria-label="Status">
          {(
            [
              { id: "all", label: "All" },
              { id: "playing", label: "Playing" },
              { id: "draft", label: "Draft" },
              { id: "finished", label: "Finished" },
            ] as const
          ).map((option) => (
            <button
              key={option.id}
              type="button"
              role="tab"
              aria-selected={filter.status === option.id}
              className={filter.status === option.id ? "active" : ""}
              onClick={() => onChange({ ...filter, status: option.id })}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <div className="room-filters-chips">
        <span className="room-filters-label">Players in this room</span>
        {filter.members.length === 0 && (
          <span className="room-filters-hint">Pick a member to narrow to games they played in.</span>
        )}
        {filter.members.map((entry) => {
          const member = members.find((candidate) => candidate.id === entry.memberId);
          if (!member) return null;
          return (
            <span key={entry.memberId} className="member-filter-chip" style={{ borderColor: member.color }}>
              <MemberAvatar member={member} />
              <span className="member-filter-name">{member.alias?.trim() || member.name}</span>
              <select
                className="member-filter-position"
                value={entry.position}
                onChange={(event) =>
                  onChange({
                    ...filter,
                    members: filter.members.map((item) =>
                      item.memberId === entry.memberId
                        ? { ...item, position: event.target.value as MemberFilterPosition }
                        : item,
                    ),
                  })
                }
              >
                <option value="any">played</option>
                <option value="first">started 1st</option>
                <option value="second">started 2nd</option>
              </select>
              <button
                type="button"
                className="member-filter-remove"
                aria-label={`Remove ${member.name} from filter`}
                onClick={() =>
                  onChange({
                    ...filter,
                    members: filter.members.filter((item) => item.memberId !== entry.memberId),
                  })
                }
              >
                <X size={13} />
              </button>
            </span>
          );
        })}
        {filter.members.length < 2 && remaining.length > 0 && (
          <select
            className="member-filter-add"
            value=""
            onChange={(event) => {
              const id = event.target.value;
              if (!id) return;
              onChange({
                ...filter,
                members: [...filter.members, { memberId: id, position: "any" }],
              });
            }}
          >
            <option value="">+ Add member</option>
            {remaining.map((member) => (
              <option key={member.id} value={member.id}>
                {member.alias?.trim() || member.name}
              </option>
            ))}
          </select>
        )}
        {filter.members.length > 0 && (
          <button
            type="button"
            className="room-filters-clear"
            onClick={() => onChange({ ...filter, members: [] })}
          >
            Clear
          </button>
        )}
      </div>

      <div className="room-filters-summary">
        Showing <strong>{visibleCount}</strong> of {totalCount} rooms
      </div>
    </div>
  );
}
