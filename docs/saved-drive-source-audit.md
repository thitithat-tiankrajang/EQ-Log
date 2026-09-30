# Saved / Drive source audit (Milestone 9)

## Existing behavior

- `private_library_items` stores full `snapshot` JSONB in each game row. Copying a private item or a Public/Region archive creates another full snapshot, with optional folder parent and `trashed_at`. The old UI supports folders, trash, restore and copy. Those rows and workflows remain legacy data; they are not new Saved ownership.
- A live room with `archive_policy = 'private'` automatically writes a Private Library snapshot at finish. The old `private_board_limit` setting defaults to 1000 and counts *all* private game rows, including trashed rows, plus private live-room reservations. Creation can be refused when this old quota is full. The History wrapper catches a private archive quota failure at completion and records the result and History without a replay, so the old quota does not block completion.
- Public and Region finalization writes their own legacy snapshots. A copy into the Private Library duplicates JSONB. Non-playing Hosts may own a legacy private item; this does not make them seated History participants.
- Replay goes through `archive-replay`, which loads raw rows with a service client and returns a safe projection. Recent stores one immutable normal Compact payload for both participants, but its normal writer is dormant until a trusted terminal Compact producer exists. Stage has a durable Compact record in `stage_completed_attempts`.
- History is permanent metadata and Recent is latest-20 replay retention. Neither is explicit long-term ownership. Ranked has no general post-game replay reader. Stage provenance says `captured_client_state`, since intermediate gameplay remains client-trusted.

## Milestone 9 boundary

New Saved is an explicit participant relation with Free 100 / EQ Plus 1000 / EQ Pro 1000 active items. It never counts History, Recent, old Private Library rows, or live reservations. It does not alter existing Private Library data or in-progress rooms. Compact payloads are shared with Recent or Stage. An eligible complete v3 legacy archive may be frozen as legacy for Saved; older or partial archives remain readable via their existing path but are not promoted to a full Saved replay. Milestone 10 must decide how old Private Library folders, copies, trash and in-progress auto-save behavior map into the new lifecycle; this milestone does not migrate them.
