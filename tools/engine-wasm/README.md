# WASM engine — development and regression only

This directory holds the browser build of the A-Math engine and the Web Worker
that used to drive it. **Nothing here is part of the application.**

Production gameplay calls the backend engine service (`src/bot/engineApi.ts`).
That is the point of the migration: the engine implementation is no longer
shipped to a browser.

## Why it is still here

The WASM build remains a useful second opinion. It is the same C++ compiled a
different way, so running a position through both and comparing answers catches
a class of bug — an adapter that describes the position wrongly, a build that
drifted — that neither can catch alone.

## Why it is in `tools/` and not in `src/`

So that "not shipped" is a structural fact rather than a habit.

`src/` is the application's module graph: anything reachable from `src/main.tsx`
ends up in the bundle. While these files lived in `src/bot/`, only the absence
of an import kept a 252 KB engine out of production, and an import is one
autocomplete away. Vite does not resolve anything under `tools/`, so re-shipping
the engine now takes a deliberate act rather than an accident.

`npm run build` is the check that this holds — see the bundle assertion in
`tests/engine-api.test.ts`.

## Refreshing the artifact

From the engine repository:

```bash
make wasm && cp build/amath_engine.mjs ../EQ-Lab/tools/engine-wasm/
```

## Comparing WASM against the native binary

```bash
node tools/engine-wasm/parity.mjs path/to/request.json
```

It runs one engine request through both builds and reports whether they agree on
the chosen move. Differences are expected where the search is time-bounded
(`budgetMs` cuts at whatever sample the machine reached); send `sampleCap` to
bound the work instead and the two builds should agree exactly.
