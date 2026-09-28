// The browser core of ArchBot: exactly the Stage 5B symbols the production
// service entry (engine-algo service/stage5b/entry.ts) imports, and nothing
// else. build-core.mjs bundles this against the pinned amath-bot-lab commit
// laid out as a sibling directory, so the paths below resolve there.
export { createManifest } from "../amath-bot-lab/src/core/tiles";
export { decisionRandom } from "../amath-bot-lab/src/bots/rng";
export { enumerateActions, envStateFrom } from "../amath-bot-lab/src/env";
export { decide, DEFAULT_BOT_CONFIG } from "../amath-bot-lab/src/integrated";
export { loadValueModel, ValueHead } from "../amath-bot-lab/src/nn";
