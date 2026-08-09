import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";

createRoot(document.getElementById("root")).render(<App />);

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  });

  // As a home-screen PWA, "reopening" the app is usually the OS resuming an
  // already-loaded tab, not a real navigation -- so a new sw.js can finish
  // installing in the background while the old JS keeps running in memory
  // indefinitely, with no full reload ever happening on its own. Reload once
  // as soon as a new service worker actually takes control, and proactively
  // ask the browser to check for a new sw.js whenever the app is resumed.
  let reloadedForUpdate = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (reloadedForUpdate) return;
    reloadedForUpdate = true;
    window.location.reload();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      navigator.serviceWorker.getRegistration().then((reg) => reg && reg.update());
    }
  });
}
