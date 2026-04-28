"use client";

import { Armchair, Plus } from "lucide-react";
import { useAgenda } from "./agenda-provider";

export function AgendaEmptyResources() {
  const { openModal } = useAgenda();

  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 14,
        padding: 40,
        textAlign: "center",
      }}
    >
      <div
        style={{
          width: 56,
          height: 56,
          borderRadius: 14,
          background: "var(--brand-softer)",
          border: "1px solid var(--border-brand)",
          color: "var(--brand)",
          display: "grid",
          placeItems: "center",
        }}
      >
        <Armchair size={24} aria-hidden />
      </div>
      <div>
        <h2
          style={{
            fontSize: 15,
            fontWeight: 600,
            color: "var(--text-1)",
            margin: 0,
            marginBottom: 6,
          }}
        >
          Configura tus sillones para empezar
        </h2>
        <p
          style={{
            fontSize: 13,
            color: "var(--text-2)",
            margin: 0,
            maxWidth: 380,
          }}
        >
          Crea sillones, salas o equipos para organizar tu agenda por recurso.
          Cada uno aparecerá como una columna en la vista del día.
        </p>
      </div>
      <button
        type="button"
        onClick={() => openModal("resources")}
        style={{
          padding: "8px 14px",
          fontSize: 12,
          fontWeight: 600,
          background: "var(--brand)",
          color: "#fff",
          border: "none",
          borderRadius: 6,
          cursor: "pointer",
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          fontFamily: "inherit",
          boxShadow: "0 0 0 1px rgba(124,58,237,0.5), 0 4px 16px -4px rgba(124,58,237,0.4)",
        }}
      >
        <Plus size={14} aria-hidden /> Crear primer sillón
      </button>
    </div>
  );
}
