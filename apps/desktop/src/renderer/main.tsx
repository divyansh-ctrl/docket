import React from "react";
import { createRoot } from "react-dom/client";
import "@xterm/xterm/css/xterm.css";
import { App } from "./app";
import "./styles.css";

const root = document.getElementById("root");

if (!root) throw new Error("Docket renderer root was not found.");

createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
