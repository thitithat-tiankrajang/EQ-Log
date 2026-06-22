# Edit Board and Branching Timeline Design

## Scope

This document is design-only. The current `Live | Last turn` behavior remains
unchanged until the timeline feature is implemented.

The feature must let an authorized player:

- inspect any committed log;
- create a named checkpoint at log `X`;
- create branch `Y` from that checkpoint;
- continue playing from any branch head;
- edit an old log without destroying the original history;
- return to an earlier branch or revision at any time.

## Product Model

History is an immutable directed tree. A committed node is never updated or
deleted by ordinary editing. A branch is a named pointer to one node in that
tree, and its head advances when a new action is committed.

- **Node:** State transition produced by one committed game action.
- **Checkpoint:** A named node selected as a stable restore point.
- **Branch:** A playable timeline starting from a node.
- **Revision:** A replacement action saved on a new branch.
- **Head:** The latest playable node of a branch.

Editing log `X` creates a revision whose parent is the node immediately before
`X`. The original log and every original descendant remain available as a
backup. No destructive overwrite is permitted.

## Entry Point

Replace the passive `Live | Last turn` tag with a flat `Edit Board` command.
Use a Lucide `GitBranch` icon and a blue filled pressed state. Owners and admins
can edit. Spectators can open the timeline read-only.

## Timeline Workspace

The workspace opens as a modal above the board.

### Header

- Title: `Edit Board`
- Current branch name and head log number
- Close icon button

### Timeline

- Use horizontal lanes for branches and a vertical sequence for log order.
- Each node shows log number, side, action type, and score delta.
- Current head uses solid brand blue.
- Checkpoints use solid brand green.
- A selected historical node uses a blue outline and light-blue fill.
- Invalid or unresolved revisions use brand red.
- Lines are 1px neutral grey; do not use glow, shadow, gradients, or nested cards.
- The list virtualizes after 100 visible nodes.

Selecting a node previews its board, racks, tilebag, score, and timers without
changing the live branch. `Continue from here` either switches to an existing
branch head or opens the branch creation dialog for a historical node.

## Create Branch Dialog

The dialog contains:

- read-only source: `Checkpoint at log X`;
- required branch name input;
- optional note;
- `Cancel` secondary command;
- `Add branch` primary command.

Branch names must be unique within a room, trimmed, and limited to 60
characters. Creating a branch does not copy all earlier logs. It stores one
pointer to the selected source node.

## Edit Log Flow

1. Select a historical node and press `Edit log`.
2. Open the board editor with the state immediately before that node.
3. Validate the edited action with the normal game rules.
4. Save as a named revision branch.
5. Preserve the original branch and mark the new branch as active only after a
   successful durable save.

The editor must show a persistent `Revision draft` label. It must never imply
that the original record is being modified in place.

## Restore and Safety

- Branch switching is atomic: load snapshot, replay deltas, verify state hash,
  then update the active branch.
- Failed loads leave the current game untouched.
- Each node stores its parent and deterministic state hash.
- Only a room owner or admin can create, rename, or archive branches.
- Archive hides a branch but retains its nodes while descendants reference it.
- Permanent deletion is a separate maintenance operation and must refuse to
  delete nodes referenced by another branch.

## Supabase Data Model

This is the proposed schema, not an applied migration.

```sql
create table public.game_timeline_nodes (
  id              bigint generated always as identity primary key,
  room_id         uuid not null references public.rooms(id) on delete cascade,
  parent_node_id  bigint references public.game_timeline_nodes(id),
  turn_number     integer not null,
  side            text check (side in ('A', 'B')),
  action_type     text not null,
  payload         jsonb not null,
  state_hash      text not null,
  created_by      uuid references public.profiles(id) on delete set null,
  created_at      timestamptz not null default now()
);

create table public.game_timeline_branches (
  id                  uuid primary key default gen_random_uuid(),
  room_id             uuid not null references public.rooms(id) on delete cascade,
  name                text not null check (char_length(name) between 1 and 60),
  forked_from_node_id bigint references public.game_timeline_nodes(id),
  head_node_id        bigint references public.game_timeline_nodes(id),
  note                text,
  status              text not null default 'active'
                        check (status in ('active', 'archived')),
  created_by          uuid references public.profiles(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (room_id, name)
);

create table public.game_timeline_checkpoints (
  node_id       bigint primary key references public.game_timeline_nodes(id)
                  on delete cascade,
  label         text not null check (char_length(label) between 1 and 60),
  snapshot      jsonb not null,
  created_by    uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now()
);

alter table public.rooms
  add column active_branch_id uuid references public.game_timeline_branches(id);

create index game_timeline_nodes_room_turn_idx
  on public.game_timeline_nodes (room_id, turn_number);
create index game_timeline_nodes_parent_idx
  on public.game_timeline_nodes (parent_node_id);
create index game_timeline_branches_room_updated_idx
  on public.game_timeline_branches (room_id, updated_at desc);
```

Before migration, use a deferred constraint or a second migration step for the
`rooms.active_branch_id` circular reference.

## Authorization and Realtime

- Reuse room ownership and admin checks for all writes.
- Public room readers may select timeline rows for replay.
- Validate that node, parent, checkpoint, branch, and room all share the same
  `room_id` inside security-definer RPCs.
- Create branch and advance branch head through RPC transactions, not multiple
  client-side writes.
- Publish branch-head changes only. Do not add nodes or checkpoint snapshots to
  Supabase Realtime; clients fetch them by indexed queries.
- Keep live placement drafts in `room_live`; never mix them with durable nodes.

## Storage Target for 10,000 Games

The design targets 10,000 ordinary games on the existing free database by
avoiding full-state copies per turn. It is a capacity target, not a guarantee;
actual usage must be measured against real payloads.

- Store one compact action delta per node, with a 4 KB payload limit.
- Store a full snapshot only at the root, explicit checkpoints, and every 32
  nodes on a long active branch.
- Reuse an existing checkpoint when multiple branches fork from the same node.
- Do not create JSONB GIN indexes; timeline payloads are not searched.
- Keep only the three narrow indexes listed above.
- Do not publish append-only node tables to Realtime.
- Remove duplicated logs/history snapshots from `rooms.state` after migration;
  retain only the current compact game state and active pointers.
- Track `pg_total_relation_size` and average payload size before enabling the
  feature for all rooms.

At an average of 30 nodes per game and 300 bytes of action data, 10,000 games
produce about 90 MB of raw action payload. PostgreSQL row and index overhead,
snapshots, and existing room data still matter, so a prototype must measure a
representative 1,000-game fixture before rollout.

## Implementation Order

1. Add codec versioning and deterministic state hashes.
2. Add tables, RLS, and transactional RPCs.
3. Backfill one main branch per existing room without deleting `rooms.state`.
4. Build read-only timeline and node preview.
5. Add checkpoint and branch creation.
6. Add continue-from-node and revision editing.
7. Measure storage, query latency, and Realtime RAM before removing legacy
   duplicated history.
