# Milestone 10 source audit — old storage lifecycle

This audit records the existing behavior before the Trash/Overflow migration. It does not treat old Private Library rows as new Saved ownership.

## Old data and capacity

`private_library_items` holds folders and game rows. Each game row carries its own full `snapshot` JSONB. Copies duplicate those bytes; `copy_private_game_item` assigns a new game ID, and `save_archive_to_private` copies Public/Region snapshots. A folder is linked by `parent_id` with `ON DELETE CASCADE`, so deleting a folder can delete its descendants. Game snapshots and source identity are immutable after insert, but name, parent and `trashed_at` can change. The old Private page lists all item metadata, offers folder moves, copy, trash, restore and direct permanent delete. Its `boardCount` includes trashed game rows.

The old `private_board_limit` setting defaults to 1,000. The private-item insert trigger counts all game rows, including Trash. Private room creation also counts all game rows plus live private-room reservations. The production room-creation RPC takes an account lock and checks this old limit before insert. `save_archive_to_private` checks the same limit. These checks are unrelated to the new plan-based Saved limits. The old cleanup function can delete Private Library rows trashed over 30 days ago; its browser execution was revoked in the internal-grants migration. Milestone 10 must not run it or purge old Trash.

## Completion and resume

The current normal finalizer writes a Private Library game row when `room_live.archive_policy = 'private'`, then records stats and deletes the live room. Public/Region finalization writes their archive tables. The History wrapper catches only the old private quota exception and repeats result/stat/History completion without an archive, so quota does not roll back a result. That fallback can leave no replay. `archive_policy = 'none'` creates no archive; normal Compact Recent capture remains dormant until a trusted normal terminal producer exists.

Existing in-progress private autosave is a `room_live` row with `archive_policy = 'private'`, not a completed Private Library item. Private Library shows these rooms through `listPrivateRooms`; opening them resumes the live room. A cutover must classify those existing rows before altering new room creation or finalization. They must not be represented as completed History, Recent, Saved or Overflow until they actually finish.

The old finalizer's private archive is owned by `room_live.owner_id`, which may be a non-playing Hosted owner. New Saved ownership requires a seated `game_history` participant and never follows Host ownership alone. Old source copies can have a different `game_id` from their source. Folder membership, copies, trashed rows and in-progress rooms therefore cannot be blindly mapped one-to-one to Saved.

## Migration implications

Eligible old completed private rows need a real History seat, matching source/game identity, complete decoder-valid v3 replay, and owner authorization. Duplicate copies of one source should produce at most one Saved relation. Incomplete, ambiguous, old v1/v2 and nonparticipant-owned rows remain legacy data. An existing trashed eligible row maps to Trash only if it can be proven to represent that participant's ownership; no old row is deleted by migration. The old folder tree stays compatibility-only and cannot own the new payload lifetime.

The cutover must remove old quota checks for **new** private rooms, stop automatic new Private Library archives, and preserve existing private in-progress rooms as a marked legacy cohort. A legacy cohort finish must retain its replay without depending on either old Private Library or new active Saved capacity. The normal trusted Compact terminal writer is a separate missing producer; without one, new `archive_policy = 'none'` games have History but may have no full replay. Milestone 10 cannot claim Recent or Saved eligibility for those games until that producer exists.

Two source-identity details surfaced during implementation. A real normal room
UUID is distinct from the encoded GameState's internal `gameId`, so archive
validation must bind the external room/archive ID and internal game ID
separately. Bot creation calls `create_live_game_core` through
`create_bot_game`; changing only the ordinary room-creation wrapper would
leave new private bot rooms on the old quota and auto-archive path. Both
creation wrappers need the cutover, while a pre-cutover bot request retry must
retain its original private policy.
