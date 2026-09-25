// The playtest page. EQ-Lab's stylesheets and board components are used as they
// are, straight from src/; this page is its own document, so the standalone
// board sheet can be loaded globally here (unlike inside the app).
import React from "react";
import { createRoot } from "react-dom/client";
import "../../../../src/styles.css";
import "../../../../src/board-styles.css";
import "./playtest.css";
import { PlaytestApp } from "./PlaytestApp.jsx";

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <PlaytestApp />
  </React.StrictMode>,
);
