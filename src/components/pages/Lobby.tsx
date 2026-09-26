import { useState } from "react";
import { ArrowUpRight, History, KeyRound, Radio, Trophy } from "lucide-react";
import type { RoomMeta } from "../../rooms";
import { AccountChip, useAuth } from "../../auth";
import { AdminButton } from "../../admin";
import { BotStatsButton } from "../botstats/BotStatsButton";
import { Sheet } from "../ui/Sheet";
import { RoomsView } from "./lobby/RoomsView";
import { ArchiveView } from "./lobby/ArchiveView";
import type { RoomVisibility } from "../../roomScope";
import type { LobbySection } from "../../router";
import { ApplicationShell } from "../../app/shells/ApplicationShell";
import type { ArchiveGame } from "../../features/gameRecords/repository";

export function Lobby({
  visibility,
  section = "live",
  regionName,
  regionAvailable,
  loading = false,
  busyMessage = null,
  rooms,
  archives = [],
  archivesTotal = 0,
  archivesLoading = false,
  archivesLoadingMore = false,
  syncError,
  getRoomRole,
  onOpen,
  onJoinRoom,
  onRename,
  onDelete,
  onExport,
  onSaveArchive,
  onArchivesChanged,
  onLoadMoreArchives,
}: {
  visibility: RoomVisibility;
  section?: LobbySection;
  regionName: string | null;
  regionAvailable: boolean;
  loading?: boolean;
  busyMessage?: string | null;
  rooms: RoomMeta[];
  archives?: ArchiveGame[];
  archivesTotal?: number;
  archivesLoading?: boolean;
  archivesLoadingMore?: boolean;
  syncError?: string | null;
  getRoomRole: (room: RoomMeta) => { canManage: boolean; canCreate: boolean; label: string };
  onOpen: (id: string) => void;
  onJoinRoom: () => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  onExport: (id: string) => void;
  onSaveArchive?: (gameId: string) => Promise<void>;
  onArchivesChanged?: () => void;
  onLoadMoreArchives?: () => void;
  onChangeSection: (section: LobbySection) => void;
}) {
  const { userId, signInWithGoogle } = useAuth();
  const [signInSheetOpen, setSignInSheetOpen] = useState(false);
  const activeSection = section === "history" ? "history" : "live";
  const scopeUnavailable = visibility === "region" && !regionAvailable;
  const scopeTitle = visibility === "public" ? "Public" : (regionName ?? "My Region");
  const scopeDescription =
    visibility === "public" ? "Games for approved members" : "Games in your region";

  return (
    <ApplicationShell
      title={scopeTitle}
      documentTitle={`${activeSection === "live" ? "Live" : "History"} · ${scopeTitle}`}
      routeKey={`${visibility}:${activeSection}`}
      description={scopeDescription}
      visibility={visibility}
      regionName={regionName}
      actions={
        <>
          <AccountChip />
          <BotStatsButton />
          <AdminButton />
        </>
      }
      secondaryNavigation={
        <nav className="eq-page-nav" aria-label={`${scopeTitle} sections`}>
          <a
            className={activeSection === "live" ? "is-active" : ""}
            href={`#/${visibility}`}
            aria-current={activeSection === "live" ? "page" : undefined}
          >
            <Radio size={17} /> Live <small>{rooms.length}</small>
          </a>
          <a
            className={activeSection === "history" ? "is-active" : ""}
            href={`#/${visibility}/history`}
            aria-current={activeSection === "history" ? "page" : undefined}
          >
            <History size={17} /> History <small>{archivesTotal.toLocaleString()}</small>
          </a>
        </nav>
      }
    >
      {scopeUnavailable ? (
        <section className="eq-state eq-state-access" aria-labelledby="region-access-title">
          <span className="eq-state-icon" aria-hidden>
            R
          </span>
          <div>
            <h2 id="region-access-title">
              {userId ? "Region access has not been assigned" : "Sign in to enter your region"}
            </h2>
            <p>
              {userId
                ? "Ask an admin to assign your account to a region."
                : "Region games require an approved account assigned by an admin."}
            </p>
          </div>
        </section>
      ) : activeSection === "live" ? (
        <div className="eq-live-layout">
          <section className="eq-arena-hero" aria-label="Start a game">
            <div className="eq-arena-hero-copy">
              <span className="eq-arena-kicker">
                <span aria-hidden="true" /> Arena is open
              </span>
              <strong>Ready for a match?</strong>
              <div className="eq-arena-actions">
                <a
                  className="eq-button eq-button-primary"
                  href={visibility === "region" ? "#/create?space=region" : "#/create"}
                >
                  New game <ArrowUpRight size={15} aria-hidden="true" />
                </a>
                <button
                  className="eq-button eq-button-secondary"
                  type="button"
                  onClick={onJoinRoom}
                >
                  <KeyRound size={15} aria-hidden="true" /> Join with code
                </button>
                {visibility === "public" && (
                  <a className="eq-button eq-button-secondary" href="#/ranked">
                    <Trophy size={15} aria-hidden="true" /> Ranked
                  </a>
                )}
              </div>
            </div>
            <div className="eq-arena-board" aria-hidden="true">
              <span>2</span>
              <span>+</span>
              <span>3</span>
              <span>=</span>
              <span>5</span>
            </div>
          </section>
          <section className="eq-section" aria-labelledby="live-games-heading">
            <div className="eq-section-heading eq-section-heading-actions">
              <div>
                <span className="eq-eyebrow">Match list</span>
                <h2 id="live-games-heading">Live games</h2>
              </div>
              <span className="eq-count">{rooms.length}</span>
            </div>
            {busyMessage && (
              <div className="eq-inline-activity" role="status" aria-live="polite">
                <span className="eq-inline-spinner" aria-hidden="true" />
                {busyMessage}
              </div>
            )}
            <RoomsView
              rooms={rooms}
              loading={loading}
              syncError={syncError}
              getRoomRole={getRoomRole}
              onOpen={onOpen}
              onJoinWithCode={onJoinRoom}
              onRename={onRename}
              onDelete={onDelete}
              onExport={onExport}
            />
          </section>
        </div>
      ) : (
        <ArchiveView
          games={archives}
          total={archivesTotal}
          loading={archivesLoading}
          loadingMore={archivesLoadingMore}
          scope={visibility}
          onChanged={onArchivesChanged}
          onSave={async (gameId) => {
            if (!userId) {
              setSignInSheetOpen(true);
              return false;
            }
            if (!onSaveArchive) return false;
            await onSaveArchive(gameId);
            return true;
          }}
          onLoadMore={onLoadMoreArchives}
        />
      )}

      <Sheet
        open={signInSheetOpen}
        title="Sign in to save this game"
        onClose={() => setSignInSheetOpen(false)}
      >
        <p className="ui-confirm-consequence">
          Private Library belongs to your account, so you need to sign in before saving a replay.
        </p>
        <div className="ui-sheet-actions">
          <button
            type="button"
            className="eq-button eq-button-primary"
            onClick={() => {
              setSignInSheetOpen(false);
              void signInWithGoogle();
            }}
          >
            Continue with Google
          </button>
        </div>
      </Sheet>
    </ApplicationShell>
  );
}
