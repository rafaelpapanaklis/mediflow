"use client";

import { useState } from "react";
import { FAQ_HEADER, FAQ_ITEMS } from "./landing-data";

/**
 * Acordeón del diseño: uno abierto a la vez, el primero abierto por defecto.
 * Volver a pulsar el abierto lo cierra.
 *
 * La 4.ª respuesta lleva el precio del primer mes, que llega desde
 * `plan_configs` (page.tsx) — nunca escrito a mano.
 */
export function TrustFaq({ firstMonthFrom }: { firstMonthFrom: string }) {
  const [open, setOpen] = useState(0);

  return (
    <section id="faq" style={{ scrollMarginTop: 72, background: "#f8fafc", borderTop: "1px solid #eef2f7" }}>
      <div style={{ maxWidth: 840, margin: "0 auto", padding: "clamp(56px,7vw,88px) 20px" }}>
        <div data-reveal="" style={{ textAlign: "center" }}>
          <span style={{ display: "inline-block", background: "#eff6ff", border: "1px solid #dbeafe", color: "#1d4ed8", fontSize: 12.5, fontWeight: 700, letterSpacing: "0.1em", borderRadius: 999, padding: "7px 15px", textTransform: "uppercase" }}>
            {FAQ_HEADER.eyebrow}
          </span>
          <h2 className="dcv4-balance" style={{ marginTop: 18, fontSize: "clamp(25px,3.1vw,38px)", lineHeight: 1.12, letterSpacing: "-0.032em", fontWeight: 800 }}>
            {FAQ_HEADER.title}
          </h2>
        </div>
        <div style={{ marginTop: "clamp(26px,3.2vw,40px)", display: "flex", flexDirection: "column", gap: 12 }}>
          {FAQ_ITEMS.map((item, i) => {
            const isOpen = open === i;
            const answer = typeof item.a === "function" ? item.a(firstMonthFrom) : item.a;
            return (
              <div key={item.q} data-reveal="" style={{ border: "1px solid #e2e8f0", borderRadius: 14, background: "#ffffff", padding: "4px 18px", boxShadow: "0 10px 24px -22px rgba(15,23,42,0.4)" }}>
                <button
                  type="button"
                  className="dcv2-faq-btn"
                  onClick={() => setOpen(isOpen ? -1 : i)}
                  aria-expanded={isOpen}
                  style={{ width: "100%", display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, background: "none", border: 0, padding: "18px 0", cursor: "pointer", textAlign: "left", fontSize: "clamp(16px,1.6vw,17.5px)", fontWeight: 700, color: "#0f172a", lineHeight: 1.4 }}
                >
                  <span>{item.q}</span>
                  <span
                    aria-hidden="true"
                    style={{ flex: "0 0 auto", width: 28, height: 28, borderRadius: 9, background: "#eff6ff", display: "grid", placeItems: "center", color: "#1d4ed8", fontSize: 16, fontWeight: 800, transition: "transform .18s ease", transform: isOpen ? "rotate(45deg)" : "rotate(0deg)" }}
                  >
                    +
                  </span>
                </button>
                {isOpen && (
                  <p style={{ padding: "0 0 20px", fontSize: 15, lineHeight: 1.62, color: "#475569", maxWidth: "62ch" }}>{answer}</p>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
