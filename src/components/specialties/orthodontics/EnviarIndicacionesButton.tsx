"use client";
// Ortodoncia — Paciente y WhatsApp (ws1-t2, W5): botón "Enviar indicaciones"
// del control de hoy, montado en la lista de "Controles de hoy" del Tablero.

import { useState } from "react";
import { Check, Copy, Send } from "lucide-react";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import { sendControlInstructions } from "@/app/actions/orthodontics/whatsapp/sendControlInstructions";
import { isFailure } from "@/app/actions/orthodontics/result";
import s from "@/components/specialties/orthodontics/modulo/modulo.module.css";

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
    return (
      <span className={s.notaExito} role="status">
        <Check size={14} strokeWidth={2.2} aria-hidden />
        Enviadas
      </span>
    );
  }

  return (
    <>
      <ButtonNew
        type="button"
        variant="secondary"
        size="sm"
        icon={
          estado === "copiar" ? (
            <Copy size={14} strokeWidth={1.9} aria-hidden />
          ) : (
            <Send size={14} strokeWidth={1.9} aria-hidden />
          )
        }
        onClick={estado === "copiar" ? copiar : enviar}
        disabled={estado === "cargando"}
      >
        {estado === "cargando" ? "Enviando…" : estado === "copiar" ? "Copiar texto" : "Enviar indicaciones"}
      </ButtonNew>
      {mensaje && (
        <span
          className={estado === "error" ? `${s.nota} ${s.notaPeligro}` : s.nota}
          style={{ maxWidth: 220 }}
          role={estado === "error" ? "alert" : "status"}
        >
          {mensaje}
        </span>
      )}
    </>
  );
}
