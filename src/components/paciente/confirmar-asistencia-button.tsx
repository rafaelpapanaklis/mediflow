"use client";

// Botón "Confirmar asistencia" del panel del paciente (WS1-T3).
// POST /api/paciente/appointments/[id]/confirm; al éxito llama onConfirmed()
// (el padre hace mutate() para refrescar el badge → la cita pasa a CONFIRMED y
// este botón se desmonta). Componente AISLADO a propósito: la página de citas
// la tocan varias ramas en paralelo, así que aquí vive toda la lógica y en
// page.tsx solo queda un render de una línea.
import { useState, type CSSProperties } from "react";

const BTN_STYLE: CSSProperties = {
  padding: "6px 14px",
  borderRadius: 10,
  fontSize: 12.5,
  fontWeight: 600,
  fontFamily: "inherit",
  background: "rgba(34,197,94,0.15)",
  border: "1px solid rgba(34,197,94,0.55)",
  color: "#86efac",
};

export function ConfirmarAsistencia({
  citaId,
  onConfirmed,
}: {
  citaId: string;
  onConfirmed: () => void | Promise<unknown>;
}) {
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");

  async function confirmar() {
    if (state === "loading") return;
    setState("loading");
    try {
      const res = await fetch(`/api/paciente/appointments/${citaId}/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      if (!res.ok) {
        setState("error");
        return;
      }
      // Éxito (incl. idempotente): refresca la lista. Mantengo "loading" hasta
      // que el padre revalide y este botón se desmonte, para evitar parpadeo.
      await onConfirmed();
    } catch {
      setState("error");
    }
  }

  if (state === "error") {
    return (
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          gap: 8,
          marginTop: 6,
        }}
      >
        <span style={{ fontSize: 12, color: "#fca5a5" }}>
          No se pudo confirmar. Inténtalo de nuevo.
        </span>
        <button type="button" onClick={confirmar} style={{ ...BTN_STYLE, cursor: "pointer" }}>
          Reintentar
        </button>
      </div>
    );
  }

  const loading = state === "loading";
  return (
    <div style={{ marginTop: 6 }}>
      <button
        type="button"
        onClick={confirmar}
        disabled={loading}
        aria-busy={loading}
        style={{ ...BTN_STYLE, opacity: loading ? 0.7 : 1, cursor: loading ? "default" : "pointer" }}
      >
        {loading ? "Confirmando…" : "Confirmar asistencia"}
      </button>
    </div>
  );
}
