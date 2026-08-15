import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { BoxApp } from "./BoxApp.tsx";
import "./styles.css";

const boxMode = window.location.pathname === "/box" || window.location.pathname === "/box/";

createRoot(document.getElementById("root")!).render(
  <StrictMode>{boxMode ? <BoxApp /> : <App />}</StrictMode>
);

if (boxMode && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/sw.js");
  });
}
