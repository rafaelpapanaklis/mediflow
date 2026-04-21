import type { CSSProperties } from "react";

export function WhatsAppCard({ style }: { style?: CSSProperties }) {
  return (
    <div style={{
      padding: 14,
      borderRadius: 12,
      background: "rgba(20, 20, 24, 0.9)",
      backdropFilter: "blur(20px)",
      border: "1px solid rgba(255,255,255,0.08)",
      boxShadow: "0 20px 50px rgba(0,0,0,0.5)",
      width: 280,
      ...style,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <div style={{
          width: 28, height: 28, borderRadius: 28,
          background: "#25d366",
          display: "grid", placeItems: "center",
          fontSize: 14,
        }}>💬</div>
        <div>
          <div style={{ fontSize: 11, color: "#fff", fontWeight: 500 }}>Recordatorio enviado</div>
          <div style={{ fontSize: 10, color: "rgba(255,255,255,0.5)" }}>WhatsApp · hace 2 min</div>
        </div>
      </div>
      <div style={{ fontSize: 11, color: "rgba(255,255,255,0.7)", lineHeight: 1.4 }}>
        Hola María 👋 Te recordamos tu cita mañana a las 10:00 con la Dra. Morales.
      </div>
    </div>
  );
}
