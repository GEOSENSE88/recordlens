import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import CheckerPage from "../app/page";
import "../app/globals.css";

const root = document.getElementById("root");

if (!root) {
  throw new Error("Pages root element was not found.");
}

createRoot(root).render(
  <StrictMode>
    <CheckerPage />
  </StrictMode>,
);
