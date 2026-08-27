# WASM engine — cross-check harness

This directory holds `parity.mjs`, which runs one engine request through the
WASM and native builds and reports whether they agree.

**The shipped engine no longer lives here.** It is
`src/bot/engine/amath_engine.mjs`, because the Super bot runs on the player's
device and Vite has to resolve it. `make deploy-ui` in the engine repository
puts it there.

## What changed, and why this file used to say the opposite

For one release the engine ran only on a backend service, and this directory
existed to keep the browser build *out* of the bundle — `tools/` is somewhere
Vite does not resolve, so shipping it took a deliberate act rather than an
accidental import.

That constraint served the backend-engine architecture and is wrong for the
current one. The Super search is the most expensive thing this product does,
and running it centrally means every concurrent Super player costs a slice of
one container's CPU. Moving it to the device removes that ceiling.

What replaced the constraint is narrower and is asserted rather than assumed —
see `tests/engine-in-browser.test.ts`:

- the engine is **not in the app's first load**; it is a chunk fetched the
  first time a Super game actually starts,
- it is reached by **dynamic import only**, from **one** module,
- that module runs **inside a Web Worker**, so the UI thread can never make the
  synchronous multi-second call, and
- the **backend engine path still exists**, because every client-side refusal
  falls back to it.

## Comparing WASM against the native binary

Still the useful thing this directory does. The same C++ compiled two ways is
an independent check on both: run a position through each and any disagreement
is a real bug in one of them.

```bash
node tools/engine-wasm/parity.mjs path/to/request.json
```

Differences are expected where the search is time-bounded (`budgetMs` cuts at
whatever sample the machine reached). Send `sampleCap` to bound the WORK
instead and the two builds agree exactly — which is also why `sampleCap`, not a
wall clock, is what the device-aware budget uses.

## Refreshing the artifact

From the engine repository:

```bash
make deploy-ui
```
