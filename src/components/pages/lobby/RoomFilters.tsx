import { useState } from "react";
import { Search, SlidersHorizontal, X } from "lucide-react";
import type { Member } from "../../../members";
import { ROOM_STATUS_TEXT } from "../../../uiText";
import { Sheet } from "../../ui/Sheet";
import { SelectControl } from "../../ui/SelectControl";
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

const STATUS_OPTIONS: Array<{ id: RoomStatusFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "playing", label: ROOM_STATUS_TEXT.playing },
  { id: "draft", label: ROOM_STATUS_TEXT.waiting },
  { id: "finished", label: ROOM_STATUS_TEXT.finished },
];

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
  const [sheetOpen, setSheetOpen] = useState(false);
  const usedIds = new Set(filter.members.map((entry) => entry.memberId));
  const remaining = members.filter((member) => !usedIds.has(member.id));
  const memberFiltersActive = filter.members.length > 0;

  return (
    <div className="eq-room-filters">
      <div className="eq-room-filters-row">
        <label className="eq-search-field eq-room-search">
          <Search size={15} aria-hidden />
          <input
            type="search"
            placeholder="Search room or player"
            value={filter.search}
            onChange={(event) => onChange({ ...filter, search: event.target.value })}
          />
        </label>
        <button
          type="button"
          className={`eq-icon-button ${memberFiltersActive ? "is-active" : ""}`}
          aria-label="More filters"
          onClick={() => setSheetOpen(true)}
        >
          <SlidersHorizontal size={16} />
          {memberFiltersActive && <span className="eq-filter-dot" aria-hidden />}
        </button>
      </div>

      <div className="eq-segmented-control" aria-label="Filter rooms by status">
        {STATUS_OPTIONS.map((option) => (
          <button
            key={option.id}
            type="button"
            aria-pressed={filter.status === option.id}
            className={filter.status === option.id ? "is-active" : ""}
            onClick={() => onChange({ ...filter, status: option.id })}
          >
            {option.label}
          </button>
        ))}
      </div>

      {(visibleCount !== totalCount || memberFiltersActive) && (
        <div className="eq-filter-summary">
          Showing <strong>{visibleCount}</strong> of {totalCount} rooms
          {memberFiltersActive && (
            <button
              type="button"
              className="eq-text-button"
              onClick={() => onChange({ ...filter, members: [] })}
            >
              Clear member filters
            </button>
          )}
        </div>
      )}

      <Sheet open={sheetOpen} title="Filters" onClose={() => setSheetOpen(false)}>
        <div className="eq-filter-sheet-section">
          <strong>Players in this room</strong>
          <p className="eq-help-text">Narrow the list to games a member played in.</p>
          {filter.members.map((entry) => {
            const member = members.find((candidate) => candidate.id === entry.memberId);
            if (!member) return null;
            return (
              <span key={entry.memberId} className="eq-member-filter-chip">
                <MemberAvatar member={member} />
                <span className="eq-member-filter-name">{member.name}</span>
                <SelectControl<MemberFilterPosition>
                  className="eq-member-filter-position"
                  ariaLabel={`${member.name} position`}
                  value={entry.position}
                  options={[
                    { value: "any", label: "played" },
                    { value: "first", label: "started 1st" },
                    { value: "second", label: "started 2nd" },
                  ]}
                  onChange={(value) =>
                    value &&
                    onChange({
                      ...filter,
                      members: filter.members.map((item) =>
                        item.memberId === entry.memberId ? { ...item, position: value } : item,
                      ),
                    })
                  }
                />
                <button
                  type="button"
                  className="eq-icon-button eq-filter-remove"
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
            <SelectControl<string>
              className="eq-select"
              ariaLabel="Add member filter"
              value=""
              placeholder="+ Add member"
              options={remaining.map((member) => ({
                value: member.id,
                label: member.institution ? `${member.name} · ${member.institution}` : member.name,
              }))}
              onChange={(id) => {
                if (!id) return;
                onChange({
                  ...filter,
                  members: [...filter.members, { memberId: id, position: "any" }],
                });
              }}
            />
          )}
          {members.length === 0 && (
            <p className="eq-help-text">Add members in the Members section first.</p>
          )}
        </div>
      </Sheet>
    </div>
  );
}
