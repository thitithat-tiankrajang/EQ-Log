# EQ Lab Game Records

This context distinguishes a game while it is being coordinated from the durable records produced after it ends.

## Language

**Live Game**:
A game that is waiting for players, actively being played, or paused and can still change.
_Avoid_: Saved room, game log

**Game Snapshot**:
An immutable replay record captured from a Live Game after it ends.
_Avoid_: Live room, editable game

**Natural Completion**:
A game ending caused by the rules of play, such as rack-out, a no-score streak, or a perfect game.
_Avoid_: Normal stop, manual finish

**Termination**:
A recorded game ending caused by an explicit human or administrative action, including surrender or manual stop.
_Avoid_: Natural completion, deleted game

**Archive Scope**:
The audience and retention collection that receives a Game Snapshot: Public, Region, Private, or None.
_Avoid_: Room type, page

**Public Archive**:
The bounded collection of Game Snapshots visible to every approved member.
_Avoid_: Public live rooms

**Region Archive**:
The bounded collection of Game Snapshots visible to approved members currently assigned to its Region.
_Avoid_: Public archive, former region history

**Private Library**:
An account-owned folder tree containing permanent personal copies of Game Snapshots up to the account quota.
_Avoid_: Private live game, shared drive

**Ephemeral Private Game**:
A private Live Game that is discarded after it ends instead of producing a Game Snapshot.
_Avoid_: Private Library item

