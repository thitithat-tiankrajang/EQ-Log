import { useEffect, useMemo, useState } from "react";
import { BarChart3, Bot, Gamepad2, Medal, Sparkles, Trophy } from "lucide-react";
import { AccountChip, useAuth } from "../../auth";
import { AdminButton } from "../../admin";
import { ApplicationShell } from "../../app/shells/ApplicationShell";
import {
  isModeInProfileGroup,
  MODE_CATALOG,
  type ProfileModeKey,
} from "../../features/gameRecords/domain";
import { listMyModeStats, type UserModeStat } from "../../features/gameRecords/repository";

const AETHER_DIFFICULTIES = ["medium", "hard", "max", "super"] as const;

/** Tiers that can no longer be chosen but that finished games were played at.
 *  Listed only when the player actually has games there — dropping them
 *  outright would quietly subtract those games from a breakdown whose total is
 *  still counting them. */
const RETIRED_AETHER_DIFFICULTIES = ["easy"] as const;

export function ProfilePage() {
  const { configured, profile, userId } = useAuth();
  const [stats, setStats] = useState<UserModeStat[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    void listMyModeStats()
      .then((rows) => {
        if (active) {
          setStats(rows);
          setError(null);
        }
      })
      .catch((cause) => {
        if (active)
          setError(cause instanceof Error ? cause.message : "Unable to load profile statistics.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [userId]);

  const totals = useMemo(
    () =>
      stats.reduce(
        (result, row) => ({
          created: result.created + row.gamesCreated,
          played: result.played + row.gamesPlayed,
          wins: result.wins + row.wins,
          losses: result.losses + row.losses,
          draws: result.draws + row.draws,
          soloScore: result.soloScore + row.soloScore,
        }),
        { created: 0, played: 0, wins: 0, losses: 0, draws: 0, soloScore: 0 },
      ),
    [stats],
  );
  const groupedStats = MODE_CATALOG.map((mode) => ({
    mode,
    ...aggregateModeStats(stats, mode.key),
  }));
  const favorite = [...groupedStats].sort(
    (a, b) => b.gamesPlayed - a.gamesPlayed || b.lastPlayedAt.localeCompare(a.lastPlayedAt),
  )[0];
  const favoriteLabel = favorite?.gamesPlayed ? favorite.mode.label : "Not played yet";
  const versusFinished = totals.wins + totals.losses + totals.draws;
  const winRate = versusFinished ? Math.round((totals.wins / versusFinished) * 100) : 0;
  const overviewRows = [
    {
      icon: <Gamepad2 aria-hidden size={19} />,
      label: "Games created",
      value: totals.created.toLocaleString(),
      detail: "Games you have started across every mode.",
    },
    {
      icon: <BarChart3 aria-hidden size={19} />,
      label: "Games played",
      value: totals.played.toLocaleString(),
      detail: "Games recorded on this profile across every mode.",
    },
    {
      icon: <Sparkles aria-hidden size={19} />,
      label: "Favorite mode",
      value: favoriteLabel,
      detail: "The mode with your highest number of games played.",
    },
    {
      icon: <Trophy aria-hidden size={19} />,
      label: "Versus win rate",
      value: `${winRate}%`,
      detail: `Wins ${totals.wins} · Losses ${totals.losses} · Draws ${totals.draws}`,
    },
    {
      icon: <Medal aria-hidden size={19} />,
      label: "Solo score",
      value: totals.soloScore.toLocaleString(),
      detail: "Combined score from Solo Practice games.",
    },
  ];

  if (configured && !userId) {
    return (
      <ApplicationShell title="Profile" actions={<AccountChip />}>
        <section className="eq-state eq-state-access">
          <Gamepad2 size={30} />
          <h2>Sign in to see your profile</h2>
          <p>Lifetime play statistics are attached to your account.</p>
        </section>
      </ApplicationShell>
    );
  }

  return (
    <ApplicationShell
      title={profile?.display_name ?? "Profile"}
      description={
        profile?.region_name ? `Member of ${profile.region_name}` : "Your lifetime EQ Lab activity"
      }
      routeKey="profile"
      actions={
        <>
          <AccountChip />
          <AdminButton />
        </>
      }
    >
      {error && (
        <p className="eq-alert eq-alert-error" role="alert">
          {error}
        </p>
      )}
      {loading ? (
        <div className="eq-skeleton-list" role="status" aria-label="Loading profile statistics">
          <span />
          <span />
          <span />
        </div>
      ) : (
        <>
          <section className="eq-section" aria-labelledby="profile-overview-heading">
            <div className="eq-section-heading">
              <div>
                <span className="eq-eyebrow">Account summary</span>
                <h2 id="profile-overview-heading">Profile overview</h2>
              </div>
            </div>
            <div className="eq-game-table-wrap">
              <table
                className="eq-game-table eq-profile-table eq-profile-overview-table"
                aria-label="Profile overview"
              >
                <thead>
                  <tr>
                    <th scope="col">Content</th>
                    <th scope="col">Value</th>
                    <th scope="col">Details</th>
                  </tr>
                </thead>
                <tbody>
                  {overviewRows.map((row) => (
                    <tr key={row.label}>
                      <th className="eq-profile-table-label" scope="row">
                        <span className="eq-profile-table-title">
                          <span className="eq-profile-table-icon">{row.icon}</span>
                          <strong>{row.label}</strong>
                        </span>
                      </th>
                      <td className="eq-profile-table-value" data-label="Value">
                        {row.value}
                      </td>
                      <td className="eq-profile-table-detail" data-label="Details">
                        {row.detail}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          <section className="eq-section" aria-labelledby="mode-breakdown-heading">
            <div className="eq-section-heading">
              <div>
                <span className="eq-eyebrow">Lifetime analytics</span>
                <h2 id="mode-breakdown-heading">Mode breakdown</h2>
              </div>
            </div>
            <div className="eq-game-table-wrap">
              <table
                className="eq-game-table eq-profile-table eq-profile-mode-table"
                aria-label="Mode breakdown"
              >
                <thead>
                  <tr>
                    <th scope="col">Mode</th>
                    <th scope="col">Activity</th>
                    <th scope="col">Performance</th>
                    <th scope="col">Details</th>
                  </tr>
                </thead>
                <tbody>
                  {groupedStats.map(({ mode, ...row }) => {
                    const finished = row.wins + row.losses + row.draws;
                    const rate = finished ? Math.round((row.wins / finished) * 100) : 0;
                    return (
                      <tr className={row.gamesPlayed ? undefined : "is-unplayed"} key={mode.key}>
                        <th className="eq-profile-table-label" scope="row">
                          <span className="eq-profile-table-title">
                            <span className="eq-profile-table-icon">
                              {mode.key === "aether" ? (
                                <Bot aria-hidden size={19} />
                              ) : (
                                <Gamepad2 aria-hidden size={19} />
                              )}
                            </span>
                            <span className="eq-profile-table-copy">
                              <strong>{mode.label}</strong>
                              <small>{mode.family === "solo" ? "Solo" : "Versus"}</small>
                            </span>
                          </span>
                        </th>
                        <td data-label="Activity">
                          <span className="eq-profile-table-cell-stack">
                            <strong>{row.gamesPlayed.toLocaleString()} played</strong>
                            <small>{row.gamesCreated.toLocaleString()} created</small>
                          </span>
                        </td>
                        <td data-label="Performance">
                          <span className="eq-profile-table-cell-stack">
                            {mode.family === "solo" ? (
                              <>
                                <strong>{row.soloScore.toLocaleString()} total score</strong>
                                <small>Across all Solo Practice games</small>
                              </>
                            ) : (
                              <>
                                <strong>{rate}% win rate</strong>
                                <small>
                                  Wins {row.wins} · Losses {row.losses} · Draws {row.draws}
                                </small>
                              </>
                            )}
                          </span>
                        </td>
                        <td className="eq-profile-table-detail" data-label="Details">
                          <span className="eq-profile-table-cell-stack">
                            {mode.key === "aether" && (
                              <span className="eq-aether-variants">
                                {[
                                  ...RETIRED_AETHER_DIFFICULTIES.filter(
                                    (difficulty) =>
                                      (stats.find((item) => item.modeKey === `aether_${difficulty}`)
                                        ?.gamesPlayed ?? 0) > 0,
                                  ),
                                  ...AETHER_DIFFICULTIES,
                                ]
                                  .map(
                                    (difficulty) =>
                                      `${difficulty} ${stats.find((item) => item.modeKey === `aether_${difficulty}`)?.gamesPlayed ?? 0}`,
                                  )
                                  .join(" · ")}
                              </span>
                            )}
                            <span>{formatLastPlayed(row.lastPlayedAt)}</span>
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </ApplicationShell>
  );
}

function aggregateModeStats(stats: UserModeStat[], profileKey: ProfileModeKey) {
  const rows = stats.filter((row) => isModeInProfileGroup(row.modeKey, profileKey));
  return rows.reduce(
    (result, row) => ({
      gamesCreated: result.gamesCreated + row.gamesCreated,
      gamesPlayed: result.gamesPlayed + row.gamesPlayed,
      wins: result.wins + row.wins,
      losses: result.losses + row.losses,
      draws: result.draws + row.draws,
      soloScore: result.soloScore + row.soloScore,
      lastPlayedAt:
        (row.lastPlayedAt ?? "").localeCompare(result.lastPlayedAt) > 0
          ? (row.lastPlayedAt ?? "")
          : result.lastPlayedAt,
    }),
    {
      gamesCreated: 0,
      gamesPlayed: 0,
      wins: 0,
      losses: 0,
      draws: 0,
      soloScore: 0,
      lastPlayedAt: "",
    },
  );
}

function formatLastPlayed(value: string): string {
  if (!value) return "Not played yet";
  return `Last played ${new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(value))}`;
}
