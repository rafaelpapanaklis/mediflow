"use client";
// Ortodoncia — ws1-t1 ronda 2: avisar al paciente del próximo control recién
// capturado al firmar, SI hay ventana de 24 h de WhatsApp. Mismo patrón que
// EnviarIndicacionesButton.tsx (Paciente y WhatsApp, ws1-t2, W5).

import { useState } from "react";
import { Check, Copy, Send } from "lucide-react";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import { avisarProximoControlAlPaciente } from "@/app/actions/orthodontics/whatsapp/avisarProximoControlAlPaciente";
import { isFailure } from "@/app/actions/orthodontics/result";
import s from "@/components/specialties/orthodontics/modulo/modulo.module.css";

export function AvisarProximoControlButton({ cardId }: { cardId: string }) {
  const [estado, setEstado] = useState<"idle" | "cargando" | "enviado" | "copiar" | "error">("idle");
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [texto, setTexto] = useState<string | null>(null);

  async function enviar() {
    setEstado("cargando");
    setMensaje(null);
    const r = await avisarProximoControlAlPaciente({ cardId });
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
        Avisado
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
        {estado === "cargando" ? "Enviando…" : estado === "copiar" ? "Copiar texto" : "Avisar al paciente"}
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
