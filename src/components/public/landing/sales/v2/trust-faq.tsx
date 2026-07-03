"use client";

import { useState } from "react";
import { FAQ } from "./landing-data";

/** Acordeón accesible: uno abierto a la vez, el primero abierto por default. */
export function TrustFaq() {
  const [openIdx, setOpenIdx] = useState(0);

  return (
    <section id="faq" style={{ scrollMarginTop: 80, background: "#fff", padding: "80px 20px" }}>
      <div style={{ maxWidth: 760, margin: "0 auto" }}>
        <div style={{ textAlign: "center", marginBottom: 36 }}>
          <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: "#2563eb", marginBottom: 12 }}>{FAQ.eyebrow}</div>
          <h2 style={{ fontSize: "clamp(28px,3.4vw,40px)", fontWeight: 800, letterSpacing: "-0.02em", margin: 0 }}>{FAQ.title}</h2>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {FAQ.items.map((item, i) => {
            const open = openIdx === i;
            return (
              <div key={item.q} style={{ border: "1px solid #e8edf5", borderRadius: 14, background: "#fff", overflow: "hidden" }}>
                <button
                  type="button"
                  className="dcv2-faq-btn"
                  onClick={() => setOpenIdx(open ? -1 : i)}
                  aria-expanded={open}
                  style={{ width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 14, background: "none", border: "none", padding: "18px 20px", fontFamily: "inherit", fontSize: 15.5, fontWeight: 700, color: "#0f172a", textAlign: "left", cursor: "pointer" }}
                >
                  {item.q}
                  <span aria-hidden="true" style={{ transform: open ? "rotate(180deg)" : "rotate(0deg)", color: "#2563eb", fontWeight: 800, transition: "transform .2s", flex: "0 0 auto" }}>▾</span>
                </button>
                {open && (
                  <div style={{ padding: "0 20px 18px", fontSize: 14.5, lineHeight: 1.65, color: "#475569" }}>{item.a}</div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
