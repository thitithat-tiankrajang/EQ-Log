import { useState } from "react";
import { Search, SlidersHorizontal, Upload, X } from "lucide-react";
import type { Member } from "../../../members";
import { ROOM_STATUS_TEXT } from "../../../uiText";
import { Sheet } from "../../ui/Sheet";
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
  importDisabledReason,
  onChange,
  onImportClick,
}: {
  filter: RoomsFilterState;
  members: Member[];
  totalCount: number;
  visibleCount: number;
  importDisabledReason: string | null;
  onChange: (next: RoomsFilterState) => void;
  onImportClick: () => void;
}) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const usedIds = new Set(filter.members.map((entry) => entry.memberId));
  const remaining = members.filter((member) => !usedIds.has(member.id));
  const memberFiltersActive = filter.members.length > 0;

  return (
    <div className="room-filters">
      <div className="room-filters-row">
        <label className="room-filters-search">
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
          className={`room-filters-more ${memberFiltersActive ? "active" : ""}`}
          aria-label="More filters"
          onClick={() => setSheetOpen(true)}
        >
          <SlidersHorizontal size={16} />
          {memberFiltersActive && <span className="room-filters-more-dot" aria-hidden />}
        </button>
      </div>

      <div className="room-filters-segment" role="tablist" aria-label="Status">
        {STATUS_OPTIONS.map((option) => (
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

      {(visibleCount !== totalCount || memberFiltersActive) && (
        <div className="room-filters-summary">
          Showing <strong>{visibleCount}</strong> of {totalCount} rooms
          {memberFiltersActive && (
            <button
              type="button"
              className="room-filters-clear"
              onClick={() => onChange({ ...filter, members: [] })}
            >
              Clear member filters
            </button>
          )}
        </div>
      )}

      <Sheet open={sheetOpen} title="Filters & tools" onClose={() => setSheetOpen(false)}>
        <div className="filter-sheet-section">
          <span className="field-row-label">Players in this room</span>
          <p className="filter-sheet-hint">Narrow the list to games a member played in.</p>
          {filter.members.map((entry) => {
            const member = members.find((candidate) => candidate.id === entry.memberId);
            if (!member) return null;
            return (
              <span key={entry.memberId} className="member-filter-chip">
                <MemberAvatar member={member} />
                <span className="member-filter-name">{member.name}</span>
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
                  {member.institution ? `${member.name} · ${member.institution}` : member.name}
                </option>
              ))}
            </select>
          )}
          {members.length === 0 && (
            <p className="filter-sheet-hint">Add members in the Members tab first.</p>
          )}
        </div>

        <div className="filter-sheet-section">
          <span className="field-row-label">Tools</span>
          <button
            type="button"
            className="ui-button-ghost"
            disabled={Boolean(importDisabledReason)}
            onClick={() => {
              setSheetOpen(false);
              onImportClick();
            }}
          >
            <Upload size={15} />
            Import a saved game file
          </button>
          {importDisabledReason && <p className="filter-sheet-hint">{importDisabledReason}</p>}
        </div>
      </Sheet>
    </div>
  );
}
