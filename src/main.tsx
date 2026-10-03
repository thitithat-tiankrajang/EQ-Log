import React from "react";
import { createRoot } from "react-dom/client";
import { AppRoot } from "./app/AppRoot";
import { AuthGate, AuthProvider } from "./auth";
import { LocaleProvider } from "./i18n/LocaleProvider";
import { registerPwa } from "./pwa";
// TEMPORARY (engine session probe). Eager on purpose: the lifecycle listeners it
// installs must exist before the player can switch tabs, and everything else
// that imports it lives in the lazily loaded Play chunk. Remove with the file.
import "./engineDebug";
import "./styles.css";

registerPwa();

// DEV-only LAN phone mode (tools/phase-a/local.mjs phone). Plain http on a
// private address is not a secure context, so browsers omit crypto.randomUUID,
// which the live client uses for idempotent command IDs. Supply an RFC 4122 v4
// UUID from crypto.getRandomValues (a CSPRNG insecure contexts keep). Removed
// from production builds; never replaces a native implementation.
if (
  import.meta.env.DEV &&
  import.meta.env.VITE_EQ_LAN_DEV === "1" &&
  typeof crypto.randomUUID !== "function"
) {
  Object.defineProperty(crypto, "randomUUID", {
    configurable: true,
    value: () => {
      const bytes = crypto.getRandomValues(new Uint8Array(16));
      bytes[6] = (bytes[6] & 0x0f) | 0x40;
      bytes[8] = (bytes[8] & 0x3f) | 0x80;
      const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    },
  });
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <LocaleProvider>
      <AuthProvider>
        <AuthGate>
          <AppRoot />
        </AuthGate>
      </AuthProvider>
    </LocaleProvider>
  </React.StrictMode>,
);
