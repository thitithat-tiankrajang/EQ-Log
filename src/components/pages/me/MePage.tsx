import { useEffect, useState, type ReactNode } from "react";
import {
  BarChart3,
  ChevronRight,
  FolderLock,
  Globe2,
  LogOut,
  MapPin,
  ShieldCheck,
  Trophy,
} from "lucide-react";
import { ApplicationShell } from "../../../app/shells/ApplicationShell";
import { AccountChip, useAuth } from "../../../auth";
import { rankedClient, type RankedRating } from "../../../features/ranked/client";
import { rankTier } from "../../../features/ranked/rating";
import { useLocale } from "../../../i18n/LocaleProvider";
import { isSupabaseConfigured } from "../../../supabaseClient";
import { LanguageSwitch } from "../../ui/LanguageSwitch";

type RatingState =
  { status: "loading" } | { status: "ready"; rating: RankedRating } | { status: "unavailable" };

/**
 * The account and platform hub. It shows only what the app already reads with
 * authority — the signed-in profile and the player's own Ranked rating — and
 * leads to the places that own everything else. No level, EXP, activity or
 * social data: none exists yet.
 */
export function MePage() {
  const { configured, isApproved, profile, signOut, userId } = useAuth();
  const { t } = useLocale();
  const rankedAvailable = isSupabaseConfigured && Boolean(userId) && isApproved;
  const [rating, setRating] = useState<RatingState>({ status: "loading" });

  useEffect(() => {
    if (!rankedAvailable) return;
    let alive = true;
    setRating({ status: "loading" });
    // The same read the Ranked page uses; its `own` row is the server's.
    rankedClient
      .leaderboard()
      .then(({ own }) => {
        if (alive) setRating({ status: "ready", rating: own });
      })
      .catch(() => {
        if (alive) setRating({ status: "unavailable" });
      });
    return () => {
      alive = false;
    };
  }, [rankedAvailable]);

  const displayName = profile?.display_name?.trim();

  return (
    <ApplicationShell
      title={t("me.title")}
      description={t("me.description")}
      routeKey="me"
      actions={<AccountChip />}
    >
      <section className="eq-section eq-me-section" aria-labelledby="me-account-heading">
        <h2 id="me-account-heading">{t("me.account.heading")}</h2>
        {configured && profile ? (
          <div className="eq-me-identity">
            <span className="eq-me-avatar" aria-hidden="true">
              {(displayName || "?").slice(0, 1).toUpperCase()}
            </span>
            <span>
              <strong>{displayName}</strong>
              <small>
                {profile.region_name
                  ? t("me.account.region", { region: profile.region_name })
                  : t("me.account.noRegion")}
                {profile.is_admin ? ` · ${t("me.account.admin")}` : ""}
              </small>
            </span>
          </div>
        ) : (
          <p className="eq-me-note">{t("me.account.localOnly")}</p>
        )}
      </section>

      <section className="eq-section eq-me-section" aria-labelledby="me-ranked-heading">
        <h2 id="me-ranked-heading">{t("me.ranked.heading")}</h2>
        {rankedAvailable &&
          (rating.status === "ready" ? (
            <p className="eq-me-rating">
              <strong>
                {t("me.ranked.rating", {
                  tier: rankTier(rating.rating.rating),
                  rating: rating.rating.rating,
                })}
              </strong>
              <small>{t("me.ranked.games", { count: rating.rating.games })}</small>
            </p>
          ) : (
            <p className="eq-me-note" role="status">
              {rating.status === "loading" ? t("me.ranked.loading") : t("me.ranked.unavailable")}
            </p>
          ))}
        <ul className="eq-me-links">
          <MeLink href="#/ranked" icon={<Trophy size={19} />} label={t("me.ranked.open")} />
        </ul>
      </section>

      <section className="eq-section eq-me-section" aria-labelledby="me-games-heading">
        <h2 id="me-games-heading">{t("me.games.heading")}</h2>
        <ul className="eq-me-links">
          <MeLink
            href="#/profile"
            icon={<BarChart3 size={19} />}
            label={t("me.games.profile")}
            hint={t("me.games.profileHint")}
          />
          <MeLink
            href="#/private"
            icon={<FolderLock size={19} />}
            label={t("me.games.saved")}
            hint={t("me.games.savedHint")}
          />
        </ul>
      </section>

      <section className="eq-section eq-me-section" aria-labelledby="me-live-heading">
        <h2 id="me-live-heading">{t("me.live.heading")}</h2>
        <ul className="eq-me-links">
          <MeLink
            href="#/public"
            icon={<Globe2 size={19} />}
            label={t("me.live.public")}
            hint={t("me.live.publicHint")}
          />
          <MeLink
            href="#/region"
            icon={<MapPin size={19} />}
            label={t("me.live.region")}
            hint={t("me.live.regionHint")}
          />
        </ul>
      </section>

      <section className="eq-section eq-me-section" aria-labelledby="me-settings-heading">
        <h2 id="me-settings-heading">{t("me.settings.heading")}</h2>
        <div className="eq-me-setting">
          <span>{t("common.language.label")}</span>
          <LanguageSwitch />
        </div>
        {configured && profile && (
          <ul className="eq-me-links">
            {profile.is_admin && (
              <MeLink
                href="#/admin/users"
                icon={<ShieldCheck size={19} />}
                label={t("me.admin.link")}
                hint={t("me.admin.hint")}
              />
            )}
            <li>
              <button type="button" className="eq-me-link" onClick={() => void signOut()}>
                <span className="eq-me-link-icon" aria-hidden="true">
                  <LogOut size={19} />
                </span>
                <span className="eq-me-link-copy">
                  <strong>{t("me.signOut")}</strong>
                </span>
              </button>
            </li>
          </ul>
        )}
      </section>
    </ApplicationShell>
  );
}

function MeLink({
  href,
  icon,
  label,
  hint,
}: {
  href: string;
  icon: ReactNode;
  label: string;
  hint?: string;
}) {
  return (
    <li>
      <a className="eq-me-link" href={href}>
        <span className="eq-me-link-icon" aria-hidden="true">
          {icon}
        </span>
        <span className="eq-me-link-copy">
          <strong>{label}</strong>
          {hint && <small>{hint}</small>}
        </span>
        <ChevronRight className="eq-me-link-arrow" size={18} aria-hidden="true" />
      </a>
    </li>
  );
}
