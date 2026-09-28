"use client";
// Ortodoncia — Paciente y WhatsApp (ws1-t2, W5): botón "Enviar indicaciones"
// del control de hoy, montado en la lista de "Controles de hoy" del Tablero.

import { useState } from "react";
import { sendControlInstructions } from "@/app/actions/orthodontics/whatsapp/sendControlInstructions";
import { isFailure } from "@/app/actions/orthodontics/result";

export function EnviarIndicacionesButton({ appointmentId }: { appointmentId: string }) {
  const [estado, setEstado] = useState<"idle" | "cargando" | "enviado" | "copiar" | "error">("idle");
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [texto, setTexto] = useState<string | null>(null);

  async function enviar() {
    setEstado("cargando");
    setMensaje(null);
    const r = await sendControlInstructions({ appointmentId });
    if (isFailure(r)) {
      setEstado("error");
      setMensaje(r.error);
      return;
    }
    setTexto(r.data.texto);
    if (r.data.enviado) {
      setEstado("enviado");
    } else {
      setEstado("copiar");
      setMensaje(r.data.motivoNoEnviado ?? null);
    }
  }

  async function copiar() {
    if (!texto) return;
    try {
      await navigator.clipboard.writeText(texto);
      setMensaje("Copiado.");
    } catch {
      setMensaje("No se pudo copiar. Selecciona el texto a mano.");
    }
  }

  if (estado === "enviado") {
    return <span style={{ fontSize: 11, color: "#34d399" }}>Enviadas</span>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
      <button
        type="button"
        onClick={estado === "copiar" ? copiar : enviar}
        disabled={estado === "cargando"}
        style={{
          fontSize: 11,
          fontWeight: 600,
          padding: "4px 10px",
          borderRadius: 999,
          border: "1px solid var(--border)",
          background: "var(--surface-2)",
          color: "var(--brand)",
          cursor: estado === "cargando" ? "default" : "pointer",
        }}
      >
        {estado === "cargando" ? "Enviando…" : estado === "copiar" ? "Copiar texto" : "Enviar indicaciones"}
      </button>
      {mensaje && (
        <span style={{ fontSize: 10, color: estado === "error" ? "var(--danger, #ef4444)" : "var(--text-3)", maxWidth: 200, textAlign: "right" }}>
          {mensaje}
        </span>
      )}
    </div>
  );
}
