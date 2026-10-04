// C-114 (ws1-t8, decisión 10): lo que ve el paciente cuando la clínica se
// ocultó y cerró su reserva web. Sin formulario ni horarios: solo cómo
// contactar a la clínica. Tokens de globals.css (claro/oscuro), sin colores a mano.

import { MapPin, Phone } from "lucide-react";
import { MENSAJE_RESERVA_CERRADA } from "@/lib/reserva-web/estado";

export function ReservaCerrada({ nombre, telefono, direccion }: { nombre: string; telefono: string | null; direccion: string | null }) {
  return (
    <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 16, background: "var(--bg)", color: "var(--text-1)", fontFamily: "var(--font-sans, system-ui, sans-serif)" }}>
      <div style={{ width: "100%", maxWidth: 460, padding: 24, borderRadius: "var(--radius-lg)", border: "1px solid var(--border-soft)", background: "var(--bg-elev)" }}>
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>{nombre}</h1>
        <p style={{ margin: "10px 0 0", fontSize: 14.5, lineHeight: 1.5, color: "var(--text-2)" }}>{MENSAJE_RESERVA_CERRADA.es}</p>
        {telefono && (
          <a href={`tel:${telefono.replace(/[^\d+]/g, "")}`} style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 16, minHeight: 44, color: "var(--brand)", fontWeight: 600, textDecoration: "none" }}>
            <Phone size={16} aria-hidden /> {telefono}
          </a>
        )}
        {direccion && (
          <p style={{ display: "flex", alignItems: "flex-start", gap: 8, margin: "8px 0 0", fontSize: 13.5, color: "var(--text-3)" }}>
            <MapPin size={16} aria-hidden style={{ flexShrink: 0, marginTop: 2 }} /> {direccion}
          </p>
        )}
      </div>
    </main>
  );
}
