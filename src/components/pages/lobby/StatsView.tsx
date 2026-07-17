import { useMemo, useState } from "react";
import { ArrowLeft } from "lucide-react";
import type { Member } from "../../../members";
import type { MemberStats } from "../../../stats";
import { formatAverage, formatWinRate } from "../../../stats";
import { MemberAvatar, MemberChip } from "./MemberChip";

export function StatsView({
  members,
  statsByMember,
  initialFocusId = null,
}: {
  members: Member[];
  statsByMember: Map<string, MemberStats>;
  initialFocusId?: string | null;
}) {
  const [focusedId, setFocusedId] = useState<string | null>(initialFocusId);

  const rows = useMemo(() => {
    return members
      .map((member) => ({
        member,
        stats: statsByMember.get(member.id) ?? null,
      }))
      .sort((a, b) => (b.stats?.games ?? 0) - (a.stats?.games ?? 0));
  }, [members, statsByMember]);

  const focusedMember = focusedId ? members.find((member) => member.id === focusedId) ?? null : null;
  const focusedStats = focusedId ? statsByMember.get(focusedId) ?? null : null;

  if (focusedMember && focusedStats) {
    return (
      <HeadToHeadView
        focused={focusedMember}
        focusedStats={focusedStats}
        members={members}
        onBack={() => setFocusedId(null)}
      />
    );
  }

  if (members.length === 0) {
    return (
      <p className="empty-state">
        Add members in the Members tab to start tracking head-to-head statistics.
      </p>
    );
  }

  const finishedRows = rows.filter((row) => (row.stats?.finished ?? 0) > 0).length;

  return (
    <div className="stats-view">
      <header className="stats-view-head">
        <h2>Member statistics</h2>
        <p>Counted from finished rooms only. Tap a member for the head-to-head breakdown.</p>
      </header>

      {/* Phone: ranked list (an 8-column table can't fit 375px without
          horizontal scrolling). Desktop keeps the full table below. */}
      <ol className="stats-ranked">
        {rows.map(({ member, stats }, index) => (
          <li key={member.id}>
            <button
              type="button"
              className="stats-ranked-row"
              disabled={!stats || stats.games === 0}
              onClick={() => setFocusedId(member.id)}
            >
              <span className="stats-ranked-pos">{index + 1}</span>
              <MemberAvatar member={member} />
              <span className="stats-ranked-copy">
                <strong>{member.name}</strong>
                <span>
                  {stats?.games ?? 0} games
                  {stats && stats.games > 0 && ` · ${formatWinRate(stats.winRate)} win`}
                  {stats && stats.games > 0 && ` · avg ${formatAverage(stats.avgScore)}`}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ol>

      <div className="stats-table-wrap">
        <table className="stats-table">
          <thead>
            <tr>
              <th>Member</th>
              <th>Games</th>
              <th>W · L · D</th>
              <th>Win rate</th>
              <th>Avg score</th>
              <th>Avg vs</th>
              <th>Last played</th>
              <th aria-label="Open detail" />
            </tr>
          </thead>
          <tbody>
            {rows.map(({ member, stats }) => (
              <tr key={member.id}>
                <td>
                  <MemberChip member={member} size="md" />
                </td>
                <td className="num">{stats?.games ?? 0}</td>
                <td className="num">
                  {stats ? `${stats.wins} · ${stats.losses} · ${stats.draws}` : "—"}
                </td>
                <td className="num">{stats ? formatWinRate(stats.winRate) : "—"}</td>
                <td className="num">{stats ? formatAverage(stats.avgScore) : "—"}</td>
                <td className="num">
                  {stats && stats.games > 0
                    ? formatAverage(stats.pointsAgainst / stats.games)
                    : "—"}
                </td>
                <td>{stats?.lastPlayedAt ? formatDate(stats.lastPlayedAt) : "—"}</td>
                <td>
                  <button
                    className="ghost-button stats-row-open"
                    type="button"
                    disabled={!stats || stats.games === 0}
                    onClick={() => setFocusedId(member.id)}
                  >
                    Open
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {finishedRows === 0 && (
        <p className="stats-hint">
          No finished games yet — win rate and head-to-head numbers appear once at least one game wraps up.
        </p>
      )}
    </div>
  );
}

function HeadToHeadView({
  focused,
  focusedStats,
  members,
  onBack,
}: {
  focused: Member;
  focusedStats: MemberStats;
  members: Member[];
  onBack: () => void;
}) {
  const opponentRows = focusedStats.opponents.map((entry) => ({
    entry,
    member: members.find((member) => member.id === entry.opponentId) ?? null,
  }));

  return (
    <div className="stats-view stats-head2head">
      <header className="stats-view-head">
        <button className="ghost-button" type="button" onClick={onBack}>
          <ArrowLeft size={14} />
          Back to overview
        </button>
        <div className="stats-focus-card">
          <MemberAvatar member={focused} size="md" />
          <div>
            <h2>{focused.name}</h2>
            <p>
              {focusedStats.games} games · {focusedStats.wins}–{focusedStats.losses}–
              {focusedStats.draws} · {formatWinRate(focusedStats.winRate)} win rate
            </p>
          </div>
        </div>
      </header>

      {opponentRows.length === 0 ? (
        <p className="empty-state">
          No matchups yet. Record a game with a tagged opponent to populate this table.
        </p>
      ) : (
        <div className="stats-table-wrap">
          <table className="stats-table">
            <thead>
              <tr>
                <th>Opponent</th>
                <th>Games</th>
                <th>W · L · D</th>
                <th>Win rate</th>
                <th>Avg score</th>
                <th>Opponent avg</th>
                <th>Last played</th>
              </tr>
            </thead>
            <tbody>
              {opponentRows.map(({ entry, member }) => (
                <tr key={entry.opponentId}>
                  <td>
                    {member ? (
                      <MemberChip member={member} size="md" />
                    ) : (
                      <span className="member-chip member-chip-placeholder">
                        <span className="member-avatar member-avatar-sm member-avatar-placeholder">?</span>
                        <span className="member-chip-name">Unknown</span>
                      </span>
                    )}
                  </td>
                  <td className="num">{entry.games}</td>
                  <td className="num">
                    {entry.wins} · {entry.losses} · {entry.draws}
                  </td>
                  <td className="num">{formatWinRate(entry.winRate)}</td>
                  <td className="num">{formatAverage(entry.avgScore)}</td>
                  <td className="num">{formatAverage(entry.avgOpponentScore)}</td>
                  <td>{entry.lastPlayedAt ? formatDate(entry.lastPlayedAt) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function formatDate(iso: string): string {
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return "—";
  return then.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}
