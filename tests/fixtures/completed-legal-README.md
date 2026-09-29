# Frozen legal completed-game traces

`completed-legal-long.json` and `completed-legal-rackout.json` are fixed action
intents generated with the local A-Math native engine's static move generator
from seed `19761`. A selection rule favored shorter engine candidates; the long
trace deliberately interleaves legal passes and exchanges so a game can reach
60+ actions before rack-out. The rack-out trace plays more continuously and
finishes naturally after 39 actions.

These JSON files are **not** trusted as legal. `frozenLegalGame` starts from the
production `createNewGame` inventory and seeded initial shuffle, maps each
intent to the actual physical rack tile, and calls the production
`validateMove` and `applyRankedAction` path for every move. It checks score
agreement and physical inventory at every revision. Tests need no external
engine binary or model files. The seed fixes production draw/exchange shuffles;
the stored action outcomes are replayed and checked, never assumed.

The long trace is a paced stress game (many passes), not a claim about natural
player strategy. The rack-out trace is the better placement density comparison.
