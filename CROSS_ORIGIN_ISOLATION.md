# Cross-origin isolation

`vercel.json` sends two headers on every response:

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

They exist for one reason: without them a browser does not hand out
`SharedArrayBuffer`, and without `SharedArrayBuffer` the threaded Super engine
(`src/bot/engine/amath_engine_mt.mjs`) **cannot instantiate at all**. Not slower
— it throws.

`vite.config.ts` sends the same pair on the dev server and on `vite preview`.
Those cover local work only. Production is Vercel, and Vercel does not read
`vite.config.ts`, which is why this file exists.

## What the headers cost, checked rather than assumed

`COEP: require-corp` blocks any cross-origin subresource fetched in **no-cors**
mode that does not carry `Cross-Origin-Resource-Policy`. `COOP: same-origin`
severs `window.opener` between this page and cross-origin windows. Every place
this app touches another origin was checked against both:

| Surface | Mode | Verdict |
|---|---|---|
| `index.html`, icons, manifest, JS/CSS chunks | same-origin | unaffected |
| Supabase REST/auth (`@supabase/supabase-js`) | CORS `fetch` | allowed — CORS is the opt-in COEP asks for |
| Supabase realtime | WebSocket | not a subresource; COEP does not apply |
| Engine service (`VITE_ENGINE_API_URL`) | CORS `fetch`, SSE read off `response.body` | allowed. `engineApi.ts` deliberately does not use `EventSource` |
| Google sign-in | `signInWithOAuth({ redirectTo })`, full-page redirect | allowed. A popup + `postMessage` flow would NOT survive `COOP: same-origin` |
| `public/sw.js` | same-origin only — it returns early on `url.origin !== self.location.origin` | never caches or replays a cross-origin response, so it cannot serve one that lacks CORP |

There are no cross-origin images, fonts, scripts or iframes. The only external
URL string in the built bundle is React's error-documentation link, which is
never fetched.

**Anything added later that loads a cross-origin image, font, script or iframe
must carry `Cross-Origin-Resource-Policy`, or be proxied through this origin.**
The failure is loud in the console and silent in the UI, so it is worth knowing
in advance rather than discovering it as a missing avatar.

Weakening `require-corp` to `credentialless` to make a third-party resource load
is not the fix. It is a different isolation contract, and the resource is the
thing that should change.

## Verifying

On any deployment, in the console:

```js
crossOriginIsolated === true && typeof SharedArrayBuffer !== "undefined";
```

Both must be true for the threaded engine to load. When they are not,
`superThreads.ts` reports `page is not cross-origin isolated` and the game runs
the single-threaded module — the **same full 160-sample Super search**, just on
one core. Nothing about the bot's strength depends on this file.
