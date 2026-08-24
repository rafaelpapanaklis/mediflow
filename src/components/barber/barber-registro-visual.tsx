"use client";

import { Scissors } from "lucide-react";

/**
 * Panel visual (izquierdo) del registro de barberías. Propio del vertical:
 * caramelo sobre negro cálido (nada dental). Se monta dentro del slot
 * `visual` de AuthShell y pinta su PROPIO fondo a sangre completa.
 */
export function BarberRegistroVisual() {
  return (
    <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column" }}>
      {/* Fondo caramelo/negro que tapa el degradado violeta del shell */}
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          inset: 0,
          background:
            "radial-gradient(90% 70% at 85% -10%, rgba(205,148,89,0.28), transparent 55%), " +
            "radial-gradient(70% 60% at -10% 110%, rgba(129,74,40,0.45), transparent 60%), " +
            "linear-gradient(165deg, #121010 0%, #241410 55%, #3D2417 100%)",
        }}
      />
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage:
            "linear-gradient(rgba(250,245,238,0.045) 1px, transparent 1px), " +
            "linear-gradient(90deg, rgba(250,245,238,0.045) 1px, transparent 1px)",
          backgroundSize: "32px 32px",
          maskImage: "radial-gradient(80% 70% at 50% 30%, #000 30%, transparent 100%)",
          WebkitMaskImage: "radial-gradient(80% 70% at 50% 30%, #000 30%, transparent 100%)",
        }}
      />

      <div
        style={{
          position: "relative",
          zIndex: 1,
          flex: 1,
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "40px 48px",
        }}
      >
        {/* Marca */}
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div
            style={{
              width: 34,
              height: 34,
              borderRadius: 10,
              background: "linear-gradient(135deg, #A2612F, #BE7A3C)",
              display: "grid",
              placeItems: "center",
              color: "#fff",
              boxShadow: "0 0 24px rgba(190,122,60,0.35)",
            }}
          >
            <Scissors size={18} />
          </div>
          <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.1 }}>
            <span style={{ fontSize: 15, fontWeight: 700, color: "#FAF5EE", letterSpacing: "-0.01em" }}>
              DaleControl
            </span>
            <span style={{ fontSize: 11, fontWeight: 600, color: "#CD9459", letterSpacing: "0.14em", textTransform: "uppercase" }}>
              Barber
            </span>
          </div>
        </div>

        {/* Mensaje */}
        <div style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 420 }}>
          <span
            style={{
              alignSelf: "flex-start",
              padding: "5px 12px",
              borderRadius: 999,
              fontSize: 11.5,
              fontWeight: 700,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: "#DDB587",
              border: "1px solid rgba(221,181,135,0.35)",
              background: "rgba(190,122,60,0.12)",
            }}
          >
            Software para barberías
          </span>
          <h2
            style={{
              fontSize: "clamp(26px, 2.6vw, 36px)",
              fontWeight: 800,
              letterSpacing: "-0.02em",
              lineHeight: 1.12,
              color: "#FAF5EE",
              margin: 0,
            }}
          >
            Tu barbería en piloto automático.
          </h2>
          <p style={{ fontSize: 15, lineHeight: 1.6, color: "rgba(250,245,238,0.72)", margin: 0 }}>
            Agenda por barbero, fila virtual para walk-ins, recordatorios por
            WhatsApp y caja con comisiones — todo en un solo panel.
          </p>
          <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 8 }}>
            {[
              "Agenda y reservas en línea",
              "Fila virtual para clientes sin cita",
              "Recordatorios que evitan no-shows",
              "Caja, propinas y comisiones claras",
            ].map((item) => (
              <li key={item} style={{ display: "flex", gap: 10, alignItems: "baseline", fontSize: 13.5, color: "rgba(250,245,238,0.85)" }}>
                <span aria-hidden="true" style={{ color: "#CD9459", fontWeight: 700 }}>✓</span>
                {item}
              </li>
            ))}
          </ul>
        </div>

        {/* Pie */}
        <p style={{ fontSize: 12, color: "rgba(250,245,238,0.5)", margin: 0 }}>
          DaleControl Barber · Hecho en México
        </p>
      </div>
    </div>
  );
}
