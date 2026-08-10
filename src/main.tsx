import React from "react";
import { createRoot } from "react-dom/client";
import { AppRoot } from "./app/AppRoot";
import { AuthGate, AuthProvider } from "./auth";
import { registerPwa } from "./pwa";
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
