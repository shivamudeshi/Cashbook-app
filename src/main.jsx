import React from "react";
import { createRoot } from "react-dom/client";
import CashBook from "./CashBook.jsx";

createRoot(document.getElementById("root")).render(<CashBook />);

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  });
}
