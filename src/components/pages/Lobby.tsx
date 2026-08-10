import { useState } from "react";
import { History, KeyRound, Radio } from "lucide-react";
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
    visibility === "public"
      ? "Live games and retained replays visible to every approved member."
      : `Live games and retained replays for ${regionName ?? "your assigned region"}.`;

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
          <section className="eq-section" aria-labelledby="live-games-heading">
            <div className="eq-section-heading eq-section-heading-actions">
              <div>
                <span className="eq-eyebrow">Now playing</span>
                <h2 id="live-games-heading">Live games</h2>
              </div>
              <button className="eq-button eq-button-secondary" type="button" onClick={onJoinRoom}>
                <KeyRound size={17} /> Join with code
              </button>
            </div>
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
              return;
            }
            await onSaveArchive?.(gameId);
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
