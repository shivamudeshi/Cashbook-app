import React from "react";

// Placeholder root for the simplified companion app (bank + credit card
// P&L, Owed, Travel, Reports) — a separate build living entirely under
// simple/, independent of src/CashBook.jsx. Real screens land here once
// a design direction is picked from the mockups.
export default function App() {
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "#e4d9f5",
        fontSize: 15,
        fontWeight: 600,
        textAlign: "center",
        padding: 24,
      }}
    >
      Cash Book — Simple
      <br />
      Coming soon.
    </div>
  );
}
