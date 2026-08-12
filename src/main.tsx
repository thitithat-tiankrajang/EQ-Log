import React from "react";
import { createRoot } from "react-dom/client";
import { AppRoot } from "./app/AppRoot";
import { AuthGate, AuthProvider } from "./auth";
import { registerPwa } from "./pwa";
// TEMPORARY (engine session probe). Eager on purpose: the lifecycle listeners it
// installs must exist before the player can switch tabs, and everything else
// that imports it lives in the lazily loaded Play chunk. Remove with the file.
import "./engineDebug";
import "./styles.css";

registerPwa();

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AuthProvider>
      <AuthGate>
        <AppRoot />
      </AuthGate>
    </AuthProvider>
  </React.StrictMode>,
);
