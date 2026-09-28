import type { ReactNode } from "react";
import {
  Bot,
  ChevronRight,
  Flag,
  GraduationCap,
  KeyRound,
  Plus,
  Radio,
  Swords,
  Trophy,
} from "lucide-react";
import { ApplicationShell } from "../../../app/shells/ApplicationShell";
import { AccountChip } from "../../../auth";
import { isEngineApiConfigured } from "../../../bot/engineApi";
import type { ProBotStatus } from "../../../bot/catalog";
import type { GameStatus } from "../../../game";
import type { ArenaBot } from "../../../features/arena/arenaBots";
import { continuableGames, openGames } from "../../../features/arena/arenaGames";
import {
  useArenaBots,
  useArenaGames,
  type ArenaBots,
  type ArenaGames,
} from "../../../features/arena/useArenaHome";
import { useLocale } from "../../../i18n/LocaleProvider";
import type { MessageKey } from "../../../i18n/translate";
import type { RoomMeta } from "../../../rooms";
import { routeToHash } from "../../../router";
import { isSupabaseConfigured } from "../../../supabaseClient";

type Handlers = {
  /** Whose game a room is, as the app already decides it (the server's viewer role). */
  roleOf: (room: RoomMeta) => string;
  /** Resume a game of yours through the app's existing open path. */
  onContinue: (room: RoomMeta) => void;
  /** Open a listed room through the same path the lobby uses. */
  onOpenListed: (room: RoomMeta) => void;
  opening: boolean;
};

/**
 * Home, the Arena lobby: what you can continue, what is open to join now, and
 * the ways to start playing. It reads what the lobbies, the Ranked page and
 * the bot catalogue already read, and every action leads to the page that
 * owns it; nothing here decides whether a game can be joined or started.
 */
export function ArenaHome({
  remoteEnabled,
  regionId,
  userId,
  ...handlers
}: Handlers & { remoteEnabled: boolean; regionId: string | null; userId: string | null }) {
  const { games, reload } = useArenaGames({ remoteEnabled, regionId, userId });
  const { bots, reload: reloadBots } = useArenaBots({
    serverAvailable: isSupabaseConfigured && isEngineApiConfigured,
  });
  return (
    <ArenaHomeView
      games={games}
      bots={bots}
      regionAvailable={Boolean(regionId)}
      onReloadGames={reload}
      onReloadBots={reloadBots}
      {...handlers}
    />
  );
}

export function ArenaHomeView({
  games,
  bots,
  regionAvailable,
  roleOf,
  onContinue,
  onOpenListed,
  onReloadGames,
  onReloadBots,
  opening,
}: Handlers & {
  games: ArenaGames;
  bots: ArenaBots;
  regionAvailable: boolean;
  onReloadGames: () => void;
  onReloadBots: () => void;
}) {
  const { t } = useLocale();
  const mine = games.status === "ready" ? continuableGames(games.rooms, roleOf) : [];
  const ranked = games.status === "ready" ? (games.ranked?.mine ?? []) : [];
  const open = games.status === "ready" ? openGames(games.rooms, roleOf) : [];
  const rankedWaiting = games.status === "ready" ? (games.ranked?.waitingForOpponent ?? 0) : 0;
  const hasContinue = mine.length > 0 || ranked.length > 0;

  return (
    <ApplicationShell
      title={t("home.title")}
      description={t("home.description")}
      routeKey="arena"
      actions={<AccountChip />}
    >
      {games.status === "error" && (
        <div className="eq-home-error" role="alert">
          <p>{t("home.error")}</p>
          <button className="eq-button" type="button" onClick={onReloadGames}>
            {t("home.retry")}
          </button>
        </div>
      )}

      {(games.status === "loading" || hasContinue) && (
        <section className="eq-section eq-home-section" aria-labelledby="home-continue-heading">
          <h2 id="home-continue-heading">{t("home.continue.heading")}</h2>
          {games.status === "loading" ? (
            <p className="eq-home-status" role="status">
              {t("home.continue.loading")}
            </p>
          ) : (
            <ul className="eq-home-rows">
              {ranked.map((match) => (
                <HomeRow
                  key={match.id}
                  href={routeToHash({ kind: "ranked", matchId: match.id })}
                  icon={<Trophy size={20} />}
                  title={t("home.continue.ranked")}
                  detail={t(
                    match.status === "playing"
                      ? "home.continue.rankedPlaying"
                      : match.status === "matched"
                        ? "home.continue.rankedMatched"
                        : "home.continue.rankedWaiting",
                  )}
                  action={t("home.continue.open")}
                  emphasis
                />
              ))}
              {mine.map((room) => (
                <HomeRow
                  key={room.id}
                  onClick={() => onContinue(room)}
                  disabled={opening}
                  icon={<Swords size={20} />}
                  title={room.name}
                  detail={[STATUS[room.status] && t(STATUS[room.status]!), scopeOf(room, t)]
                    .filter(Boolean)
                    .join(" · ")}
                  action={t("home.continue.open")}
                  emphasis
                />
              ))}
            </ul>
          )}
        </section>
      )}

      <section className="eq-section eq-home-section" aria-labelledby="home-live-heading">
        <h2 id="home-live-heading">{t("home.live.heading")}</h2>
        {games.status === "loading" ? (
          <p className="eq-home-status" role="status">
            {t("home.live.loading")}
          </p>
        ) : games.status === "ready" && open.length === 0 && rankedWaiting === 0 ? (
          <p className="eq-home-note">{t("home.live.empty")}</p>
        ) : games.status === "ready" ? (
          <ul className="eq-home-rows">
            {rankedWaiting > 0 && (
              <HomeRow
                href={routeToHash({ kind: "ranked" })}
                icon={<Trophy size={20} />}
                title={t("home.live.ranked", { count: rankedWaiting })}
              />
            )}
            {open.map((room) => (
              <HomeRow
                key={room.id}
                onClick={() => onOpenListed(room)}
                disabled={opening}
                icon={<Radio size={20} />}
                title={room.name}
                detail={[room.ownerName ?? room.playerA, t("home.live.seat"), scopeOf(room, t)]
                  .filter(Boolean)
                  .join(" · ")}
                action={t("home.live.open")}
              />
            ))}
          </ul>
        ) : null}
        <p className="eq-home-links">
          <a href={routeToHash({ kind: "home", visibility: "public", section: "live" })}>
            {t("home.live.allPublic")}
          </a>
          {regionAvailable && (
            <a href={routeToHash({ kind: "home", visibility: "region", section: "live" })}>
              {t("home.live.allRegion")}
            </a>
          )}
        </p>
      </section>

      <section className="eq-section eq-home-section" aria-labelledby="home-play-heading">
        <h2 id="home-play-heading">{t("home.play.heading")}</h2>
        <ul className="eq-home-rows">
          <HomeRow
            href={routeToHash({ kind: "ranked" })}
            icon={<Trophy size={20} />}
            title={t("home.play.ranked")}
            detail={t("home.play.rankedHint")}
          />
          <HomeRow
            href={routeToHash({ kind: "stage" })}
            icon={<Flag size={20} />}
            title={t("home.play.stage")}
            detail={t("home.play.stageHint")}
          />
          <HomeRow
            href={routeToHash({ kind: "create", visibility: "public" })}
            icon={<Plus size={20} />}
            title={t("home.play.create")}
            detail={t("home.play.createHint")}
          />
          <HomeRow
            href={routeToHash({ kind: "join", visibility: "public" })}
            icon={<KeyRound size={20} />}
            title={t("home.play.join")}
            detail={t("home.play.joinHint")}
          />
        </ul>
        <BotRows bots={bots} onReload={onReloadBots} />
      </section>

      <section className="eq-section eq-home-section" aria-labelledby="home-learn-heading">
        <h2 id="home-learn-heading">{t("home.learn.heading")}</h2>
        <ul className="eq-home-rows">
          <HomeRow
            href={routeToHash({ kind: "learn" })}
            icon={<GraduationCap size={20} />}
            title={t("home.learn.link")}
            detail={t("home.learn.hint")}
          />
        </ul>
      </section>
    </ApplicationShell>
  );
}

const STATUS: Record<GameStatus, MessageKey | null> = {
  playing: "home.continue.playing",
  draft: "home.continue.waiting",
  finished: null,
};

function scopeOf(room: RoomMeta, t: (key: MessageKey) => string): string | null {
  const scope = room.accessScope ?? room.visibility;
  return scope === "private"
    ? t("create.scope.private")
    : scope === "region"
      ? t("create.scope.region")
      : scope === "public"
        ? t("create.scope.public")
        : null;
}

function BotRows({ bots, onReload }: { bots: ArenaBots; onReload: () => void }) {
  const { t } = useLocale();
  return (
    <section className="eq-home-bots" aria-labelledby="home-bots-heading">
      <h3 id="home-bots-heading">{t("home.bots.heading")}</h3>
      {bots.status === "offline" ? (
        <p className="eq-home-note">{t("home.bots.noService")}</p>
      ) : bots.status === "loading" ? (
        <p className="eq-home-status" role="status">
          {t("home.bots.loading")}
        </p>
      ) : bots.status === "error" ? (
        <div className="eq-home-error" role="alert">
          <p>{t("home.bots.failed")}</p>
          <button className="eq-button" type="button" onClick={onReload}>
            {t("home.retry")}
          </button>
        </div>
      ) : bots.bots.length === 0 ? (
        <p className="eq-home-note">{t("home.bots.none")}</p>
      ) : (
        <ul className="eq-home-rows">
          {bots.bots.map((bot) => (
            <BotRow key={bot.key} bot={bot} probot={bots.probot} />
          ))}
        </ul>
      )}
    </section>
  );
}

function BotRow({ bot, probot }: { bot: ArenaBot; probot: ProBotStatus | null }) {
  const { t } = useLocale();
  // The plan is the row's tag; the details say where it runs.
  const facts = bot.execution === "SERVER" ? [t("home.bots.server")] : [];
  const notes = bot.unavailable
    ? [t(bot.unavailable === "closed" ? "home.bots.unavailable" : "home.bots.needsServer")]
    : bot.tier === "EQ Pro"
      ? proBotNotes(probot, t)
      : [];
  return (
    <HomeRow
      href={bot.unavailable ? undefined : routeToHash(bot.setup)}
      icon={<Bot size={20} />}
      title={t("home.bots.play", { name: bot.name })}
      detail={facts.join(" · ")}
      notes={notes}
      tag={bot.tier ?? undefined}
    />
  );
}

/**
 * What the player's Pro-Bot status says, in the words the server's own
 * refusals use. Information only: the setup and the server decide.
 */
function proBotNotes(
  probot: ProBotStatus | null,
  t: (key: MessageKey, params?: Record<string, string | number>) => string,
): string[] {
  if (!probot) return [];
  const notes: string[] = [];
  const reason = probot.allowance.reason;
  notes.push(
    reason === "ok"
      ? t("home.bots.allowance", { count: probot.allowance.available })
      : t(`errors.server.allowance_${reason}` as MessageKey),
  );
  if (probot.credits > 0) notes.push(t("home.bots.credits", { count: probot.credits }));
  if (probot.boards.limit != null && probot.boards.active >= probot.boards.limit) {
    notes.push(t("errors.server.active_board_limit.self"));
  }
  return notes;
}

/**
 * One line of Home: a link to a place, or a button that opens a game. An
 * unavailable entry is neither, and says why.
 */
function HomeRow({
  href,
  onClick,
  disabled = false,
  icon,
  title,
  detail,
  notes = [],
  action,
  tag,
  emphasis = false,
}: {
  href?: string;
  onClick?: () => void;
  disabled?: boolean;
  icon: ReactNode;
  title: string;
  detail?: string;
  notes?: string[];
  action?: string;
  tag?: string;
  emphasis?: boolean;
}) {
  const className = `eq-home-row${emphasis ? " is-emphasis" : ""}`;
  const content = (
    <>
      <span className="eq-home-row-icon" aria-hidden="true">
        {icon}
      </span>
      <span className="eq-home-row-copy">
        <span className="eq-home-row-title">
          <strong>{title}</strong>
          {tag && <span className="eq-home-row-tag">{tag}</span>}
        </span>
        {detail && <small>{detail}</small>}
        {notes.map((note) => (
          <small key={note} className="eq-home-row-note">
            {note}
          </small>
        ))}
      </span>
      {action ? (
        <span className="eq-home-row-action">{action}</span>
      ) : (
        (href || onClick) && (
          <ChevronRight className="eq-home-row-arrow" size={18} aria-hidden="true" />
        )
      )}
    </>
  );
  return (
    <li>
      {href ? (
        <a className={className} href={href}>
          {content}
        </a>
      ) : onClick ? (
        <button className={className} type="button" onClick={onClick} disabled={disabled}>
          {content}
        </button>
      ) : (
        <span className={className} aria-disabled="true">
          {content}
        </span>
      )}
    </li>
  );
}
